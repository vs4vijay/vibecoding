/**
 * Pooled ambient AI traffic (Midtown Blitz, task 4.2).
 *
 * ~24 kinematic cars (design Decision 7: "~24 active AI cars follow lane
 * waypoints; at intersections they pick straight/left/right from a seeded
 * stream, slow for the turn, and probe ahead (~8 m) to brake for cars or
 * the player; cars beyond a radius from the player are teleported to unused
 * lane slots near the player") that drive the task 4.1 lane graph. This
 * module owns MOTION ONLY — poses are plain data; rendering lives in
 * src/game/traffic-view.js. Physical collision response (separation /
 * momentum exchange) lives in src/game/car-collisions.js (task 4.3): the
 * resolver never edits a car's path or speed — it writes the decaying
 * kick/offset/spin fields documented on {@link TrafficCar}, which this
 * module integrates in update() step 5.5, so a hit car is shoved sideways,
 * yaws, and then swings back onto its lane path. Parked cars (task 4.3)
 * are static collision-world AABBs along the curbs; lane centers clear
 * their AABBs by ~1.05 m by construction, so probes and spawns never
 * interact with them.
 *
 * Motion model (per fixed tick, in creation order):
 *  1. Path following: every car sits at arc-length `s` along a polyline
 *     `path` — either a lane's straight part (phase 'lane') or a junction
 *     connector from LaneGraph.nextChoice (phase 'junction'). Pose = point
 *     + tangent of the polyline; the rendered heading chases the tangent
 *     exponentially (purely cosmetic smoothing — position is exact, so the
 *     lane-keeping metric never sees it).
 *  2. Junctions: the next turn is drawn ONCE when the car enters a lane
 *     (car.pendingChoice, from the car's own forked rng stream), so the
 *     approach can anticipate: cars decelerate toward the connector's
 *     turn speed `clamp(sqrt(TURN_LATERAL_MS2 * arcRadiusM), 3, 7)` over
 *     the braking distance `(v^2 - vTurn^2) / (2 * TURN_BRAKE_MS2)`.
 *     Straight connectors (arcRadiusM === 0) never slow the car.
 *  3. Ahead probe: a cone extending PROBE_RANGE_M along the path tangent
 *     and PROBE_HALF_WIDTH_M to each side. Every other traffic car and the
 *     PLAYER body inside the cone yields a bumper gap
 *     `forwardDist - CAR_HALF_LENGTH_M - obstacleHalfLength`; the largest
 *     obstacle (smallest gap) caps speed at the kinematically safe
 *     `sqrt(2 * BRAKE_MS2 * max(0, gap - MIN_GAP_M))` — braking grows
 *     proportionally as the gap closes, and a car that keeps the safety
 *     speed can never end below MIN_GAP_M (5 m bumper-to-bumper; a hard
 *     clamp stops it just above that). While obstructed the car holds;
 *     when the path clears it resumes after a 0.3-0.6 s reaction delay
 *     (traffic spec "resumes when the path clears"). The player always
 *     blocks; other traffic cars stop blocking after CREEP_AFTER_S of
 *     standstill so two cars that mutually probe each other inside a
 *     junction cannot deadlock — the blocked car creeps past at walking
 *     pace (queueing behavior itself is untouched; 4.3 adds the physical
 *     separation layer).
 *  4. Recycling: a car farther than RECYCLE_DIST_M (260 m = the medium
 *     tier's fog far, beyond the draw distance) from the player is
 *     teleported onto a random lane (graph.randomLaneAt) in a 100-180 m
 *     ring around the player — kept > 40 m away, clear of static solids,
 *     and not overlapping another car — so pop-in hides behind buildings
 *     and fog. Cars are SEAMLESS in the sense that a teleport only ever
 *     happens far outside the visible window; nearby traffic is never
 *     moved (traffic spec "moved in and out of the active area
 *     seamlessly").
 *
 * Kinematic, allocation-free per tick: cars are plain objects advanced by
 * arithmetic (no physics step, no three.js); the only allocations are the
 * per-car rng forks and spawn bookkeeping at creation time. Probe checks
 * are O(cars^2) distance math (~600 dot products for 24 cars) — orders of
 * magnitude under the frame budget (measured by scripts/traffic-test.mjs).
 *
 * Determinism: every car gets its own rng fork ('traffic-car-<i>') used
 * for cruise speed, spawn placement, turn choices, resume delays, and its
 * recycle draws, forked from the caller's stream in fixed index order —
 * same seed + same player-position script = float-identical traffic
 * (verified by scripts/traffic-test.mjs). A real session is of course
 * player-dependent: the player's position feeds the probe and the recycle
 * trigger. No wall clock, no Math.random.
 *
 * Player contract: update(dt, playerState) reads ONLY playerState.x and
 * playerState.z (any object with those fields works — main passes the live
 * car.state). A null/absent playerState skips the player probe and keeps
 * cars from recycling (harness convenience).
 *
 * Purity: no three.js, no DOM; node-testable (scripts/traffic-test.mjs).
 */

/** Tunables for the whole traffic system (meters, m/s, m/s^2, seconds). */
export const TRAFFIC_TUNING = Object.freeze({
  /** Default pooled car count (design Decision 7: ~24). */
  COUNT: 24,
  /** Cruise speed range in m/s, drawn per car (spec "steady cruising pace"). */
  CRUISE_MIN_MS: 8,
  CRUISE_MAX_MS: 12,
  /** Acceleration toward the target speed in m/s^2. */
  ACCEL_MS2: 5,
  /** Obstacle braking deceleration in m/s^2 (sets the safe-speed curve). */
  BRAKE_MS2: 6,
  /** Comfortable deceleration used to anticipate junction turns in m/s^2. */
  TURN_BRAKE_MS2: 4.5,
  /** Lateral comfort acceleration for the junction turn-speed curve in m/s^2. */
  TURN_LATERAL_MS2: 3.5,
  /** Junction turn-speed clamp in m/s (tight 3.5 m right arcs -> 3.5 m/s). */
  TURN_SPEED_MIN_MS: 3,
  TURN_SPEED_MAX_MS: 7,
  /** Probe cone length along the tangent in m (design: "probe ahead ~8 m" beyond the kept gap). */
  PROBE_RANGE_M: 18,
  /** Probe cone half-width in m (car width ~1.9/2 plus reaction margin). */
  PROBE_HALF_WIDTH_M: 2.1,
  /** Target stopping gap, bumper to bumper, in m (spec "a safe distance"). */
  MIN_GAP_M: 5,
  /** Gap in m under which the hard safety clamp stops the car this tick. */
  HARD_STOP_GAP_M: 5.5,
  /** Bumper gap in m under which a car counts as obstructed (holds). */
  OBSTRUCTED_GAP_M: 6,
  /** Resume reaction delay range in s (spec "resumes within a short moment"). */
  RESUME_DELAY_MIN_S: 0.3,
  RESUME_DELAY_MAX_S: 0.6,
  /** Half-length of a traffic/player body used in gap math in m (4.4 m cars). */
  CAR_HALF_LENGTH_M: 2.2,
  PLAYER_HALF_LENGTH_M: 2.2,
  /** Recycle trigger distance from the player in m (medium tier fog far). */
  RECYCLE_DIST_M: 260,
  /** Recycle spawn ring around the player in m (hidden behind buildings/fog). */
  RECYCLE_RING_MIN_M: 100,
  RECYCLE_RING_MAX_M: 180,
  /** Initial spawn ring minimum in m (first population may sit closer). */
  INITIAL_RING_MIN_M: 50,
  /** Spawn/recycle keep-out radius around the player in m. */
  SPAWN_KEEP_OUT_M: 40,
  /** Minimum spacing between two spawned/recycled cars in m. */
  SPAWN_SEPARATION_M: 10,
  /** Static-overlap clearance radius for spawn/recycle checks in m. */
  SPAWN_CLEAR_RADIUS_M: 1.0,
  /** Rendered-heading chase rate in 1/s (cosmetic smoothing only). */
  HEADING_RATE: 10,
  /** Recycle placement attempts before relaxing the separation rule. */
  RECYCLE_ATTEMPTS: 30,
  /** Standstill seconds after which a car ignores OTHER TRAFFIC in its
   *  probe (never the player) and creeps through — anti-junction-deadlock. */
  CREEP_AFTER_S: 8,
  /** Creep speed cap in m/s while the deadlock escape is active. */
  CREEP_SPEED_MS: 2,
  /** Number of paint indices cars carry (traffic-view owns the palette). */
  PAINT_COUNT: 5,

  // --- momentum-exchange state (task 4.3, set by car-collisions.js) --------
  // Collision impulses do not touch the path-following speed (`speed`):
  // they land in separate decaying fields integrated in update() step 5.5,
  // so lane keeping, probing and recycling keep working unchanged.
  /** Exponential decay rate of a car's kick velocity in 1/s. */
  KICK_DECAY_RATE: 2.5,
  /** Exponential decay rate of a car's yaw rate (spin) in 1/s. */
  YAW_RATE_DECAY_RATE: 2.5,
  /** Exponential decay rate of the lateral/positional kick offset in 1/s
   *  (slower than the velocity decay: the car swings back onto its lane
   *  over ~1-2 s, "steering back to its lane path" after the hit). */
  OFFSET_DECAY_RATE: 1.4,
  /** Hard clamp on |kick velocity| in m/s (also applied by the resolver). */
  KICK_MAX_MS: 8,
  /** Hard clamp on |yaw rate| in rad/s (also applied by the resolver). */
  YAW_RATE_MAX_RPS: 3,
  /** Hard clamp on the accumulated positional offset in m. */
  OFFSET_MAX_M: 3,
  /** Hard clamp on the accumulated visual yaw offset in rad. */
  YAW_OFFSET_MAX_RAD: 1.2,
  /** Values under these thresholds snap to exactly 0 (lets update() drop
   *  back to its zero-cost fast path once a kick has died out). */
  KICK_EPS_MS: 0.02,
  YAW_RATE_EPS_RPS: 0.01,
  OFFSET_EPS_M: 0.005,
  YAW_OFFSET_EPS_RAD: 0.002,
});

/**
 * A pooled traffic car — plain mutable data, advanced by
 * {@link Traffic.update}. Treat every field as read-only from outside
 * (the sim overwrites them each tick).
 *
 * @typedef {object} TrafficCar
 * @property {number} x Body origin x (m; on-road always — lanes are asphalt).
 * @property {number} z Body origin z (m).
 * @property {number} heading Rendered yaw in rad, forward = (sin, cos);
 *   exponentially chases the path tangent — use directly as rotation.y.
 * @property {number} tangentX Unit x of the path tangent at `s` (probe basis).
 * @property {number} tangentZ Unit z of the path tangent at `s`.
 * @property {number} speed Current forward speed in m/s (>= 0; traffic never reverses).
 * @property {number} cruiseMs Per-car cruise speed in m/s (rng-drawn 8-12).
 * @property {import('./lane-graph.js').Lane} lane The lane being followed
 *   (phase 'lane') or the exit lane of the junction connector (phase 'junction').
 * @property {'lane' | 'junction'} phase Which polyline `path` is.
 * @property {import('./lane-graph.js').LanePoint[]} path Current polyline
 *   (shared/frozen lane waypoints or a frozen connector waypoint array).
 * @property {number} s Arc-length progress along `path` in m.
 * @property {import('./lane-graph.js').LaneTurnChoice | null} pendingChoice
 *   Pre-drawn junction choice for the end of the current lane (null only
 *   mid-junction, before the exit lane's own choice is drawn).
 * @property {'straight' | 'left' | 'right'} turn Maneuver label of the
 *   junction being traversed (or the last one entered).
 * @property {number} turnCount Completed turning junctions since creation.
 * @property {number} paint Paint index 0..TRAFFIC_TUNING.PAINT_COUNT-1
 *   (traffic-view maps it to a body color).
 * @property {boolean} held True while the probe holds the car stopped.
 * @property {number} kickVx World-space kick velocity x from car-car
 *   impacts in m/s (task 4.3; written by car-collisions.js, integrated and
 *   exponentially decayed in update(); read-only for other consumers).
 * @property {number} kickVz World-space kick velocity z from car-car
 *   impacts in m/s (see kickVx).
 * @property {number} yawRate Spin rate in rad/s around +Y from an
 *   off-center impact (task 4.3; decays exponentially; sign follows the
 *   impact torque).
 * @property {number} yawOffset Accumulated visual/physical yaw offset in
 *   rad from spin — add to `heading` for the rendered rotation (the
 *   traffic view does); decays back to 0 as the car straightens out.
 * @property {number} offX Accumulated positional offset x in m from kicks
 *   and separation — already included in `x`/`z` (update() adds it to the
 *   path pose); decays back to 0 as the car returns to its lane line.
 * @property {number} offZ Accumulated positional offset z in m (see offX).
 * @property {import('../engine/rng.js').Rng} rng The car's private rng fork
 *   (turn choices, resume delays, recycle draws).
 */

/**
 * Cumulative counters since creation (harness/debug aid; monotonic).
 *
 * @typedef {object} TrafficStats
 * @property {number} turnEvents Turning junctions entered by any car.
 * @property {number} recycles Teleports performed by the recycler.
 * @property {number} spawnFallbacks Placements that needed the relaxed
 *   (separation-free) fallback path.
 */

/**
 * Handle for a created traffic pool.
 *
 * @typedef {object} Traffic
 * @property {TrafficCar[]} cars The pooled cars (fixed length).
 * @property {TrafficStats} stats Cumulative counters.
 * @property {(dt: number, playerState?: { x: number, z: number } | null) => void} update
 *   Advance every car by one fixed tick (dt = SIM_DT; called per tick from
 *   main after the player's step). Reads only playerState.x/z.
 */

/**
 * Shortest-arc angular difference from `from` to `to` in rad, in (-PI, PI].
 * @param {number} from Start angle (rad).
 * @param {number} to End angle (rad).
 * @returns {number} Signed delta.
 */
function shortestArcDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Junction speed for a connector arc radius: the speed whose lateral
 * acceleration stays at the comfort budget, clamped to a drivable band.
 * Straight connectors (radius 0) never call this.
 * @param {number} radiusM Arc radius in m.
 * @returns {number} Target speed in m/s.
 */
function turnSpeedFor(radiusM) {
  const t = TRAFFIC_TUNING;
  const v = Math.sqrt(t.TURN_LATERAL_MS2 * radiusM);
  return Math.min(t.TURN_SPEED_MAX_MS, Math.max(t.TURN_SPEED_MIN_MS, v));
}

/**
 * Create the pooled ambient traffic for a built lane graph.
 *
 * @param {object} deps Collaborators.
 * @param {import('./city-gen.js').CityLayout} deps.layout Generated city
 *   layout (must match the graph's; kept for validation/future tuning).
 * @param {import('./lane-graph.js').LaneGraph} deps.graph Lane graph from
 *   buildLaneGraph(layout) — the road network cars drive.
 * @param {import('./collision.js').CollisionWorld} deps.world Collision
 *   world (overlapsSolid gates spawn/recycle placements).
 * @param {import('../engine/rng.js').Rng} deps.rng Caller-owned rng stream;
 *   one fork per car is taken from it in index order.
 * @param {number} [deps.count=TRAFFIC_TUNING.COUNT] Pool size (cars).
 * @param {{ x: number, z: number }} [deps.player] Initial player position
 *   for the spawn ring (defaults to the layout's documented spawn area at
 *   the grid center). Only read at creation.
 * @returns {Traffic} The traffic pool handle.
 * @throws {TypeError} If deps are missing or shaped wrong.
 */
export function createTraffic({ layout, graph, world, rng, count = TRAFFIC_TUNING.COUNT, player = null } = {}) {
  const T = TRAFFIC_TUNING;
  if (!layout || !layout.grid) {
    throw new TypeError('createTraffic: needs the city layout');
  }
  if (!graph || !Array.isArray(graph.lanes) || typeof graph.nextChoice !== 'function' || typeof graph.randomLaneAt !== 'function') {
    throw new TypeError('createTraffic: needs a LaneGraph (buildLaneGraph output)');
  }
  if (!world || typeof world.overlapsSolid !== 'function') {
    throw new TypeError('createTraffic: needs a CollisionWorld with overlapsSolid');
  }
  if (!rng || typeof rng.fork !== 'function' || typeof rng.float !== 'function') {
    throw new TypeError('createTraffic: needs a caller-owned rng (engine createRng)');
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new TypeError(`createTraffic: count must be a positive integer (got ${count})`);
  }
  const px = player ? Number(player.x) : 0;
  const pz = player ? Number(player.z) : 0;
  if (!Number.isFinite(px) || !Number.isFinite(pz)) {
    throw new TypeError('createTraffic: player position must be finite');
  }

  /** @type {TrafficCar[]} */
  const cars = [];
  /** @type {TrafficStats} */
  const stats = { turnEvents: 0, recycles: 0, spawnFallbacks: 0 };

  /**
   * Fill the car's cumulative-length scratch and pose bookkeeping for a
   * polyline entry (lane straight part or junction connector).
   * @param {TrafficCar} car Car to re-path.
   * @param {import('./lane-graph.js').LanePoint[]} path New polyline.
   * @param {'lane' | 'junction'} phase Which kind of polyline.
   * @param {number} s Entry arc length in m (clamped into the path).
   * @returns {number} Total path length in m.
   */
  function enterPath(car, path, phase, s) {
    car.path = path;
    car.phase = phase;
    const cum = car._cum;
    let total = 0;
    cum[0] = 0;
    for (let i = 0; i + 1 < path.length; i += 1) {
      total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
      cum[i + 1] = total;
    }
    car._total = total;
    car.s = Math.min(Math.max(s, 0), total);
    return total;
  }

  /**
   * Place a car on a lane at arc length s (spawn, recycle, and junction
   * exit all land here): rebuilds the path, snaps the pose, pre-draws the
   * junction choice for the lane's end.
   * @param {TrafficCar} car Car to place.
   * @param {import('./lane-graph.js').Lane} lane Lane to drive.
   * @param {number} s Arc length along the lane's straight part in m.
   * @returns {void}
   */
  function placeOnLane(car, lane, s) {
    car.lane = lane;
    car._turnRadius = 0;
    enterPath(car, lane.waypoints, 'lane', s);
    car.pendingChoice = graph.nextChoice(lane.toNode, lane, car.rng);
    updatePose(car, true);
  }

  /**
   * Recompute a car's position/tangent from (path, s) and integrate the
   * rendered heading toward the tangent. `snap` skips the heading chase
   * (placements must not sweep across town).
   * @param {TrafficCar} car Car to pose.
   * @param {boolean} [snap=false] Snap heading to the tangent instead of chasing.
   * @returns {void}
   */
  function updatePose(car, snap = false) {
    const path = car.path;
    const cum = car._cum;
    let i = 0;
    while (i + 2 < path.length && car.s > cum[i + 1]) i += 1;
    const ax = path[i].x;
    const az = path[i].z;
    const bx = path[i + 1].x;
    const bz = path[i + 1].z;
    const segLen = cum[i + 1] - cum[i];
    const t = segLen > 1e-9 ? (car.s - cum[i]) / segLen : 0;
    car.x = ax + (bx - ax) * t;
    car.z = az + (bz - az) * t;
    car.tangentX = (bx - ax) / segLen;
    car.tangentZ = (bz - az) / segLen;
    const tangentHeading = Math.atan2(car.tangentX, car.tangentZ);
    if (snap) {
      car.heading = tangentHeading;
    } else {
      car.heading += shortestArcDelta(car.heading, tangentHeading) * (1 - Math.exp(-T.HEADING_RATE * car._dt));
    }
  }

  /**
   * Advance through path boundaries: lane -> junction connector (applying
   * the pre-drawn choice) -> exit lane, until s sits inside the path.
   * @param {TrafficCar} car Car to advance.
   * @returns {void}
   */
  function advancePath(car) {
    for (let guard = 0; guard < 4 && car.s >= car._total; guard += 1) {
      const leftover = car.s - car._total;
      if (car.phase === 'lane') {
        const choice = car.pendingChoice;
        if (!choice) {
          // Unreachable on the shipped grid (every node offers >= 1
          // continuation); recycle rather than drive off the road.
          if (!recycleCar(car, car._px, car._pz)) car.s = car._total - 1e-6;
          return;
        }
        car.pendingChoice = null;
        car.turn = choice.turn;
        car.lane = choice.exitLane; // junction-phase lane = the exit lane
        car._turnRadius = choice.arcRadiusM;
        enterPath(car, choice.waypoints, 'junction', leftover);
        if (choice.arcRadiusM > 0) {
          car.turnCount += 1;
          stats.turnEvents += 1;
        }
      } else {
        // Junction exit: merge onto the chosen lane; it draws its own
        // next choice inside placeOnLane.
        placeOnLane(car, car.lane, leftover);
        return;
      }
    }
  }

  /**
   * Probe the cone ahead of a car for other traffic and the player; returns
   * the smallest bumper gap (Infinity when clear). Pure distance math.
   * @param {TrafficCar} car Probing car.
   * @param {{ x: number, z: number } | null} player Player body (x/z only).
   * @param {boolean} [ignoreCars=false] Skip other traffic (deadlock escape;
   *   the player always blocks).
   * @returns {number} Smallest bumper gap in m (Infinity when clear).
   */
  function probeAhead(car, player, ignoreCars = false) {
    const tx = car.tangentX;
    const tz = car.tangentZ;
    const rx = -tz; // driver's right = forward rotated by -PI/2 (lane-graph rule)
    const rz = tx;
    let minGap = Infinity;
    const self = car;
    if (!ignoreCars) {
      for (let j = 0; j < cars.length; j += 1) {
        const other = cars[j];
        if (other === self) continue;
        const dx = other.x - self.x;
        const dz = other.z - self.z;
        const fwd = dx * tx + dz * tz;
        if (fwd <= 0 || fwd > T.PROBE_RANGE_M) continue;
        const lat = Math.abs(dx * rx + dz * rz);
        if (lat > T.PROBE_HALF_WIDTH_M) continue;
        const gap = fwd - 2 * T.CAR_HALF_LENGTH_M;
        if (gap < minGap) minGap = gap;
      }
    }
    if (player) {
      const dx = player.x - self.x;
      const dz = player.z - self.z;
      const fwd = dx * tx + dz * tz;
      if (fwd > 0 && fwd <= T.PROBE_RANGE_M) {
        const lat = Math.abs(dx * rx + dz * rz);
        if (lat <= T.PROBE_HALF_WIDTH_M) {
          const gap = fwd - T.CAR_HALF_LENGTH_M - T.PLAYER_HALF_LENGTH_M;
          if (gap < minGap) minGap = gap;
        }
      }
    }
    return minGap;
  }

  /**
   * Try to place a car on a lane in the ring around the player: rejects
   * lanes too close to the player, placements inside static solids, and
   * (first pass only) spots overlapping other cars. Draws from the car's
   * rng, so the sequence is deterministic per car.
   * @param {TrafficCar} car Car to place.
   * @param {number} px Player x (m).
   * @param {number} pz Player z (m).
   * @param {number} ringMinM Inner spawn radius in m.
   * @param {boolean} enforceSeparation Respect SPAWN_SEPARATION_M to other cars.
   * @returns {boolean} True when placed.
   */
  function tryPlaceNear(car, px, pz, ringMinM, enforceSeparation) {
    for (let attempt = 0; attempt < T.RECYCLE_ATTEMPTS; attempt += 1) {
      const ring = car.rng.float(ringMinM, T.RECYCLE_RING_MAX_M);
      const lane = graph.randomLaneAt(px, pz, ring, car.rng);
      if (!lane) continue;
      const s = lane.lengthM * car.rng.float(0.15, 0.85);
      const [a, b] = lane.waypoints;
      const t = s / lane.lengthM;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const dxp = x - px;
      const dzp = z - pz;
      if (dxp * dxp + dzp * dzp < T.SPAWN_KEEP_OUT_M * T.SPAWN_KEEP_OUT_M) continue;
      if (world.overlapsSolid(x, z, T.SPAWN_CLEAR_RADIUS_M)) continue;
      if (enforceSeparation) {
        let crowded = false;
        for (let j = 0; j < cars.length; j += 1) {
          const other = cars[j];
          if (other === car) continue;
          const dx = other.x - x;
          const dz = other.z - z;
          if (dx * dx + dz * dz < T.SPAWN_SEPARATION_M * T.SPAWN_SEPARATION_M) {
            crowded = true;
            break;
          }
        }
        if (crowded) continue;
      }
      car.speed = car.cruiseMs * 0.6; // roll out of the teleport at moderate pace
      car.held = false;
      car._clearTimer = -1;
      // A teleport leaves any collision kick behind (task 4.3): the car
      // spawns clean on its lane line.
      car.kickVx = 0;
      car.kickVz = 0;
      car.yawRate = 0;
      car.yawOffset = 0;
      car.offX = 0;
      car.offZ = 0;
      placeOnLane(car, lane, s);
      return true;
    }
    return false;
  }

  /**
   * Recycle a car that strayed beyond the player radius: teleport onto a
   * ring lane near the player (see module header). Falls back to a
   * separation-relaxed placement, then leaves the car untouched (it is
   * beyond the draw distance anyway; the next tick retries).
   * @param {TrafficCar} car Car to recycle.
   * @param {number} px Player x (m).
   * @param {number} pz Player z (m).
   * @returns {boolean} True when the car was moved.
   */
  function recycleCar(car, px, pz) {
    if (tryPlaceNear(car, px, pz, T.RECYCLE_RING_MIN_M, true)) {
      stats.recycles += 1;
      return true;
    }
    if (tryPlaceNear(car, px, pz, T.RECYCLE_RING_MIN_M, false)) {
      stats.recycles += 1;
      stats.spawnFallbacks += 1;
      return true;
    }
    return false;
  }

  // --- create the pool: one rng fork per car, in index order ----------------
  for (let i = 0; i < count; i += 1) {
    /** @type {TrafficCar} */
    const car = {
      x: 0,
      z: 0,
      heading: 0,
      tangentX: 0,
      tangentZ: 1,
      speed: 0,
      cruiseMs: 0,
      lane: null,
      phase: 'lane',
      path: [],
      s: 0,
      pendingChoice: null,
      turn: 'straight',
      turnCount: 0,
      paint: 0,
      held: false,
      // Task 4.3 momentum-exchange state (see TrafficCar typedef): decaying
      // kick velocity, spin, and positional/yaw offsets. Zero until the
      // car-collisions resolver lands a hit; teleports reset them.
      kickVx: 0,
      kickVz: 0,
      yawRate: 0,
      yawOffset: 0,
      offX: 0,
      offZ: 0,
      rng: rng.fork(`traffic-car-${i}`),
      // Private scratch (underscored): cumulative lengths, path total, the
      // arc radius of the junction being traversed, the probe hold/resume
      // timer, the anti-deadlock standstill clock, the tick's dt and the
      // player position for pathless recycle fallbacks.
      _cum: new Float64Array(8),
      _total: 0,
      _turnRadius: 0,
      _clearTimer: -1,
      _stuck: 0,
      _dt: 0,
      _px: px,
      _pz: pz,
    };
    car.cruiseMs = car.rng.float(T.CRUISE_MIN_MS, T.CRUISE_MAX_MS);
    car.paint = car.rng.int(0, T.PAINT_COUNT - 1);
    if (!tryPlaceNear(car, px, pz, T.INITIAL_RING_MIN_M, true)) {
      // Dense-world fallback: keep the pool full, drop only the separation
      // rule (solids/keep-out still apply).
      if (!tryPlaceNear(car, px, pz, T.INITIAL_RING_MIN_M, false)) {
        const lane = graph.randomLaneAt(px, pz, T.RECYCLE_RING_MAX_M, car.rng);
        if (lane) {
          stats.spawnFallbacks += 1;
          car.speed = car.cruiseMs * 0.6;
          placeOnLane(car, lane, lane.lengthM * car.rng.float(0.15, 0.85));
        }
      }
    }
    cars.push(car);
  }

  /**
   * Advance every car one fixed tick (module header for the model).
   * @param {number} dt Fixed tick length in s (SIM_DT = 1/60).
   * @param {{ x: number, z: number }} [playerState] Live player body
   *   (x/z read; main passes car.state). Omit to sim without a player.
   * @returns {void}
   * @throws {TypeError} If dt is not a positive finite number.
   */
  function update(dt, playerState = null) {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new TypeError(`traffic.update: dt must be a positive finite number (got ${dt})`);
    }
    const px = playerState ? Number(playerState.x) : NaN;
    const pz = playerState ? Number(playerState.z) : NaN;
    const hasPlayer = playerState !== null && Number.isFinite(px) && Number.isFinite(pz);

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      car._dt = dt;
      if (hasPlayer) {
        car._px = px;
        car._pz = pz;
      }

      // --- 1. target speed: cruise, capped by the junction being driven or
      // anticipated (pre-drawn choice lets the car brake BEFORE the arc).
      let target = car.cruiseMs;
      if (car.phase === 'junction' && car._turnRadius > 0) {
        target = Math.min(target, turnSpeedFor(car._turnRadius));
      }
      if (car.phase === 'lane' && car.pendingChoice && car.pendingChoice.arcRadiusM > 0) {
        const vTurn = turnSpeedFor(car.pendingChoice.arcRadiusM);
        const dRem = car._total - car.s;
        const dNeeded = Math.max(0, car.speed * car.speed - vTurn * vTurn) / (2 * T.TURN_BRAKE_MS2);
        if (dRem <= dNeeded) target = Math.min(target, vTurn);
      }

      // --- 2. ahead probe: hold state machine + kinematic safe speed. Two
      // passes so the deadlock escape can latch cleanly: a car kept at a
      // standstill by OTHER TRAFFIC for CREEP_AFTER_S stops sensing cars
      // (never the player) until the traffic gap reopens, creeping past at
      // walking pace. The player always blocks, for as long as they stay.
      const gapCars = probeAhead(car, null);
      const gapPlayer = hasPlayer ? probeAhead(car, playerState) : Infinity;
      if (gapCars < T.OBSTRUCTED_GAP_M) car._stuck += dt;
      else car._stuck = 0;
      const creep = car._stuck > T.CREEP_AFTER_S;
      const gap = creep ? gapPlayer : Math.min(gapCars, gapPlayer);
      if (gap < T.OBSTRUCTED_GAP_M) {
        car.held = true;
        car._clearTimer = -1;
      } else if (car.held) {
        if (car._clearTimer < 0) {
          car._clearTimer = car.rng.float(T.RESUME_DELAY_MIN_S, T.RESUME_DELAY_MAX_S);
        }
        car._clearTimer -= dt;
        if (car._clearTimer <= 0) car.held = false;
      }
      let vAllow = Infinity;
      if (car.held) {
        vAllow = 0;
      } else if (gap < Infinity) {
        vAllow = Math.sqrt(2 * T.BRAKE_MS2 * Math.max(0, gap - T.MIN_GAP_M));
      }
      target = Math.min(target, vAllow);
      if (creep) target = Math.max(0, Math.min(target, T.CREEP_SPEED_MS));

      // --- 3. integrate speed (accel/brake limited), then the safety clamps
      // that make undershooting MIN_GAP_M impossible.
      if (target < car.speed) {
        car.speed = Math.max(target, car.speed - T.BRAKE_MS2 * dt);
      } else {
        car.speed = Math.min(target, car.speed + T.ACCEL_MS2 * dt);
      }
      if (car.speed > vAllow) car.speed = vAllow;
      if (gap < T.HARD_STOP_GAP_M || car.speed < 0.005) car.speed = Math.min(car.speed, 0);
      if (car.speed < 0) car.speed = 0;

      // --- 4. advance along the path, crossing junction boundaries.
      car.s += car.speed * dt;
      advancePath(car);

      // --- 5. pose from the path (exact position, chased heading).
      updatePose(car, false);

      // --- 5.5 momentum-exchange state (task 4.3): integrate the decaying
      // kick velocity into a positional offset, the yaw rate into a yaw
      // offset, and decay both toward zero (the car swings back onto its
      // lane line and straightens out). updatePose() re-derives x/z from
      // the path each tick, so the offset is what persists. Skipped
      // entirely (zero cost) while every field rests at exactly 0 — the
      // common tick. A static-solids guard shrinks the offset so a shove
      // can never press the car into a building/parked car.
      if (
        car.kickVx !== 0 || car.kickVz !== 0 || car.yawRate !== 0 ||
        car.offX !== 0 || car.offZ !== 0 || car.yawOffset !== 0
      ) {
        const dV = Math.exp(-T.KICK_DECAY_RATE * dt);
        const dO = Math.exp(-T.OFFSET_DECAY_RATE * dt);
        const dY = Math.exp(-T.YAW_RATE_DECAY_RATE * dt);
        car.kickVx *= dV;
        car.kickVz *= dV;
        car.yawRate *= dY;
        car.offX = (car.offX + car.kickVx * dt) * dO;
        car.offZ = (car.offZ + car.kickVz * dt) * dO;
        car.yawOffset = (car.yawOffset + car.yawRate * dt) * dY;
        // Snap tiny values to exactly 0 so the fast path re-engages.
        if (Math.abs(car.kickVx) < T.KICK_EPS_MS) car.kickVx = 0;
        if (Math.abs(car.kickVz) < T.KICK_EPS_MS) car.kickVz = 0;
        if (Math.abs(car.yawRate) < T.YAW_RATE_EPS_RPS) car.yawRate = 0;
        if (Math.abs(car.offX) < T.OFFSET_EPS_M) car.offX = 0;
        if (Math.abs(car.offZ) < T.OFFSET_EPS_M) car.offZ = 0;
        if (Math.abs(car.yawOffset) < T.YAW_OFFSET_EPS_RAD) car.yawOffset = 0;
        // Clamps (the resolver clamps too; this is the defensive net).
        if (car.offX > T.OFFSET_MAX_M) car.offX = T.OFFSET_MAX_M;
        else if (car.offX < -T.OFFSET_MAX_M) car.offX = -T.OFFSET_MAX_M;
        if (car.offZ > T.OFFSET_MAX_M) car.offZ = T.OFFSET_MAX_M;
        else if (car.offZ < -T.OFFSET_MAX_M) car.offZ = -T.OFFSET_MAX_M;
        if (car.yawOffset > T.YAW_OFFSET_MAX_RAD) car.yawOffset = T.YAW_OFFSET_MAX_RAD;
        else if (car.yawOffset < -T.YAW_OFFSET_MAX_RAD) car.yawOffset = -T.YAW_OFFSET_MAX_RAD;
        // Static guard: halve the offset until the body is clear of
        // buildings/parked cars (open road keeps it untouched).
        let shrink = 1;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const ox = car.x + car.offX * shrink;
          const oz = car.z + car.offZ * shrink;
          if (!world.overlapsSolid(ox, oz, T.SPAWN_CLEAR_RADIUS_M)) break;
          shrink *= 0.5;
        }
        if (shrink !== 1) {
          car.offX *= shrink;
          car.offZ *= shrink;
        }
        car.x += car.offX;
        car.z += car.offZ;
      }

      // --- 6. recycling beyond the player radius (module header rule).
      if (hasPlayer) {
        const dx = car.x - px;
        const dz = car.z - pz;
        if (dx * dx + dz * dz > T.RECYCLE_DIST_M * T.RECYCLE_DIST_M) {
          recycleCar(car, px, pz);
        }
      }
    }
  }

  return { cars, stats, update };
}
