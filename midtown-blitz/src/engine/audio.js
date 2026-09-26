/**
 * WebAudio audio manager (Midtown Blitz engine, task 1.4).
 *
 * Owns the app-lifetime WebAudio graph: a single master GainNode (the
 * settings volume, per design Decision 8) feeding `context.destination`.
 * Everything the later audio-content pass (task 6.1) synthesizes connects
 * into `master`, so master volume and mute apply to all sound live.
 *
 * Autoplay-policy handling:
 *  - The AudioContext is created lazily (never at manager creation), so the
 *    loading screen and a normal boot stay completely silent by design.
 *  - `window`-level `pointerdown`/`keydown` listeners (attached by default)
 *    unlock audio on the player's first gesture: the handler detaches itself
 *    immediately (so the resume wire-up fires exactly once per session) and
 *    calls `resume()`, which creates the graph if needed and resumes the
 *    context. The context is therefore created inside a gesture and starts
 *    running — no blocked-autoplay console warnings in a normal session.
 *  - `blip()` (and any other entry point) is safe to call before the unlock:
 *    it triggers `resume()` as a fallback and merely schedules nodes; WebAudio
 *    plays the scheduled envelope once the context actually runs. No sound
 *    is ever *started* by the manager outside a gesture.
 *
 * Volume/mute model: the master gain's effective value is `muted ? 0 :
 * volume`. Every change is applied with `setTargetAtTime` (a short ramp from
 * the current value) so volume changes are immediate but click-free; the
 * raw `gain.value` is only written once, at node creation.
 *
 * Like loop.js (`frame(nowMs)`) and input.js (`handleKeyDown`), the manager
 * takes its WebAudio implementation as an injectable `contextFactory`, so a
 * plain-node harness can supply a fake AudioContext and assert the graph —
 * no browser or jsdom needed.
 */

/** Default master volume (0..1) before the settings module supplies one. */
export const DEFAULT_VOLUME = 0.8;

/**
 * Time constant (seconds) for master-gain ramps: short enough that a volume
 * change is effectively immediate, long enough to avoid zipper clicks.
 */
const GAIN_TIME_CONSTANT_S = 0.015;

/** Test-blip tone frequency in Hz. */
const BLIP_FREQ_HZ = 880;

/** Test-blip peak envelope level (pre-master-gain). */
const BLIP_LEVEL = 0.5;

/** Test-blip envelope attack time in seconds. */
const BLIP_ATTACK_S = 0.005;

/** Test-blip exponential decay time in seconds (after the attack). */
const BLIP_DECAY_S = 0.15;

/**
 * Small scheduling lead so a blip's envelope never starts exactly "now"
 * (avoids racing the current audio quantum).
 */
const BLIP_LEAD_S = 0.02;

/**
 * Default AudioContext constructor (browser). Node harnesses inject a fake
 * via the `contextFactory` option instead of ever reaching this.
 * @returns {AudioContext} A fresh (suspended until unlocked) AudioContext.
 */
function defaultContextFactory() {
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ?? window.webkitAudioContext
      : null;
  if (typeof Ctor !== 'function') {
    throw new Error(
      'createAudioManager: no WebAudio AudioContext available; supply a contextFactory (node harnesses do this)'
    );
  }
  return new Ctor();
}

/**
 * Handle for a created audio manager.
 *
 * @typedef {object} AudioManager
 * @property {(value: number) => number} setVolume Set the master volume;
 *   clamped to [0, 1] (NaN counts as 0) and applied to the master gain
 *   immediately (short click-free ramp). Returns the clamped value.
 *   Applied live even while muted — the stored volume is what unmute restores.
 * @property {(muted: boolean) => void} setMuted Mute (master gain ramps to
 *   0) or unmute (ramps back to the stored volume). Immediate, click-free.
 * @property {() => Promise<boolean>} resume Create the graph if needed and
 *   resume the context; resolves true once the context state is 'running'.
 *   Safe to call repeatedly; safe outside a gesture (it may just stay
 *   suspended until the player interacts).
 * @property {() => (object | null)} blip Schedule one short synthesized test
 *   tone (oscillator + gain envelope) through the master gain. Returns the
 *   oscillator, or null after dispose. If the context is not running yet it
 *   also triggers `resume()`; the scheduled blip plays on unlock.
 * @property {() => void} dispose Remove the gesture listeners and freeze the
 *   manager (resume/blip become no-ops). Does NOT close the AudioContext —
 *   the manager is an app-lifetime singleton and its graph may still be in
 *   use. Safe to call more than once.
 * @property {() => number} volume Currently stored (clamped) volume in [0, 1].
 * @property {() => boolean} muted Current mute flag.
 * @property {() => string} state 'uninitialized' until the graph exists
 *   (this getter never constructs it), otherwise the context's own state
 *   ('suspended' | 'running' | 'closed').
 * @property {() => GainNode} master The master GainNode all audio content
 *   should connect into (already connected to `context.destination`).
 *   First access constructs the graph (lazy but explicit).
 * @property {() => AudioContext} context The underlying AudioContext
 *   (constructs the graph on first access, like `master`).
 */

/**
 * Create the audio manager.
 *
 * @param {object} [options] Configuration.
 * @param {EventTarget} [options.target=window] DOM target the unlock
 *   listeners (pointerdown/keydown) attach to. Required when `attach` is true.
 * @param {boolean} [options.attach=true] Attach the first-gesture unlock
 *   listeners immediately. Node harnesses pass `attach: false` (or a fake
 *   target) and drive `resume()`/`blip()` directly.
 * @param {() => AudioContext} [options.contextFactory] Creates the
 *   AudioContext; called at most once (double-creation guard). Defaults to
 *   `new AudioContext()` in the browser.
 * @returns {AudioManager} The audio manager handle.
 */
export function createAudioManager({
  target = typeof window !== 'undefined' ? window : null,
  attach = true,
  contextFactory = defaultContextFactory,
} = {}) {
  if (attach && !target) {
    throw new TypeError(
      'createAudioManager: attach:true requires a DOM target (e.g. window)'
    );
  }

  /** @type {AudioContext | null} Lazily created WebAudio context. */
  let ctx = null;
  /** @type {GainNode | null} Master gain feeding destination. */
  let master = null;
  let volume = DEFAULT_VOLUME;
  let muted = false;
  let disposed = false;
  let gestureAttached = false;

  /**
   * Push the current effective level (muted ? 0 : volume) onto the master
   * gain as a short ramp. No-op until the graph exists (the stored volume is
   * baked in as the initial gain when it is created).
   * @returns {void}
   */
  function applyGain() {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, GAIN_TIME_CONSTANT_S);
  }

  /**
   * Create the AudioContext + master gain exactly once (later calls return
   * the existing graph). The initial master gain is the current effective
   * level, so volume set before creation still applies from the start.
   * @returns {AudioContext} The context.
   */
  function ensureContext() {
    if (ctx) return ctx;
    ctx = contextFactory();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    return ctx;
  }

  /**
   * Unlock audio: create the graph if needed and resume the context.
   * Resolves true once the context reports 'running'.
   * @returns {Promise<boolean>} Whether the context is running afterwards.
   */
  async function resume() {
    if (disposed) return false;
    const c = ensureContext();
    if (c.state === 'running') return true;
    try {
      await c.resume();
    } catch {
      return false; // never surface an unhandled rejection; retry is harmless
    }
    return c.state === 'running';
  }

  /**
   * Remove the gesture listeners (idempotent).
   * @returns {void}
   */
  function detachGestureListeners() {
    if (!gestureAttached) return;
    gestureAttached = false;
    target.removeEventListener('pointerdown', onFirstGesture);
    target.removeEventListener('keydown', onFirstGesture);
  }

  /**
   * First user gesture: detach immediately (the wire-up must fire exactly
   * once even if pointerdown and keydown land together), then unlock.
   * @returns {void}
   */
  function onFirstGesture() {
    if (!gestureAttached) return;
    detachGestureListeners();
    void resume();
  }

  /**
   * Schedule one enveloped test tone through the master gain: a fast linear
   * attack to BLIP_LEVEL then an exponential decay to (audibly) silence.
   * @returns {AudioBufferSourceNode | OscillatorNode | null} The scheduled
   *   oscillator, or null after dispose.
   */
  function blip() {
    if (disposed) return null;
    const c = ensureContext();
    if (c.state !== 'running') void resume(); // best-effort unlock; see header
    const t0 = c.currentTime + BLIP_LEAD_S;
    const tEnd = t0 + BLIP_ATTACK_S + BLIP_DECAY_S;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = BLIP_FREQ_HZ;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(BLIP_LEVEL, t0 + BLIP_ATTACK_S);
    env.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    osc.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(tEnd + 0.03);
    return osc;
  }

  /**
   * Set the master volume (clamped to [0, 1], NaN reads as 0) and apply it
   * to the master gain immediately. Live even while muted.
   * @param {number} value Requested volume.
   * @returns {number} The clamped stored value.
   */
  function setVolume(value) {
    const n = Number(value);
    volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
    applyGain();
    return volume;
  }

  /**
   * Mute or unmute; the master gain ramps to 0 or back to the stored volume.
   * @param {boolean} nextMuted True to silence all output.
   * @returns {void}
   */
  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    applyGain();
  }

  /**
   * Remove the gesture listeners and freeze the manager (idempotent; the
   * graph and any already-scheduled audio are left untouched).
   * @returns {void}
   */
  function dispose() {
    detachGestureListeners();
    disposed = true;
  }

  if (attach) {
    target.addEventListener('pointerdown', onFirstGesture);
    target.addEventListener('keydown', onFirstGesture);
    gestureAttached = true;
  }

  return {
    setVolume,
    setMuted,
    resume,
    blip,
    dispose,
    /** @returns {number} Stored (clamped) volume in [0, 1]. */
    get volume() {
      return volume;
    },
    /** @returns {boolean} Current mute flag. */
    get muted() {
      return muted;
    },
    /** @returns {string} 'uninitialized' until the graph exists, else context state. */
    get state() {
      return ctx ? ctx.state : 'uninitialized';
    },
    /** @returns {GainNode} Master gain (first access constructs the graph). */
    get master() {
      ensureContext();
      return /** @type {GainNode} */ (master);
    },
    /** @returns {AudioContext} The context (first access constructs the graph). */
    get context() {
      return ensureContext();
    },
  };
}
