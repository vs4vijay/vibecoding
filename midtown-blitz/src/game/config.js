/**
 * All car-physics tunables in one place (Midtown Blitz, task 3.1).
 *
 * Design Decision 4 risk item: "Car model keeps tunable constants in one
 * file (`game/config` style)". Every number the arcade driving model uses
 * lives here, grouped by concern, each with its unit in the JSDoc. Task 3.2
 * does the by-hand feel pass by editing these values only.
 *
 * Unit conventions (whole physics module):
 *  - 1 world unit = 1 meter; speeds in m/s (multiply by 3.6 for km/h);
 *    accelerations in m/s^2; angles in radians; rates in 1/s.
 *  - Heading is a yaw angle where forward = (sin(heading), cos(heading)) in
 *    x/z: heading 0 faces +Z, heading PI/2 faces +X. This matches the
 *    engine camera-rig convention (target local +Z is forward), so a car
 *    mesh can use `mesh.rotation.y = state.heading` directly.
 *
 * Purity: data only — no three.js, no DOM, node-testable.
 */

/** km/h per m/s (unit conversion helper for HUD/tests). */
export const KMH_PER_MS = 3.6;

/**
 * The default car tuning. Deep-frozen — createCarPhysics() reads it as-is
 * unless the caller passes overrides (shallow-merged per section).
 *
 * @typedef {object} CarConfig
 * @property {{ lengthM: number, widthM: number, circleRadiusM: number,
 *   circleOffsetM: number, wheelbaseM: number, wheelRadiusM: number }} body
 *   Two-circle capsule body + wheel geometry (meters).
 * @property {{ topSpeedMs: number, taperSpeedMs: number, accelMs2: number,
 *   brakeDecelMs2: number, reverseTopSpeedMs: number, reverseAccelMs2: number,
 *   reverseCrossoverMs: number, handbrakeDecelMs2: number, dragK: number,
 *   rollingResistMs2: number }} engine
 *   Longitudinal dynamics (m/s, m/s^2, 1/m).
 * @property {{ maxSteerAngleRad: number, gripAccelMs2: number,
 *   minRefSpeedMs: number, responseRate: number }} steering
 *   Speed-sensitive steering limits (rad, m/s^2, m/s, 1/s).
 * @property {{ lateralGripRate: number, handbrakeGripRate: number }} grip
 *   Lateral velocity damping rates (1/s).
 * @property {{ scrubFraction: number, bumpTimeS: number, bumpPitchRad: number,
 *   pitchDecayRate: number, minSpeedMs: number, cooldownS: number }} curb
 *   Curb step crossing feedback (dimensionless, s, rad, 1/s, m/s, s).
 * @property {{ maxMovePerSubstepM: number, maxSubsteps: number,
 *   restitution: number, maxReboundMs: number, maxImpactDeltaVMs: number,
 *   impactMinSpeedMs: number, impactMinIntervalS: number }} collision
 *   Substepped capsule-vs-AABB response (m, count, dimensionless, m/s, m/s,
 *   m/s, s).
 *
 * @type {CarConfig}
 */
export const DEFAULT_CAR_CONFIG = Object.freeze({
  /**
   * Body geometry: the car is a two-circle capsule in the x/z plane — one
   * circle centered `circleOffsetM` forward of the body origin along the
   * heading, one the same distance behind, both with `circleRadiusM`.
   */
  body: Object.freeze({
    /** Total body length in m (must equal 2 * circleOffsetM + 2 * circleRadiusM). */
    lengthM: 4.4,
    /** Total body width in m (must equal 2 * circleRadiusM). */
    widthM: 1.9,
    /** Radius of each body circle in m; also the minimum clearance kept to walls. */
    circleRadiusM: 0.95,
    /** Offset of each circle center from the body origin along forward, in m. */
    circleOffsetM: 1.25,
    /** Wheelbase in m — the bicycle-model axle distance used for yaw rate. */
    wheelbaseM: 2.5,
    /** Wheel radius in m — maps forward speed to wheel spin rate (state.wheelSpinRate = speed / wheelRadiusM, rad/s). */
    wheelRadiusM: 0.34,
  }),

  /**
   * Longitudinal dynamics. Top speed is set by an arcade governor: engine
   * force tapers to zero at `taperSpeedMs` (slightly above the limit) and
   * the integrated forward speed is clamped to `topSpeedMs`, so the car
   * reaches exactly the governed top speed and holds it.
   */
  engine: Object.freeze({
    /** Governor top speed in m/s (55.56 m/s = 200 km/h; spec range 180-220 km/h). */
    topSpeedMs: 55.56,
    /** Speed in m/s at which engine force tapers to zero (above the governor so the governor sets the true limit). */
    taperSpeedMs: 62,
    /** Engine acceleration at zero speed in m/s^2, scaled by (1 - v / taperSpeedMs) and throttle. */
    accelMs2: 24,
    /** Brake deceleration in m/s^2 at full brake while moving forward. */
    brakeDecelMs2: 30,
    /** Reverse speed limit in m/s (governor floor; -10 m/s = -36 km/h). */
    reverseTopSpeedMs: 10,
    /** Reverse acceleration in m/s^2 when the brake input acts as reverse throttle. */
    reverseAccelMs2: 8,
    /** Forward speed threshold in m/s below which the brake input becomes reverse throttle. */
    reverseCrossoverMs: 0.35,
    /** Extra longitudinal deceleration in m/s^2 while the handbrake is held. */
    handbrakeDecelMs2: 5,
    /** Quadratic air-drag coefficient in 1/m (deceleration = dragK * v^2 in m/s^2). */
    dragK: 0.0004,
    /** Rolling resistance in m/s^2 (constant deceleration opposing motion, never reversing it). */
    rollingResistMs2: 0.2,
  }),

  /**
   * Speed-sensitive steering: the driver input (-1..1) maps to a front
   * wheel angle capped by both the low-speed lock angle and the cornering
   * grip budget (delta_max(v) = atan(gripAccel * wheelbase / v^2)), so
   * lateral acceleration never exceeds gripAccelMs2 at any speed.
   */
  steering: Object.freeze({
    /** Maximum front wheel angle at standstill in rad (~35.5 degrees). */
    maxSteerAngleRad: 0.62,
    /** Cornering grip budget in m/s^2 — caps lateral acceleration, hence the steer angle at speed. */
    gripAccelMs2: 12.5,
    /** Reference speed floor in m/s used in the steering-cap formula (keeps the cap finite at crawl). */
    minRefSpeedMs: 2,
    /** Steering angle smoothing rate in 1/s (exponential approach to the target angle). */
    responseRate: 9,
  }),

  /**
   * Lateral grip: the component of velocity perpendicular to the heading
   * decays exponentially at `lateralGripRate` (grippy) or
   * `handbrakeGripRate` (rear traction cut -> sustained slide).
   */
  grip: Object.freeze({
    /** Normal lateral velocity damping rate in 1/s (higher = tighter cornering lines). */
    lateralGripRate: 10,
    /** Lateral damping rate in 1/s while the handbrake is held (low = slide). */
    handbrakeGripRate: 1.6,
  }),

  /**
   * Curb step (road 0 m <-> block surface 0.15 m): never blocks; crossing
   * it scrubs a little speed and kicks a visual pitch pulse for the body.
   */
  curb: Object.freeze({
    /** Fraction of speed removed by one curb crossing (0.06 = 6% scrub, dimensionless). */
    scrubFraction: 0.06,
    /** Duration of the bump visual state in s after a crossing (state.bumpTimer). */
    bumpTimeS: 0.28,
    /** Initial visual pitch in rad at the moment of a crossing (state.visualPitch; + = nose up hopping onto a curb). */
    bumpPitchRad: 0.06,
    /** Visual pitch decay rate in 1/s (exponential return to level). */
    pitchDecayRate: 7,
    /** Minimum |speed| in m/s for a crossing to count as a bump (prevents events while parked on the line). */
    minSpeedMs: 1,
    /** Minimum time in s between bump events (stops flicker while grazing the curb line). */
    cooldownS: 0.3,
  }),

  /**
   * Capsule-vs-AABB collision response: the tick's displacement is split
   * into substeps of at most `maxMovePerSubstepM` (< circle radius, so a
   * 55 m/s tick can never tunnel), each resolved with impulse-style
   * pushout + normal-velocity kill and a small capped rebound.
   */
  collision: Object.freeze({
    /** Maximum body translation per collision substep in m (must stay < circleRadiusM to prevent tunneling). */
    maxMovePerSubstepM: 0.45,
    /** Hard cap on collision substeps per tick (55 m/s needs 3 at 60 Hz). */
    maxSubsteps: 8,
    /** Coefficient of restitution for the normal response (dimensionless, 0 = dead stop, 0.25 = small bounce). */
    restitution: 0.25,
    /** Rebound speed cap in m/s — hard hits stop the car instead of bouncing it back at full speed. */
    maxReboundMs: 2.5,
    /** Cap on a single impact's velocity change in m/s (safety net for pathological multi-box corner hits). */
    maxImpactDeltaVMs: 60,
    /** Minimum impact speed in m/s that fires the onImpact callback (below that the contact is a rub, not a hit). */
    impactMinSpeedMs: 5,
    /** Minimum time in s between onImpact firings (~4/s rate limit). */
    impactMinIntervalS: 0.25,
  }),
});
