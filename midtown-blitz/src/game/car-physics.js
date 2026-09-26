/**
 * Arcade car physics (Midtown Blitz, task 3.1).
 *
 * Custom kinematic bicycle-style model in the horizontal plane (design
 * Decision 4 — no physics engine):
 *
 *  - The car state is a position (x, z), a heading yaw, and a WORLD-SPACE
 *    velocity vector (vx, vz). Forward/lateral components are derived each
 *    tick by projecting the velocity onto the heading frame.
 *  - Steering: the -1..1 input maps to a front wheel angle capped by both
 *    the low-speed lock angle and the cornering grip budget
 *    (`deltaMax(v) = atan(gripAccel * wheelbase / v^2)`), so lateral
 *    acceleration stays bounded at every speed. Yaw integrates the bicycle
 *    relation `heading += (vForward / wheelbase) * tan(steerAngle) * dt`.
 *  - Lateral grip: the velocity component perpendicular to the heading
 *    decays exponentially (rate from {@link CarConfig.grip}); the handbrake
 *    swaps in a much lower rate, so the heading still follows the steering
 *    while the velocity slides — an arcade handbrake slide.
 *  - Engine/brake: throttle accelerates forward with a speed taper plus an
 *    arcade governor clamping to the top speed; brake decelerates, and acts
 *    as reverse throttle below a small forward speed (limited reverse).
 *    Drag + rolling resistance coast the car down; the handbrake adds a
 *    longitudinal scrub.
 *  - Curbs: the surface under the body is sampled each tick (0 m road,
 *    CURB_M block surface). Crossing the step never blocks — it scrubs a
 *    small fraction of speed and kicks the visual bump/pitch state.
 *  - Collision: the body is a two-circle capsule (see CarConfig.body)
 *    resolved against the AABB collision world. The tick's displacement is
 *    split into substeps of at most `maxMovePerSubstepM` (< circle radius),
 *    so a top-speed tick cannot tunnel. Each substep moves the body, then
 *    pushes penetrating circles out along the box normal and reflects the
 *    normal velocity (restitution with a rebound cap): head-on hits stop
 *    the car at the wall, glancing hits keep the tangential component and
 *    deflect. Impacts above a speed threshold fire an `onImpact` callback
 *    (the sound/camera-shake hook for tasks 3.2/6.1), rate-limited.
 *
 * Convention (matches src/engine/camera-rig.js, whose target's local +Z is
 * forward): `forward = (sin(heading), cos(heading))` — heading 0 faces +Z,
 * positive steer/heading turns toward +X. A car mesh uses
 * `mesh.rotation.y = state.heading` directly.
 *
 * Purity: plain math + the collision-world query API only — no three.js,
 * no DOM, no randomness. Identical tick sequences give float-identical
 * states (verified by scripts/car-physics-test.mjs).
 *
 * Query contract note: the world's `circleHits` returns a shared scratch
 * array, so every hit list is consumed immediately inside the resolution
 * pass. `onImpact` callbacks are queued and fired after the movement
 * substeps finish, so a callback may safely run world queries.
 */

import { DEFAULT_CAR_CONFIG } from './config.js';

/**
 * Per-tick control inputs (all optional, clamped to range).
 *
 * @typedef {object} CarControls
 * @property {number} [throttle=0] Accelerator pedal in [0, 1].
 * @property {number} [brake=0] Brake pedal in [0, 1]; acts as reverse
 *   throttle when the forward speed is below the crossover.
 * @property {number} [steer=0] Steering input in [-1, 1] (positive turns
 *   from +Z toward +X, i.e. right when facing +Z... conventionally just
 *   "increasing heading").
 * @property {boolean} [handbrake=false] Handbrake held: cuts lateral grip
 *   (slide) and adds a longitudinal scrub.
 */

/**
 * Diagnostic payload passed to the {@link CarPhysicsOnImpact} callback.
 *
 * @typedef {object} CarImpactEvent
 * @property {number} speed Impact speed along the contact normal (m/s,
 *   always >= the configured threshold).
 * @property {number} normalX X component of the push-out normal (unit
 *   vector, points away from the wall).
 * @property {number} normalZ Z component of the push-out normal.
 */

/**
 * @callback CarPhysicsOnImpact
 * @param {CarImpactEvent} impact Impact info (hard-impact hook for sound /
 *   camera shake). Must not mutate the car state; may query the world.
 * @returns {void}
 */

/**
 * Live simulation state — plain numbers, read by the renderer/HUD (task
 * 3.2) and by test harnesses. Mutated by {@link CarPhysics.step}; treat as
 * read-only from outside.
 *
 * @typedef {object} CarState
 * @property {number} x Body origin x (m).
 * @property {number} z Body origin z (m).
 * @property {number} heading Yaw in rad; forward = (sin, cos) (see module
 *   header). Use directly as `mesh.rotation.y`.
 * @property {number} vx World velocity x (m/s).
 * @property {number} vz World velocity z (m/s).
 * @property {number} headingPrev Heading at the start of the last tick
 *   (rad) — lets the renderer interpolate between ticks.
 * @property {number} speed Planar speed |v| (m/s).
 * @property {number} forwardSpeed Signed velocity component along forward
 *   (m/s; negative when reversing).
 * @property {number} lateralSpeed Signed velocity component along the
   heading's right vector (m/s) — the slide amount.
 * @property {number} slipAngle atan2(lateral, |forward|) in rad (0 when
 *   slow) — skid-audio/camera cue.
 * @property {number} steerAngle Current front wheel angle in rad (visual
 *   steer for the front wheels).
 * @property {number} surfaceY Ground elevation under the body (m; 0 road,
 *   0.15 block surface) — where the wheels sit.
 * @property {number} bumpTimer Remaining curb-bump visual time (s; 0 when
 *   idle).
 * @property {number} bumpCount Total curb crossings since reset.
 * @property {number} visualPitch Visual body pitch in rad from curb bumps
 *   (+ = nose up); decays to 0. Cosmetic only.
 * @property {number} wheelSpin Accumulated wheel rotation in rad (mod for
 *   rendering).
 * @property {number} wheelSpinRate Wheel angular speed in rad/s (= forward
 *   speed / wheel radius).
 * @property {number} time Simulation clock in s (sum of step() dt).
 * @property {number} lastSubsteps Collision substeps used by the last tick.
 * @property {number} lastTickMaxPenetration Deepest body-circle overlap
 *   with any AABB left AFTER resolution during the last tick (m; ~0 — the
 *   harness asserts <= 0.01 to prove no tunneling/sticking).
 */

/**
 * Handle for a created car physics instance.
 *
 * @typedef {object} CarPhysics
 * @property {CarState} state Live simulation state (mutated by step()).
 * @property {CarConfig} config The effective (section-merged) config.
 * @property {(dt: number, controls?: CarControls) => void} step Advance the
 *   simulation by one fixed tick (dt = SIM_DT from the engine loop).
 * @property {(opts?: CarPhysicsResetOpts) => void} reset Respawn the car
 *   (spawn/debug helper; also used by the harness to stage maneuvers).
 * @property {(impact: CarImpactEvent) => void} notifyImpact Public impact
 *   trigger (task 4.3): fires the `onImpact` hook exactly as an internal
 *   wall impact would — same speed threshold and rate limit — so car-car
 *   collisions can drive the sound/camera-shake hook. Call AFTER the
 *   tick's resolution is done (the callback may run world queries).
 */

/**
 * @typedef {object} CarPhysicsResetOpts
 * @property {number} [x] New body origin x (m; default: keep current).
 * @property {number} [z] New body origin z (m; default: keep current).
 * @property {number} [heading] New yaw in rad (default: keep current).
 * @property {number} [vx] New world velocity x in m/s (default 0).
 * @property {number} [vz] New world velocity z in m/s (default 0).
 */

/**
 * @param {number} v Value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} Clamped value.
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Build the effective config: each top-level section of the user config
 * replaces the matching default section (validated to be complete).
 *
 * @param {Partial<CarConfig> | undefined} override Caller overrides.
 * @returns {CarConfig} Frozen effective config.
 */
function mergeConfig(override) {
  if (override === undefined) return DEFAULT_CAR_CONFIG;
  const merged = { ...DEFAULT_CAR_CONFIG };
  for (const key of Object.keys(DEFAULT_CAR_CONFIG)) {
    if (override[key] !== undefined) {
      merged[key] = { ...DEFAULT_CAR_CONFIG[key], ...override[key] };
    }
  }
  return Object.freeze(merged);
}

/**
 * Create the arcade car physics for the given static collision world.
 *
 * @param {import('./collision.js').CollisionWorld} world Collision world
 *   built from the generated city (queries: circleHits, surfaceHeightAt).
 * @param {Partial<CarConfig>} [cfg] Config overrides (sections are shallow-
 *   merged over {@link DEFAULT_CAR_CONFIG}; omit for stock tuning).
 * @param {object} [opts] Options.
 * @param {CarPhysicsOnImpact} [opts.onImpact] Hard-impact hook: fired at
 *   most ~4/s when an impact exceeds the configured speed threshold —
 *   tasks 3.2/6.1 wire camera shake and the impact sound here.
 * @returns {CarPhysics} The car physics handle.
 * @throws {TypeError} If world lacks the required queries.
 */
export function createCarPhysics(world, cfg, opts = {}) {
  if (!world || typeof world.circleHits !== 'function' || typeof world.surfaceHeightAt !== 'function') {
    throw new TypeError('createCarPhysics: world must be a CollisionWorld (circleHits + surfaceHeightAt)');
  }
  const onImpact = typeof opts.onImpact === 'function' ? opts.onImpact : null;
  const C = mergeConfig(cfg);
  const body = C.body;
  const eng = C.engine;
  const steer = C.steering;
  const grip = C.grip;
  const curb = C.curb;
  const col = C.collision;
  const radiusSq = body.circleRadiusM * body.circleRadiusM;

  /** @type {CarState} */
  const state = {
    x: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    headingPrev: 0,
    speed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipAngle: 0,
    steerAngle: 0,
    surfaceY: 0,
    bumpTimer: 0,
    bumpCount: 0,
    visualPitch: 0,
    wheelSpin: 0,
    wheelSpinRate: 0,
    time: 0,
    lastSubsteps: 0,
    lastTickMaxPenetration: 0,
  };

  let lastImpactTime = -Infinity;
  let lastBumpTime = -Infinity;
  /** Impact events queued during resolution, fired after the tick moves. */
  const pendingImpacts = [];

  /**
   * Speed-sensitive steering cap: min(low-speed lock, grip-budget angle).
   *
   * @param {number} speedAbs Planar speed in m/s.
   * @returns {number} Maximum front wheel angle in rad.
   */
  function maxSteerAtSpeed(speedAbs) {
    const v = Math.max(speedAbs, steer.minRefSpeedMs);
    const byGrip = Math.atan((steer.gripAccelMs2 * body.wheelbaseM) / (v * v));
    return Math.min(steer.maxSteerAngleRad, byGrip);
  }

  /**
   * Push the two body circles out of every AABB they touch at the given
   * interpolated heading, reflecting normal velocity (impulse-style).
   * Returns the deepest post-resolution residual penetration (m) and
   * whether any box was touched.
   *
   * @param {number} hI Interpolated heading in rad for circle placement.
   * @param {{ resid: number }} stats Stats accumulator for this tick.
   * @returns {boolean} True when any circle touched any box.
   */
  function resolveCircles(hI, stats) {
    const sinH = Math.sin(hI);
    const cosH = Math.cos(hI);
    let touched = false;

    for (let pass = 0; pass < 2; pass += 1) {
      let anyThisPass = false;
      for (let s = 1; s >= -1; s -= 2) {
        let cx = state.x + sinH * body.circleOffsetM * s;
        let cz = state.z + cosH * body.circleOffsetM * s;
        const hits = world.circleHits(cx, cz, body.circleRadiusM);
        if (hits === null) continue;
        // Shared scratch array: consume immediately (never store it).
        for (let k = 0; k < hits.length; k += 1) {
          const b = world.aabbs[hits[k]];
          // Closest point on the box to the circle center.
          const px = clamp(cx, b.minX, b.maxX);
          const pz = clamp(cz, b.minZ, b.maxZ);
          const dx = cx - px;
          const dz = cz - pz;
          const dSq = dx * dx + dz * dz;
          let nx;
          let nz;
          let pen;
          if (dSq > 1e-12) {
            if (dSq >= radiusSq) continue; // touched the query radius, not the circle
            const d = Math.sqrt(dSq);
            nx = dx / d;
            nz = dz / d;
            pen = body.circleRadiusM - d;
          } else {
            // Center inside the box: eject along the shallowest face.
            const left = cx - b.minX;
            const right = b.maxX - cx;
            const bottom = cz - b.minZ;
            const top = b.maxZ - cz;
            const m = Math.min(left, right, bottom, top);
            if (m === left) { nx = -1; nz = 0; pen = left + body.circleRadiusM; } else if (m === right) { nx = 1; nz = 0; pen = right + body.circleRadiusM; } else if (m === bottom) { nx = 0; nz = -1; pen = bottom + body.circleRadiusM; } else { nx = 0; nz = 1; pen = top + body.circleRadiusM; }
          }
          // Positional pushout (moves the whole body).
          state.x += nx * pen;
          state.z += nz * pen;
          cx += nx * pen;
          cz += nz * pen;
          // Impulse response: kill (and slightly reflect) inward normal velocity.
          const vn = state.vx * nx + state.vz * nz;
          if (vn < 0) {
            const impactSpeed = -vn;
            const rebound = Math.min(col.restitution * impactSpeed, col.maxReboundMs);
            let dv = impactSpeed + rebound;
            if (dv > col.maxImpactDeltaVMs) dv = col.maxImpactDeltaVMs;
            state.vx += nx * dv;
            state.vz += nz * dv;
            if (impactSpeed >= col.impactMinSpeedMs && state.time - lastImpactTime >= col.impactMinIntervalS) {
              lastImpactTime = state.time;
              pendingImpacts.push({ speed: impactSpeed, normalX: nx, normalZ: nz });
            }
          }
          anyThisPass = true;
          touched = true;
        }
      }
      if (!anyThisPass) break; // pass 1 found nothing; skip the settle pass
    }

    // Residual penetration AFTER resolution (the no-tunneling metric).
    for (let s = 1; s >= -1; s -= 2) {
      const cx = state.x + sinH * body.circleOffsetM * s;
      const cz = state.z + cosH * body.circleOffsetM * s;
      const hits = world.circleHits(cx, cz, body.circleRadiusM);
      if (hits === null) continue;
      for (let k = 0; k < hits.length; k += 1) {
        const b = world.aabbs[hits[k]];
        const px = clamp(cx, b.minX, b.maxX);
        const pz = clamp(cz, b.minZ, b.maxZ);
        const dSq = (cx - px) * (cx - px) + (cz - pz) * (cz - pz);
        if (dSq < radiusSq) {
          const pen = body.circleRadiusM - Math.sqrt(dSq);
          if (pen > stats.resid) stats.resid = pen;
        }
      }
    }
    return touched;
  }

  /**
   * Advance the simulation one fixed tick (see module header for the
   * model). Pure function of (state, dt, controls) — deterministic.
   *
   * @param {number} dt Fixed tick length in s (SIM_DT = 1/60).
   * @param {CarControls} [controls] Per-tick inputs (default: coasting).
   * @returns {void}
   * @throws {TypeError} If dt is not a positive finite number.
   */
  function step(dt, controls) {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new TypeError(`carPhysics.step: dt must be a positive finite number (got ${dt})`);
    }
    const c = {
      throttle: clamp(controls?.throttle ?? 0, 0, 1),
      brake: clamp(controls?.brake ?? 0, 0, 1),
      steer: clamp(controls?.steer ?? 0, -1, 1),
      handbrake: !!(controls?.handbrake),
    };
    state.time += dt;

    // --- heading-frame decomposition (basis from the tick's start heading)
    const sinH = Math.sin(state.heading);
    const cosH = Math.cos(state.heading);
    let fwd = state.vx * sinH + state.vz * cosH;
    let lat = state.vx * cosH - state.vz * sinH;
    const speedAbs = Math.sqrt(state.vx * state.vx + state.vz * state.vz);

    // --- steering: smoothed input -> angle, capped by speed-sensitive grip
    const steerTarget = c.steer * maxSteerAtSpeed(speedAbs);
    const kSteer = 1 - Math.exp(-steer.responseRate * dt);
    state.steerAngle += (steerTarget - state.steerAngle) * kSteer;

    // --- yaw (kinematic bicycle); signed fwd makes reverse steering mirror
    state.headingPrev = state.heading;
    state.heading += (fwd / body.wheelbaseM) * Math.tan(state.steerAngle) * dt;

    // --- longitudinal forces
    if (c.throttle > 0 && fwd < eng.topSpeedMs) {
      fwd += eng.accelMs2 * c.throttle * Math.max(0, 1 - fwd / eng.taperSpeedMs) * dt;
    }
    if (c.brake > 0) {
      if (fwd > eng.reverseCrossoverMs) {
        fwd = Math.max(0, fwd - eng.brakeDecelMs2 * c.brake * dt);
      } else {
        fwd = Math.max(-eng.reverseTopSpeedMs, fwd - eng.reverseAccelMs2 * c.brake * dt);
      }
    }
    if (c.handbrake) {
      fwd = fwd > 0
        ? Math.max(0, fwd - eng.handbrakeDecelMs2 * dt)
        : Math.min(0, fwd + eng.handbrakeDecelMs2 * dt);
    }
    fwd -= eng.dragK * fwd * Math.abs(fwd) * dt;
    const rollDv = eng.rollingResistMs2 * dt;
    if (Math.abs(fwd) <= rollDv) {
      fwd = 0;
    } else {
      fwd -= Math.sign(fwd) * rollDv;
    }
    // Arcade governor: exact top/reverse speed limits.
    fwd = clamp(fwd, -eng.reverseTopSpeedMs, eng.topSpeedMs);

    // --- lateral grip (handbrake cuts it -> slide)
    const gripRate = c.handbrake ? grip.handbrakeGripRate : grip.lateralGripRate;
    lat *= Math.exp(-gripRate * dt);

    // --- recompose into world velocity
    state.vx = fwd * sinH + lat * cosH;
    state.vz = fwd * cosH - lat * sinH;

    // --- substepped movement + collision (see module header)
    const planarSpeed = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
    const substeps = Math.min(
      col.maxSubsteps,
      Math.max(1, Math.ceil((planarSpeed * dt) / col.maxMovePerSubstepM))
    );
    const sdt = dt / substeps;
    const h0 = state.headingPrev;
    const h1 = state.heading;
    const stats = { resid: 0 };
    for (let i = 1; i <= substeps; i += 1) {
      state.x += state.vx * sdt;
      state.z += state.vz * sdt;
      resolveCircles(h0 + (h1 - h0) * (i / substeps), stats);
    }
    state.lastSubsteps = substeps;
    state.lastTickMaxPenetration = stats.resid;

    // --- queued impact callbacks (world-safe: resolution is done)
    for (let i = 0; i < pendingImpacts.length; i += 1) {
      onImpact(pendingImpacts[i]);
    }
    pendingImpacts.length = 0;

    // --- curb step: sample the surface, scrub + bump on crossing (never blocks)
    const surface = world.surfaceHeightAt(state.x, state.z);
    if (surface !== state.surfaceY) {
      const fwdNow = state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading);
      if (state.time - lastBumpTime >= curb.cooldownS && Math.abs(fwdNow) >= curb.minSpeedMs) {
        const hopUp = surface > state.surfaceY ? 1 : -1;
        const scrub = 1 - curb.scrubFraction;
        state.vx *= scrub;
        state.vz *= scrub;
        state.bumpTimer = curb.bumpTimeS;
        state.bumpCount += 1;
        state.visualPitch = curb.bumpPitchRad * hopUp * (fwdNow >= 0 ? 1 : -1);
        lastBumpTime = state.time;
      }
      state.surfaceY = surface;
    }
    if (state.bumpTimer > 0) state.bumpTimer = Math.max(0, state.bumpTimer - dt);
    state.visualPitch *= Math.exp(-curb.pitchDecayRate * dt);

    // --- derived visuals/telemetry
    const sinH1 = Math.sin(state.heading);
    const cosH1 = Math.cos(state.heading);
    const fwdFinal = state.vx * sinH1 + state.vz * cosH1;
    const latFinal = state.vx * cosH1 - state.vz * sinH1;
    state.wheelSpinRate = fwdFinal / body.wheelRadiusM;
    state.wheelSpin += state.wheelSpinRate * dt;
    state.speed = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
    state.forwardSpeed = fwdFinal;
    state.lateralSpeed = latFinal;
    state.slipAngle = state.speed > 0.5 ? Math.atan2(latFinal, Math.abs(fwdFinal)) : 0;
  }

  /**
   * Public impact trigger (task 4.3): fire the `onImpact` hook from outside
   * the tick — the car-car collision resolver (src/game/car-collisions.js)
   * calls it when the player rammed another car. Shares the wall-impact
   * rate limit and speed threshold (below `impactMinSpeedMs` a contact is
   * a rub, not a hit, and is silently dropped), so callers can notify every
   * tick of a sustained push without flooding the sound/camera hooks.
   * Call only after resolution is finished (the callback may run queries).
   *
   * @param {CarImpactEvent} impact Impact info; the normal points away
   *   from the other car (the player's push-out direction).
   * @returns {void}
   * @throws {TypeError} If the impact payload is missing or not finite.
   */
  function notifyImpact(impact) {
    if (!impact || typeof impact !== 'object') {
      throw new TypeError('notifyImpact: needs a {speed, normalX, normalZ} impact event');
    }
    const speed = Number(impact.speed);
    const nx = Number(impact.normalX);
    const nz = Number(impact.normalZ);
    if (!Number.isFinite(speed) || !Number.isFinite(nx) || !Number.isFinite(nz)) {
      throw new TypeError(`notifyImpact: speed/normalX/normalZ must be finite (got ${speed}, ${nx}, ${nz})`);
    }
    if (!onImpact || speed < col.impactMinSpeedMs) return;
    if (state.time - lastImpactTime < col.impactMinIntervalS) return;
    lastImpactTime = state.time;
    onImpact({ speed, normalX: nx, normalZ: nz });
  }

  /**
   * Respawn/teleport the car (harness staging, debug resets). Everything
   * unspecified is kept (velocity defaults to zero); bump/impact timers
   * and derived state re-initialize cleanly.
   *
   * @param {CarPhysicsResetOpts} [opts] See {@link CarPhysicsResetOpts}.
   * @returns {void}
   */
  function reset(opts = {}) {
    if (opts.x !== undefined) state.x = Number(opts.x);
    if (opts.z !== undefined) state.z = Number(opts.z);
    if (opts.heading !== undefined) state.heading = Number(opts.heading);
    state.vx = opts.vx !== undefined ? Number(opts.vx) : 0;
    state.vz = opts.vz !== undefined ? Number(opts.vz) : 0;
    state.headingPrev = state.heading;
    state.steerAngle = 0;
    state.surfaceY = world.surfaceHeightAt(state.x, state.z);
    state.bumpTimer = 0;
    state.bumpCount = 0;
    state.visualPitch = 0;
    state.wheelSpin = 0;
    state.wheelSpinRate = 0;
    state.speed = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
    state.forwardSpeed = state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading);
    state.lateralSpeed = state.vx * Math.cos(state.heading) - state.vz * Math.sin(state.heading);
    state.slipAngle = 0;
    state.time = 0;
    state.lastSubsteps = 0;
    state.lastTickMaxPenetration = 0;
    lastImpactTime = -Infinity;
    lastBumpTime = -Infinity;
    pendingImpacts.length = 0;
  }

  return { state, config: C, step, reset, notifyImpact };
}
