/**
 * Race-start countdown controller (Midtown Blitz game, task 5.3).
 *
 * The pure, tick-driven "3 · 2 · 1 · GO" state behind the HUD's center
 * countdown display and the controls lock at a race start (race-events spec:
 * "a countdown is displayed and the player cannot accelerate until it
 * finishes, with the timer starting as control begins").
 *
 * Time model: the caller feeds SIMULATION time — one `update(dt)` per fixed
 * 60 Hz tick (src/engine/loop.js SIM_DT). There is no wall clock anywhere in
 * here, so a paused game (which stops ticking) freezes the countdown
 * mid-number and resumes exactly where it left off. Task 5.4's race state
 * machine will own this controller; until then main.js starts it on every
 * fresh racing entry and behind ?debug on the T test route.
 *
 * Semantics:
 *  - `start()` shows 3 immediately (onTick(3)) and locks the controls.
 *  - Each number holds `numberSeconds` (default 1 s): 3 for [0,1), 2 for
 *    [1,2), 1 for [2,3) — onTick fires once per number change.
 *  - At 3 s `onGo()` fires exactly once and the controls unlock (control
 *    begins at GO — the timer start point 5.4 will hook). The GO display
 *    lingers `goSeconds` (default 0.8 s), then `onEnd()` fires and the
 *    controller goes idle.
 *  - `update()` may cross several boundaries in one call (a long catch-up
 *    frame or a big harness dt): callbacks fire in order within the call.
 *  - `cancel()` silently deactivates (mode teardown); no callbacks fire.
 *
 * Purity: plain math + callbacks — no DOM, no timers, no three.js, so plain
 * node harnesses step it deterministically (scripts/hud-test.mjs).
 */

/** How many numbers count down before GO (3 · 2 · 1). */
export const COUNTDOWN_START_NUMBER = 3;

/** Default seconds each number (3/2/1) stays on screen. */
export const DEFAULT_NUMBER_SECONDS = 1;

/** Default seconds the GO display lingers after control unlocks. */
export const DEFAULT_GO_SECONDS = 0.8;

/**
 * Float-slop allowance for boundary comparisons: 60 accumulated 1/60 steps
 * land at 0.9999999999999999, which must already count as a full second.
 */
const TIME_EPSILON_S = 1e-9;

/**
 * Callback fired when the displayed number changes (3 -> 2 -> 1).
 *
 * @callback CountdownOnTick
 * @param {number} n The new number (3, 2 or 1).
 * @returns {void}
 */

/**
 * Callback fired exactly once when the countdown reaches GO (controls
 * unlock; the race timer would start here in 5.4).
 *
 * @callback CountdownOnGo
 * @returns {void}
 */

/**
 * Callback fired when the GO display window closes and the controller goes
 * idle (the HUD clears the center display).
 *
 * @callback CountdownOnEnd
 * @returns {void}
 */

/**
 * Handle for a created countdown controller.
 *
 * @typedef {object} Countdown
 * @property {() => void} start Begin (or restart) the countdown: shows 3 via
 *   onTick(3) immediately and locks the controls.
 * @property {(dt: number) => void} update Advance by `dt` seconds of
 *   simulation time (call once per fixed tick; negative dt counts as 0).
 *   No-op while inactive.
 * @property {() => void} cancel Silently deactivate (teardown path): the
 *   controller goes idle and the controls unlock WITHOUT firing onGo/onEnd.
 * @property {() => boolean} isActive Whether a countdown (numbers or GO
 *   linger) is currently running.
 * @property {() => boolean} controlsLocked True from start() until onGo()
 *   fires (or cancel() is called) — main zeroes throttle/brake/steer while
 *   this holds.
 * @property {() => number} number The currently displayed number: 3/2/1
 *   during the count, 0 during the GO linger, 0 when idle.
 */

/**
 * Create the countdown controller.
 * @param {object} [hooks] Callbacks (all optional).
 * @param {CountdownOnTick} [hooks.onTick] Fired on each number change.
 * @param {CountdownOnGo} [hooks.onGo] Fired once at GO.
 * @param {CountdownOnEnd} [hooks.onEnd] Fired when the GO window closes.
 * @param {number} [hooks.numberSeconds=DEFAULT_NUMBER_SECONDS] Seconds per
 *   number (harness/tuning seam).
 * @param {number} [hooks.goSeconds=DEFAULT_GO_SECONDS] Seconds the GO
 *   display lingers (harness/tuning seam).
 * @returns {Countdown} The controller handle.
 */
export function createCountdown({
  onTick,
  onGo,
  onEnd,
  numberSeconds = DEFAULT_NUMBER_SECONDS,
  goSeconds = DEFAULT_GO_SECONDS,
} = {}) {
  let active = false;
  let locked = false;
  let elapsedS = 0;
  let number = 0;
  let goFired = false;

  return {
    /** @returns {void} */
    start() {
      active = true;
      locked = true;
      elapsedS = 0;
      goFired = false;
      number = COUNTDOWN_START_NUMBER;
      if (onTick) onTick(number);
    },

    /**
     * Advance by simulation time, firing any boundary callbacks in order.
     * @param {number} dt Seconds to advance (negative counts as 0).
     * @returns {void}
     */
    update(dt) {
      if (!active) return;
      elapsedS += dt > 0 ? dt : 0;
      // Number boundaries: 2 at 1x numberSeconds, 1 at 2x numberSeconds.
      while (
        number > 1 &&
        elapsedS >= (COUNTDOWN_START_NUMBER - number + 1) * numberSeconds - TIME_EPSILON_S
      ) {
        number -= 1;
        if (onTick) onTick(number);
      }
      // GO boundary at COUNTDOWN_START_NUMBER x numberSeconds: unlock once.
      if (!goFired && elapsedS >= COUNTDOWN_START_NUMBER * numberSeconds - TIME_EPSILON_S) {
        goFired = true;
        locked = false;
        number = 0;
        if (onGo) onGo();
      }
      // GO linger closes: idle (HUD clears the display via onEnd).
      if (goFired && elapsedS >= COUNTDOWN_START_NUMBER * numberSeconds + goSeconds - TIME_EPSILON_S) {
        active = false;
        if (onEnd) onEnd();
      }
    },

    /** @returns {void} */
    cancel() {
      active = false;
      locked = false;
    },

    /** @returns {boolean} Whether the countdown is running. */
    isActive() {
      return active;
    },

    /** @returns {boolean} Whether the controls must stay locked. */
    controlsLocked() {
      return locked;
    },

    /** @returns {number} Display number: 3/2/1 counting, 0 for GO/idle. */
    number() {
      return number;
    },
  };
}
