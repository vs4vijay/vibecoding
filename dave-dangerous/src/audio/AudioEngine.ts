// src/audio/AudioEngine.ts
export type SfxId =
  | "jump" | "land" | "shoot" | "collect" | "trophy" | "hurt" | "die"
  | "jetpack" | "door" | "warp" | "oneup" | "gun";

export interface SfxParams { f0: number; f1: number; dur: number; type: OscillatorType; gain: number; }

export const SFX_PARAMS: Record<SfxId, SfxParams> = {
  jump:     { f0: 440, f1: 220, dur: 0.08, type: "square", gain: 0.15 },
  land:     { f0: 150, f1: 90,  dur: 0.04, type: "square", gain: 0.12 },
  shoot:    { f0: 880, f1: 440, dur: 0.03, type: "square", gain: 0.10 },
  collect:  { f0: 523, f1: 784, dur: 0.12, type: "triangle", gain: 0.15 },
  trophy:   { f0: 523, f1: 1047, dur: 0.30, type: "triangle", gain: 0.18 },
  hurt:     { f0: 200, f1: 100, dur: 0.20, type: "sawtooth", gain: 0.18 },
  die:      { f0: 880, f1: 110, dur: 0.80, type: "square", gain: 0.15 },
  jetpack:  { f0: 110, f1: 130, dur: 0.08, type: "square", gain: 0.08 },
  door:     { f0: 220, f1: 330, dur: 0.20, type: "triangle", gain: 0.15 },
  warp:     { f0: 440, f1: 880, dur: 0.15, type: "square", gain: 0.12 },
  oneup:    { f0: 523, f1: 1047, dur: 0.40, type: "triangle", gain: 0.2 },
  gun:      { f0: 220, f1: 330, dur: 0.10, type: "square", gain: 0.12 },
};

export class AudioEngine {
  private supportedFlag: boolean;
  private ctx: AudioContext | null;
  private mutedFlag = false;

  constructor(ctx: AudioContext | null = null) {
    this.ctx = ctx;
    this.supportedFlag = ctx !== null;
  }
  get supported(): boolean { return this.supportedFlag; }

  ensure(): AudioContext | null {
    if (!this.ctx && typeof globalThis.AudioContext === "function") {
      const ctx = new globalThis.AudioContext();
      this.ctx = ctx;
      this.supportedFlag = true;
      if (ctx.state === "suspended") void ctx.resume();
    }
    return this.ctx;
  }

  setMuted(m: boolean): void { this.mutedFlag = m; }
  get muted(): boolean { return this.mutedFlag; }

  playSfx(id: SfxId): void {
    if (this.mutedFlag) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const p = SFX_PARAMS[id];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.f0, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, p.f1), ctx.currentTime + p.dur);
    gain.gain.setValueAtTime(p.gain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + p.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + p.dur);
  }
}
