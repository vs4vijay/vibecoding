import { describe, it, expect } from 'bun:test';
import {
  createAudio,
  DEFAULT_VOLUME,
  type AudioContextLike,
  type AudioStorage,
} from './audio.js';

// ─── Plain-object node graph recorder ─────────────────────

interface ParamEvent {
  method: 'set' | 'linearRamp' | 'exponentialRamp';
  time: number;
  value: number;
}

function makeParam(value: number) {
  return {
    value,
    events: [] as ParamEvent[],
    setValueAtTime(v: number, t: number) {
      this.events.push({ method: 'set', time: t, value: v });
      return this;
    },
    linearRampToValueAtTime(v: number, t: number) {
      this.events.push({ method: 'linearRamp', time: t, value: v });
      return this;
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      this.events.push({ method: 'exponentialRamp', time: t, value: v });
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  };
}
type FakeParam = ReturnType<typeof makeParam>;

class FakeNode {
  connections: unknown[] = [];
  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connections = [];
  }
}

class FakeOscillator extends FakeNode {
  type = '';
  frequency: FakeParam = makeParam(440);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when?: number): void {
    this.startedAt = when ?? 0;
  }
  stop(when?: number): void {
    this.stoppedAt = when ?? 0;
  }
}

class FakeGain extends FakeNode {
  gain: FakeParam = makeParam(1);
}

class FakeFilter extends FakeNode {
  type = '';
  frequency: FakeParam = makeParam(350);
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when?: number): void {
    this.startedAt = when ?? 0;
  }
  stop(when?: number): void {
    this.stoppedAt = when ?? 0;
  }
}

class FakeBuffer {
  private data = new Map<number, Float32Array>();
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  getChannelData(channel: number): Float32Array {
    let buf = this.data.get(channel);
    if (!buf) {
      buf = new Float32Array(this.length);
      this.data.set(channel, buf);
    }
    return buf;
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';
  destination = new FakeNode();
  resumeCalls = 0;
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  sources: FakeSource[] = [];
  buffers: FakeBuffer[] = [];

  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const buffer = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }
}

/** In-memory stand-in for localStorage (bun's test runtime may lack it). */
class MemoryStorage implements AudioStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** Wire a fake context + factory counter into createAudio. */
function makeAudio(storage?: AudioStorage, context = new FakeContext()) {
  let contextsCreated = 0;
  const factory = (): AudioContextLike => {
    contextsCreated++;
    return context;
  };
  return { audio: createAudio(factory, storage), context, getContextsCreated: () => contextsCreated };
}

/** Total scheduled voice nodes (everything except the master gain). */
function voiceCount(ctx: FakeContext): number {
  return ctx.oscillators.length + ctx.sources.length;
}

// ─── Tests ────────────────────────────────────────────────

describe('audio context lifecycle', () => {
  it('never creates an AudioContext at construction time', () => {
    const { getContextsCreated } = makeAudio(new MemoryStorage());
    expect(getContextsCreated()).toBe(0);
  });

  it('creates the context lazily on first unlock and reuses it afterwards', () => {
    const { audio, getContextsCreated } = makeAudio(new MemoryStorage());
    audio.unlock();
    expect(getContextsCreated()).toBe(1);
    audio.unlock();
    audio.shot('ak47');
    audio.reload();
    expect(getContextsCreated()).toBe(1);
  });

  it('resumes a suspended context on unlock but does not re-resume a running one', () => {
    const { audio, context } = makeAudio(new MemoryStorage(), new FakeContext());
    context.state = 'suspended';
    audio.unlock();
    expect(context.resumeCalls).toBe(1);
    audio.unlock();
    expect(context.resumeCalls).toBe(1);
  });

  it('creates the context on demand when a sound plays before any unlock', () => {
    const { audio, context, getContextsCreated } = makeAudio(new MemoryStorage());
    audio.shot('glock');
    expect(getContextsCreated()).toBe(1);
    expect(context.oscillators.length).toBe(1);
  });
});

describe('procedural sounds', () => {
  it('shot(ak47) is a low burst with a noise tail routed through the master gain', () => {
    const { audio, context } = makeAudio();
    audio.unlock();
    audio.shot('ak47');

    // 1 tonal voice + 1 noise voice
    expect(context.oscillators.length).toBe(1);
    expect(context.sources.length).toBe(1);
    expect(context.filters.length).toBe(1);

    // Character: low-frequency sweep 120 -> 40 Hz
    const osc = context.oscillators[0]!;
    const set = osc.frequency.events.find(e => e.method === 'set');
    const ramp = osc.frequency.events.find(e => e.method === 'exponentialRamp');
    expect(set?.value).toBe(120);
    expect(ramp?.value).toBe(40);

    // Noise tail: lowpassed, longer than the tonal burst (0.18s vs 0.12s)
    expect(context.filters[0]!.type).toBe('lowpass');
    expect(context.sources[0]!.stoppedAt).toBe(0.18);
    expect(osc.stoppedAt).toBe(0.12);

    // Graph: voice gains connect into the master gain, master into destination
    const master = context.gains[0]!;
    expect(master.connections).toContain(context.destination);
    expect(context.gains[1]!.connections).toContain(master);
    expect(context.gains[2]!.connections).toContain(master);
    expect(context.sources[0]!.connections).toContain(context.filters[0]!);
  });

  it('shot(glock) is a snappier, higher-pitched crack than the ak47', () => {
    const { audio, context } = makeAudio();
    audio.shot('glock');

    const osc = context.oscillators[0]!;
    const set = osc.frequency.events.find(e => e.method === 'set');
    expect(set?.value).toBe(520);
    // Snappier: shorter than the ak47 burst
    expect(osc.stoppedAt).toBe(0.06);
    expect(context.filters[0]!.type).toBe('bandpass');
  });

  it('reload() plays two mechanical noise clicks and no tonal voices', () => {
    const { audio, context } = makeAudio();
    audio.reload();

    expect(context.oscillators.length).toBe(0);
    expect(context.sources.length).toBe(2);
    expect(context.filters.length).toBe(2);
    expect(context.sources[0]!.startedAt).toBe(0);
    expect(context.sources[1]!.startedAt).toBe(0.12);
  });

  it('event sounds are tonal, distinct, and short', () => {
    type AudioApi = ReturnType<typeof createAudio>;
    const cases: { sound: (a: AudioApi) => void; oscs: number; freqs: number[] }[] = [
      { sound: a => a.hitMarker(), oscs: 1, freqs: [1500] },
      { sound: a => a.killConfirm(), oscs: 2, freqs: [880, 1320] },
      { sound: a => a.death(), oscs: 1, freqs: [220] },
      { sound: a => a.matchStart(), oscs: 2, freqs: [440, 660] },
      { sound: a => a.matchEnd(), oscs: 3, freqs: [523, 659, 784] },
    ];

    for (const { sound, oscs, freqs } of cases) {
      const { audio, context } = makeAudio();
      audio.unlock();
      sound(audio);

      expect(context.oscillators.length).toBe(oscs);
      expect(context.sources.length).toBe(0);
      expect(context.oscillators.map(o => o.frequency.events[0]?.value)).toEqual(freqs);
      // Everything routes through the master gain
      const master = context.gains[0]!;
      for (const gain of context.gains.slice(1)) {
        expect(gain.connections).toContain(master);
      }
    }
  });
});

describe('mute', () => {
  it('suppresses all output: master gain goes to 0 and no new voices are scheduled', () => {
    const { audio, context } = makeAudio();
    audio.unlock();
    audio.shot('ak47');
    const before = voiceCount(context);

    expect(audio.toggleMute()).toBe(true);
    expect(audio.isMuted()).toBe(true);
    expect(context.gains[0]!.gain.value).toBe(0);

    audio.shot('ak47');
    audio.reload();
    audio.death();
    expect(voiceCount(context)).toBe(before);
  });

  it('unmuting restores the configured volume on the master gain', () => {
    const { audio, context } = makeAudio();
    audio.unlock();
    audio.setVolume(0.3);
    audio.toggleMute();
    audio.toggleMute();
    expect(audio.isMuted()).toBe(false);
    expect(context.gains[0]!.gain.value).toBe(0.3);
  });
});

describe('volume and persistence', () => {
  it('clamps volume into 0..1 and persists it as JSON under dustline.audio', () => {
    const storage = new MemoryStorage();
    const { audio } = makeAudio(storage);

    audio.setVolume(2);
    expect(audio.getVolume()).toBe(1);
    audio.setVolume(-3);
    expect(audio.getVolume()).toBe(0);
    audio.setVolume(0.55);

    const raw = storage.getItem('dustline.audio');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ volume: 0.55, muted: false });
  });

  it('roundtrips settings to a fresh instance from the same storage', () => {
    const storage = new MemoryStorage();

    const first = makeAudio(storage);
    first.audio.setVolume(0.42);
    first.audio.toggleMute();

    const second = makeAudio(storage);
    expect(second.audio.getVolume()).toBe(0.42);
    expect(second.audio.isMuted()).toBe(true);

    // The restored muted state suppresses output immediately
    second.audio.unlock();
    expect(second.context.gains[0]!.gain.value).toBe(0);
    second.audio.shot('ak47');
    expect(voiceCount(second.context)).toBe(0);
  });

  it('starts with the default volume and unmuted when storage is empty', () => {
    const { audio } = makeAudio(new MemoryStorage());
    expect(audio.getVolume()).toBe(DEFAULT_VOLUME);
    expect(audio.isMuted()).toBe(false);
  });

  it('falls back to defaults when persisted settings are corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem('dustline.audio', '{{{not json');

    const { audio } = makeAudio(storage);
    expect(audio.getVolume()).toBe(DEFAULT_VOLUME);
    expect(audio.isMuted()).toBe(false);
    expect(() => audio.shot('ak47')).not.toThrow();
  });
});
