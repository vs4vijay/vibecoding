#!/usr/bin/env node
/**
 * Scripted verification harness for src/engine/audio.js (task 1.4).
 *
 * Stands in for the "click the page and hear a blip / drag the volume"
 * manual check by driving the manager against a tiny in-harness fake of the
 * WebAudio graph (FakeAudioContext / FakeGainNode / FakeOscillatorNode /
 * FakeAudioParam, all recording connects, automation events, and start/stop
 * calls) plus a fake event target for the gesture wiring. Assertions, per
 * the task:
 *
 *   1. lazy graph creation   -> nothing is constructed at manager creation
 *      or by plain setVolume/setMuted; first use (master access, blip,
 *      resume) constructs exactly one AudioContext ever (double-create guard)
 *   2. volume                -> setVolume clamps to [0,1] (NaN -> 0), applies
 *      to the SAME master gain node immediately (setTargetAtTime scheduled at
 *      the current context time), and volume set before creation becomes the
 *      initial master gain — i.e. live, no reload/rebuild
 *   3. mute/unmute           -> mute ramps master gain to 0; volume changes
 *      while muted stay stored (gain stays 0); unmute restores the stored
 *      volume
 *   4. resume on gesture     -> pointerdown and keydown are both wired; the
 *      first gesture attempts resume exactly once and removes both listeners;
 *      later gestures are inert; a keydown alone also unlocks; an
 *      already-running context is not resumed again (but listeners detach)
 *   5. blip                  -> schedules exactly one oscillator with an
 *      attack/decay gain envelope routed osc -> env -> master -> destination;
 *      starts once and stops after it starts; a blip on a suspended context
 *      also triggers a resume attempt; a second blip while running resumes
 *      nothing new
 *   6. dispose               -> removes both gesture listeners exactly once
 *      (idempotent), gestures after dispose do nothing, and blip/resume are
 *      inert afterwards
 *   7. attach guard          -> attach:true without a target throws
 *
 * Run: node scripts/audio-test.mjs   (plain node, no dependencies)
 */
import { createAudioManager, DEFAULT_VOLUME } from '../src/engine/audio.js';

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
/* Fake WebAudio graph                                                 */
/* ------------------------------------------------------------------ */

/**
 * AudioParam fake: records every automation event in call order. For
 * assertion convenience, setValueAtTime/setTargetAtTime also update
 * `.value` (the harness treats "an event was scheduled" as "applied");
 * direct `.value =` writes go through a counted setter so the harness can
 * assert the manager never writes the parameter directly after node
 * creation (direct writes are what cause clicks).
 */
class FakeAudioParam {
  /**
   * @param {number} initial Initial value (bypasses the write counter,
   *   since the node constructor's value is not the manager's doing).
   */
  constructor(initial) {
    this._value = initial;
    this.directWrites = 0;
    /** @type {Array<{op: string, value?: number, time: number, timeConstant?: number}>} */
    this.events = [];
  }

  /**
   * @returns {number} Current value.
   */
  get value() {
    return this._value;
  }

  /**
   * @param {number} v New value (counted as a direct write).
   */
  set value(v) {
    this._value = v;
    this.directWrites += 1;
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
   * @param {unknown} dest Destination node.
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

/** AudioContext fake: suspended until resumed (async, like a real one). */
class FakeAudioContext {
  /**
   * @param {{state?: string}} [opts] Initial state override.
   */
  constructor({ state = 'suspended' } = {}) {
    this.state = state;
    this.currentTime = 12.5; // nonzero so sloppy time math would stand out
    this.destination = new FakeAudioNode();
    /** @type {FakeGainNode[]} */
    this.createdGains = [];
    /** @type {FakeOscillatorNode[]} */
    this.createdOscillators = [];
    this.resumeCalls = 0;
    /** @type {Promise<boolean>[]} */
    this.resumePromises = [];
  }

  /**
   * @returns {FakeGainNode} A new gain node.
   */
  createGain() {
    const g = new FakeGainNode();
    this.createdGains.push(g);
    return g;
  }

  /**
   * @returns {FakeOscillatorNode} A new oscillator node.
   */
  createOscillator() {
    const o = new FakeOscillatorNode();
    this.createdOscillators.push(o);
    return o;
  }

  /**
   * Flip to 'running' asynchronously, like a real context unlocking inside
   * a gesture (the manager must not rely on it being synchronous).
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

/**
 * EventTarget fake recording add/remove and dispatching to current listeners.
 * @returns {{ added: Array<{type: string}>, removed: Array<{type: string}>, addEventListener: (type: string, fn: (e: unknown) => void) => void, removeEventListener: (type: string, fn: (e: unknown) => void) => void, listenerCount: (type: string) => number, dispatch: (type: string) => void }} The fake target.
 */
function createFakeTarget() {
  /** @type {Map<string, Set<(e: unknown) => void>>} */
  const listeners = new Map();
  /** @type {Array<{type: string}>} */
  const added = [];
  /** @type {Array<{type: string}>} */
  const removed = [];
  return {
    added,
    removed,
    addEventListener(type, fn) {
      added.push({ type });
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      removed.push({ type });
      listeners.get(type)?.delete(fn);
    },
    /**
     * Number of currently registered listeners for a type.
     * @param {string} type Event type.
     * @returns {number} Count.
     */
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    /**
     * Invoke every current listener for a type with a minimal fake event.
     * @param {string} type Event type.
     * @returns {void}
     */
    dispatch(type) {
      for (const fn of listeners.get(type) ?? []) fn({ type, target: null });
    },
  };
}

/** Context factory that counts constructions and remembers the last fake. @returns {{ factory: () => FakeAudioContext, last: () => FakeAudioContext | null, count: () => number }} Tracker. */
function createCountingFactory() {
  let count = 0;
  let last = null;
  return {
    factory() {
      count += 1;
      last = new FakeAudioContext();
      return last;
    },
    /**
     * @returns {FakeAudioContext | null} Last constructed fake context.
     */
    last() {
      return last;
    },
    /**
     * @returns {number} Number of constructions.
     */
    count() {
      return count;
    },
  };
}

/**
 * Wait for all pending fake resume promises to settle.
 * @param {FakeAudioContext} ctx The fake context.
 * @returns {Promise<void>} Resolves after its resume microtask/timeout ran.
 */
async function settle(ctx) {
  await Promise.all(ctx.resumePromises);
  await new Promise((r) => setTimeout(r, 0));
}

/* ------------------------------------------------------------------ */
/* 1. Lazy graph creation + double-create guard                        */
/* ------------------------------------------------------------------ */

section('1. lazy graph creation + double-create guard');
{
  const f = createCountingFactory();
  const t = createFakeTarget();
  const m = createAudioManager({ target: t, attach: true, contextFactory: f.factory });

  check(f.count() === 0, 'no AudioContext is constructed at manager creation');
  check(m.state === 'uninitialized', 'state reads "uninitialized" before first use');
  check(m.volume === DEFAULT_VOLUME, `default volume is DEFAULT_VOLUME (${DEFAULT_VOLUME})`);

  m.setVolume(0.5);
  m.setVolume(1.2);
  m.setMuted(true);
  m.setMuted(false);
  check(f.count() === 0, 'setVolume/setMuted before first use stay lazy (value stored only)');
  check(m.volume === 1, 'stored volume reflects the last setVolume call while lazy');

  const master = m.master;
  check(f.count() === 1, 'accessing master constructs the graph exactly once');
  check(master === m.master && m.context && f.count() === 1,
    'repeat master/context access returns the same graph (no rebuild)');
  check(m.context.state === 'suspended', 'graph starts suspended (unlocked only by resume)');

  m.setVolume(0.3);
  void m.resume();
  m.blip();
  check(f.count() === 1, 'later calls reuse the single AudioContext (no double creation)');

  // Volume set before creation becomes the initial master gain value.
  const f2 = createCountingFactory();
  const m2 = createAudioManager({ attach: false, contextFactory: f2.factory });
  m2.setVolume(0.35);
  check(f2.count() === 0, 'a detached manager is lazy too');
  const master2 = m2.master;
  check(master2.gain.value === 0.35, 'volume set before creation is the initial master gain');
}

/* ------------------------------------------------------------------ */
/* 2. setVolume: clamping + immediate live application                 */
/* ------------------------------------------------------------------ */

section('2. setVolume clamps and applies to the master gain immediately');
{
  const f = createCountingFactory();
  const m = createAudioManager({ attach: false, contextFactory: f.factory });
  m.setVolume(0.42);
  const master = m.master;
  const ctx = f.last();

  check(master === m.master, 'volume changes hit the same master gain node (live, no graph rebuild)');

  const targetEvents = () =>
    master.gain.events.filter((e) => e.op === 'setTarget');

  let before = targetEvents().length;
  m.setVolume(1.7);
  check(m.volume === 1, 'setVolume clamps values above 1 to 1');
  check(targetEvents().length === before + 1, 'each setVolume schedules exactly one gain event');

  m.setVolume(-2);
  check(m.volume === 0, 'setVolume clamps negative values to 0');
  m.setVolume(Number.NaN);
  check(m.volume === 0, 'setVolume treats NaN as 0 (silent, no NaN gain)');

  before = targetEvents().length;
  m.setVolume(0.6);
  const last = targetEvents()[targetEvents().length - 1];
  check(last.value === 0.6, 'the scheduled gain target equals the requested volume');
  check(last.time === ctx.currentTime, 'the gain event is scheduled at the current context time (immediate)');
  check(last.timeConstant > 0 && last.timeConstant <= 0.05, 'the event is a short ramp (click-free), not a snap');
  check(master.gain.value === 0.6, 'the master gain value reflects the new volume right after the call');
  check(master.gain.directWrites === 1, 'gain.value is never written directly after creation (ramps only)');
}

/* ------------------------------------------------------------------ */
/* 3. Mute zeroes output, unmute restores                              */
/* ------------------------------------------------------------------ */

section('3. mute zeroes master output, unmute restores the stored volume');
{
  const f = createCountingFactory();
  const m = createAudioManager({ attach: false, contextFactory: f.factory });
  m.setVolume(0.9);
  const master = m.master;

  const lastTargetValue = () => {
    const evs = master.gain.events.filter((e) => e.op === 'setTarget');
    // Before the first ramp the "target" is simply the initial gain value
    // the manager baked in at creation.
    return evs.length ? evs[evs.length - 1].value : master.gain.value;
  };

  check(lastTargetValue() === 0.9, 'precondition: master target equals the volume');
  m.setMuted(true);
  check(m.muted === true, 'setMuted(true) is reflected in the muted getter');
  check(lastTargetValue() === 0, 'mute ramps the master gain target to 0');

  m.setVolume(0.4);
  check(m.volume === 0.4, 'volume changes while muted are stored');
  check(lastTargetValue() === 0, 'but the output stays silent while muted');

  m.setMuted(false);
  check(m.muted === false, 'setMuted(false) is reflected in the muted getter');
  check(lastTargetValue() === 0.4, 'unmute restores exactly the stored volume');
}

/* ------------------------------------------------------------------ */
/* 4. Resume-on-gesture: exactly once, listeners removed               */
/* ------------------------------------------------------------------ */

section('4. resume-on-gesture fires exactly once and removes its listeners');
{
  const f = createCountingFactory();
  const t = createFakeTarget();
  const m = createAudioManager({ target: t, attach: true, contextFactory: f.factory });

  check(
    t.added.length === 2 &&
      t.added.some((l) => l.type === 'pointerdown') &&
      t.added.some((l) => l.type === 'keydown'),
    'attach wires exactly pointerdown + keydown unlock listeners'
  );

  t.dispatch('pointerdown');
  await settle(f.last());
  check(f.last().resumeCalls === 1, 'the first gesture attempts resume exactly once');
  check(m.state === 'running', 'the context is running after the gesture');
  check(
    t.removed.length === 2 &&
      t.removed.some((l) => l.type === 'pointerdown') &&
      t.removed.some((l) => l.type === 'keydown') &&
      t.listenerCount('pointerdown') === 0 &&
      t.listenerCount('keydown') === 0,
    'both unlock listeners are removed after the unlock'
  );

  t.dispatch('pointerdown');
  t.dispatch('keydown');
  await settle(f.last());
  check(f.last().resumeCalls === 1, 'later gestures are inert (no further resume attempts)');

  // A keydown alone must also unlock.
  const f2 = createCountingFactory();
  const t2 = createFakeTarget();
  const m2 = createAudioManager({ target: t2, attach: true, contextFactory: f2.factory });
  t2.dispatch('keydown');
  await settle(f2.last());
  check(f2.last().resumeCalls === 1 && m2.state === 'running', 'a lone keydown unlocks too');

  // An already-running context must not be resumed again (but listeners detach).
  const runningCtx = new FakeAudioContext({ state: 'running' });
  let runningConstructions = 0;
  const t3 = createFakeTarget();
  const m3 = createAudioManager({
    target: t3,
    attach: true,
    contextFactory() {
      runningConstructions += 1;
      return runningCtx;
    },
  });
  t3.dispatch('pointerdown');
  await settle(runningCtx);
  check(runningCtx.resumeCalls === 0, 'an already-running context is not resumed again');
  check(runningConstructions === 1, 'the running context was still created lazily, once');
  check(t3.listenerCount('pointerdown') === 0 && t3.listenerCount('keydown') === 0,
    'listeners still detach when the context was already running');
}

/* ------------------------------------------------------------------ */
/* 5. blip: one oscillator + envelope through the master gain          */
/* ------------------------------------------------------------------ */

section('5. blip schedules one enveloped oscillator through the master gain');
{
  const f = createCountingFactory();
  const m = createAudioManager({ attach: false, contextFactory: f.factory });

  const osc = m.blip();
  const ctx = f.last();
  const master = m.master;

  check(osc !== null && ctx.createdOscillators.length === 1, 'each blip schedules exactly one oscillator');
  check(ctx.createdGains.length === 2, 'the graph holds the master gain plus one envelope gain');

  check(osc.type === 'sine', 'the blip oscillator is a sine tone');
  check(osc.frequency.value > 200 && osc.frequency.value < 2000, 'the blip frequency is audible (~880 Hz)');

  const env = osc.connections[0];
  check(osc.connections.length === 1 && env === ctx.createdGains[1],
    'the oscillator feeds exactly one envelope gain node');
  check(env.connections.length === 1 && env.connections[0] === master,
    'the envelope gain routes into the master gain');
  check(master.connections.length === 1 && master.connections[0] === ctx.destination,
    'the master gain is wired to context.destination');

  const evs = env.gain.events;
  check(evs.length === 3, 'the envelope is exactly three automation events');
  check(evs[0].op === 'setValueAtTime' && evs[0].value === 0, 'the envelope starts from silence');
  check(evs[1].op === 'linearRamp' && evs[1].value > 0 && evs[1].value <= 1, 'a fast linear attack rises to an audible level');
  check(evs[2].op === 'exponentialRamp' && evs[2].value < 0.001, 'an exponential decay returns to (audible) silence');
  check(evs[0].time < evs[1].time && evs[1].time < evs[2].time, 'the envelope times are strictly ordered');

  check(osc.startCalls === 1, 'the oscillator starts exactly once');
  check(osc.startedAt === evs[0].time, 'it starts when the envelope starts');
  check(osc.stoppedAt !== null && osc.stoppedAt > osc.startedAt, 'it stops after the envelope finishes');

  // A blip on a suspended context also attempts an unlock (best-effort),
  // so a first-click blip is audible once the context resumes.
  check(ctx.resumeCalls === 1, 'a blip on a suspended context triggers a resume attempt');
  await settle(ctx);
  check(m.state === 'running', 'after settling, the context unlocked');

  m.blip();
  check(ctx.createdOscillators.length === 2, 'a second blip schedules a second oscillator');
  check(ctx.resumeCalls === 1, 'a blip while running does not resume again');
}

/* ------------------------------------------------------------------ */
/* 6. dispose: removes listeners, idempotent, freezes the manager      */
/* ------------------------------------------------------------------ */

section('6. dispose removes gesture listeners and is idempotent');
{
  const f = createCountingFactory();
  const t = createFakeTarget();
  const m = createAudioManager({ target: t, attach: true, contextFactory: f.factory });

  m.dispose();
  m.dispose();
  check(
    t.removed.length === 2 &&
      t.listenerCount('pointerdown') === 0 &&
      t.listenerCount('keydown') === 0,
    'double dispose removes each listener exactly once (idempotent, no duplicates)'
  );

  t.dispatch('pointerdown');
  t.dispatch('keydown');
  await new Promise((r) => setTimeout(r, 5));
  check(f.count() === 0, 'gestures after dispose construct and resume nothing');

  check(m.blip() === null, 'blip after dispose is a no-op (returns null)');
  check(await m.resume() === false, 'resume after dispose resolves false without creating a context');
  check(f.count() === 0, 'dispose keeps the manager fully lazy');

  // Disposing an already-unlocked manager is also safe.
  const f2 = createCountingFactory();
  const t2 = createFakeTarget();
  const m2 = createAudioManager({ target: t2, attach: true, contextFactory: f2.factory });
  t2.dispatch('pointerdown');
  await settle(f2.last());
  m2.dispose();
  check(t2.listenerCount('pointerdown') === 0 && t2.listenerCount('keydown') === 0,
    'disposing an unlocked manager leaves no listeners behind');
}

/* ------------------------------------------------------------------ */
/* 7. attach guard                                                     */
/* ------------------------------------------------------------------ */

section('7. attach:true without a target throws');
{
  let threw = false;
  try {
    createAudioManager({ target: null, attach: true, contextFactory: () => new FakeAudioContext() });
  } catch {
    threw = true;
  }
  check(threw, 'attach:true with no DOM target throws a TypeError');
}

console.log(`\naudio-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`audio-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('audio-test: ALL PASS');
