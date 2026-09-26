/**
 * Ordered checkpoint sequence + ?debug test route (Midtown Blitz, task 5.3).
 *
 * {@link createCheckpointSequence} is the pure order-enforcement core the
 * race-events spec requires ("checkpoints cannot be taken out of order"):
 * exactly ONE target checkpoint is live at a time, only the CURRENT target's
 * pass radius is tested each tick, and passing it advances the target (or
 * completes the route). Because only the current target is ever sampled,
 * driving through any later/earlier checkpoint does NOTHING — skipping is
 * impossible by construction. The same controller serves task 5.4's real
 * race routes.
 *
 * {@link buildTestRouteCheckpoints} is the ?debug verification route: three
 * grid intersections (from the generated layout's road centerlines) forming
 * a short loop near the documented spawn — close enough to drive without
 * steering from the spawn straight to checkpoint 1, so the orchestrator can
 * verify the whole guidance loop (marker, edge arrow, chime, order,
 * completion) without task 5.4's race machine. Main.js keys it to T behind
 * ?debug (racing only) and tears it down through the mode machine's
 * cleanup registry.
 *
 * Purity: plain math — no three.js, no DOM, no randomness; identical
 * (position, dt) sequences are float-identical (harness-verified).
 */

/** Pass radius in m for the ?debug test route's checkpoints. */
export const TEST_ROUTE_PASS_RADIUS_M = 12;

/**
 * One checkpoint: a ground position plus an optional label.
 *
 * @typedef {object} RouteCheckpoint
 * @property {number} x World x (m).
 * @property {number} [y] World y (m; road level is 0).
 * @property {number} z World z (m).
 * @property {string} [label] Optional display label.
 */

/**
 * Fired when the current target's pass radius is reached and the NEXT
 * checkpoint becomes the target.
 *
 * @callback SequenceOnAdvance
 * @param {number} index Index of the NEW target (1-based pass count).
 * @param {RouteCheckpoint} next The new target checkpoint.
 * @returns {void}
 */

/**
 * Fired when the FINAL checkpoint's pass radius is reached. The sequence is
 * done afterwards; only reset() can run it again.
 *
 * @callback SequenceOnComplete
 * @returns {void}
 */

/**
 * Handle for a created checkpoint sequence.
 *
 * @typedef {object} CheckpointSequence
 * @property {(dt: number, carState: { x: number, z: number }) => void} update
 *   Sample the car position against the CURRENT target only (dt is unused
 *   today — kept for interface parity with the other per-tick updaters and
 *   future timed gates).
 * @property {() => number} currentIndex Index of the current target
 *   (0-based; === total() when done).
 * @property {() => number} total Number of checkpoints.
 * @property {() => RouteCheckpoint | null} currentTarget The checkpoint the
 *   player must reach now (null when done).
 * @property {() => boolean} isDone Whether the final checkpoint was passed.
 * @property {() => void} reset Restart from the first checkpoint (fires no
 *   callbacks; callers re-announce the first target themselves).
 */

/**
 * Create an ordered checkpoint sequence.
 * @param {object} deps Collaborators.
 * @param {RouteCheckpoint[]} deps.checkpoints Ordered checkpoints (>= 1).
 * @param {number} [deps.passRadiusM=TEST_ROUTE_PASS_RADIUS_M] Distance (m)
 *   at which the current target counts as passed.
 * @param {SequenceOnAdvance} [deps.onAdvance] Target advanced callback.
 * @param {SequenceOnComplete} [deps.onComplete] Route completed callback.
 * @returns {CheckpointSequence} The sequence handle.
 */
export function createCheckpointSequence({
  checkpoints,
  passRadiusM = TEST_ROUTE_PASS_RADIUS_M,
  onAdvance,
  onComplete,
} = {}) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new Error('createCheckpointSequence: checkpoints must be a non-empty array');
  }
  const radiusSq = passRadiusM * passRadiusM;
  let index = 0;

  return {
    /**
     * Test the car position against the CURRENT target ONLY — later (or
     * earlier) checkpoints are never sampled, so they cannot be taken out
     * of order.
     * @param {number} _dt Sim dt (s; unused, see typedef).
     * @param {{ x: number, z: number }} carState Live car position (read).
     * @returns {void}
     */
    update(_dt, carState) {
      if (index >= checkpoints.length) return; // done
      const cp = /** @type {RouteCheckpoint} */ (checkpoints[index]);
      const dx = carState.x - cp.x;
      const dz = carState.z - cp.z;
      if (dx * dx + dz * dz > radiusSq) return; // not reached yet
      index += 1;
      if (index >= checkpoints.length) {
        if (onComplete) onComplete();
      } else if (onAdvance) {
        onAdvance(index, /** @type {RouteCheckpoint} */ (checkpoints[index]));
      }
    },

    /** @returns {number} Current target index (0-based; total when done). */
    currentIndex() {
      return index;
    },

    /** @returns {number} Checkpoint count. */
    total() {
      return checkpoints.length;
    },

    /** @returns {RouteCheckpoint | null} The current target (null when done). */
    currentTarget() {
      return index < checkpoints.length
        ? /** @type {RouteCheckpoint} */ (checkpoints[index])
        : null;
    },

    /** @returns {boolean} Whether the route is complete. */
    isDone() {
      return index >= checkpoints.length;
    },

    /** @returns {void} */
    reset() {
      index = 0;
    },
  };
}

/**
 * Build the ?debug test route's checkpoints: three road-grid intersections
 * near the documented spawn (x = -3.5, z = -117, heading +Z), derived from
 * the generated layout's centerlines so the route always lands on clear
 * asphalt. The straight line spawn -> checkpoint 1 passes within 3.5 m of
 * checkpoint 1 (inside the pass radius), so holding throttle alone verifies
 * a pass; the loop then runs two junctions east/north.
 *
 * Layout (grid line i sits at (i - GRID_N/2) * pitchM, pitch = 78 m):
 *   0. (x=0,   z=-78)  linesX[5] x linesZ[4] — ~39 m ahead of the spawn
 *   1. (x=78,  z=-78)  linesX[6] x linesZ[4] — one block east
 *   2. (x=78,  z=0)    linesX[6] x linesZ[5] — one block north (final)
 * @param {import('./city-gen.js').CityLayout} layout Generated city layout
 *   (grid.linesX / grid.linesZ consumed).
 * @returns {RouteCheckpoint[]} The three ordered checkpoints.
 */
export function buildTestRouteCheckpoints(layout) {
  const { linesX, linesZ } = layout.grid;
  return [
    { x: linesX[5], z: linesZ[4], label: 'TEST 1/3' },
    { x: linesX[6], z: linesZ[4], label: 'TEST 2/3' },
    { x: linesX[6], z: linesZ[5], label: 'TEST 3/3' },
  ];
}
