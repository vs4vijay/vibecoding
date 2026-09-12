// src/audio/CinematicAudio.ts
// Layered procedural score + rich SFX synth. Same SfxId vocabulary as AudioEngine
// (src/audio/AudioEngine.ts, kept for tests). Zero binary assets, zero network.
//
// Signal graph:
//   track bus "menu"   ┐
//   track bus "cave"   ├→ musicBus → duckGain ┐
//   track bus "danger" ┘                      ├→ compressor → muteGain → masterGain → destination
//   sfx voices          → sfxBus              ┘
//
// - duckGain is the sidechain: death/shoot/pickups briefly dip the music bus.
// - muteGain gives setMuted a smooth ramp; masterGain carries the master volume.
// - Music is sequenced by a lookahead scheduler ticked from update(dt): it walks
//   16th-note steps on the AudioContext clock (never wall time), queueing ~1.2 s
//   ahead — a full bar at the danger/cave tempos — so rAF hitches never open
//   gaps and repeated runs stay drift-free. Steps schedule oscillators at absolute
//   audio-clock times; only envelopes are allocated per note, and every one-shot
//   source disconnects itself on ended so node count stays bounded.
// - All three cues are written around D (dorian/aeolian) to match the
//   "CATACOMB DEPTHS" palette: deep teal drone beds with warm ember-gold
//   overtones (open fifths, glass bells), crimson-adjacent tension in the
//   danger pulse.
import type { SfxId } from "./AudioEngine";

export type MusicTrack = "menu" | "cave" | "danger";

export interface AudioSettings {
  master: number; // 0..1
  music: number;  // 0..1
  sfx: number;    // 0..1
}

/** Scheduler lookahead on the audio clock (seconds). Covers a full bar at the
 *  cave/danger tempos and comfortably beats the 60 fps update cadence. */
const LOOKAHEAD = 1.2;
/** Track crossfade length for playMusic/stopMusic transitions (seconds). */
const CROSSFADE = 1.2;

/** midi note → Hz (A4 = 440). */
function hz(midi: number): number { return 440 * 2 ** ((midi - 69) / 12); }

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** D-dorian pad cycle for the menu pad glides (midi chord tones). */
const MENU_PAD_CHORDS: readonly (readonly [number, number, number])[] = [
  [50, 53, 57], // Dm:   D3  F3  A3
  [46, 53, 62], // Bb:   Bb2 F3  D4
  [55, 58, 62], // Gm:   G3  Bb3 D4
  [45, 50, 53], // Dm/A: A2  D3  F3
];

/** Sparse bell motif per bar of the menu loop: [step, midi, pan]. */
const MENU_BELLS: readonly (readonly (readonly [number, number, number])[])[] = [
  [],                            // bar 0 — let the drone breathe
  [[0, 77, -0.3]],               // F5, left
  [[8, 74, 0.35]],               // D5, right, off the half-bar
  [[0, 81, 0], [8, 84, -0.2]],   // A5 → C6, closing the phrase
];

/** Danger bass line — 2 bars of 16ths (midi, null = rest). */
const DANGER_BASS: readonly (number | null)[] = [
  38, null, 38, null, 38, null, 45, null, // D2 ··· A2
  38, null, 38, null, 41, null, 43, null, // walk to F2–G2
  38, null, 38, null, 38, null, 45, null,
  38, null, 41, null, 43, null, 45, null, // resolve back up to A2
];

const DANGER_STAB: readonly [number, number, number] = [62, 65, 69]; // Dm: D4 F4 A4

interface TrackDef { bpm: number; bars: number; }

interface ToneOpts {
  type: OscillatorType;
  f0: number;
  f1?: number;          // optional pitch ramp target
  dur: number;
  gain: number;
  dest: AudioNode;
  pan?: number;
  attack?: number;
}

interface NoiseOpts {
  dur: number;
  gain: number;
  dest: AudioNode;
  filter?: { type: BiquadFilterType; f0: number; f1?: number; q?: number };
  pan?: number;
  attack?: number;
}

export class CinematicAudio {
  private mutedFlag = false;
  private disposed = false;
  private settings: AudioSettings = { master: 0.8, music: 0.7, sfx: 0.9 };

  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // buses
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private muteGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private trackGain: Record<MusicTrack, GainNode | null> = { menu: null, cave: null, danger: null };

  // persistent voices (created once at unlock, stopped at dispose)
  private persistent: AudioScheduledSourceNode[] = [];
  private padOscs: OscillatorNode[] = [];
  private dangerBassFilter: BiquadFilterNode | null = null;
  private dangerStabFilter: BiquadFilterNode | null = null;
  private echoIn: GainNode | null = null;

  // lookahead scheduler state (audio-clock domain)
  private currentTrack: MusicTrack | null = null;
  private pendingTrack: MusicTrack | null = null;
  private step = 0;
  private nextStepTime = 0;

  get muted(): boolean { return this.mutedFlag; }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
    const mute = this.muteGain;
    const ctx = this.ctx;
    if (!mute || !ctx) return;
    mute.gain.cancelScheduledValues(ctx.currentTime);
    // ~150 ms perceived ramp via setTargetAtTime; click-free mute/unmute
    mute.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
  }

  /** Create/resume the AudioContext — call from a user-gesture handler. */
  unlock(): void {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => { /* autoplay still blocked */ });
      return;
    }
    if (typeof globalThis.AudioContext !== "function") return; // headless/node — stay silent
    let ctx: AudioContext;
    try {
      ctx = new globalThis.AudioContext();
    } catch {
      return; // no usable audio device — every method keeps no-op'ing
    }
    this.ctx = ctx;
    this.buildGraph(ctx);
    if (ctx.state === "suspended") void ctx.resume().catch(() => { /* autoplay still blocked */ });
    const pending = this.pendingTrack;
    if (pending) {
      this.pendingTrack = null;
      this.playMusic(pending); // a track requested before unlock starts now
    }
  }

  playSfx(id: SfxId): void {
    if (this.mutedFlag) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    switch (id) {
      case "jump": this.sfxJump(t); break;
      case "land": this.sfxLand(t); break;
      case "shoot": this.sfxShoot(t); break;
      case "collect": this.sfxCollect(t); break;
      case "trophy": this.sfxTrophy(t); break;
      case "hurt": this.sfxHurt(t); break;
      case "die": this.sfxDie(t); break;
      case "jetpack": this.sfxJetpack(t); break;
      case "door": this.sfxDoor(t); break;
      case "warp": this.sfxWarp(t); break;
      case "oneup": this.sfxOneup(t); break;
      case "gun": this.sfxGun(t); break;
    }
  }

  playMusic(track: MusicTrack): void {
    this.pendingTrack = track;
    const ctx = this.ctx;
    if (!ctx) return;
    this.pendingTrack = null;
    if (this.currentTrack === track) return; // already on it — keep the groove
    const now = ctx.currentTime + 0.03;
    for (const key of ["menu", "cave", "danger"] as const) {
      const g = this.trackGain[key];
      if (!g) continue;
      const p = g.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(key === track ? 1 : 0, now + CROSSFADE);
    }
    this.currentTrack = track;
    this.step = 0;
    this.nextStepTime = now + 0.08; // clean downbeat just past the fade start
  }

  stopMusic(): void {
    this.pendingTrack = null;
    this.currentTrack = null;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime + 0.02;
    for (const key of ["menu", "cave", "danger"] as const) {
      const g = this.trackGain[key];
      if (!g) continue;
      const p = g.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(0, now + 1.0);
    }
  }

  setSettings(s: Partial<AudioSettings>): void {
    if (s.master !== undefined) this.settings.master = clamp01(s.master);
    if (s.music !== undefined) this.settings.music = clamp01(s.music);
    if (s.sfx !== undefined) this.settings.sfx = clamp01(s.sfx);
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.masterGain?.gain.setTargetAtTime(this.settings.master, now, 0.05);
    this.musicBus?.gain.setTargetAtTime(this.settings.music, now, 0.05);
    this.sfxBus?.gain.setTargetAtTime(this.settings.sfx, now, 0.05);
  }

  /** Per-frame ducking/side-chain; safe to call with dt. Advances the music
   *  scheduler (audio-clock based, so dt itself only matters for cadence). */
  update(_dt: number): void {
    const ctx = this.ctx;
    const track = this.currentTrack;
    if (!ctx || !track || this.mutedFlag) return;
    const def = this.trackDef(track);
    const stepDur = 60 / def.bpm / 4; // 16th note
    const now = ctx.currentTime;
    if (this.nextStepTime < now - 0.5) this.nextStepTime = now + 0.02; // resync after mute/suspension
    let guard = 0;
    while (this.nextStepTime < now + LOOKAHEAD && guard++ < 64) {
      this.scheduleStep(track, this.step, this.nextStepTime);
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % (def.bars * 16);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.currentTrack = null;
    this.pendingTrack = null;
    for (const src of this.persistent) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.persistent = [];
    this.padOscs = [];
    const ctx = this.ctx;
    this.ctx = null;
    this.noiseBuf = null;
    this.muteGain = null;
    this.masterGain = null;
    this.musicBus = null;
    this.duckGain = null;
    this.sfxBus = null;
    this.trackGain = { menu: null, cave: null, danger: null };
    this.dangerBassFilter = null;
    this.dangerStabFilter = null;
    this.echoIn = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => { /* already closing */ });
  }

  // ---------------------------------------------------------------- graph

  private buildGraph(ctx: AudioContext): void {
    // Shared noise bed: one buffer, reused by every burst/percussive hit.
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // Master chain: glue compressor → mute ramp → master volume → out.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const mute = ctx.createGain();
    mute.gain.value = this.mutedFlag ? 0 : 1;
    const master = ctx.createGain();
    master.gain.value = clamp01(this.settings.master);
    comp.connect(mute).connect(master).connect(ctx.destination);
    this.muteGain = mute;
    this.masterGain = master;

    // Buses: music (with sidechain duck) and sfx, independent gains.
    const music = ctx.createGain();
    music.gain.value = clamp01(this.settings.music);
    const duck = ctx.createGain();
    duck.gain.value = 1;
    music.connect(duck).connect(comp);
    const sfx = ctx.createGain();
    sfx.gain.value = clamp01(this.settings.sfx);
    sfx.connect(comp);
    this.musicBus = music;
    this.duckGain = duck;
    this.sfxBus = sfx;

    for (const t of ["menu", "cave", "danger"] as const) {
      const g = ctx.createGain();
      g.gain.value = 0; // faded in by playMusic
      g.connect(music);
      this.trackGain[t] = g;
    }

    this.buildMenuVoices(ctx);
    this.buildCaveVoices(ctx);
    this.buildDangerVoices(ctx);
  }

  /** menu — slow, spacious, mysterious: sub drone + airy detuned-saw pad that
   *  glides through a D-dorian cycle + occasional soft bells into an echo chamber. */
  private buildMenuVoices(ctx: AudioContext): void {
    const bus = this.trackGain.menu;
    if (!bus) return;
    this.drone(ctx, bus, 38, "sine", 0.15, 0.07, 5);  // D2 cavern floor
    this.drone(ctx, bus, 45, "sine", 0.06, 0.05, 4);  // A2 open fifth, ember overtone

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    filter.Q.value = 0.6;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    filter.connect(padGain).connect(bus);
    this.lfo(ctx, 0.05, 230, filter.frequency);   // slow filter breathing
    this.lfo(ctx, 0.033, 0.018, padGain.gain);    // slower swell
    const chord = MENU_PAD_CHORDS[0] ?? [50, 53, 57];
    const pans = [-0.45, 0, 0.45];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = hz(chord[i] ?? 50);
      const pan = ctx.createStereoPanner();
      pan.pan.value = pans[i] ?? 0;
      osc.connect(pan).connect(filter);
      osc.start();
      this.persistent.push(osc);
      this.padOscs.push(osc);
    }

    // Echo chamber for the bell motif (persistent delay + feedback).
    const echoIn = ctx.createGain();
    echoIn.gain.value = 1;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.8; // ~dotted 8th at 56 bpm
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    echoIn.connect(delay);
    delay.connect(fb).connect(delay);
    echoIn.connect(bus);
    delay.connect(bus);
    this.echoIn = echoIn;
  }

  /** cave — mid-tempo ambience: drone bed + a filtered saw whose "tension"
   *  filter slowly opens and closes (rhythm is sequenced in caveStep). */
  private buildCaveVoices(ctx: AudioContext): void {
    const bus = this.trackGain.cave;
    if (!bus) return;
    this.drone(ctx, bus, 38, "triangle", 0.12, 0.04, 3); // D2 bed
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz(50); // D3 shadow voice
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    filter.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    osc.connect(filter).connect(g).connect(bus);
    this.lfo(ctx, 0.09, 150, filter.frequency);
    osc.start();
    this.persistent.push(osc);
  }

  /** danger — pulse/bass/stabs are sequenced per step; only their shared
   *  shaping filters are persistent. */
  private buildDangerVoices(ctx: AudioContext): void {
    const bus = this.trackGain.danger;
    if (!bus) return;
    const bassF = ctx.createBiquadFilter();
    bassF.type = "lowpass";
    bassF.frequency.value = 800;
    bassF.Q.value = 1;
    bassF.connect(bus);
    this.dangerBassFilter = bassF;
    const stabF = ctx.createBiquadFilter();
    stabF.type = "bandpass";
    stabF.frequency.value = 1300;
    stabF.Q.value = 0.8;
    stabF.connect(bus);
    this.dangerStabFilter = stabF;
  }

  private drone(ctx: AudioContext, dest: AudioNode, midi: number, type: OscillatorType, gain: number, lfoRate: number, lfoDepth: number): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz(midi);
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(dest);
    this.lfo(ctx, lfoRate, lfoDepth, osc.detune); // slow detune drift in cents
    osc.start();
    this.persistent.push(osc);
  }

  private lfo(ctx: AudioContext, rate: number, depth: number, target: AudioParam): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(target);
    osc.start();
    this.persistent.push(osc);
  }

  // ------------------------------------------------------------- scheduler

  private trackDef(track: MusicTrack): TrackDef {
    switch (track) {
      case "menu": return { bpm: 56, bars: 4 };
      case "cave": return { bpm: 92, bars: 2 };
      case "danger": return { bpm: 132, bars: 2 };
    }
  }

  private scheduleStep(track: MusicTrack, step: number, t: number): void {
    switch (track) {
      case "menu": this.menuStep(step, t); break;
      case "cave": this.caveStep(step, t); break;
      case "danger": this.dangerStep(step, t); break;
    }
  }

  private menuStep(step: number, t: number): void {
    const bus = this.trackGain.menu;
    if (!bus) return;
    const bar = Math.floor(step / 16);
    const pos = step % 16;
    if (pos === 0) {
      // glide the pad into the next chord of the D-dorian cycle
      const chord = MENU_PAD_CHORDS[bar % MENU_PAD_CHORDS.length] ?? MENU_PAD_CHORDS[0];
      if (chord) {
        for (let i = 0; i < this.padOscs.length; i++) {
          const osc = this.padOscs[i];
          const midi = chord[i];
          if (osc && midi !== undefined) osc.frequency.setTargetAtTime(hz(midi), t, 0.9);
        }
      }
    }
    const bells = MENU_BELLS[bar % MENU_BELLS.length] ?? [];
    const echo = this.echoIn;
    const dest: AudioNode = echo ?? bus;
    for (const [bellPos, midi, pan] of bells) {
      if (bellPos === pos) this.bell(t, hz(midi), pan, 2.6, 0.11, dest);
    }
  }

  private caveStep(step: number, t: number): void {
    const bus = this.trackGain.cave;
    if (!bus) return;
    const bar = Math.floor(step / 16) % 2;
    const pos = step % 16;
    // heartbeat: lub-dub on the downbeats, double-time on the second bar
    if (pos === 0 || pos === 3 || (bar === 1 && (pos === 8 || pos === 11))) {
      const strong = pos === 0 || pos === 8;
      this.tone(t, { type: "sine", f0: 82, f1: 46, dur: strong ? 0.3 : 0.22, gain: strong ? 0.16 : 0.1, dest: bus });
    }
    // sparse metallic ticks on the backbeats
    if (pos === 4 || pos === 12) {
      this.noiseHit(t, { dur: 0.035, gain: 0.045, pan: bar === 0 ? 0.3 : -0.3, filter: { type: "highpass", f0: 5200 }, dest: bus });
    }
    if (bar === 1 && pos === 14) {
      // distant clank in the dark
      this.tone(t, { type: "square", f0: 2350, f1: 1900, dur: 0.07, gain: 0.028, pan: 0.45, dest: bus });
    }
    if (bar === 0 && pos === 7) {
      // water drip
      this.tone(t, { type: "sine", f0: 1250, f1: 880, dur: 0.09, gain: 0.02, pan: -0.55, dest: bus });
    }
  }

  private dangerStep(step: number, t: number): void {
    const bus = this.trackGain.danger;
    if (!bus) return;
    const idx = step % 32; // 2-bar loop
    // four-on-the-floor pulse
    if (idx % 4 === 0) this.tone(t, { type: "sine", f0: 150, f1: 44, dur: 0.14, gain: 0.42, dest: bus });
    // driving 8th bass through the growl filter
    const bass = DANGER_BASS[idx];
    const bassF = this.dangerBassFilter;
    if (bass !== null && bass !== undefined && bassF) {
      this.tone(t, { type: "sawtooth", f0: hz(bass), dur: 0.13, gain: 0.2, attack: 0.006, dest: bassF });
    }
    // higher-register stabs on the off-beats (extra push at the loop seam)
    const stabF = this.dangerStabFilter;
    if ((idx === 2 || idx === 10 || idx === 30) && stabF) {
      for (const midi of DANGER_STAB) {
        this.tone(t, { type: "sawtooth", f0: hz(midi), dur: 0.1, gain: 0.06, dest: stabF });
      }
      if (idx === 30) this.tone(t, { type: "sawtooth", f0: hz(74), dur: 0.12, gain: 0.05, dest: stabF });
    }
    // hats on the 8th off-beats
    if (idx % 4 === 2) {
      this.noiseHit(t, { dur: 0.025, gain: 0.035, pan: idx % 8 === 2 ? 0.25 : -0.25, filter: { type: "highpass", f0: 8000 }, dest: bus });
    }
    // funeral toll anchoring the loop (the game-over read of this cue)
    if (idx === 0) this.bell(t, hz(50), 0, 2.2, 0.07, bus);
  }

  // -------------------------------------------------------- voice helpers

  /** One-shot oscillator with an exponential attack/decay envelope. */
  private tone(t: number, o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    const extras: AudioNode[] = [];
    let tail: AudioNode = g;
    if (o.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      tail = p;
      extras.push(p);
    }
    tail.connect(o.dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      for (const e of extras) e.disconnect();
    };
  }

  /** One-shot noise burst from the shared buffer, optionally shaped by a
   *  biquad (with its own optional frequency sweep) and panned. */
  private noiseHit(t: number, o: NoiseOpts): void {
    const ctx = this.ctx;
    const buf = this.noiseBuf;
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    const extras: AudioNode[] = [];
    let chain: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.setValueAtTime(Math.max(10, o.filter.f0), t);
      if (o.filter.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filter.f1), t + o.dur);
      f.Q.value = o.filter.q ?? 0.8;
      src.connect(f);
      chain = f;
      extras.push(f);
    }
    chain.connect(g);
    let tail: AudioNode = g;
    if (o.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      tail = p;
      extras.push(p);
    }
    tail.connect(o.dest);
    src.start(t, (t * 61.8) % buf.duration);
    src.stop(t + o.dur + 0.05);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      for (const e of extras) e.disconnect();
    };
  }

  /** Glassy two-partial bell (fundamental + inharmonic 2.76× shimmer) through
   *  a per-hit panner; feeds the menu echo chamber when used by the score. */
  private bell(t: number, f: number, pan: number, decay: number, gain: number, dest: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dest);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(p);
    osc.start(t);
    osc.stop(t + decay + 0.05);
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = f * 2.76;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.28), t + 0.006);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.5);
    osc2.connect(g2).connect(p);
    osc2.start(t);
    osc2.stop(t + decay * 0.5 + 0.05);
    osc2.onended = () => {
      osc.disconnect();
      g.disconnect();
      osc2.disconnect();
      g2.disconnect();
      p.disconnect();
    };
  }

  /** Sidechain: dip the music bus, then release. Automation is absolute, so
   *  overlapping ducks simply restart from the current value. */
  private duckMusic(level: number, release: number): void {
    const duck = this.duckGain;
    const ctx = this.ctx;
    if (!duck || !ctx) return;
    const p = duck.gain;
    const now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(level, now + 0.03);
    p.linearRampToValueAtTime(1, now + 0.03 + release);
  }

  // ------------------------------------------------------------------ sfx

  /** jump — energetic up-chirp with a tiny air tick. */
  private sfxJump(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.tone(t, { type: "square", f0: 300, f1: 560, dur: 0.09, gain: 0.12, dest: bus });
    this.noiseHit(t, { dur: 0.04, gain: 0.05, filter: { type: "highpass", f0: 2400 }, dest: bus });
  }

  /** land — soft-body thud: lowpass impact noise + sub pitch drop. */
  private sfxLand(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.tone(t, { type: "sine", f0: 130, f1: 52, dur: 0.1, gain: 0.2, dest: bus });
    this.noiseHit(t, { dur: 0.09, gain: 0.16, filter: { type: "lowpass", f0: 420 }, dest: bus });
    this.duckMusic(0.8, 0.15);
  }

  /** shoot — noise snap + pitch-dropping square; ducks the music briefly. */
  private sfxShoot(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.noiseHit(t, { dur: 0.06, gain: 0.22, filter: { type: "bandpass", f0: 2100, f1: 700, q: 1.1 }, dest: bus });
    this.tone(t, { type: "square", f0: 940, f1: 240, dur: 0.07, gain: 0.14, dest: bus });
    this.duckMusic(0.7, 0.2);
  }

  /** collect — two-note glass chime with a sparkle of air. */
  private sfxCollect(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.bell(t, 659.26, 0.18, 0.6, 0.11, bus);         // E5
    this.bell(t + 0.085, 987.77, 0.28, 0.9, 0.11, bus); // B5
    this.noiseHit(t + 0.085, { dur: 0.18, gain: 0.04, pan: 0.3, filter: { type: "highpass", f0: 6800 }, dest: bus });
  }

  /** trophy — ascending Dm bell arpeggio over a warm sub. */
  private sfxTrophy(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    const notes = [74, 77, 81, 86]; // D5 F5 A5 D6
    notes.forEach((midi, i) => this.bell(t + i * 0.09, hz(midi), i % 2 === 0 ? -0.2 : 0.2, 1.3, 0.1, bus));
    this.tone(t, { type: "sine", f0: hz(38), dur: 0.5, gain: 0.09, attack: 0.02, dest: bus });
    this.duckMusic(0.75, 0.5);
  }

  /** hurt (enemy death) — crunch impact + descending squeak. */
  private sfxHurt(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.noiseHit(t, { dur: 0.12, gain: 0.2, filter: { type: "lowpass", f0: 900, f1: 240 }, dest: bus });
    this.tone(t, { type: "sawtooth", f0: 760, f1: 170, dur: 0.2, gain: 0.1, dest: bus });
    this.tone(t + 0.02, { type: "square", f0: 1500, f1: 420, dur: 0.09, gain: 0.04, pan: 0.3, dest: bus });
    this.duckMusic(0.65, 0.3);
  }

  /** die — long downward sweep layered with impact noise and a sub drop;
   *  the strongest sidechain duck in the game. */
  private sfxDie(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.tone(t, { type: "square", f0: 620, f1: 68, dur: 0.72, gain: 0.16, dest: bus });
    this.tone(t, { type: "sawtooth", f0: 310, f1: 46, dur: 0.72, gain: 0.1, dest: bus });
    this.noiseHit(t, { dur: 0.32, gain: 0.26, filter: { type: "lowpass", f0: 700, f1: 120 }, dest: bus });
    this.tone(t + 0.02, { type: "sine", f0: 96, f1: 36, dur: 0.5, gain: 0.22, dest: bus });
    this.duckMusic(0.3, 0.9);
  }

  /** jetpack — filtered-noise whoosh with a flicker; game.ts retriggers it
   *  every 90 ms while thrusting, so repeats merge into a continuous roar. */
  private sfxJetpack(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.noiseHit(t, { dur: 0.1, gain: 0.13, attack: 0.02, filter: { type: "bandpass", f0: 300, f1: 460, q: 1.2 }, dest: bus });
    this.noiseHit(t + 0.03, { dur: 0.05, gain: 0.035, filter: { type: "highpass", f0: 3200 }, dest: bus });
  }

  /** door — low rumble under a rising harmonic, resolved by a clunk. */
  private sfxDoor(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.noiseHit(t, { dur: 0.7, gain: 0.16, attack: 0.05, filter: { type: "lowpass", f0: 200 }, dest: bus });
    this.tone(t, { type: "sawtooth", f0: 98, f1: 392, dur: 0.55, gain: 0.07, attack: 0.08, dest: bus });
    this.tone(t + 0.55, { type: "sine", f0: 170, f1: 58, dur: 0.14, gain: 0.2, dest: bus });
    this.duckMusic(0.6, 0.6);
  }

  /** warp — level-clear riser into an arrival chord + sub drop. */
  private sfxWarp(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.noiseHit(t, { dur: 0.8, gain: 0.1, attack: 0.3, filter: { type: "bandpass", f0: 380, f1: 3400, q: 1.5 }, dest: bus });
    this.tone(t, { type: "sawtooth", f0: 170, f1: 1200, dur: 0.8, gain: 0.07, attack: 0.25, dest: bus });
    this.bell(t + 0.8, hz(74), 0, 1.6, 0.1, bus);    // D5
    this.bell(t + 0.8, hz(81), 0.25, 1.6, 0.08, bus); // A5
    this.tone(t + 0.8, { type: "sine", f0: 220, f1: 58, dur: 0.3, gain: 0.16, dest: bus });
    this.duckMusic(0.5, 0.9);
  }

  /** oneup — bright ascending D-dorian bell run. */
  private sfxOneup(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    const notes = [74, 81, 86, 88]; // D5 A5 D6 E6
    notes.forEach((midi, i) => this.bell(t + i * 0.08, hz(midi), i % 2 === 0 ? -0.25 : 0.25, 0.9, 0.09, bus));
    this.noiseHit(t + 0.24, { dur: 0.2, gain: 0.035, filter: { type: "highpass", f0: 7000 }, dest: bus });
  }

  /** gun — metallic pickup: click + rising fifth motif with a glassy tail. */
  private sfxGun(t: number): void {
    const bus = this.sfxBus;
    if (!bus) return;
    this.noiseHit(t, { dur: 0.05, gain: 0.12, filter: { type: "bandpass", f0: 3000, q: 2 }, dest: bus });
    this.tone(t, { type: "square", f0: hz(50), f1: hz(57), dur: 0.12, gain: 0.1, dest: bus });
    this.bell(t + 0.1, hz(69), 0, 0.7, 0.07, bus);
    this.duckMusic(0.85, 0.25);
  }
}
