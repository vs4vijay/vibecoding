import { save } from "./storage";

/**
 * Structural WebAudio surface used by the engine. Real AudioContext
 * satisfies it; tests substitute minimal fakes.
 */
type AudioParamLike = {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
  setTargetAtTime(value: number, time: number, tau: number): void;
  cancelScheduledValues(time: number): void;
  setTargetAtTime(value: number, time: number, tau: number): void;
};
type AudioNodeLike = { connect(dest: unknown): AudioNodeLike };
type GainLike = AudioNodeLike & { gain: AudioParamLike };
type OscLike = AudioNodeLike & {
  type: string;
  frequency: AudioParamLike;
  detune: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
};
type FilterLike = AudioNodeLike & {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
};
type SourceLike = AudioNodeLike & {
  buffer: unknown;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
};
type BufferLike = { getChannelData(channel: number): Float32Array };
type ContextLike = {
  currentTime: number;
  sampleRate: number;
  destination: unknown;
  resume(): Promise<void>;
  createGain(): GainLike;
  createOscillator(): OscLike;
  createBiquadFilter(): FilterLike;
  createBufferSource(): SourceLike;
  createBuffer(channels: number, length: number, rate: number): BufferLike;
};

type ContextCtor = new () => ContextLike;

const MASTER_LEVEL = 0.9;
const ENGINE_BASE_HZ = 55;
const ENGINE_SPAN_HZ = 70;
const ENGINE_GAIN = 0.05;
const GROAN_MIN_S = 2;
const GROAN_SPAN_S = 3;
/** Double-thump cadence while the car is about to tip. */
const HEART_RATE_HZ = 1.6;
const HEART_GAP_S = 0.16;
/** Scrape bed stays audible this long after the last scrape pulse. */
const SCRAPE_HOLD_MS = 350;
const SILENCE = 0.0001;

/** Snapshot of what the soundscape needs to know this frame. */
export type AudioState = {
  phase: string;
  speed01: number;
  zombiesActive: boolean;
  tiltDanger: boolean;
};

/**
 * Fully synthesized soundscape: engine drone, gunfire, zombie groans, hull
 * thuds, rail scrape, tilt heartbeat and menu stings. Every entry point
 * degrades to a no-op until (and unless) a real AudioContext is acquired
 * on the first user gesture.
 */
export class AudioEngine {
  private ctx: ContextLike | null = null;
  private master: GainLike | null = null;
  private noise: BufferLike | null = null;

  private engOscs: OscLike[] | null = null;
  private engGain: GainLike | null = null;

  private scrapeSrc: SourceLike | null = null;
  private scrapeGain: GainLike | null = null;
  /** performance.now() deadline keeping the scrape bed audible between pulses. */
  private scrapeHoldUntil = -1;

  /** True once a real context exists (browser after a gesture). */
  unlocked = false;
  muted: boolean;

  private groanCountdown = GROAN_MIN_S;
  private heartCountdown = 0;
  private heartOn = false;

  constructor(initialMuted = false) {
    this.muted = initialMuted;
  }

  /**
   * Lazily create the context + master gain + shared noise bed. Call from
   * any user gesture; repeat-safe and inert without WebAudio support.
   */
  unlock(): void {
    if (this.ctx || this.unlocked) return;
    const g = globalThis as {
      AudioContext?: ContextCtor;
      webkitAudioContext?: ContextCtor;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    // No constructor at all: mark attempted so we never retry per frame.
    if (!Ctor) {
      this.unlocked = true;
      return;
    }
    let ctx: ContextLike | null = null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null; // construction can throw in hardened sandboxes
    }
    if (!ctx) {
      this.unlocked = true;
      return;
    }

    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    this.master.connect(ctx.destination);

    // Shared white-noise buffer: shots, thuds, scrape bed and crash all tap it.
    const len = Math.floor(ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    void ctx.resume().catch(() => undefined);

    this.buildEngine();
    this.buildScrapeBed();
    this.unlocked = true;
  }

  /** Persist the mute preference; safe before/without an AudioContext. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    save("muted", muted);
    const t = this.ctx?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(
      muted ? 0 : MASTER_LEVEL,
      t,
      0.02,
    );
  }

  /**
   * Per-frame tick driven by wall dt: engine pitch by speed01, groan
   * scheduler while zombies are active, heartbeat while tipping.
   */
  update(dt: number, state: AudioState): void {
    this.updateEngine(state.speed01, state.phase === "running");
    this.updateGroans(dt, state.zombiesActive);
    this.updateHeartbeat(dt, state.tiltDanger);
  }

  shot(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Noise burst through an 1800 Hz bandpass — the gun crack body.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + 0.06);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.08);
    // Layered click osc gives the transient its snap.
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(1200, t);
    click.frequency.exponentialRampToValueAtTime(300, t + 0.03);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.25, t);
    cg.gain.exponentialRampToValueAtTime(SILENCE, t + 0.03);
    click.connect(cg).connect(this.master!);
    click.start(t);
    click.stop(t + 0.04);
  }

  /** Zombie latched on: dull 80 Hz sine drop plus a slap of noise. */
  attachThud(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + 0.15);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.16);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(SILENCE, t + 0.1);
    src.connect(lp).connect(ng).connect(this.master!);
    src.start(t);
    src.stop(t + 0.12);
  }

  /** Three-note square arpeggio A3 → C#4 → E4 on level-up. */
  levelUpSting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const notes = [220, 277.18, 329.63];
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const start = t0 + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(SILENCE, start);
      g.gain.linearRampToValueAtTime(0.14, start + 0.02);
      g.gain.exponentialRampToValueAtTime(SILENCE, start + 0.22);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  /** Wreck sting: noise boom over a decaying 40 Hz sine. */
  crashSting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + 0.7);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.75);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(40, t);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(SILENCE, t + 0.8);
    sub.connect(sg).connect(this.master!);
    sub.start(t);
    sub.stop(t + 0.85);
  }

  /** Flip warning: slow riser into a boom ~1.2 s later. */
  flipRiser(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENCE, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.9);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + 1.15);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 1.2);
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(42, t + 1.1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(SILENCE, t);
    bg.gain.setValueAtTime(0.5, t + 1.1);
    bg.gain.exponentialRampToValueAtTime(SILENCE, t + 1.9);
    boom.connect(bg).connect(this.master!);
    boom.start(t);
    boom.stop(t + 2);
  }

  /** Menu button feedback. */
  uiClick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 660;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + 0.07);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Re-arm the scrape bed; it self-fades SCRAPE_HOLD_MS after the last call. */
  scrape(): void {
    if (!this.ctx || !this.scrapeGain) return;
    const now = performance.now();
    const retrigger = now >= this.scrapeHoldUntil;
    this.scrapeHoldUntil = now + SCRAPE_HOLD_MS;
    if (retrigger) {
      const t = this.ctx.currentTime;
      this.scrapeGain.gain.cancelScheduledValues(t);
      this.scrapeGain.gain.setValueAtTime(0.22, t);
      this.scrapeGain.gain.exponentialRampToValueAtTime(
        SILENCE,
        t + (SCRAPE_HOLD_MS + 150) / 1000,
      );
    }
  }

  // --- private builders and schedulers -------------------------------------

  /** Two detuned sawtooths through a lowpass; pitch tracks speed01. */
  private buildEngine(): void {
    const ctx = this.ctx!;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = ENGINE_GAIN;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    lp.Q.value = 0.7;
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = ENGINE_BASE_HZ;
      osc.detune.value = detune;
      osc.connect(lp);
      osc.start();
      this.engOscs!.push(osc);
    }
    lp.connect(this.engGain).connect(this.master!);
  }

  /** Looping bandpassed noise bed whose gain is pulsed while scraping. */
  private buildScrapeBed(): void {
    const ctx = this.ctx!;
    this.scrapeSrc = ctx.createBufferSource();
    this.scrapeSrc.buffer = this.noise;
    this.scrapeSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 0.6;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.scrapeSrc.connect(bp).connect(this.scrapeGain).connect(this.master!);
    this.scrapeSrc.start();
  }

  private updateEngine(speed01: number, running: boolean): void {
    if (!this.ctx || !this.engGain || this.engOscs === null) return;
    const t = this.ctx.currentTime;
    const freq = ENGINE_BASE_HZ + speed01 * ENGINE_SPAN_HZ;
    const gain = running ? ENGINE_GAIN : SILENCE;
    this.engGain.gain.setTargetAtTime(gain, t, 0.08);
    for (const osc of this.engOscs) {
      osc.frequency.setTargetAtTime(freq, t, 0.06);
    }
  }

  private updateGroans(dt: number, zombiesActive: boolean): void {
    if (!zombiesActive) {
      this.groanCountdown = Math.min(
        GROAN_MIN_S,
        this.groanCountdown + dt,
      );
      return;
    }
    this.groanCountdown -= dt;
    if (this.groanCountdown > 0) return;
    this.spawnGroan();
    this.groanCountdown = GROAN_MIN_S + Math.random() * GROAN_SPAN_S;
  }

  /** Sawtooth 90–130 Hz with 6 Hz vibrato, ~0.6 s. */
  private spawnGroan(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = 90 + Math.random() * 40;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = base;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENCE, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.12);
    g.gain.setValueAtTime(0.12, t + 0.35);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + 0.6);
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.65);
    lfo.stop(t + 0.65);
  }

  /**
   * 55 Hz double-thump at 1.6 Hz while |imbalance| ≥ 0.75; the pair
   * (lub-dub) fires every beat so the danger cue reads as a pulse.
   */
  private updateHeartbeat(dt: number, danger: boolean): void {
    if (!danger) {
      this.heartOn = false;
      return;
    }
    if (!this.heartOn) {
      this.heartOn = true;
      this.heartCountdown = 0;
    }
    this.heartCountdown -= dt;
    if (this.heartCountdown > 0) return;
    this.spawnThump(0);
    this.spawnThump(HEART_GAP_S);
    this.heartCountdown = 1 / HEART_RATE_HZ;
  }

  private spawnThump(delay: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(55, start);
    osc.frequency.exponentialRampToValueAtTime(38, start + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENCE, start);
    g.gain.linearRampToValueAtTime(0.3, start + 0.015);
    g.gain.exponentialRampToValueAtTime(SILENCE, start + 0.13);
    osc.connect(g).connect(this.master!);
    osc.start(start);
    osc.stop(start + 0.15);
  }
}