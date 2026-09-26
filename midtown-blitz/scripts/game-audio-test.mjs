#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/game-audio.js (task 6.1).
 *
 * Drives the game audio content layer against the same fake-WebAudio pattern
 * as scripts/audio-test.mjs (FakeAudioContext + recording nodes), extended
 * with buffer sources and biquad filters (the game layer needs noise
 * buffers and lowpass/bandpass sweeps). The audio manager gets a running
 * fake context via contextFactory; the music pump interval is disabled
 * (schedulerIntervalMs: null) so the harness advances `ctx.currentTime` and
 * calls pumpScheduler() itself.
 *
 * Assertions, per the task:
 *   a. engine    -> update with rising speed raises the sawtooth pitch
 *                   monotonically (sub tracks an octave below, lowpass opens),
 *                   gain follows throttle; speed 0 + throttle 0 sits at the
 *                   quiet idle; update before setDriving(true) is inert
 *   b. skid      -> high lateral slip at speed raises the skid gain, straight
 *                   driving and low speed keep it at 0, handbrake adds a
 *                   scrape floor; the noise source loops
 *   c. impact    -> each burst schedules a fresh one-shot noise source
 *                   through a lowpass sweep (2800 -> 150 Hz) with a gain
 *                   envelope whose peak scales with intensity
 *   d. chime     -> exactly two enveloped sine notes, the second later and
 *                   higher
 *   e. music     -> startMusic BEFORE the manager has a context defers (no
 *                   graph construction outside a gesture); after the first
 *                   sound builds the graph it schedules notes at strictly
 *                   increasing absolute times and keeps a drift-free grid
 *                   over 3+ simulated minutes; stopMusic halts the pump
 *                   (no new notes) and fades the bus; restart works
 *   f. master    -> every content chain (engine, skid, music, impact, chime,
 *                   click) connects into the audio manager's master gain —
 *                   the same node setVolume/setMuted drive
 *   g. pause     -> setDriving(false) ramps engine + skid gains to 0 and
 *                   later updates stay inert (frozen sim cannot leave sound
 *                   hanging)
 *   h. dispose   -> stops the scheduler and sustained sources; update/impact/
 *                   chime/click/pump are no-ops afterwards
 *
 * Run: node scripts/game-audio-test.mjs   (plain node, no dependencies)
 */
import { createAudioManager } from '../src/engine/audio.js';
import { createGameAudio } from '../src/game/game-audio.js';

let checks = 0;
let failed = 0;

/**
 * Record a single assertion.
 * @param {boolean} cond Condition to assert.
 * @param {string} label Human-readable assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function check(cond, label) {
  checks += 1;
  if (!cond) {
    failed += 1;
    console.log(`    FAIL ${label}`);
  }
  return cond;
}

/**
 * Record a named section header.
 * @param {string} name Section name.
 * @returns {void}
 */
function section(name) {
  console.log(`  ${name}`);
}

/* ------------------------------------------------------------------ */
/* Fake WebAudio graph (pattern from scripts/audio-test.mjs, extended) */
/* ------------------------------------------------------------------ */

/**
 * AudioParam fake: records every automation event in call order; the
 * setTargetAtTime/setValueAtTime target is also mirrored into `.value`
 * ("the scheduled target is the applied value") so assertions can read the
 * last-written target directly.
 */
class FakeAudioParam {
  /**
   * @param {number} initial Initial value.
   */
  constructor(initial) {
    this._value = initial;
    /** @type {Array<{op: string, value?: number, time: number, timeConstant?: number}>} */
    this.events = [];
  }

  /** @returns {number} Current (last-applied) value. */
  get value() {
    return this._value;
  }

  /**
   * @param {number} v New value.
   */
  set value(v) {
    this._value = v;
  }

  /**
   * @param {number} v Target value.
   * @param {number} t Time in seconds.
   * @returns {void}
   */
  setValueAtTime(v, t) {
    this.events.push({ op: 'setValueAtTime', value: v, time: t });
    this._value = v;
  }

  /**
   * @param {number} v Target value.
   * @param {number} t Time in seconds.
   * @returns {void}
   */
  linearRampToValueAtTime(v, t) {
    this.events.push({ op: 'linearRamp', value: v, time: t });
  }

  /**
   * @param {number} v Target value.
   * @param {number} t Time in seconds.
   * @returns {void}
   */
  exponentialRampToValueAtTime(v, t) {
    this.events.push({ op: 'exponentialRamp', value: v, time: t });
  }

  /**
   * @param {number} v Target value.
   * @param {number} t Start time in seconds.
   * @param {number} tc Time constant in seconds.
   * @returns {void}
   */
  setTargetAtTime(v, t, tc) {
    this.events.push({ op: 'setTarget', value: v, time: t, timeConstant: tc });
    this._value = v;
  }

  /**
   * @param {number} t Cancel time in seconds.
   * @returns {void}
   */
  cancelScheduledValues(t) {
    this.events.push({ op: 'cancel', time: t });
  }
}

/**
 * Base node fake: records connect destinations (connect chains like real
 * WebAudio by returning the destination).
 */
class FakeAudioNode {
  constructor() {
    /** @type {unknown[]} */
    this.connections = [];
  }

  /**
   * @param {unknown} dest Destination node or param.
   * @returns {unknown} The destination (WebAudio connect chaining).
   */
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
}

/** GainNode fake with a single `gain` AudioParam. */
class FakeGainNode extends FakeAudioNode {
  constructor() {
    super();
    this.gain = new FakeAudioParam(1);
  }
}

/** OscillatorNode fake with type/frequency and start/stop records. */
class FakeOscillatorNode extends FakeAudioNode {
  constructor() {
    super();
    this.type = '';
    this.frequency = new FakeAudioParam(440);
    this.startCalls = 0;
    this.startedAt = null;
    this.stoppedAt = null;
  }

  /**
   * @param {number} [when] Start time in seconds.
   * @returns {void}
   */
  start(when) {
    this.startCalls += 1;
    this.startedAt = typeof when === 'number' ? when : 0;
  }

  /**
   * @param {number} [when] Stop time in seconds.
   * @returns {void}
   */
  stop(when) {
    this.stoppedAt = typeof when === 'number' ? when : 0;
  }
}

/** BiquadFilterNode fake: type + frequency/Q params. */
class FakeBiquadFilterNode extends FakeAudioNode {
  constructor() {
    super();
    this.type = '';
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
    this.detune = new FakeAudioParam(0);
  }
}

/** AudioBufferSourceNode fake: buffer + loop flag + start/stop records. */
class FakeBufferSourceNode extends FakeAudioNode {
  constructor() {
    super();
    this.buffer = null;
    this.loop = false;
    this.startCalls = 0;
    this.startedAt = null;
    this.stoppedAt = null;
  }

  /**
   * @param {number} [when] Start time in seconds.
   * @returns {void}
   */
  start(when) {
    this.startCalls += 1;
    this.startedAt = typeof when === 'number' ? when : 0;
  }

  /**
   * @param {number} [when] Stop time in seconds.
   * @returns {void}
   */
  stop(when) {
    this.stoppedAt = typeof when === 'number' ? when : 0;
  }
}

/** AudioBuffer fake: Float32Array channels the game layer writes noise into. */
class FakeAudioBuffer {
  /**
   * @param {number} channels Channel count.
   * @param {number} length Samples per channel.
   * @param {number} sampleRate Sample rate in Hz.
   */
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    /** @type {Float32Array[]} */
    this.channels = [];
    for (let i = 0; i < channels; i += 1) this.channels.push(new Float32Array(length));
  }

  /**
   * @param {number} index Channel index.
   * @returns {Float32Array} The channel data.
   */
  getChannelData(index) {
    return this.channels[index] ?? new Float32Array(this.length);
  }
}

/** AudioContext fake: suspended until resumed (async, like a real one). */
class FakeAudioContext {
  /**
   * @param {{state?: string}} [opts] Initial state override.
   */
  constructor({ state = 'suspended' } = {}) {
    this.state = state;
    this.currentTime = 12.5; // nonzero so sloppy time math would stand out
    this.sampleRate = 44100;
    this.destination = new FakeAudioNode();
    /** @type {FakeGainNode[]} */
    this.createdGains = [];
    /** @type {FakeOscillatorNode[]} */
    this.createdOscillators = [];
    /** @type {FakeBiquadFilterNode[]} */
    this.createdBiquadFilters = [];
    /** @type {FakeBufferSourceNode[]} */
    this.createdBufferSources = [];
    /** @type {FakeAudioBuffer[]} */
    this.createdBuffers = [];
    this.resumeCalls = 0;
    /** @type {Promise<boolean>[]} */
    this.resumePromises = [];
  }

  /** @returns {FakeGainNode} A new gain node. */
  createGain() {
    const g = new FakeGainNode();
    this.createdGains.push(g);
    return g;
  }

  /** @returns {FakeOscillatorNode} A new oscillator node. */
  createOscillator() {
    const o = new FakeOscillatorNode();
    this.createdOscillators.push(o);
    return o;
  }

  /** @returns {FakeBiquadFilterNode} A new biquad filter node. */
  createBiquadFilter() {
    const f = new FakeBiquadFilterNode();
    this.createdBiquadFilters.push(f);
    return f;
  }

  /** @returns {FakeBufferSourceNode} A new buffer source node. */
  createBufferSource() {
    const s = new FakeBufferSourceNode();
    this.createdBufferSources.push(s);
    return s;
  }

  /**
   * @param {number} channels Channel count.
   * @param {number} length Samples per channel.
   * @param {number} sampleRate Sample rate in Hz.
   * @returns {FakeAudioBuffer} An empty buffer.
   */
  createBuffer(channels, length, sampleRate) {
    const b = new FakeAudioBuffer(channels, length, sampleRate);
    this.createdBuffers.push(b);
    return b;
  }

  /**
   * Flip to 'running' asynchronously, like a real context unlocking inside
   * a gesture.
   * @returns {Promise<boolean>} Resolves true once running.
   */
  resume() {
    this.resumeCalls += 1;
    const p = new Promise((resolve) => {
      setTimeout(() => {
        this.state = 'running';
        resolve(true);
      }, 0);
    });
    this.resumePromises.push(p);
    return p;
  }
}

/* ------------------------------------------------------------------ */
/* Shared setup helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Wait for a fake context's pending resume promises to settle.
 * @param {FakeAudioContext} ctx The fake context.
 * @returns {Promise<void>} Resolves after its resume microtask/timeout ran.
 */
async function settle(ctx) {
  await Promise.all(ctx.resumePromises);
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * Build a manager + game-audio pair over one fake context. The interval is
 * disabled so the harness pumps the music scheduler manually.
 * @param {{ state?: string }} [opts] Initial context state.
 * @returns {{ ctx: FakeAudioContext, audio: object, gameAudio: object }} The trio.
 */
function makePair({ state = 'running' } = {}) {
  const ctx = new FakeAudioContext({ state });
  const audio = createAudioManager({ attach: false, contextFactory: () => ctx });
  const gameAudio = createGameAudio(audio, { schedulerIntervalMs: null });
  return { ctx, audio, gameAudio };
}

/** A standstill car state / neutral controls pair. */
const IDLE_STATE = { speed: 0, forwardSpeed: 0, lateralSpeed: 0, slipAngle: 0 };
const NEUTRAL_CONTROLS = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/**
 * Locate the game layer's persistent nodes structurally (build order in
 * ensureGraph: engine saw + sub + LFO oscillators, LFO depth gain, engine
 * lowpass, engine gain, skid noise source, skid bandpass, skid gain, music
 * bus gain; the manager's master gain is the very first gain in existence).
 * `musicGain` is the gain that other (envelope) gains feed — it only
 * resolves once at least one music note has been scheduled.
 * @param {FakeAudioContext} ctx The fake context.
 * @returns {{ master: FakeGainNode, saw: FakeOscillatorNode, sub: FakeOscillatorNode,
 *   lfo: FakeOscillatorNode, engineFilter: FakeBiquadFilterNode, engineGain: FakeGainNode,
 *   skidSource: FakeBufferSourceNode, skidFilter: FakeBiquadFilterNode,
 *   skidGain: FakeGainNode, musicGain: FakeGainNode | undefined }} The node handles.
 */
function gameNodes(ctx) {
  const master = ctx.createdGains[0];
  const saw = /** @type {FakeOscillatorNode} */ (
    ctx.createdOscillators.find((o) => o.type === 'sawtooth')
  );
  const lfo = /** @type {FakeOscillatorNode} */ (
    ctx.createdOscillators.find((o) => o.type === 'sine' && o.frequency.value === 13)
  );
  const engineFilter = /** @type {FakeBiquadFilterNode} */ (saw.connections[0]);
  const engineGain = /** @type {FakeGainNode} */ (engineFilter.connections[0]);
  const sub = /** @type {FakeOscillatorNode} */ (
    ctx.createdOscillators.find((o) => o.type === 'triangle') // first triangle = the sub
  );
  const skidSource = ctx.createdBufferSources[0]; // first source ever = the loop
  const skidFilter = /** @type {FakeBiquadFilterNode} */ (
    ctx.createdBiquadFilters.find((f) => f.type === 'bandpass')
  );
  const skidGain = /** @type {FakeGainNode} */ (skidFilter.connections[0]);
  const musicGain = /** @type {FakeGainNode | undefined} */ (
    ctx.createdGains.find(
      (g) =>
        g !== master &&
        g !== engineGain &&
        g !== skidGain &&
        ctx.createdGains.some((e) => e !== g && e.connections.includes(g))
    )
  );
  return { master, saw, sub, lfo, engineFilter, engineGain, skidSource, skidFilter, skidGain, musicGain };
}

/* ------------------------------------------------------------------ */
/* a. Engine: pitch rises with speed, gain follows throttle, idle rest  */
/* ------------------------------------------------------------------ */

section('a. engine: pitch from speed, gain from throttle, quiet idle');
{
  const { ctx, gameAudio } = makePair();

  // Before driving: update is inert — nothing is even built.
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);
  check(ctx.createdOscillators.length === 0, 'update before setDriving(true) builds nothing');

  gameAudio.setDriving(true);
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);
  const nodes = gameNodes(ctx);
  check(nodes.saw.type === 'sawtooth', 'the engine voice has a sawtooth oscillator');
  check(nodes.sub.type === 'triangle', 'the engine voice has a triangle sub oscillator');
  check(nodes.engineFilter.type === 'lowpass', 'the engine voice runs through a lowpass');
  check(nodes.saw.startCalls === 1 && nodes.sub.startCalls === 1 && nodes.lfo.startCalls === 1,
    'engine/sub/LFO sources started exactly once at graph build');
  check(nodes.lfo.frequency.value === 13, 'a slow LFO wobbles the pitch');

  // Idle: speed 0 + throttle 0 -> idle pitch, quiet (not silent) gain.
  check(nodes.saw.frequency.value === 55, `idle pitch is 55 Hz (got ${nodes.saw.frequency.value})`);
  check(nodes.sub.frequency.value === 27.5, 'the sub oscillates an octave below');
  check(nodes.engineGain.gain.value > 0.01 && nodes.engineGain.gain.value < 0.1,
    `idle gain is quiet but audible (got ${nodes.engineGain.gain.value})`);

  // Rising speed at constant throttle -> pitch rises monotonically.
  const freqs = [];
  for (const speed of [0, 10, 20, 30, 40, 50, 55.56]) {
    gameAudio.update(0.016, { ...IDLE_STATE, speed, forwardSpeed: speed }, { ...NEUTRAL_CONTROLS, throttle: 0.8 });
    freqs.push(nodes.saw.frequency.value);
  }
  let monotonic = true;
  for (let i = 1; i < freqs.length; i += 1) {
    if (freqs[i] <= freqs[i - 1]) monotonic = false;
  }
  check(monotonic, `pitch rises monotonically with speed (${freqs.map((f) => f.toFixed(1)).join(' < ')})`);
  check(Math.abs(freqs[0] - (55 + (210 - 55) * 0.15 * 0.8)) < 0.001,
    'standing-still throttle revs above idle (the throttle blend)');
  check(freqs[freqs.length - 1] > 150 && freqs[freqs.length - 1] <= 210,
    'top speed lands high in the 55-210 Hz band');
  check(nodes.sub.frequency.value === nodes.saw.frequency.value / 2, 'the sub tracks the saw');
  const filterFreqs = nodes.engineFilter.frequency.events
    .filter((e) => e.op === 'setTarget')
    .map((e) => e.value);
  check(filterFreqs[filterFreqs.length - 1] > filterFreqs[0] + 1000,
    'the lowpass opens with speed');

  // Gain follows throttle at a fixed speed.
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 27.78, forwardSpeed: 27.78 }, { ...NEUTRAL_CONTROLS, throttle: 0 });
  const gainLowThrottle = nodes.engineGain.gain.value;
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 27.78, forwardSpeed: 27.78 }, { ...NEUTRAL_CONTROLS, throttle: 1 });
  const gainFullThrottle = nodes.engineGain.gain.value;
  check(gainFullThrottle > gainLowThrottle * 1.5,
    `gain follows throttle (${gainLowThrottle.toFixed(3)} -> ${gainFullThrottle.toFixed(3)})`);
}

/* ------------------------------------------------------------------ */
/* b. Skid: slip-driven gain, handbrake floor, straight = silence       */
/* ------------------------------------------------------------------ */

section('b. skid: gain tied to lateral slip, handbrake scrape, silence when straight');
{
  const { ctx, gameAudio } = makePair();
  gameAudio.setDriving(true);
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);
  const nodes = gameNodes(ctx);

  check(nodes.skidSource.loop === true && nodes.skidSource.buffer !== null,
    'the skid voice is a looping noise buffer source');
  check(nodes.skidFilter.type === 'bandpass', 'the noise runs through a bandpass');
  check(nodes.skidGain.gain.value === 0, 'the skid starts silent');

  // Straight driving, no handbrake -> no skid.
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 20, forwardSpeed: 20, lateralSpeed: 0.1 }, NEUTRAL_CONTROLS);
  check(nodes.skidGain.gain.value === 0, 'straight driving keeps the skid silent');

  // High slip at speed -> audible skid (no handbrake needed).
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 20, forwardSpeed: 20, lateralSpeed: 6 }, NEUTRAL_CONTROLS);
  const slipGain = nodes.skidGain.gain.value;
  check(slipGain > 0.15 && slipGain <= 0.22, `high slip raises the skid gain (got ${slipGain.toFixed(3)})`);

  // Handbrake at speed even with little slip -> scrape floor.
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 20, forwardSpeed: 20, lateralSpeed: 0.1 },
    { ...NEUTRAL_CONTROLS, handbrake: true });
  const handbrakeGain = nodes.skidGain.gain.value;
  check(handbrakeGain > 0.1, `handbrake at speed gives a scrape floor (got ${handbrakeGain.toFixed(3)})`);

  // Below the speed threshold -> silent again.
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 1, forwardSpeed: 1, lateralSpeed: 6 }, NEUTRAL_CONTROLS);
  check(nodes.skidGain.gain.value === 0, 'low speed keeps the skid silent');
}

/* ------------------------------------------------------------------ */
/* c. Impact: one-shot noise burst, lowpass sweep, intensity-scaled     */
/* ------------------------------------------------------------------ */

section('c. impact: swept noise burst, louder with intensity');
{
  const { ctx, gameAudio } = makePair();
  gameAudio.setDriving(true);
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);
  const nodes = gameNodes(ctx);

  const sourcesBefore = ctx.createdBufferSources.length;
  gameAudio.impact(0.9);
  check(ctx.createdBufferSources.length === sourcesBefore + 1,
    'each impact schedules a fresh noise source');
  const src = ctx.createdBufferSources[ctx.createdBufferSources.length - 1];
  check(src !== nodes.skidSource && src.loop === false && src.buffer !== null,
    'the burst is a one-shot (non-looping) noise source');
  check(src.startCalls === 1 && src.startedAt !== null && src.stoppedAt !== null && src.stoppedAt > src.startedAt,
    'the burst starts and stops itself');

  const lp = /** @type {FakeBiquadFilterNode} */ (src.connections[0]);
  check(lp.type === 'lowpass', 'the burst runs through a lowpass');
  const sweep = lp.frequency.events;
  check(sweep.length === 2 && sweep[0].op === 'setValueAtTime' && sweep[0].value === 2800,
    'the sweep starts wide open (~2800 Hz)');
  check(sweep[1].op === 'exponentialRamp' && sweep[1].value === 150,
    'the sweep closes down to a thud (~150 Hz)');
  check(sweep[0].time < sweep[1].time, 'the sweep is ordered in time');

  const env = /** @type {FakeGainNode} */ (lp.connections[0]);
  const envEvents = env.gain.events;
  check(envEvents.length === 3, 'the burst envelope is exactly three events');
  check(envEvents[0].op === 'setValueAtTime' && envEvents[0].value === 0, 'the burst starts from silence');
  check(envEvents[1].op === 'linearRamp' && envEvents[1].value > 0.3,
    'a fast attack reaches a loud peak');
  check(envEvents[2].op === 'exponentialRamp' && envEvents[2].value < 0.001,
    'an exponential decay returns to silence');

  // Peak scales with intensity (0.16 + 0.44 * i on the noise env; each
  // impact appends [noise env, thump env] to createdGains).
  gameAudio.impact(0.1);
  const softEnv = ctx.createdGains[ctx.createdGains.length - 2];
  gameAudio.impact(1.0);
  const loudEnv = ctx.createdGains[ctx.createdGains.length - 2];
  const peakOf = (g) =>
    /** @type {FakeGainNode} */ (g).gain.events.find((e) => e.op === 'linearRamp').value;
  check(peakOf(loudEnv) > peakOf(softEnv),
    `louder with intensity (soft ${peakOf(softEnv).toFixed(3)} < loud ${peakOf(loudEnv).toFixed(3)})`);
  check(Math.abs(peakOf(loudEnv) - 0.6) < 0.01, 'full-intensity peak hits the 0.6 ceiling');
}

/* ------------------------------------------------------------------ */
/* d. Chime: two enveloped sine notes, ordered                          */
/* ------------------------------------------------------------------ */

section('d. checkpoint chime: two enveloped sine notes');
{
  const { ctx, gameAudio } = makePair();
  gameAudio.setDriving(true);
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);

  const before = ctx.createdOscillators.length;
  gameAudio.checkpointChime();
  const notes = ctx.createdOscillators.slice(before);
  check(notes.length === 2, 'the chime schedules exactly two notes');
  check(notes.every((o) => o.type === 'sine'), 'both chime notes are sine tones');
  check(notes[0].frequency.value === 880 && notes[1].frequency.value > 1300,
    'the pair is 880 Hz then ~1318 Hz (rising fifth+octave)');
  check(notes[0].startedAt < notes[1].startedAt, 'the second note starts after the first');

  for (const [i, note] of notes.entries()) {
    const env = /** @type {FakeGainNode} */ (note.connections[0]);
    const evs = env.gain.events;
    check(evs.length === 3 && evs[0].op === 'setValueAtTime' && evs[0].value === 0,
      `note ${i + 1} envelope starts from silence`);
    check(evs[1].op === 'linearRamp' && evs[1].value > 0.1 && evs[1].value <= 0.3,
      `note ${i + 1} attacks to an audible level`);
    check(evs[2].op === 'exponentialRamp' && evs[2].value < 0.001,
      `note ${i + 1} decays away`);
    check(evs[0].time < evs[1].time && evs[1].time < evs[2].time,
      `note ${i + 1} envelope times are ordered`);
    check(note.startCalls === 1 && note.stoppedAt !== null && note.stoppedAt > note.startedAt,
      `note ${i + 1} starts and stops itself`);
  }
}

/* ------------------------------------------------------------------ */
/* e. Music: deferred before unlock, drift-free loop, clean stop        */
/* ------------------------------------------------------------------ */

section('e. music: defers before unlock, drift-free over 3+ minutes, stops clean');
{
  // --- defer: startMusic with no manager context constructs nothing.
  const suspended = new FakeAudioContext({ state: 'suspended' });
  let constructions = 0;
  const audio = createAudioManager({
    attach: false,
    contextFactory() {
      constructions += 1;
      return suspended;
    },
  });
  const deferred = createGameAudio(audio, { schedulerIntervalMs: null });
  check(audio.state === 'uninitialized', 'precondition: the manager has no context yet');
  deferred.startMusic();
  check(constructions === 0, 'startMusic before the first gesture constructs no AudioContext');
  check(!deferred.isMusicPlaying(), 'the scheduler is not running while deferred');
  // The first sound (a UI click, itself a gesture) builds the graph and the
  // deferred loop starts right after.
  deferred.uiClick();
  check(constructions === 1, 'the first sound builds the graph exactly once');
  check(deferred.isMusicPlaying(), 'the deferred music loop starts on the first sound');
  await settle(suspended);
  suspended.currentTime += 0.3;
  deferred.pumpScheduler();
  const notesCount = suspended.createdOscillators.filter((o) => o.startedAt > 12.5).length;
  check(notesCount >= 3, `deferred start schedules notes once running (${notesCount} after one pump)`);

  // --- drift: fresh running pair; a first sound builds the graph, then the
  // loop runs over 3+ simulated minutes of manual pumps.
  const { ctx, gameAudio } = makePair();
  gameAudio.uiClick(); // stand-in for the player's first gesture
  gameAudio.startMusic();
  check(gameAudio.isMusicPlaying(), 'startMusic on an unlocked context runs the scheduler');
  const t0 = ctx.currentTime;
  const stepDur = 60 / 104 / 2; // eighth notes at 104 BPM (module constant)
  const barDur = 8 * stepDur;
  for (let i = 0; i < 720; i += 1) {
    ctx.currentTime += 0.25; // 720 * 0.25 s = 180 s = 3 minutes
    gameAudio.pumpScheduler();
  }
  const musicOscs = ctx.createdOscillators.filter((o) => o.startedAt !== null && o.startedAt > t0);
  check(musicOscs.length >= 300,
    `the loop kept scheduling for 3+ simulated minutes (${musicOscs.length} notes)`);

  // Chord pads: one triangle chord per bar -> pad start times sit on the
  // bar grid anchored at the first scheduled bar.
  const padStarts = [
    ...new Set(
      musicOscs
        .filter((o) => o.type === 'triangle' && o.frequency.value > 150)
        .map((o) => o.startedAt)
    ),
  ].sort((a, b) => a - b);
  check(padStarts.length >= 70, `a pad for every bar (${padStarts.length} bars scheduled)`);
  const anchor = padStarts[0];
  let maxDrift = 0;
  for (const [i, t] of padStarts.entries()) {
    const ideal = anchor + i * barDur;
    maxDrift = Math.max(maxDrift, Math.abs(t - ideal));
  }
  check(maxDrift < 0.05, `pad grid drifts less than 50 ms over the whole run (max ${maxDrift * 1000} ms)`);
  let increasing = true;
  for (let i = 1; i < musicOscs.length; i += 1) {
    if (musicOscs[i].startedAt < musicOscs[i - 1].startedAt) increasing = false;
  }
  check(increasing, 'notes are scheduled at non-decreasing absolute times');

  // --- stop: the pump halts and the bus fades.
  const nodes = gameNodes(ctx);
  const countAtStop = ctx.createdOscillators.length;
  gameAudio.stopMusic();
  check(!gameAudio.isMusicPlaying(), 'stopMusic halts the scheduler');
  for (let i = 0; i < 40; i += 1) {
    ctx.currentTime += 0.25;
    gameAudio.pumpScheduler();
  }
  check(ctx.createdOscillators.length === countAtStop, 'no new notes after stopMusic');
  check(nodes.musicGain.gain.events.some((e) => e.op === 'setTarget' && e.value === 0),
    'the music bus ramps to 0 (the scheduled tail fades out)');

  // Restart works (results -> racing again).
  gameAudio.startMusic();
  check(gameAudio.isMusicPlaying(), 'startMusic after stopMusic restarts the loop');
}

/* ------------------------------------------------------------------ */
/* f. Master routing: every chain ends at the manager's master gain     */
/* ------------------------------------------------------------------ */

section('f. everything routes through the audio manager master gain');
{
  const { ctx, audio, gameAudio } = makePair();
  const master = audio.master;
  gameAudio.setDriving(true);
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);
  gameAudio.impact(0.5);
  gameAudio.checkpointChime();
  gameAudio.uiClick();
  gameAudio.startMusic();
  ctx.currentTime += 0.3;
  gameAudio.pumpScheduler();
  const nodes = gameNodes(ctx);

  check(nodes.engineGain.connections.includes(master), 'engine gain -> master');
  check(nodes.skidGain.connections.includes(master), 'skid gain -> master');
  check(nodes.musicGain.connections.includes(master), 'music bus -> master');

  // Every one-shot envelope (impact noise + thump, chime x2, click) feeds
  // the master directly. The engine LFO depth gain routes into an oscillator
  // param instead; the music note envelopes feed the music bus.
  const oneShots = ctx.createdGains.filter(
    (g) => g !== nodes.engineGain && g !== nodes.skidGain && g !== nodes.musicGain && g !== master &&
      g.connections.includes(master)
  );
  check(oneShots.length === 5,
    `all 5 one-shot envelopes (impact x2, chime x2, click) feed the master (got ${oneShots.length})`);

  // The master node the content feeds is the one setVolume drives.
  const before = master.gain.events.filter((e) => e.op === 'setTarget').length;
  audio.setVolume(0.3);
  const events = master.gain.events.filter((e) => e.op === 'setTarget');
  check(events.length === before + 1 && events[events.length - 1].value === 0.3,
    'a master volume change lands on the same node all content feeds');
}

/* ------------------------------------------------------------------ */
/* g. Pause path: setDriving(false) ramps the driving voices to 0       */
/* ------------------------------------------------------------------ */

section('g. pause: driving voices ramp to 0 and stay down');
{
  const { ctx, gameAudio } = makePair();
  gameAudio.setDriving(true);
  const fast = { ...IDLE_STATE, speed: 25, forwardSpeed: 25, lateralSpeed: 5 };
  gameAudio.update(0.016, fast, { ...NEUTRAL_CONTROLS, throttle: 1, handbrake: true });
  const nodes = gameNodes(ctx);
  check(nodes.engineGain.gain.value > 0 && nodes.skidGain.gain.value > 0,
    'precondition: driving with sound raises both voices');

  gameAudio.setDriving(false);
  check(nodes.engineGain.gain.value === 0, 'setDriving(false) ramps the engine gain to 0');
  check(nodes.skidGain.gain.value === 0, 'setDriving(false) ramps the skid gain to 0');

  // A stale update (the sim no longer ticks, but belt and braces) must not
  // resurrect the voices.
  const sawEventsBefore = nodes.saw.frequency.events.length;
  gameAudio.update(0.016, fast, { ...NEUTRAL_CONTROLS, throttle: 1 });
  check(nodes.saw.frequency.events.length === sawEventsBefore,
    'updates after setDriving(false) write nothing');
  check(nodes.engineGain.gain.value === 0, 'the engine gain stays down');

  // Re-entering racing re-arms the voices.
  gameAudio.setDriving(true);
  gameAudio.update(0.016, fast, { ...NEUTRAL_CONTROLS, throttle: 1 });
  check(nodes.engineGain.gain.value > 0, 'setDriving(true) + update re-raises the engine');
}

/* ------------------------------------------------------------------ */
/* h. Dispose: scheduler + sustained sources die, entry points no-op    */
/* ------------------------------------------------------------------ */

section('h. dispose kills the scheduler and sources, entry points become no-ops');
{
  const { ctx, gameAudio } = makePair();
  gameAudio.setDriving(true);
  gameAudio.update(0.016, IDLE_STATE, NEUTRAL_CONTROLS);
  gameAudio.startMusic();
  ctx.currentTime += 0.3;
  gameAudio.pumpScheduler();
  const nodes = gameNodes(ctx);
  check(nodes.saw.stoppedAt === null, 'precondition: engine sources run while alive');

  gameAudio.dispose();
  gameAudio.dispose(); // idempotent
  check(nodes.saw.stoppedAt !== null && nodes.sub.stoppedAt !== null && nodes.lfo.stoppedAt !== null,
    'dispose stops the engine/sub/LFO sources');
  check(nodes.skidSource.stoppedAt !== null, 'dispose stops the skid noise source');
  check(!gameAudio.isMusicPlaying(), 'dispose stops the music scheduler');

  const oscCount = ctx.createdOscillators.length;
  const srcCount = ctx.createdBufferSources.length;
  const sawEvents = nodes.saw.frequency.events.length;
  for (let i = 0; i < 10; i += 1) {
    ctx.currentTime += 0.25;
    gameAudio.pumpScheduler();
  }
  gameAudio.update(0.016, { ...IDLE_STATE, speed: 30, forwardSpeed: 30 }, { ...NEUTRAL_CONTROLS, throttle: 1 });
  gameAudio.impact(0.8);
  gameAudio.checkpointChime();
  gameAudio.uiClick();
  check(ctx.createdOscillators.length === oscCount && ctx.createdBufferSources.length === srcCount,
    'pump/update/impact/chime/click after dispose create nothing');
  check(nodes.saw.frequency.events.length === sawEvents, 'the engine params are untouched after dispose');
}

console.log(`\ngame-audio-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`game-audio-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('game-audio-test: ALL PASS');
