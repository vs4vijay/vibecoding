/**
 * Race controller — the ONE race state machine (Midtown Blitz, task 5.4).
 *
 * Design Decision 9: one state machine drives every event,
 * `countdown -> running -> finished/failed`, and Cruise is the SAME
 * controller fed a no-objective event ({@link CRUISE_EVENT} shape:
 * `type: 'cruise'`) — no timer, no checkpoints, it never finishes and only
 * a pause-quit ends the session (race-events spec "Cruise free-roam mode":
 * "no timer or failure ever ends the mode").
 *
 * Phases (phase()):
 *  - 'countdown': from begin() (which starts the caller's countdown
 *    controller — 3-2-1-GO, controls locked, HUD wired by main.js) until
 *    the countdown's GO unlocks the controls. No race time accumulates.
 *  - 'running' (Blitz): the race clock runs on SIM time — elapsedMs grows
 *    by dt each update AFTER the GO boundary, so the timer starts exactly
 *    as control begins (race-events spec "the timer starting as control
 *    begins"). Each tick samples the ordered checkpoint sequence (task
 *    5.3's createCheckpointSequence — only the CURRENT target is tested,
 *    so checkpoints cannot be taken out of order), advances the HUD target
 *    + chimes on a pass, feeds the HUD the remaining time, and checks
 *    expiry. Reaching the FINAL checkpoint first finishes the race as a
 *    WIN (onFinish with {eventId, timeMs, medal}); the timer reaching zero
 *    first fails it — on the FIRST tick whose accumulated time reaches the
 *    limit, with the payload clamped to exactly timeLimitMs (expiry is
 *    immediate, never a tick late). A same-tick tie (final gate and expiry
 *    in one update) goes to the driver: the gate is sampled first.
 *  - 'cruising' (Cruise): after GO, runs forever — update() is a no-op.
 *  - 'finished' | 'failed': terminal; update() stops, callbacks are done.
 *
 * Time model: pure SIM time. update(dt, carState) is called once per fixed
 * tick AFTER the caller advanced the countdown controller (main.js's tick
 * order), so pausing (which stops the sim) freezes the countdown, the
 * race clock, and the checkpoints mid-state, and resume continues them
 * exactly (game-shell spec "the exact prior race state, timer resuming").
 * There is no wall clock and no timer of its own in here.
 *
 * Pause/teardown contract with main.js: the controller is deliberately
 * NOT destroyed by the racing-mode cleanup on a pause — a paused Blitz
 * race must resume where it stood. It is destroyed by
 * main.js's teardownRaceSession() on every path that genuinely ends the
 * session (fresh start/restart/retry, finish/fail -> results, quit to
 * menu). dispose() is idempotent and guarantees no callback fires after
 * it (harness-checked); after dispose, update() is a no-op.
 *
 * Presentation split: the controller owns the HUD's RACE state (timer
 * value, checkpoint guidance target, the <10 s urgency tint on the timer)
 * because that state IS the race state; the caller owns everything around
 * it (the world marker moves via onCheckpoint + begin()'s return, the
 * countdown display via the countdown's own callbacks, HUD show/hide via
 * the mode machine). The checkpoint chime is audio.blip() — the documented
 * placeholder until task 6.1's real synthesized chime (design Decision 8).
 *
 * Purity: plain math + injected callbacks — no three.js, no DOM, no
 * timers; plain-node harnesses step it deterministically
 * (scripts/race-controller-test.mjs).
 */

import { createCheckpointSequence, TEST_ROUTE_PASS_RADIUS_M } from './test-route.js';
import { medalForTime } from './races.js';

/** Timer turns this color when a Blitz race's remaining time drops under 10 s. */
export const TIMER_URGENT_COLOR = '#ff5a4e';
/** Neutral HUD timer color (the HUD's own default) restored above the threshold. */
export const TIMER_NORMAL_COLOR = '#e8ecf4';
/** Remaining-time threshold (ms) for the urgency tint. */
export const TIMER_URGENT_UNDER_MS = 10000;

/**
 * Progress payload of {@link RaceControllerCallbacks.onCheckpoint} — fired
 * when the CURRENT target's pass radius is reached and the next gate (or
 * the finish) takes over.
 *
 * @typedef {object} CheckpointProgress
 * @property {number} index Index of the NEW target (1-based pass count).
 * @property {number} total Total checkpoints in the route.
 * @property {import('./test-route.js').RouteCheckpoint} checkpoint The NEW
 *   target (the world marker should move here).
 */

/**
 * Payload of onFinish — a WON Blitz race.
 *
 * @typedef {object} RaceResult
 * @property {string} eventId The route id (the records key).
 * @property {number} timeMs Finish time in ms (sim time from GO to the
 *   final gate).
 * @property {'gold' | 'silver' | 'bronze' | null} medal Medal per the
 *   route's thresholds (null = finished over bronze — a win, no award).
 */

/**
 * Payload of onFail — the timer reached zero before the final gate.
 *
 * @typedef {object} RaceFailure
 * @property {string} eventId The route id.
 * @property {number} elapsedMs The time limit, exactly (the race ended the
 *   moment the timer hit zero).
 */

/**
 * Callbacks (all optional).
 *
 * @callback RaceControllerOnCheckpoint
 * @param {CheckpointProgress} progress Advance progress.
 * @returns {void}
 * @callback RaceControllerOnFinish
 * @param {RaceResult} result The win.
 * @returns {void}
 * @callback RaceControllerOnFail
 * @param {RaceFailure} failure The timeout.
 * @returns {void}
 */

/**
 * Handle for a created race controller.
 *
 * @typedef {object} RaceController
 * @property {() => boolean} begin Start the session: starts the countdown
 *   (controls lock; HUD countdown via the countdown's own callbacks), and
 *   for Blitz sets the HUD timer to the full limit + the first checkpoint
 *   guidance target. Returns the FIRST checkpoint target (main moves the
 *   world marker there), or null for Cruise (no target, HUD timer hidden).
 *   No-op when already begun or disposed.
 * @property {(dt: number, carState: { x: number, z: number }) => void} update
 *   Advance one fixed sim tick (call AFTER the countdown's own update;
 *   dt in seconds). No-op while counting down (the GO boundary is observed,
 *   not double-ticked), terminal, or disposed.
 * @property {() => void} dispose End the session: idempotent; guarantees
 *   no further callbacks. Does NOT touch the countdown or the HUD — the
 *   caller's session teardown owns those (main.js teardownRaceSession).
 * @property {() => string} phase Current phase: 'countdown' | 'running' |
 *   'cruising' | 'finished' | 'failed'.
 * @property {() => string} eventId The driving event's id.
 * @property {() => boolean} isCruise Whether this session is Cruise.
 * @property {() => number} elapsedMs Race clock (ms since GO; 0 during the
 *   countdown; frozen terminal).
 * @property {() => number | null} remainingMs Remaining timer (ms; clamped
 *   at 0 once expired; null for Cruise — no timer).
 * @property {() => import('./test-route.js').RouteCheckpoint | null} currentTarget
 *   The live checkpoint gate (null for Cruise, before begin, and after the
 *   final gate).
 * @property {() => boolean} isDisposed Whether dispose() has run.
 */

/**
 * Create a race controller for one event.
 * @param {object} deps Collaborators.
 * @param {import('./races.js').BlitzRaceEvent | import('./races.js').CruiseEvent} deps.event
 *   Event definition (races.js data): 'blitz' routes drive the full
 *   countdown -> running -> win/fail machine; a 'cruise' event (or any
 *   event without checkpoints) runs the countdown and then cruises forever.
 * @param {import('./ui/hud.js').Hud} deps.hud HUD handle (setTimer /
 *   setCheckpoint + parts.timer for the urgency tint; the tint write is
 *   stub-safe — skipped when parts.timer is absent).
 * @param {import('./countdown.js').Countdown} deps.countdown The shared
 *   countdown controller; begin() calls start() on it, update() only
 *   OBSERVES controlsLocked() (the caller ticks it — main.js's tick order).
 * @param {{ blip?: () => void } | null} [deps.audio] Audio manager; blip()
 *   is the checkpoint chime placeholder until task 6.1. Optional — chimes
 *   are skipped when absent (harness seam).
 * @param {RaceControllerOnFinish} [deps.onFinish] Win callback (Blitz).
 * @param {RaceControllerOnFail} [deps.onFail] Timeout callback (Blitz).
 * @param {RaceControllerOnCheckpoint} [deps.onCheckpoint] Advance callback
 *   (main moves the world marker; the controller moves the HUD target).
 * @returns {RaceController} The controller handle.
 */
export function createRaceController({
  event,
  hud,
  countdown,
  audio,
  onFinish,
  onFail,
  onCheckpoint,
}) {
  if (!event || typeof event.id !== 'string') {
    throw new TypeError('createRaceController: needs an event definition with an id');
  }
  if (!hud || typeof hud.setTimer !== 'function' || typeof hud.setCheckpoint !== 'function') {
    throw new TypeError('createRaceController: needs a hud with setTimer/setCheckpoint');
  }
  if (!countdown || typeof countdown.start !== 'function' || typeof countdown.controlsLocked !== 'function') {
    throw new TypeError('createRaceController: needs a countdown controller');
  }

  // Cruise discriminator: an explicit cruise type, or simply no gates —
  // "one controller, no-objective event" per design Decision 9.
  const isCruise =
    event.type === 'cruise' ||
    !Array.isArray(event.checkpoints) ||
    event.checkpoints.length === 0;
  const hasTimer =
    !isCruise && Number.isFinite(event.timeLimitMs) && event.timeLimitMs > 0;

  /** @type {'countdown' | 'running' | 'cruising' | 'finished' | 'failed'} */
  let phase = 'countdown';
  let begun = false;
  let disposed = false;
  /** Race clock in ms (sim time accumulated after the GO boundary). */
  let elapsedMs = 0;
  /** @type {import('./test-route.js').CheckpointSequence | null} */
  let sequence = null;
  /** Whether the HUD timer is currently tinted urgent (<10 s left). */
  let timerUrgent = false;

  /**
   * Restore the HUD timer tint (change-gated; stub-safe without parts).
   * @returns {void}
   */
  function clearUrgentTint() {
    if (!timerUrgent) return;
    timerUrgent = false;
    const timerEl = /** @type {{ style?: { color?: string } } | undefined} */ (hud.parts?.timer);
    if (timerEl?.style) timerEl.style.color = TIMER_NORMAL_COLOR;
  }

  /**
   * Sample the sequence, run out the clock, and enforce expiry — the
   * Blitz 'running' tick. Order matters: the gate is sampled BEFORE the
   * expiry check, so a final gate reached on the same tick the timer runs
   * out still counts as a win (ties go to the driver).
   * @param {number} dt Sim dt in seconds.
   * @param {{ x: number, z: number }} carState Live car position (read).
   * @returns {void}
   */
  function updateRunning(dt, carState) {
    elapsedMs += dt > 0 ? dt * 1000 : 0;
    if (sequence) {
      // May fire onComplete -> phase 'finished' -> onFinish (terminal; the
      // checks below then see phase !== 'running' and stop).
      sequence.update(dt, carState);
    }
    if (phase !== 'running') return; // finished on this tick
    if (hasTimer) {
      const remainingMs = Math.max(0, event.timeLimitMs - elapsedMs);
      hud.setTimer(remainingMs);
      const urgent = remainingMs <= TIMER_URGENT_UNDER_MS;
      if (urgent !== timerUrgent) {
        timerUrgent = urgent;
        const timerEl = /** @type {{ style?: { color?: string } } | undefined} */ (hud.parts?.timer);
        if (timerEl?.style) {
          timerEl.style.color = urgent ? TIMER_URGENT_COLOR : TIMER_NORMAL_COLOR;
        }
      }
      if (elapsedMs >= event.timeLimitMs) {
        // Timer zero = immediate failure, THIS tick. The payload reports
        // exactly the limit: the race ended the moment the timer hit zero.
        phase = 'failed';
        clearUrgentTint();
        if (onFail) onFail({ eventId: event.id, elapsedMs: event.timeLimitMs });
      }
    }
  }

  /** @type {RaceController} */
  const controller = {
    /**
     * Start the session (see typedef). Idempotent per controller instance.
     * @returns {import('./test-route.js').RouteCheckpoint | null} First
     *   gate (Blitz; the caller moves the world marker) or null (Cruise).
     */
    begin() {
      if (begun || disposed) return null;
      begun = true;
      // Fresh 3-2-1-GO with the controls locked (race-events spec
      // "Countdown before control"); the countdown's own callbacks own the
      // HUD's center display. start() resets any stale countdown state.
      countdown.start();
      if (isCruise) {
        hud.setTimer(null); // no timer in Cruise: dimmed placeholder
        return null;
      }
      const checkpoints = /** @type {import('./races.js').BlitzRaceEvent} */ (event).checkpoints;
      sequence = createCheckpointSequence({
        checkpoints: /** @type {import('./test-route.js').RouteCheckpoint[]} */ (checkpoints),
        passRadiusM: TEST_ROUTE_PASS_RADIUS_M, // 12 m — same gates as the ?debug route
        onAdvance: (index, next) => {
          // Checkpoint pass feedback: chime (6.1 replaces the blip) + HUD
          // target; the world marker moves via onCheckpoint.
          if (audio && typeof audio.blip === 'function') audio.blip();
          hud.setCheckpoint(next);
          if (onCheckpoint) {
            onCheckpoint({ index, total: checkpoints.length, checkpoint: next });
          }
        },
        onComplete: () => {
          // Final gate before zero = WIN: medal per thresholds, terminal.
          if (audio && typeof audio.blip === 'function') audio.blip();
          phase = 'finished';
          clearUrgentTint();
          const timeMs = elapsedMs;
          hud.setTimer(timeMs); // freeze the HUD on the finish time
          if (onFinish) {
            onFinish({
              eventId: event.id,
              timeMs,
              medal: medalForTime(timeMs, /** @type {import('./races.js').BlitzRaceEvent} */ (event).thresholds),
            });
          }
        },
      });
      const first = /** @type {import('./test-route.js').RouteCheckpoint} */ (checkpoints[0]);
      hud.setTimer(event.timeLimitMs); // full budget visible from the countdown on
      hud.setCheckpoint(first);
      return first;
    },

    /**
     * Advance one fixed sim tick (see typedef).
     * @param {number} dt Sim dt in seconds.
     * @param {{ x: number, z: number }} carState Live car position (read).
     * @returns {void}
     */
    update(dt, carState) {
      if (disposed || phase === 'finished' || phase === 'failed') return;
      if (phase === 'countdown') {
        // The CALLER advanced the countdown this tick (main's tick order);
        // the unlock is observed here, never double-ticked. The GO tick
        // itself adds no race time: the clock starts at the boundary.
        if (!countdown.controlsLocked()) {
          phase = isCruise ? 'cruising' : 'running';
        }
        return;
      }
      if (phase === 'cruising') return; // free roam: no clock, no gates, no end
      updateRunning(dt, carState);
    },

    /** @returns {void} */
    dispose() {
      if (disposed) return;
      disposed = true;
      sequence = null;
      clearUrgentTint();
    },

    /** @returns {string} Current phase. */
    phase() {
      return phase;
    },

    /** @returns {string} The driving event's id. */
    eventId() {
      return event.id;
    },

    /** @returns {boolean} Whether this session is Cruise. */
    isCruise() {
      return isCruise;
    },

    /** @returns {number} Race clock (ms since GO). */
    elapsedMs() {
      return elapsedMs;
    },

    /** @returns {number | null} Remaining timer (ms), or null for Cruise. */
    remainingMs() {
      if (!hasTimer) return null;
      return Math.max(0, event.timeLimitMs - elapsedMs);
    },

    /** @returns {import('./test-route.js').RouteCheckpoint | null} Live gate. */
    currentTarget() {
      return sequence ? sequence.currentTarget() : null;
    },

    /** @returns {boolean} Whether dispose() has run. */
    isDisposed() {
      return disposed;
    },
  };

  return controller;
}
