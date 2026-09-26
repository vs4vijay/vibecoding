/**
 * Mode state machine (Midtown Blitz game, task 5.2).
 *
 * The game-shell spec's "Mode navigation state machine": the game keeps
 * exactly ONE active mode at a time — 'menu' | 'racing' | 'paused' |
 * 'results' — and moves between them along a fixed legal-transition table:
 *
 * ```text
 *   menu    -> racing                (start an event / cruise from the menu)
 *   racing  -> paused                (Esc during play)
 *   racing  -> results               (race finished or failed — task 5.4)
 *   racing  -> menu                  (future in-race abort; currently unused)
 *   paused  -> racing                (RESUME and RESTART both land here — the
 *                                     entry data says which: {resume:true}
 *     .                                   keeps the world untouched, a fresh
 *     .                                   entry respawns it)
 *   paused  -> menu                  (QUIT TO MENU)
 *   results -> racing                (RETRY)
 *   results -> menu                  (MENU)
 * ```
 *
 * Anything else — pausing from the menu, entering results from paused,
 * re-entering the current mode, unknown mode names — is refused: `enterMode`
 * returns `false`, fires NO hooks, and leaves the machine untouched.
 *
 * Teardown registry (the task's "transitions tear down timers, audio, and
 * mode UI completely"): while a mode is active it registers everything it
 * owns — intervals, rAF handles, DOM overlays it opened, audio content —
 * through `onCleanup(fn)`. Every successful transition force-runs the whole
 * registry BEFORE the new mode's enter hook, so a mode can never leak state
 * into its successor. Guarantees:
 *   - each registered cleanup runs at most once (a manual cancel before exit
 *     means it never runs — that is the point of cancelling);
 *   - cleanups run LIFO (register order is teardown reverse order);
 *   - NESTED registrations are safe: a cleanup that registers another cleanup
 *     (e.g. a timer teardown cancelling a child handle) has that nested entry
 *     run in the same flush, exactly once;
 *   - after the flush the registry holds only the NEW mode's registrations —
 *     `pendingCleanups` + `lastFlushed` make "nothing from the old mode is
 *     left over" observable in harnesses.
 *
 * The machine is pure logic — no DOM, no timers of its own — so plain-node
 * harnesses drive it directly (scripts/modes-test.mjs).
 */

/** Every mode name, in navigation order. */
export const MODE_NAMES = Object.freeze(['menu', 'racing', 'paused', 'results']);

/** Legal transitions: mode -> modes it may enter (anything else is refused). */
export const MODE_TRANSITIONS = Object.freeze({
  menu: Object.freeze(['racing']),
  racing: Object.freeze(['paused', 'results', 'menu']),
  paused: Object.freeze(['racing', 'menu']),
  results: Object.freeze(['racing', 'menu']),
});

/**
 * Hook run when a mode is left, after its teardown registry has flushed.
 *
 * @callback ModeExitFn
 * @param {string} mode The mode being left.
 * @param {{ to: string }} info Navigation context.
 * @returns {void}
 */

/**
 * Hook run when a mode is entered, after `current` has switched and the
 * previous mode's teardown has flushed.
 *
 * @callback ModeEnterFn
 * @param {string} mode The mode being entered.
 * @param {{ from: string | null, data: unknown }} info Navigation context;
 *   `from` is null for the very first entry (boot), `data` is the payload
 *   passed to `enterMode` (null when omitted).
 * @returns {void}
 */

/**
 * Handle for a created mode machine.
 *
 * @typedef {object} ModeMachine
 * @property {() => string | null} current The active mode name (null until
 *   the first successful enterMode).
 * @property {() => unknown} data The payload the current mode was entered
 *   with (null when none).
 * @property {(mode: string, data?: unknown) => boolean} enterMode Switch
 *   modes: validates the transition, force-runs the outgoing mode's teardown
 *   registry (LIFO, nested-safe), then fires onExit/onEnter. Returns false
 *   (untouched) for illegal transitions, unknown modes, and same-mode
 *   re-entries.
 * @property {(from: string, to: string) => boolean} canTransition Whether the
 *   from->to move is legal per {@link MODE_TRANSITIONS} (pure table read).
 * @property {(fn: () => void) => () => void} onCleanup Register a teardown
 *   callback scoped to the CURRENT mode; returns a cancel function (calling
 *   it before the mode exits means the callback never runs).
 * @property {() => number} pendingCleanups How many teardown callbacks are
 *   registered for the current mode — after any exit this is exactly the NEW
 *   mode's own registrations (old-mode leftovers would inflate it).
 * @property {() => number} lastFlushed How many cleanups the most recent
 *   exit flush ran (0 before the first exit) — the harness-visible "the old
 *   mode's teardown actually happened" counter.
 */

/**
 * Create the mode state machine.
 * @param {object} [hooks] Lifecycle hooks (both optional).
 * @param {ModeEnterFn} [hooks.onEnter] Called after each successful entry.
 * @param {ModeExitFn} [hooks.onExit] Called after each successful exit's
 *   teardown flush, before the new mode's onEnter.
 * @returns {ModeMachine} The machine handle.
 */
export function createModeMachine({ onEnter, onExit } = {}) {
  /** @type {string | null} Active mode name. */
  let current = null;
  /** Payload the active mode was entered with. */
  let data = null;
  /** @type {Array<() => void>} Teardown registry for the active mode. */
  let cleanups = [];
  /** Cleanups run by the most recent exit flush (harness observability). */
  let lastFlushedCount = 0;

  /**
   * Force-run and empty the registry: LIFO, nested-safe, each exactly once.
   * A cleanup may push more entries (nested case) — the loop keeps going
   * until the array is drained.
   * @returns {void}
   */
  function flushCleanups() {
    lastFlushedCount = 0;
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (typeof fn === 'function') {
        fn();
        lastFlushedCount += 1;
      }
    }
  }

  return {
    /** @returns {string | null} The active mode (null before first entry). */
    get current() {
      return current;
    },

    /** @returns {unknown} The current mode's entry payload (or null). */
    get data() {
      return data;
    },

    /** @returns {number} Registered-but-not-yet-run teardown callbacks. */
    get pendingCleanups() {
      return cleanups.length;
    },

    /** @returns {number} Cleanups run by the most recent exit flush. */
    get lastFlushed() {
      return lastFlushedCount;
    },

    /**
     * Pure table read: would entering `to` from `from` be legal?
     * @param {string} from Source mode (null — the pre-boot state — may
     *   enter any real mode).
     * @param {string} to Target mode.
     * @returns {boolean} Whether the move is allowed.
     */
    canTransition(from, to) {
      if (!MODE_NAMES.includes(to)) return false;
      if (from === null) return true; // boot: any real mode may be first
      if (from === to) return false; // same-mode re-entry is refused
      const allowed = MODE_TRANSITIONS[from];
      return Array.isArray(allowed) && allowed.includes(to);
    },

    /**
     * Register a teardown callback for the active mode. Throws when no mode
     * is active (there is nothing to scope the cleanup to) — callers always
     * register from inside an enter hook.
     * @param {() => void} fn Teardown callback.
     * @returns {() => void} Cancel function (removes fn without running it).
     */
    onCleanup(fn) {
      if (current === null) {
        throw new Error('modeMachine.onCleanup: no active mode (call from an enter hook)');
      }
      cleanups.push(fn);
      return () => {
        const i = cleanups.indexOf(fn);
        if (i >= 0) cleanups.splice(i, 1);
      };
    },

    /**
     * Switch to `mode` (see the module header for the legal table and
     * teardown guarantees).
     * @param {string} mode Target mode (one of {@link MODE_NAMES}).
     * @param {unknown} [nextData] Payload for the new mode (e.g.
     *   `{ event: 'blitz-downtown', resume: false }`); null when omitted.
     * @returns {boolean} True on success; false when the move is refused
     *   (machine and hooks untouched).
     */
    enterMode(mode, nextData) {
      if (!this.canTransition(current, mode)) return false;
      const from = current;
      flushCleanups(); // old mode's timers/UI/audio die BEFORE the new enter
      if (onExit && from !== null) onExit(from, { to: mode });
      current = mode;
      data = nextData === undefined ? null : nextData;
      if (onEnter) onEnter(mode, { from, data });
      return true;
    },
  };
}
