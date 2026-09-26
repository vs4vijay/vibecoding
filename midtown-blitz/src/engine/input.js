/**
 * Keyboard input abstraction (Midtown Blitz engine, task 1.3).
 *
 * Maps physical keys (KeyboardEvent.code, so it is independent of the
 * player's keyboard layout) to game actions and exposes two consumption
 * styles:
 *
 *  - Polled state: `isDown(action)` / `snapshot()` always reflect the
 *    currently held keys; the simulation reads these every tick so held
 *    inputs produce continuous responses (vehicle-control spec).
 *  - Edge events: `onEdge(listener)` fires exactly once per physical press
 *    and once per release. OS auto-repeat (`event.repeat === true`) never
 *    produces edges, and a defensive "already down" guard means a stray
 *    duplicate keydown cannot double-fire either.
 *
 * Design notes:
 *  - Game keys get `preventDefault()` on keydown so Space cannot scroll the
 *    page and the arrows cannot scroll/navigate; unmapped keys (F5, browser
 *    shortcuts, modifier chords) are left completely untouched.
 *  - When focus sits inside a form control (`<input>`, `<textarea>`,
 *    `<select>`, contentEditable — the future settings screens), keydowns
 *    are ignored entirely so range sliders and text fields keep their
 *    native keys and nothing is prevented there.
 *  - Keyups are always processed regardless of focus: a key pressed before
 *    an input took focus must still release cleanly (no stuck keys), and a
 *    release carries no default browser behavior worth preventing.
 *  - Window blur clears every held key silently — no edge events, because an
 *    edge is a physical key transition and losing focus is neither — so the
 *    car does not keep driving after an alt-tab.
 *  - `handleKeyDown`/`handleKeyUp` are the exact functions the DOM listeners
 *    call, so a plain-node harness can drive the manager with fake events
 *    (no jsdom needed), the same way loop.js exposes `frame(nowMs)`.
 */

/** Every game action, in stable display order. */
export const ACTIONS = Object.freeze([
  'throttle',
  'brake',
  'left',
  'right',
  'handbrake',
  'reset',
  'camera',
  'pause',
]);

/**
 * Physical key (KeyboardEvent.code) -> action. Both key clusters drive the
 * same action (WASD and arrows), per the vehicle-control spec.
 */
export const KEYMAP = Object.freeze({
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause',
});

/** action -> frozen list of physical keys that drive it (derived from KEYMAP). */
export const ACTION_CODES = Object.freeze(
  ACTIONS.reduce((map, action) => {
    map[action] = Object.freeze(
      Object.keys(KEYMAP).filter((code) => KEYMAP[code] === action)
    );
    return map;
  }, {})
);

/**
 * A single key transition delivered to edge listeners.
 *
 * @typedef {object} InputEdgeEvent
 * @property {'press'|'release'} type Kind of transition.
 * @property {string} action Game action the key maps to (one of ACTIONS).
 * @property {string} code Physical key (KeyboardEvent.code) that transitioned.
 */

/**
 * Edge listener invoked once per physical key press and once per release.
 *
 * @callback InputEdgeListener
 * @param {InputEdgeEvent} event The transition.
 * @returns {void}
 */

/**
 * Handle for a created input manager.
 *
 * @typedef {object} InputManager
 * @property {(action: string) => boolean} isDown Whether any key bound to
 *   `action` is currently held (false for unknown actions).
 * @property {() => Record<string, boolean>} snapshot Polled state of every
 *   action as a fresh `{ [action]: held }` object.
 * @property {(listener: InputEdgeListener) => () => void} onEdge Subscribe to
 *   once-per-physical-press/release events; returns an unsubscribe function.
 * @property {(event: KeyboardEvent) => void} handleKeyDown The DOM keydown
 *   handler; exposed so tests can drive it with fake events directly.
 * @property {(event: KeyboardEvent) => void} handleKeyUp The DOM keyup
 *   handler; same test seam.
 * @property {() => void} clearHeld Release every held key (polled state only;
 *   no edge events).
 * @property {() => void} dispose Remove the DOM listeners and edge
 *   subscriptions and clear state; safe to call twice.
 */

/**
 * Create the keyboard input manager.
 *
 * @param {object} [options] Configuration.
 * @param {EventTarget} [options.target=window] DOM target the key/blur
 *   listeners attach to (window in the app). Required when `attach` is true.
 * @param {boolean} [options.attach=true] Attach the DOM listeners immediately.
 *   Node harnesses pass `attach: false` and call `handleKeyDown`/`handleKeyUp`
 *   themselves, or supply a fake event target to exercise attach/dispose.
 * @returns {InputManager} The input manager handle.
 */
export function createInputManager({
  target = typeof window !== 'undefined' ? window : null,
  attach = true,
} = {}) {
  if (attach && !target) {
    throw new TypeError(
      'createInputManager: attach:true requires a DOM target (e.g. window)'
    );
  }

  /** @type {Set<string>} Physical codes currently held down. */
  const downCodes = new Set();
  /** @type {Set<InputEdgeListener>} Subscribed edge listeners. */
  const edgeListeners = new Set();
  let disposed = false;

  /**
   * Whether a keydown/keyup target is a form control the user is typing in
   * (game keys must not steal or prevent events there).
   * @param {unknown} node Event target to inspect.
   * @returns {boolean} True if the target is an editable form control.
   */
  function isEditableTarget(node) {
    if (!node || typeof node.tagName !== 'string') return false;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return node.isContentEditable === true;
  }

  /**
   * Deliver an edge event to every listener.
   * @param {InputEdgeEvent} event The transition.
   * @returns {void}
   */
  function emit(event) {
    for (const listener of edgeListeners) listener(event);
  }

  /**
   * DOM keydown handler (also the test seam). Sets polled state and fires a
   * single press edge per physical press; prevents default on game keys.
   * @param {KeyboardEvent} event The keydown event (or a fake look-alike).
   * @returns {void}
   */
  function onKeyDown(event) {
    if (disposed) return;
    const action = KEYMAP[event.code];
    if (!action) return; // unmapped key: none of our business
    if (isEditableTarget(event.target)) return; // typing in a form control
    event.preventDefault(); // game key: stop page scroll / navigation (repeats too)
    if (event.repeat) return; // OS auto-repeat: key is already held, no edge
    if (downCodes.has(event.code)) return; // stray duplicate: exactly-once guard
    downCodes.add(event.code);
    emit({ type: 'press', action, code: event.code });
  }

  /**
   * DOM keyup handler (also the test seam). Clears polled state and fires a
   * single release edge. Always processed (no editable-target guard): a key
   * pressed before an input took focus must still release cleanly.
   * @param {KeyboardEvent} event The keyup event (or a fake look-alike).
   * @returns {void}
   */
  function onKeyUp(event) {
    if (disposed) return;
    const action = KEYMAP[event.code];
    if (!action) return;
    if (!downCodes.has(event.code)) return; // not held: edges stay balanced
    downCodes.delete(event.code);
    emit({ type: 'release', action, code: event.code });
  }

  /**
   * Window blur handler: forget every held key so nothing stays stuck after
   * an alt-tab. Silent by design (no edge events).
   * @returns {void}
   */
  function onBlur() {
    downCodes.clear();
  }

  /**
   * Whether any key bound to `action` is currently held.
   * @param {string} action One of ACTIONS (unknown actions read as false).
   * @returns {boolean} Held state of the action.
   */
  function isDown(action) {
    const codes = ACTION_CODES[action];
    if (!codes) return false;
    for (const code of codes) {
      if (downCodes.has(code)) return true;
    }
    return false;
  }

  /**
   * Polled state of every action as a fresh object.
   * @returns {Record<string, boolean>} `{ [action]: held }` for all ACTIONS.
   */
  function snapshot() {
    /** @type {Record<string, boolean>} */
    const state = {};
    for (const action of ACTIONS) state[action] = isDown(action);
    return state;
  }

  /**
   * Subscribe to edge events (once per physical press and per release).
   * @param {InputEdgeListener} listener Called with each transition.
   * @returns {() => void} Unsubscribe function for this listener.
   */
  function onEdge(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('input.onEdge: listener must be a function');
    }
    edgeListeners.add(listener);
    return () => edgeListeners.delete(listener);
  }

  /**
   * Release every held key (also used by the blur handler). Polled state
   * only; no edge events fire.
   * @returns {void}
   */
  function clearHeld() {
    downCodes.clear();
  }

  /**
   * Tear down: remove the DOM listeners, clear held state, and drop all edge
   * subscriptions. Safe to call more than once.
   * @returns {void}
   */
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (attach) {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    }
    downCodes.clear();
    edgeListeners.clear();
  }

  if (attach) {
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
  }

  return {
    isDown,
    snapshot,
    onEdge,
    handleKeyDown: onKeyDown,
    handleKeyUp: onKeyUp,
    clearHeld,
    dispose,
  };
}
