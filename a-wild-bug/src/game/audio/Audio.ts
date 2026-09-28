import { mulberry32, type Rng } from "../util/Rng";

/**
 * Procedural audio (design D4): one lazy AudioContext on two buses, fully
 * synthesized — zero asset files, zero dependencies, zero loading state.
 *
 * The class is INERT until the first user gesture (title START, any shell
 * press, or a window pointerdown/keydown): before that no AudioContext is
 * constructed at all, satisfying browser autoplay policy, so a silent boot
 * produces no audio and no audio errors. Once unlocked, the graph is
 *
 *   AudioContext → master gain → destination
 *                     ↑ music gain (drone + plucks)
 *                     ↑ sfx gain   (one-shot patches)
 *
 * Muting is gain 0 — the graph keeps running, no reconnect churn.
 *
 * Schedule-only contract: `sfx()` and the music scheduler only ever schedule
 * envelopes at `ctx.currentTime`; nothing here runs inside the sim step's
 * synchronous budget beyond that cheap scheduling call, and every WebAudio
 * failure is swallowed — the game must run fine with no audio at all
 * (`setEnabled(false)` makes every call a no-op, and a browser without
 * working AudioContext drops the system into "unsupported" state).
 *
 * Persistence: `wb.audio.music` / `wb.audio.sfx` (JSON booleans) are read at
 * construction and applied to the bus gains when the context starts; toggles
 * write through. The in-run mute (`setMuted`) drives the MASTER gain for the
 * session only and never touches the stored keys.
 *
 * The debug() view is the harness contract (tools/probe-ui.mjs asserts graph
 * shape, per-event schedule counts and bed continuity through it) — headless
 * captures assert the GRAPH, never audible output.
 */

/** Every synthesized one-shot; names match the gameplay events that fire them. */
export type SfxName = "pickup" | "throw" | "deposit" | "launch" | "sting" | "win" | "lose" | "ui";

/** CLOSED state union (design D4) — the raw AudioContextState never leaks. */
export type AudioState = "idle" | "running" | "suspended" | "closed" | "unsupported" | "disabled";

/** Harness/debug view of the audio graph. */
export interface AudioDebug {
  state: AudioState;
  enabled: boolean;
  muted: boolean;
  music: boolean;
  sfx: boolean;
  /** True once a first gesture built the context + graph. */
  contextCreated: boolean;
  connected: boolean;
  gains: { master: number; music: number; sfx: number } | null;
  nodes: { master: number; music: number; sfx: number };
  counts: Partial<Record<SfxName, number>>;
  sfxTotal: number;
  lastSfx: SfxName | null;
  /** The generative music bed's scheduler state. */
  bed: {
    notes: number;
    /** Seconds until the last scheduled note plays (scheduler health). */
    nextIn: number;
    /** Increments only when the drone is rebuilt — stable across mode changes. */
    generation: number;
    drone: boolean;
    scheduler: boolean;
  };
  /** AudioContext clock (null before the first gesture). */
  time: number | null;
}

const KEY_MUSIC = "wb.audio.music";
const KEY_SFX = "wb.audio.sfx";

const MASTER_LEVEL = 0.9;
/** Music sits ~0.16× the sfx bus so feedback sounds read over the bed. */
const MUSIC_LEVEL = 0.16;
const SFX_LEVEL = 1;
/** Drone level relative to the music bus. */
const DRONE_LEVEL = 0.05;

/** Lookahead scheduler: tick every 25 ms, schedule ~140 ms ahead. */
const TICK_MS = 25;
const LOOKAHEAD = 0.14;

/** A-major pentatonic semitones; plucks span three octaves from A3 (220 Hz). */
const PENTA = [0, 2, 4, 7, 9] as const;
const PLUCK_BASE = 220;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) === true;
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); the session state still works.
  }
}

/** A gain node with a prebuilt attack/decay envelope starting at `t`. */
function env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
  return g;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  /** Shared white-noise buffer for noise-based patches (throw whoosh). */
  private noise: AudioBuffer | null = null;

  private enabled = true;
  private unsupported = false;
  /** Set exactly once, when a gesture first builds the context. */
  private contextCreated = false;
  /** Persisted bus choices (wb.audio.music / wb.audio.sfx), read at boot. */
  private musicOn = readFlag(KEY_MUSIC, true);
  private sfxOn = readFlag(KEY_SFX, true);
  /** Session-scoped master mute — never persisted (design D4). */
  private mutedSession = false;
  private connected = false;

  // Debug counters (harness assertions read these via debug()).
  private nodesMaster = 0;
  private nodesMusic = 0;
  private nodesSfx = 0;
  private readonly counts: Partial<Record<SfxName, number>> = {};
  private sfxTotal = 0;
  private lastSfx: SfxName | null = null;

  // Music bed state: one seeded scheduler that runs across title → day.
  private rng: Rng;
  private timer: number | null = null;
  private nextNoteAt = 0;
  private notes = 0;
  private generation = 0;
  private droneAlive = false;

  constructor(seed: number) {
    this.rng = mulberry32(seed ^ 0x1a0d10);
    // First-gesture unlock (autoplay policy): any press anywhere. The handler
    // is a cheap state guard after the first hit, so it also recovers a
    // context the browser left suspended.
    window.addEventListener("pointerdown", this.onGesture);
    window.addEventListener("keydown", this.onGesture);
  }

  /** Context state; "idle" until the first gesture creates the graph. */
  get state(): AudioState {
    if (!this.enabled) return "disabled";
    if (this.unsupported) return "unsupported";
    const ctx = this.ctx;
    if (!ctx) return "idle";
    // Keep the exposed union CLOSED: the DOM lib's AudioContextState also
    // carries the iOS-only "interrupted", which behaves as running here.
    switch (ctx.state) {
      case "suspended":
        return "suspended";
      case "closed":
        return "closed";
      default:
        return "running";
    }
  }

  /** Persisted MUSIC choice (aria-pressed source for the title toggle). */
  get musicEnabled(): boolean {
    return this.musicOn;
  }

  /** Persisted SFX choice (aria-pressed source for the title toggle). */
  get sfxEnabled(): boolean {
    return this.sfxOn;
  }

  get muted(): boolean {
    return this.mutedSession;
  }

  /**
   * Persists the MUSIC choice and re-applies the bus gain (0 when off — the
   * graph stays connected, no restarts).
   */
  setMusic(on: boolean): void {
    if (this.musicOn === on) return;
    this.musicOn = on;
    writeFlag(KEY_MUSIC, on);
    this.applyGains();
  }

  /** Persists the SFX choice and re-applies the bus gain. */
  setSfx(on: boolean): void {
    if (this.sfxOn === on) return;
    this.sfxOn = on;
    writeFlag(KEY_SFX, on);
    this.applyGains();
  }

  /**
   * Session master mute (the in-run control): master gain 0 for THIS session
   * only — the persisted music/sfx keys are untouched.
   */
  setMuted(muted: boolean): void {
    if (this.mutedSession === muted) return;
    this.mutedSession = muted;
    this.applyGains();
  }

  /**
   * Harness seam (task 8.5): every call becomes a no-op; the context, if one
   * was live, is closed and never re-created.
   */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) return;
    this.stopScheduler();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noise = null;
    this.connected = false;
    this.droneAlive = false;
    if (ctx) {
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        // Already closed; nothing to recover.
      }
    }
  }

  /** Harness/debug view — the probe asserts graph shape and counts through it. */
  debug(): AudioDebug {
    const ctx = this.ctx;
    return {
      state: this.state,
      enabled: this.enabled,
      muted: this.mutedSession,
      music: this.musicOn,
      sfx: this.sfxOn,
      contextCreated: this.contextCreated,
      connected: this.connected,
      gains:
        ctx && this.master && this.musicBus && this.sfxBus
          ? {
              master: this.master.gain.value,
              music: this.musicBus.gain.value,
              sfx: this.sfxBus.gain.value,
            }
          : null,
      nodes: { master: this.nodesMaster, music: this.nodesMusic, sfx: this.nodesSfx },
      counts: { ...this.counts },
      sfxTotal: this.sfxTotal,
      lastSfx: this.lastSfx,
      bed: {
        notes: this.notes,
        nextIn: ctx ? Math.max(0, this.nextNoteAt - ctx.currentTime) : 0,
        generation: this.generation,
        drone: this.droneAlive,
        scheduler: this.timer !== null,
      },
      time: ctx ? ctx.currentTime : null,
    };
  }

  // --- gesture unlock ---------------------------------------------------------

  private readonly onGesture = (): void => {
    if (!this.enabled || this.unsupported) return;
    if (!this.ctx) {
      this.unlock();
      return;
    }
    if (this.ctx.state === "suspended") {
      try {
        void this.ctx.resume().catch(() => undefined);
      } catch {
        // Autoplay policy may still refuse; the next gesture retries.
      }
    }
  };

  /** Creates the context + graph exactly once, on the first user gesture. */
  private unlock(): void {
    if (this.ctx || !this.enabled || this.unsupported) return;
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        this.unsupported = true;
        return;
      }
      const ctx = new Ctor();
      this.ctx = ctx;
      this.contextCreated = true;
      this.buildGraph(ctx);
      try {
        void ctx.resume().catch(() => undefined);
      } catch {
        // A suspended context resumes on the next gesture (onGesture).
      }
    } catch {
      // Construction threw (no audio hardware / stubbed browser): run silent.
      this.unsupported = true;
      this.ctx = null;
      this.master = null;
      this.musicBus = null;
      this.sfxBus = null;
    }
  }

  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.mutedSession ? 0 : MASTER_LEVEL;
    this.master.connect(ctx.destination);
    this.nodesMaster++;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? MUSIC_LEVEL : 0;
    this.musicBus.connect(this.master);
    this.nodesMusic++;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? SFX_LEVEL : 0;
    this.sfxBus.connect(this.master);
    this.nodesSfx++;

    // One shared noise buffer, built once, reused by every noise patch.
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.connected = true;
    this.applyGains();
    this.startBed();
  }

  /** Re-applies every bus gain from the current choice state (short ramp so
   *  toggles click smoothly; the graph itself never reconnects). */
  private applyGains(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const t = ctx.currentTime;
    const ramp = (node: GainNode, value: number) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(value, t + 0.05);
    };
    ramp(this.master, this.mutedSession ? 0 : MASTER_LEVEL);
    ramp(this.musicBus, this.musicOn ? MUSIC_LEVEL : 0);
    ramp(this.sfxBus, this.sfxOn ? SFX_LEVEL : 0);
  }

  // --- sfx patches (schedule-only one-shots) ----------------------------------

  /**
   * Schedules one patch at `ctx.currentTime`. A no-op until the graph exists
   * (pre-gesture events are simply silent) and when the sfx bus is muted.
   * Never throws into the caller: gameplay fires this from live event hooks.
   */
  sfx(name: SfxName): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.sfxBus || !this.sfxOn || ctx.state === "closed") return;
    try {
      switch (name) {
        case "pickup":
          this.patchPickup(ctx);
          break;
        case "throw":
          this.patchThrow(ctx);
          break;
        case "deposit":
          this.patchDeposit(ctx);
          break;
        case "launch":
          this.patchLaunch(ctx);
          break;
        case "sting":
          this.patchSting(ctx);
          break;
        case "win":
          this.patchWin(ctx);
          break;
        case "lose":
          this.patchLose(ctx);
          break;
        case "ui":
          this.patchUi(ctx);
          break;
      }
    } catch {
      return; // a failed patch must never break the event that fired it
    }
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    this.sfxTotal++;
    this.lastSfx = name;
  }

  /** Bright two-oscillator rising blip. */
  private patchPickup(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const o1 = ctx.createOscillator();
    o1.type = "triangle";
    o1.frequency.setValueAtTime(620, t);
    o1.frequency.exponentialRampToValueAtTime(1040, t + 0.09);
    o1.connect(env(ctx, t, 0.34, 0.012, 0.12)).connect(this.sfxBus!);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(1240, t + 0.02);
    o2.frequency.exponentialRampToValueAtTime(2080, t + 0.12);
    o2.connect(env(ctx, t + 0.02, 0.16, 0.01, 0.1)).connect(this.sfxBus!);
    o1.start(t);
    o1.stop(t + 0.16);
    o2.start(t + 0.02);
    o2.stop(t + 0.18);
    this.nodesSfx += 4;
  }

  /** Filtered noise whoosh, band sweeping up as the grain leaves. */
  private patchThrow(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    src.connect(bp).connect(env(ctx, t, 0.4, 0.02, 0.24)).connect(this.sfxBus!);
    src.start(t);
    src.stop(t + 0.3);
    this.nodesSfx += 3;
  }

  /** Low sine thunk plus a bright pentatonic ping — the plunk pays out. */
  private patchDeposit(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const thunk = ctx.createOscillator();
    thunk.type = "sine";
    thunk.frequency.setValueAtTime(170, t);
    thunk.frequency.exponentialRampToValueAtTime(62, t + 0.14);
    thunk.connect(env(ctx, t, 0.55, 0.008, 0.18)).connect(this.sfxBus!);
    thunk.start(t);
    thunk.stop(t + 0.22);
    const ping = ctx.createOscillator();
    ping.type = "sine";
    ping.frequency.value = 1318.5; // E6
    ping.connect(env(ctx, t + 0.04, 0.15, 0.006, 0.5)).connect(this.sfxBus!);
    ping.start(t + 0.04);
    ping.stop(t + 0.6);
    this.nodesSfx += 4;
  }

  /** Rising filtered-saw sweep for the spring-seed launch. */
  private patchLaunch(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(740, t + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1500;
    o.connect(lp).connect(env(ctx, t, 0.26, 0.05, 0.4)).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.5);
    this.nodesSfx += 3;
  }

  /** Dissonant minor-2nd stab with a fast decay — the snatch sting. */
  private patchSting(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;
    hp.connect(env(ctx, t, 0.3, 0.006, 0.3)).connect(this.sfxBus!);
    for (const freq of [392, 415.3]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = freq;
      o.connect(hp);
      o.start(t);
      o.stop(t + 0.34);
    }
    this.nodesSfx += 4;
  }

  /** Major arpeggio up, ~1.5 s — the victory stinger. */
  private patchWin(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.14;
      const last = i === notes.length - 1;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = notes[i];
      o.connect(env(ctx, at, 0.2, 0.008, last ? 1.1 : 0.45)).connect(this.sfxBus!);
      o.start(at);
      o.stop(at + (last ? 1.2 : 0.5));
    }
    this.nodesSfx += 8;
  }

  /** Descending minor line, lowpassed and sagging — the defeat stinger. */
  private patchLose(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(this.sfxBus!);
    const notes = [329.63, 277.18, 220, 164.81]; // E4 C#4 A3 E3
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.26;
      const last = i === notes.length - 1;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(notes[i] * 1.01, at);
      o.frequency.exponentialRampToValueAtTime(notes[i] * 0.985, at + 0.7);
      o.connect(env(ctx, at, 0.24, 0.01, last ? 1.3 : 0.7)).connect(lp);
      o.start(at);
      o.stop(at + (last ? 1.5 : 0.8));
    }
    this.nodesSfx += 9;
  }

  /** Tiny neutral tick for interface presses. */
  private patchUi(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.045);
    o.connect(env(ctx, t, 0.12, 0.004, 0.05)).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.08);
    this.nodesSfx += 2;
  }

  // --- generative music bed ---------------------------------------------------

  /**
   * The bed: a slow detuned drone (its own lowpass, fading in gently) plus a
   * seeded pentatonic pluck pattern on a lookahead scheduler. The scheduler
   * timer runs regardless of mode, so the SAME bed spans title → day with no
   * restart: mode changes touch nothing here (the "generation" counter only
   * moves when the drone is rebuilt).
   */
  private startBed(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    try {
      const t = ctx.currentTime;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 320;
      filter.Q.value = 0.5;
      const droneGain = ctx.createGain();
      droneGain.gain.setValueAtTime(0, t);
      droneGain.gain.linearRampToValueAtTime(DRONE_LEVEL, t + 3);
      filter.connect(droneGain).connect(this.musicBus);
      const voices: Array<[OscillatorType, number, number]> = [
        ["sine", 110, 1], // A2 root
        ["sine", 164.81, 0.35], // E3 fifth
        ["sawtooth", 110.6, 0.12], // slow-beat air
      ];
      for (const [type, freq, level] of voices) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(filter);
        osc.start(t);
        this.nodesMusic += 2;
      }
      this.droneAlive = true;
      this.generation++;
    } catch {
      this.droneAlive = false; // the plucks may still work; never throw
    }
    this.nextNoteAt = ctx.currentTime + 0.2;
    this.timer = window.setInterval(this.tickScheduler, TICK_MS);
  }

  private stopScheduler(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Lookahead scheduling (standard WebAudio pattern): every 25 ms tick, fill
   * the next ~140 ms with plucks. Steps are 0.36 s with occasional 0.72 s
   * rests, so the widest gap between scheduled notes stays well under 1 s and
   * the bed reads sparse, not busy. With music muted the STEP CLOCK keeps
   * advancing (only the plucks are skipped) — re-enabling music can never
   * dump a stale backlog of notes at once.
   */
  private readonly tickScheduler = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.enabled) return;
    try {
      const horizon = ctx.currentTime + LOOKAHEAD;
      while (this.nextNoteAt < horizon) {
        const t = this.nextNoteAt;
        if (this.rng() < 0.74 && this.musicOn) {
          const st = PENTA[Math.floor(this.rng() * PENTA.length)];
          const oct = Math.floor(this.rng() * 3);
          const freq = PLUCK_BASE * Math.pow(2, (st + 12 * oct) / 12);
          this.pluck(t, freq, 0.08 + this.rng() * 0.07);
        }
        this.nextNoteAt += this.rng() < 0.3 ? 0.72 : 0.36;
      }
    } catch {
      // Scheduling must never throw into the game.
    }
  };

  /** One soft triangle pluck with a fast attack and ~1.1 s decay. */
  private pluck(t: number, freq: number, vel: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.15);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 1.25);
    osc.onended = () => {
      g.disconnect();
      osc.disconnect();
    };
    this.nodesMusic += 2;
    this.notes++;
  }
}
