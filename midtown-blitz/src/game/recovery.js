/**
 * Reset targeting + stuck detection (Midtown Blitz, task 3.3).
 *
 * Two pure, DOM-free pieces behind the vehicle-control spec's "Reset and
 * recovery" requirement:
 *
 *  - {@link findNearestRoadPosition} maps any world point (the car's current
 *    position, however wedged or out of bounds) to the nearest drivable road
 *    position: the closer of the nearest vertical / horizontal road
 *    centerline (`grid.linesX` / `grid.linesZ`), projected onto that line
 *    and clamped to the grid's extent, with a heading aligned to the road's
 *    direction (vertical roads face +Z, horizontal roads face +X — the
 *    shared physics/camera convention `forward = (sin, cos)`). Deterministic
 *    tie-breaks: equal distances on an axis pick the lower line index, and a
 *    vertical road wins an inter-axis tie. The point lands exactly on a
 *    centerline, i.e. on asphalt (`surfaceHeightAt == 0`), well inside the
 *    road width; the caller resets the car there with zero velocity.
 *
 *  - {@link createStuckMonitor} implements this game's planar-physics
 *    reading of the spec's "flipped or immovably stuck" trigger. The car
 *    cannot roll over, so "flipped" maps to "stuck": the monitor raises a
 *    sustained `isStuck`/`promptVisible` state when the car shows no
 *    movement while the throttle is held for `stuckTimeS` (~2 s) — wedged
 *    against a wall — or when residual collision penetration (an embed the
 *    resolver could not fully clear) persists for the same time, and it
 *    raises the state IMMEDIATELY when the car leaves the drivable world
 *    bounds. Simply being parked (no throttle) never counts as stuck.
 *    Main polls `promptVisible` each frame to show/hide the reset prompt.
 *
 * Purity: plain math + layout/world-bounds data only — no three.js, no DOM,
 * no randomness. Identical inputs give identical outputs (verified by
 * scripts/recovery-test.mjs alongside the DOM wiring in main.js).
 */

/**
 * @typedef {object} RoadPosition
 * @property {number} x Body origin x on a road centerline (m).
 * @property {number} z Body origin z on the road (m).
 * @property {number} heading Yaw aligned with the road direction (rad):
 *   0 (facing +Z) on a vertical road, PI/2 (facing +X) on a horizontal one.
 */

/**
 * Map any world point to the nearest road position (module header).
 *
 * @param {import('./city-gen.js').CityLayout} layout Generated city layout
 *   (uses `grid.linesX`, `grid.linesZ` only).
 * @param {number} x Query world x (m; may be off-road or out of bounds).
 * @param {number} z Query world z (m).
 * @returns {RoadPosition} Nearest on-road position + road-aligned heading.
 */
export function findNearestRoadPosition(layout, x, z) {
  const { linesX, linesZ } = layout.grid;

  // Nearest centerline per axis (strict `<` keeps the lower index on ties —
  // deterministic for a point exactly between two lines).
  let vi = 0;
  for (let i = 1; i < linesX.length; i += 1) {
    if (Math.abs(linesX[i] - x) < Math.abs(linesX[vi] - x)) vi = i;
  }
  let hi = 0;
  for (let j = 1; j < linesZ.length; j += 1) {
    if (Math.abs(linesZ[j] - z) < Math.abs(linesZ[hi] - z)) hi = j;
  }

  const distV = Math.abs(linesX[vi] - x);
  const distH = Math.abs(linesZ[hi] - z);

  // Along-axis coordinates clamp to the centerline span (interior of the
  // grid), so a wildly out-of-bounds query still lands on a real road.
  const zOnRoad = Math.min(linesZ[linesZ.length - 1], Math.max(linesZ[0], z));
  const xOnRoad = Math.min(linesX[linesX.length - 1], Math.max(linesX[0], x));

  // Vertical roads (running along z) win ties; both outcomes are on asphalt.
  if (distV <= distH) {
    return { x: linesX[vi], z: zOnRoad, heading: 0 };
  }
  return { x: xOnRoad, z: linesZ[hi], heading: Math.PI / 2 };
}

/**
 * Monitor configuration (all optional; see {@link createStuckMonitor}).
 *
 * @typedef {object} StuckMonitorOptions
 * @property {{ minX: number, maxX: number, minZ: number, maxZ: number }} [bounds]
 *   Drivable world bounds (the layout's `world` rect). Omit to disable the
 *   out-of-bounds trigger.
 * @property {number} [speedThresholdMs=0.5] Planar speed below which the car
 *   counts as not moving while the throttle is held (m/s).
 * @property {number} [throttleThreshold=0.5] Throttle input at/above which
 *   the pedal counts as held (0..1).
 * @property {number} [stuckTimeS=2] Sustained duration before the
 *   stationary/embedded conditions raise the stuck state (s).
 * @property {number} [penetrationThresholdM=0.05] Residual body-vs-AABB
 *   penetration depth that counts as embedded (m).
 * @property {number} [outOfBoundsMarginM=1] Extra slack outside `bounds`
 *   before the car counts as out of the drivable area (m).
 */

/**
 * Car-state-like snapshot the monitor reads (a plain subset of CarState, so
 * the live physics state can be passed directly — the hot path allocates
 * nothing).
 *
 * @typedef {object} StuckStateLike
 * @property {number} x Car world x (m).
 * @property {number} z Car world z (m).
 * @property {number} speed Planar speed (m/s; CarState.speed).
 * @property {number} [lastTickMaxPenetration=0] Residual post-resolution
 *   penetration depth (m; CarState.lastTickMaxPenetration).
 */

/**
 * Controls-like input snapshot (a subset of CarControls; only the throttle
 * matters here).
 *
 * @typedef {object} StuckControlsLike
 * @property {number} [throttle=0] Throttle input this tick (0..1).
 */

/**
 * Handle for a created stuck monitor. Fields are refreshed by every
 * {@link StuckMonitor.update} call.
 *
 * @typedef {object} StuckMonitor
 * @property {() => number} stuckTimer Sustained-stuck accumulation (s;
 *   0..stuckTimeS, reset to 0 whenever no stuck condition holds).
 * @property {() => boolean} outOfBounds Whether the last update saw the car
 *   outside the drivable bounds.
 * @property {() => boolean} isStuck Stuck per the module-header rules
 *   (sustained timer reached OR out of bounds).
 * @property {() => boolean} promptVisible Whether the "press R to reset"
 *   prompt should be shown (== isStuck).
 * @property {(dt: number, state: StuckStateLike, controls?: StuckControlsLike) => void} update
 *   Feed one sim tick (dt in s; the live CarState + CarControls work as-is).
 * @property {() => void} reset Clear the stuck state (after a reset/teleport;
 *   the next update re-derives everything from the new position).
 */

/**
 * Create the stuck monitor (module header for the trigger rules).
 *
 * @param {StuckMonitorOptions} [options] Tunables + drivable bounds.
 * @returns {StuckMonitor} The monitor handle.
 */
export function createStuckMonitor(options = {}) {
  const bounds = options.bounds ?? null;
  const speedThresholdMs = options.speedThresholdMs ?? 0.5;
  const throttleThreshold = options.throttleThreshold ?? 0.5;
  const stuckTimeS = options.stuckTimeS ?? 2;
  const penetrationThresholdM = options.penetrationThresholdM ?? 0.05;
  const outOfBoundsMarginM = options.outOfBoundsMarginM ?? 1;

  let timer = 0;
  let outside = false;

  /**
   * @param {StuckStateLike} state The tick's car state.
   * @returns {void}
   */
  function updateOutside(state) {
    if (!bounds) {
      outside = false;
      return;
    }
    outside =
      state.x < bounds.minX - outOfBoundsMarginM ||
      state.x > bounds.maxX + outOfBoundsMarginM ||
      state.z < bounds.minZ - outOfBoundsMarginM ||
      state.z > bounds.maxZ + outOfBoundsMarginM;
  }

  /**
   * @returns {boolean} Current stuck state (see typedef).
   */
  function isStuck() {
    return outside || timer >= stuckTimeS;
  }

  return {
    stuckTimer: () => timer,
    outOfBounds: () => outside,
    isStuck,
    promptVisible: isStuck,
    update(dt, state, controls) {
      updateOutside(state);
      // Immovable: driver demand with no resulting motion (wedged against a
      // wall). Embedded: the collision resolver keeps failing to fully clear
      // a box. Parked WITHOUT throttle is deliberately never stuck.
      const immovable =
        (controls?.throttle ?? 0) >= throttleThreshold &&
        state.speed < speedThresholdMs;
      const embedded = (state.lastTickMaxPenetration ?? 0) > penetrationThresholdM;
      if (immovable || embedded) {
        timer = Math.min(stuckTimeS, timer + dt);
      } else {
        timer = 0;
      }
    },
    reset() {
      timer = 0;
      outside = false;
    },
  };
}
