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

// ---------------------------------------------------------------------------
// Procedural music loop (Phase 9)
//
// A 4-bar eighth-note pattern: sawtooth bass line over an Am-F-C-G riff plus
// high-passed noise "hat" blips. Notes are scheduled ahead of time against
// AudioContext.currentTime (lookahead pattern), so timing is sample-accurate
// and immune to frame hitches; every note gets its own gain envelope, so the
// pattern can loop forever without clicks at the seam.
// ---------------------------------------------------------------------------

const MUSIC_BPM = 132;
const STEPS_PER_BAR = 8; // eighth notes
const BARS = 4;
const MUSIC_STEP_DUR = 60 / MUSIC_BPM / 2; // one eighth note in seconds
const MUSIC_TOTAL_STEPS = STEPS_PER_BAR * BARS;
const LOOKAHEAD = 0.25; // seconds of scheduling head-start
const TICK_MS = 80;

/** Music bus — everything routes here, then into master. Kept well under SFX. */
let musicBus: GainNode | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicStep = 0;
let musicNextTime = 0;
let musicPlaying = false;

const MUSIC_BUS_VOLUME = 0.3;

/** Chord root per bar (Hz): Am – F – C – G, one octave below middle range. */
const BAR_ROOTS = [55.0, 43.65, 65.41, 49.0]; // A1 F1 C2 G1

function ensureMusicBus(): GainNode {
  if (!musicBus) {
    musicBus = ctx!.createGain();
    musicBus.gain.value = MUSIC_BUS_VOLUME;
    musicBus.connect(master!);
  }
  return musicBus;
}

/** One enveloped synth note into the music bus (envelope = no clicks). */
function musicNote(
  freq: number,
  time: number,
  dur: number,
  type: OscillatorType,
  vol: number,
): void {
  if (!ctx || !musicBus) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(vol, time + 0.008); // soft attack
  g.gain.exponentialRampToValueAtTime(0.001, time + dur); // full decay
  osc.connect(g).connect(musicBus);
  osc.start(time);
  osc.stop(time + dur + 0.03);
}

/** One hat blip: short high-passed slice of the shared noise buffer. */
function musicHat(time: number, vol: number): void {
  if (!ctx || !musicBus || !noiseBuffer) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  src.connect(hp).connect(g).connect(musicBus);
  src.start(time);
  src.stop(time + 0.07);
}

/** Bass hits on steps 0/3/6 of each bar; step 4 pops up an octave. */
function scheduleMusicStep(stepInLoop: number, time: number): void {
  const bar = Math.floor(stepInLoop / STEPS_PER_BAR) % BARS;
  const step = stepInLoop % STEPS_PER_BAR;
  const root = BAR_ROOTS[bar];

  // Hat on every eighth, accented offbeats for drive
  musicHat(time, step % 2 === 1 ? 0.05 : 0.02);

  if (step === 0) musicNote(root, time, 0.4, "sawtooth", 0.22);
  else if (step === 3) musicNote(root, time, 0.18, "sawtooth", 0.16);
  else if (step === 4) musicNote(root * 2, time, 0.16, "square", 0.09);
  else if (step === 6) musicNote(root * 1.5, time, 0.18, "sawtooth", 0.14);
}

function musicSchedulerTick(): void {
  if (!ctx || !musicBus) return;
  while (musicNextTime < ctx.currentTime + LOOKAHEAD) {
    scheduleMusicStep(musicStep % MUSIC_TOTAL_STEPS, musicNextTime);
    musicStep += 1;
    musicNextTime += MUSIC_STEP_DUR;
  }
}

/** Start the loop from step 0 with a short fade-in. No-op before initAudio(). */
export function startMusic(): void {
  if (!ctx || !master || musicPlaying) return;
  const bus = ensureMusicBus();
  musicPlaying = true;
  musicStep = 0;
  musicNextTime = ctx.currentTime + 0.05;

  // Fade the bus in from wherever it currently sits (covers a stop() fade-out)
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), t);
  bus.gain.linearRampToValueAtTime(MUSIC_BUS_VOLUME, t + 0.35);

  musicSchedulerTick();
  musicTimer = setInterval(musicSchedulerTick, TICK_MS);
}

/**
 * Stop the loop: fade the bus to silence (killing any already-scheduled notes
 * click-free), then halt the scheduler. Restarting begins a fresh pattern.
 */
export function stopMusic(fadeSeconds = 0.6): void {
  if (!ctx || !musicBus) return;
  const t = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.exponentialRampToValueAtTime(0.0001, t + fadeSeconds);
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  musicPlaying = false;
}


// ---------------------------------------------------------------------------
// Pause support (Phase 9): suspending the context freezes ALL audio — SFX,
// engine hum and the music scheduler (which runs on ctx.currentTime) — so
// resume is seamless with no drift or dt-style jumps.
// ---------------------------------------------------------------------------

export function suspendAudio(): void {
  if (ctx && ctx.state === "running") void ctx.suspend();
}

export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}
