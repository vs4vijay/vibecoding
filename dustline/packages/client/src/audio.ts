/**
 * Procedural sound effects — zero assets, pure Web Audio synthesis.
 *
 * The AudioContext is created lazily on the first user gesture (browser
 * autoplay policy); nothing touches the DOM at import time, so this module
 * stays importable (and headless-testable) under bun. Web Audio access and
 * persistence are injectable: tests supply a plain-object context factory and
 * an in-memory `{ getItem, setItem }` store.
 *
 * Graph: every voice (oscillator or filtered noise burst) feeds a per-voice
 * gain envelope, which feeds the single master gain — the master gain is the
 * one place where volume and mute are applied, so muting suppresses ALL
 * output, including sounds already in flight.
 */

// ─── Injectable Web Audio surface (structural, DOM-free) ──

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: 'sine' | 'square' | 'sawtooth' | 'triangle';
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: 'lowpass' | 'highpass' | 'bandpass';
  frequency: AudioParamLike;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface AudioContextLike {
  currentTime: number;
  sampleRate: number;
  state: string;
  destination: AudioNodeLike;
  resume(): Promise<void> | void;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
}

export type AudioContextFactory = () => AudioContextLike;

/** Minimal persistence surface (defaults to window.localStorage). */
export interface AudioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ─── Public API ───────────────────────────────────────────

export const DEFAULT_VOLUME = 0.8;

/** localStorage key holding JSON `{volume, muted}`. */
const STORAGE_KEY = 'dustline.audio';

export interface Audio {
  /** Create the context and resume it if suspended; call from a user gesture. */
  unlock(): void;
  /** Gunshot, per weapon character. */
  shot(weaponId: string): void;
  /** Two mechanical clicks (mag out / mag in). */
  reload(): void;
  /** Short high tick confirming a hit. */
  hitMarker(): void;
  /** Two rising blips for a kill by the local player. */
  killConfirm(): void;
  /** Descending sweep on local death. */
  death(): void;
  /** Rising two-tone announcement. */
  matchStart(): void;
  /** Three-tone fanfare. */
  matchEnd(): void;
  /** Clamp to 0..1, apply to the master gain, persist. */
  setVolume(volume: number): void;
  getVolume(): number;
  /** Flip muted state, apply to the master gain, persist. Returns muted. */
  toggleMute(): boolean;
  isMuted(): boolean;
}

// ─── Default (browser) injection points ───────────────────

const defaultContextFactory: AudioContextFactory = () => {
  const ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
  if (!ctor) {
    throw new Error('Web Audio API is not available');
  }
  return new ctor();
};

const defaultStorage: AudioStorage = {
  getItem(key) {
    try {
      return (globalThis as { localStorage?: AudioStorage }).localStorage?.getItem(key) ?? null;
    } catch {
      return null; // privacy modes can throw on storage access
    }
  },
  setItem(key, value) {
    try {
      (globalThis as { localStorage?: AudioStorage }).localStorage?.setItem(key, value);
    } catch {
      // Persistence is best-effort; audio keeps working without it.
    }
  },
};

// ─── Factory ──────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function createAudio(
  contextFactory?: AudioContextFactory,
  storage?: AudioStorage,
): Audio {
  const factory = contextFactory ?? defaultContextFactory;
  const store = storage ?? defaultStorage;

  // Restore persisted settings; corrupt entries fall back to defaults.
  let volume = DEFAULT_VOLUME;
  let muted = false;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
      if (typeof parsed.volume === 'number') volume = clamp01(parsed.volume);
      if (typeof parsed.muted === 'boolean') muted = parsed.muted;
    }
  } catch {
    // Unreadable settings — start clean rather than failing.
  }

  let ctx: AudioContextLike | null = null;
  let master: GainNodeLike | null = null;
  let noiseBuffer: AudioBufferLike | null = null;

  function applyMasterGain(): void {
    if (master) {
      master.gain.value = muted ? 0 : volume;
    }
  }

  function persist(): void {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ volume, muted }));
    } catch {
      // Best-effort persistence.
    }
  }

  /** Lazily create the context (once) and its master gain. */
  function ensureContext(): AudioContextLike | null {
    if (ctx) return ctx;
    try {
      ctx = factory();
    } catch (err) {
      console.warn('audio: Web Audio unavailable', err);
      return null;
    }
    noiseBuffer = null; // noise buffer is per-context
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    return ctx;
  }

  function ensureNoiseBuffer(context: AudioContextLike): AudioBufferLike {
    if (!noiseBuffer) {
      const length = Math.floor(context.sampleRate);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return noiseBuffer;
  }

  /** Schedule a voice unless muted; `at` is the absolute context time. */
  function play(offsetSeconds: number, voice: (at: number) => void): void {
    if (muted) return; // don't even schedule silent output
    const context = ensureContext();
    if (!context || !master) return;
    voice(context.currentTime + offsetSeconds);
  }

  /** Pitched blip with an exponential decay envelope. */
  function tone(
    at: number,
    opts: { type: OscillatorNodeLike['type']; from: number; to?: number; duration: number; peak: number },
  ): void {
    const context = ctx!;
    const osc = context.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.from, at);
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(opts.to, 1), at + opts.duration);
    }
    const gain = context.createGain();
    gain.gain.setValueAtTime(opts.peak, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + opts.duration);
    osc.connect(gain);
    gain.connect(master!);
    osc.start(at);
    osc.stop(at + opts.duration);
  }

  /** Filtered white-noise burst with an exponential decay envelope. */
  function noiseBurst(
    at: number,
    opts: { duration: number; peak: number; filter: BiquadFilterNodeLike['type']; cutoff: number },
  ): void {
    const context = ctx!;
    const source = context.createBufferSource();
    source.buffer = ensureNoiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = opts.filter;
    filter.frequency.setValueAtTime(opts.cutoff, at);
    const gain = context.createGain();
    gain.gain.setValueAtTime(opts.peak, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + opts.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master!);
    source.start(at);
    source.stop(at + opts.duration);
  }

  return {
    unlock() {
      const context = ensureContext();
      if (context && context.state === 'suspended') {
        void context.resume();
      }
    },

    shot(weaponId) {
      play(0, at => {
        if (weaponId === 'ak47') {
          // Heavy, lower-frequency burst with a noise tail.
          tone(at, { type: 'square', from: 120, to: 40, duration: 0.12, peak: 0.5 });
          noiseBurst(at, { duration: 0.18, peak: 0.45, filter: 'lowpass', cutoff: 1400 });
        } else {
          // Glock (and fallback): snappier, higher-pitched crack.
          tone(at, { type: 'square', from: 520, to: 160, duration: 0.06, peak: 0.4 });
          noiseBurst(at, { duration: 0.06, peak: 0.3, filter: 'bandpass', cutoff: 2600 });
        }
      });
    },

    reload() {
      play(0, at => {
        noiseBurst(at, { duration: 0.05, peak: 0.3, filter: 'bandpass', cutoff: 1800 }); // mag out
        noiseBurst(at + 0.12, { duration: 0.07, peak: 0.3, filter: 'bandpass', cutoff: 1000 }); // mag in
      });
    },

    hitMarker() {
      play(0, at => {
        tone(at, { type: 'square', from: 1500, duration: 0.04, peak: 0.22 });
      });
    },

    killConfirm() {
      play(0, at => {
        tone(at, { type: 'square', from: 880, duration: 0.06, peak: 0.28 });
        tone(at + 0.07, { type: 'square', from: 1320, duration: 0.09, peak: 0.28 });
      });
    },

    death() {
      play(0, at => {
        tone(at, { type: 'sawtooth', from: 220, to: 55, duration: 0.5, peak: 0.4 });
      });
    },

    matchStart() {
      play(0, at => {
        tone(at, { type: 'sine', from: 440, duration: 0.1, peak: 0.3 });
        tone(at + 0.12, { type: 'sine', from: 660, duration: 0.15, peak: 0.3 });
      });
    },

    matchEnd() {
      play(0, at => {
        tone(at, { type: 'sine', from: 523, duration: 0.18, peak: 0.3 });
        tone(at + 0.13, { type: 'sine', from: 659, duration: 0.18, peak: 0.3 });
        tone(at + 0.26, { type: 'sine', from: 784, duration: 0.22, peak: 0.3 });
      });
    },

    setVolume(v) {
      volume = clamp01(v);
      applyMasterGain();
      persist();
    },
    getVolume: () => volume,

    toggleMute() {
      muted = !muted;
      applyMasterGain();
      persist();
      return muted;
    },
    isMuted: () => muted,
  };
}
