// OWNER: Agent D. Procedural WebAudio: engine loop + all sfx. Contract per
// .plan.md §5. Do not change signatures. No audio files — oscillators and
// noise buffers only. Must not construct AudioContext until unlock() (browser
// autoplay policy); every method must be a safe no-op before unlock().

export type SfxName =
  | "punch"
  | "kick"
  | "hit"
  | "knockdown"
  | "crash"
  | "beep"
  | "go"
  | "ui-move"
  | "ui-confirm"
  | "finish"
  | "remount"
  | "near-miss";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private mutedFlag = false;
  // Engine chain (created on unlock).
  private engA: OscillatorNode | null = null;
  private engB: OscillatorNode | null = null;
  private engGain: GainNode | null = null;
  // Siren loop.
  private sirenOsc: OscillatorNode | null = null;
  private sirenTimer: number | null = null;
  private sirenHigh = false;
  private sirenOn = false;

  constructor() {
    // no-op until unlock()
  }

  /** Call from a user-gesture handler. Idempotent. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const AC =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (w as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = this.mutedFlag ? 0 : 1;
      master.connect(ctx.destination);
      // Engine: saw + square an octave below -> lowpass -> gain.
      const a = ctx.createOscillator();
      a.type = "sawtooth";
      a.frequency.value = 60;
      const b = ctx.createOscillator();
      b.type = "square";
      b.frequency.value = 30;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 720;
      filt.Q.value = 2;
      const g = ctx.createGain();
      g.gain.value = 0;
      a.connect(filt);
      b.connect(filt);
      filt.connect(g);
      g.connect(master);
      a.start();
      b.start();
      this.ctx = ctx;
      this.master = master;
      this.engA = a;
      this.engB = b;
      this.engGain = g;
      void ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
      this.master = null;
      this.engA = null;
      this.engB = null;
      this.engGain = null;
    }
  }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
    } catch {
      /* ignore */
    }
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** rpm01: 0..1 engine rev level; load01: 0..1 throttle load. */
  setEngine(rpm01: number, load01: number): void {
    const ctx = this.ctx;
    const a = this.engA;
    const b = this.engB;
    const g = this.engGain;
    if (!ctx || !a || !b || !g) return;
    const rpm = clamp01(rpm01);
    const load = clamp01(load01);
    const t = ctx.currentTime;
    // Small detune wobble keeps the drone from sounding static.
    const wobble = Math.sin(t * 29) * 3;
    const f = 42 + rpm * 148 + wobble;
    try {
      a.frequency.setTargetAtTime(f, t, 0.04);
      b.frequency.setTargetAtTime(f / 2, t, 0.04);
      g.gain.setTargetAtTime(0.05 + load * 0.12, t, 0.06);
    } catch {
      /* ignore */
    }
  }

  /** Cop siren loop while cops are near; start/stop are idempotent. */
  setSiren(on: boolean): void {
    if (on === this.sirenOn) return;
    if (on) {
      const ctx = this.ctx;
      const master = this.master;
      if (!ctx || !master) return;
      try {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = 660;
        const g = ctx.createGain();
        g.gain.value = 0.055;
        osc.connect(g);
        g.connect(master);
        osc.start();
        this.sirenOsc = osc;
        this.sirenOn = true;
        this.sirenHigh = false;
        this.sirenTimer = window.setInterval(() => {
          this.sirenHigh = !this.sirenHigh;
          const o = this.sirenOsc;
          const c = this.ctx;
          if (!o || !c) return;
          try {
            o.frequency.setValueAtTime(this.sirenHigh ? 880 : 660, c.currentTime);
          } catch {
            /* ignore */
          }
        }, 280);
      } catch {
        /* ignore */
      }
      return;
    }
    this.sirenOn = false;
    if (this.sirenTimer !== null) {
      window.clearInterval(this.sirenTimer);
      this.sirenTimer = null;
    }
    const osc = this.sirenOsc;
    this.sirenOsc = null;
    try {
      if (osc) osc.stop();
    } catch {
      /* ignore */
    }
  }

  play(name: SfxName): void {
    if (!this.ctx) return;
    try {
      switch (name) {
        case "punch":
          this.tone("sine", 150, 55, 0.14, 0.5);
          this.noise(0.07, 0.3, "highpass", 1400, 1400, 0.7);
          break;
        case "kick":
          this.tone("sine", 95, 36, 0.2, 0.6);
          break;
        case "hit":
          this.noise(0.12, 0.45, "bandpass", 1900, 1400, 0.8);
          break;
        case "knockdown":
          this.tone("sawtooth", 320, 55, 0.4, 0.35);
          this.noise(0.3, 0.3, "lowpass", 900, 300, 0.5);
          break;
        case "crash":
          this.noise(0.5, 0.55, "lowpass", 2600, 260, 0.4);
          this.tone("sine", 90, 32, 0.35, 0.5);
          break;
        case "beep":
          this.tone("square", 880, 880, 0.12, 0.2);
          break;
        case "go":
          this.tone("square", 1320, 1320, 0.35, 0.25);
          break;
        case "ui-move":
          this.tone("square", 520, 520, 0.06, 0.15);
          break;
        case "ui-confirm":
          this.tone("square", 520, 520, 0.07, 0.16);
          this.tone("square", 784, 784, 0.1, 0.16, 0.09);
          break;
        case "finish":
          this.tone("triangle", 523, 523, 0.12, 0.2);
          this.tone("triangle", 659, 659, 0.12, 0.2, 0.12);
          this.tone("triangle", 784, 784, 0.2, 0.22, 0.24);
          break;
        case "remount":
          this.tone("square", 240, 170, 0.05, 0.28);
          this.noise(0.06, 0.25, "lowpass", 500, 300, 0.5, 0.09);
          break;
        case "near-miss":
          this.noise(0.28, 0.32, "bandpass", 420, 2600, 1.2);
          break;
      }
    } catch {
      /* never throw */
    }
  }

  /** Pitched blip/thump: f0 -> f1 exponential sweep with decay envelope. */
  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(f0, 1), t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(Math.max(vol, 0.001), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** Filtered white-noise burst with optional filter sweep. */
  private noise(
    dur: number,
    vol: number,
    ftype: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (!this.noiseBuf) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * 0.6));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = ftype;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(Math.max(f0, 10), t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(f1, 10), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(vol, 0.001), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }
}
