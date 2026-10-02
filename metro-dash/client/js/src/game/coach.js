/**
 * @file game/coach.js
 * First-run teaching layer (ui-ux-pass design D8, tasks 7.1).
 *
 * Pure logic, zero DOM, zero dependencies so QA probes can drive it
 * headless: `coachShouldRun` reads the persisted tutoring flag and
 * `createCoach` builds a one-shot hint scheduler that main.js ticks on the
 * fixed-step clock. The coach is strictly READ-ONLY over the sim — it
 * consumes distance/z numbers and injected obstacle queries and never
 * touches run state, RNG or timing, so a coached and an uncoached run
 * produce identical distance/score.
 *
 * Flag convention (matches the neon-rush save migration): the key
 * `late_again_tutored` is "0" ONLY on a brand-new save. A MISSING or
 * corrupt key means a pre-existing player who already knows the game —
 * they are never retro-taught. main.js flips the key to "1" when the
 * tutored run ends by any path.
 */

/** The localStorage key main.js persists under (single source here). */
export const TUTOR_KEY = "late_again_tutored";

/** Distance (m) the lane-switch hint fires at. */
export const LANE_HINT_M = 30;
/** Look-ahead window (m) for both hazard queries. */
export const HINT_RANGE_M = 35;
/** Teaching window: no hint fires at or beyond this distance (m). */
export const HINT_WINDOW_M = 200;

/**
 * Should this run be tutored? Only an EXPLICIT "0" means "not yet
 * taught" — missing/null/undefined/corrupt values all mean an existing
 * save (already taught) and return false.
 * @param {string|null|undefined} raw Raw localStorage value.
 * @returns {boolean}
 */
export function coachShouldRun(raw) {
  return raw === "0";
}

/**
 * Build a coach for one run.
 * @param {object} deps
 * @param {boolean} deps.shouldRun Result of coachShouldRun (checked once).
 * @param {{nearestJumpable: (z: number, range: number) => boolean,
 *          nearestOverhead: (z: number, range: number) => boolean}} deps.queries
 *        Read-only obstacle queries (run.js pass-throughs or stubs).
 * @param {(kind: "lane"|"jump"|"roll") => void} deps.showHint
 *        Called at most once per kind; main.js maps kind -> scheme copy.
 * @returns {{tick: (distance: number, z: number) => void}}
 */
export function createCoach({ shouldRun, queries, showHint }) {
  const fired = { lane: false, jump: false, roll: false };

  return {
    /**
     * One fixed-step tick. `distance` gates the teaching window and the
     * lane hint; `z` drives the hazard look-ahead. Allocation-free.
     */
    tick(distance, z) {
      if (!shouldRun || distance >= HINT_WINDOW_M) return;
      if (!fired.lane && distance >= LANE_HINT_M) {
        fired.lane = true;
        showHint("lane");
      }
      if (!fired.jump && queries.nearestJumpable(z, HINT_RANGE_M)) {
        fired.jump = true;
        showHint("jump");
      }
      if (!fired.roll && queries.nearestOverhead(z, HINT_RANGE_M)) {
        fired.roll = true;
        showHint("roll");
      }
    },
  };
}
