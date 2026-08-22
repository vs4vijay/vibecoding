// Phase 5: WebAudio SFX — pure oscillator/noise synthesis, zero asset files.
//
// The AudioContext is created lazily on the first user gesture (Enter / R key
// in game.ts) to satisfy browser autoplay policies. Every exported function
// is a silent no-op until initAudio() has run, so callers never need to check.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

/** Shared 1s white-noise buffer, created once alongside the context. */
let noiseBuffer: AudioBuffer | null = null;

const MASTER_VOLUME = 0.5;

export function initAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);

    const len = ctx.sampleRate; // 1 second of noise
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Toggle global mute. Returns the new muted state. Safe before init. */
export function toggleMute(): boolean {
  muted = !muted;
  if (master && ctx) {
    master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
  }
  return muted;
}

// ---------------------------------------------------------------------------
// Tiny synth primitives
// ---------------------------------------------------------------------------

/** Pitch-sweeping oscillator blip. */
function blip(
  fromHz: number,
  toHz: number,
  dur: number,
  type: OscillatorType,
  vol: number,
): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(fromHz, 1), t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, 1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Filtered noise burst with a lowpass sweep (explosions, whooshes). */
function noiseBurst(
  dur: number,
  vol: number,
  filterFromHz: number,
  filterToHz: number,
): void {
  if (!ctx || !master || !noiseBuffer) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(Math.max(filterFromHz, 20), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(filterToHz, 20), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------------------
// One-shot SFX
// ---------------------------------------------------------------------------

export const sfx = {
  /** Cannon shot: quick descending square zap. */
  shot(): void {
    blip(520, 130, 0.12, "square", 0.22);
  },
  /** Shell impact: low triangle thud + grit. */
  hit(): void {
    blip(110, 50, 0.16, "triangle", 0.38);
    noiseBurst(0.12, 0.14, 900, 150);
  },
  /** Tank destroyed: big noise explosion + sub drop. */
  explosion(): void {
    noiseBurst(0.7, 0.45, 1600, 60);
    blip(90, 28, 0.5, "sawtooth", 0.28);
  },
  /** Countdown tick. */
  beep(): void {
    blip(440, 440, 0.12, "square", 0.2);
  },
  /** GO!: higher, longer beep. */
  go(): void {
    blip(880, 880, 0.32, "square", 0.26);
  },
  /** Boost pad / pickup boost: rising airy whoosh. */
  boost(): void {
    noiseBurst(0.35, 0.18, 300, 3400);
  },
  /** Shield / triple-shot pickup: rising chime. */
  pickup(): void {
    blip(620, 1240, 0.16, "sine", 0.2);
  },
};

// ---------------------------------------------------------------------------
// Continuous engine hum (created lazily, parameters driven per-frame)
// ---------------------------------------------------------------------------

interface EngineVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}
let engine: EngineVoice | null = null;

function ensureEngine(): EngineVoice {
  if (engine) return engine;
  const osc1 = ctx!.createOscillator();
  osc1.type = "sawtooth";
  const osc2 = ctx!.createOscillator();
  osc2.type = "square";
  const filter = ctx!.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 260;
  const gain = ctx!.createGain();
  gain.gain.value = 0;
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain).connect(master!);
  osc1.start();
  osc2.start();
  engine = { osc1, osc2, filter, gain };
  return engine;
}

/**
 * Per-frame engine update. `speed01` is 0..1 of max speed; `running` gates the
 * volume (hum only during the race itself). All ramps are smoothed so the
 * pitch/glide follows acceleration audibly.
 */
export function updateEngine(speed01: number, running: boolean): void {
  if (!ctx) return;
  const e = ensureEngine();
  const t = ctx.currentTime;
  const s = Math.min(Math.max(speed01, 0), 1);
  const targetGain = running ? 0.02 + s * 0.05 : 0;
  e.gain.gain.setTargetAtTime(targetGain, t, 0.1);
  const freq = 42 + s * 72;
  e.osc1.frequency.setTargetAtTime(freq, t, 0.08);
  e.osc2.frequency.setTargetAtTime(freq * 1.5 + 2, t, 0.08);
  e.filter.frequency.setTargetAtTime(220 + s * 520, t, 0.1);
}
