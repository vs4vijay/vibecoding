/**
 * Car-vs-car collisions (Midtown Blitz, task 4.3).
 *
 * The physical layer between the player car (src/game/car-physics.js) and
 * the kinematic traffic pool (src/game/traffic.js), run once per fixed tick
 * AFTER both steps (design Decision 4: "car-vs-car uses circle-circle
 * separation with momentum exchange"; traffic spec: an impact "affects
 * both — deflecting, spinning, or slowing them ... and neither passes
 * through the other", and "queueing traffic piles up rather than
 * overlapping").
 *
 * Bodies: both archetypes are two-circle capsules (DEFAULT_CAR_CONFIG.body:
 * circles r 0.95 at ±1.25 along the heading — traffic-view renders the same
 * silhouette). A contact is the DEEPER of two exact tests: the deepest of
 * the four circle-circle pairs (authoritative for head-on, rear-end and
 * other near-axis hits, where the circle pair carries the whole overlap)
 * and the closest-points test between the two body axes (Ericson, Real-Time
 * Collision Detection 5.1.9), which covers the hull BETWEEN the circles —
 * a nose poked into another car's waist or a shallow side-swipe gets the
 * true minimal-translation vector instead of slipping through between the
 * circle pairs.
 *
 * Response, per overlapping pair:
 *  - Separation: the PLAYER is the dynamic authority and takes the full
 *    minimal-translation-vector push (optionally verified against the
 *    static world: if the push would wedge the player INTO a wall/parked
 *    car, the positional push is skipped and the traffic car takes the
 *    whole MTV instead); the traffic car also takes an extra half-MTV in
 *    its decaying offsets, so a hit pair ends the tick separated with a
 *    small gap instead of resting tangent (re-contact damping). Traffic
 *    cars are path-kinematic — their positional share goes into the
 *    decaying `offX/offZ` offsets that traffic.update() integrates and
 *    swings back to the lane line (see traffic.js step 5.5).
 *  - Momentum exchange: equal masses along the contact normal — the normal
 *    closing velocity `vn` produces a per-side impulse
 *    `dv = (1 + restitution) * |vn| / 2` (restitution 0.2, hard-capped):
 *    the player's velocity is reflected along the normal (T-bone at speed
 *    → deflected + slowed), and the traffic car receives the opposite
 *    impulse in its kick velocity fields (decaying m/s, clamped).
 *  - Spin: the impulse acts at the contact point, so the torque about each
 *    center (r × J, +Y convention matching the heading) drives the
 *    traffic car's `yawRate` (decaying, clamped — an off-center T-bone
 *    spins it) and a small direct yaw kick on the player (the player model
 *    has no yaw-rate state, so the arcade approximation applies a clamped
 *    instantaneous heading change; the renderer interpolates it via
 *    headingPrev). Center hits produce (near-)zero torque by construction.
 *  - Impact event: the player's rate-limited `notifyImpact` hook fires so
 *    the task 3.2 camera shake / task 6.1 impact audio react to car-car
 *    hits exactly as to wall hits.
 *
 * Order per call: traffic-vs-traffic pairs first (queue integrity, both
 * cars share the MTV and a fraction of the closing velocity as kicks — no
 * spin), then player-vs-traffic, so the tick ENDS with the player
 * non-overlapping. Nothing here reads the clock or draws randomness —
 * identical inputs give float-identical outputs (verified by
 * scripts/car-collisions-test.mjs).
 *
 * Cost: O(cars^2) early-outed distance checks (276 pair tests for 24 cars)
 * plus the 25 player pairs — well under the frame budget (measured).
 *
 * Purity: plain math + the collision world only (when passed) — no three.js,
 * no DOM, node-testable.
 */

import { DEFAULT_CAR_CONFIG } from './config.js';

/**
 * Tunables for the car-car response (dimensionless, m/s, rad, rad/s).
 * Traffic-side clamps mirror TRAFFIC_TUNING's kick limits (traffic.js
 * re-clamps defensively during integration).
 */
export const CAR_COLLISION_TUNING = Object.freeze({
  /** Coefficient of restitution along the contact normal (0 = dead stop). */
  RESTITUTION: 0.2,
  /** Hard cap on a single pair's per-side impulse in m/s. */
  MAX_IMPULSE_MS: 12,
  /** Cap on a traffic car's kick velocity magnitude in m/s. */
  TRAFFIC_KICK_MAX_MS: 8,
  /** Cap on a traffic car's yaw rate in rad/s. */
  TRAFFIC_YAW_RATE_MAX_RPS: 3,
  /** Torque-to-yaw-rate scale for traffic spin (1/(m·s) dimension, tuned). */
  TRAFFIC_SPIN_SCALE: 0.35,
  /** Torque-to-heading scale for the player's direct yaw kick (tuned). */
  PLAYER_SPIN_SCALE: 0.12,
  /** Clamp on one impact's instantaneous player heading change in rad. */
  PLAYER_YAW_KICK_MAX_RAD: 0.25,
  /** Boxed body inertia about +Y in kg·m²-ish: (L² + W²) / 12 for the
   *  4.4 x 1.9 archetype (relative quantity — mass cancels). */
  BODY_INERTIA: (4.4 * 4.4 + 1.9 * 1.9) / 12,
  /** Center-distance beyond which two cars cannot overlap in m
   *  (2 x capsule half-length 2.2, plus slack). */
  PAIR_EARLY_OUT_M: 4.5,
  /** Traffic-vs-traffic separation sweeps per tick (settles deep overlaps
   *  in one tick without costing anything when nothing overlaps). */
  SEPARATION_PASSES: 2,
  /** Cap on the traffic positional share in m (mirrors OFFSET_MAX_M). */
  TRAFFIC_OFFSET_MAX_M: 3,
});

/**
 * Resolve all car-car contacts for this tick (module header for the model).
 * Mutates the player's state (position/velocity/heading) and the traffic
 * cars' decaying kick fields; fires the player's impact hook. Call ONCE per
 * fixed tick, after `car.step(...)` and `traffic.update(...)` (main's
 * order). Deterministic and allocation-free.
 *
 * @param {import('./car-physics.js').CarPhysics} player The player physics
 *   handle (state mutated; `config.body` provides the shared capsule
 *   geometry; `notifyImpact` fires the impact hook).
 * @param {import('./traffic.js').Traffic} traffic The traffic pool (cars'
 *   kick fields mutated; poses/paths untouched).
 * @param {object} [opts] Options.
 * @param {import('./collision.js').CollisionWorld} [opts.world] Collision
 *   world — when given, the player's positional separation is suppressed
 *   if it would embed the player in a static solid (the traffic side then
 *   takes the whole MTV; traffic.update() has its own static guard).
 * @param {typeof CAR_COLLISION_TUNING} [opts.tuning] Tuning overrides.
 * @returns {void}
 * @throws {TypeError} If player/traffic are missing or shaped wrong.
 */
export function resolveCarCollisions(player, traffic, opts = {}) {
  if (!player || !player.state || typeof player.notifyImpact !== 'function') {
    throw new TypeError('resolveCarCollisions: needs a CarPhysics handle (state + notifyImpact)');
  }
  if (!traffic || !Array.isArray(traffic.cars)) {
    throw new TypeError('resolveCarCollisions: needs a Traffic pool with cars');
  }
  const T = opts.tuning ?? CAR_COLLISION_TUNING;
  const world = opts.world ?? null;
  const state = player.state;
  const body = (player.config ?? DEFAULT_CAR_CONFIG).body;
  const r = body.circleRadiusM;
  const off = body.circleOffsetM;
  const cars = traffic.cars;
  const earlySq = T.PAIR_EARLY_OUT_M * T.PAIR_EARLY_OUT_M;

  // --- 1. traffic-vs-traffic: shared MTV + kick exchange (no spin) --------
  for (let pass = 0; pass < T.SEPARATION_PASSES; pass += 1) {
    let any = false;
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        const dxc = a.x - b.x;
        const dzc = a.z - b.z;
        if (dxc * dxc + dzc * dzc > earlySq) continue;
        const c = bodyContact(
          a.x, a.z, Math.sin(a.heading + a.yawOffset), Math.cos(a.heading + a.yawOffset),
          b.x, b.z, Math.sin(b.heading + b.yawOffset), Math.cos(b.heading + b.yawOffset),
          r, off
        );
        if (!c.hit) continue;
        any = true;
        // Positional: half the MTV into each car's decaying offset — along
        // +n for `a` and -n for `b` (n points from B toward A), so the pair
        // ends the pass just touching (traffic.update() re-derives x/z from
        // the lane path each tick; the offsets are what persist, decaying
        // back to the lane line).
        addOffset(a, c.nx * c.pen * 0.5, c.nz * c.pen * 0.5, T.TRAFFIC_OFFSET_MAX_M);
        addOffset(b, -c.nx * c.pen * 0.5, -c.nz * c.pen * 0.5, T.TRAFFIC_OFFSET_MAX_M);
        // Momentum: equal-mass normal exchange between the effective
        // velocities (path speed along the tangent + current kick).
        const avx = a.tangentX * a.speed + a.kickVx;
        const avz = a.tangentZ * a.speed + a.kickVz;
        const bvx = b.tangentX * b.speed + b.kickVx;
        const bvz = b.tangentZ * b.speed + b.kickVz;
        const vn = (avx - bvx) * c.nx + (avz - bvz) * c.nz; // a relative to b along n (b -> a)
        if (vn < 0) {
          const dv = Math.min(-(1 + T.RESTITUTION) * 0.5 * vn, T.MAX_IMPULSE_MS);
          addKick(a, c.nx * dv, c.nz * dv, T.TRAFFIC_KICK_MAX_MS);
          addKick(b, -c.nx * dv, -c.nz * dv, T.TRAFFIC_KICK_MAX_MS);
        }
      }
    }
    if (!any) break;
  }

  // --- 2. player-vs-traffic: player authority, resolved last ---------------
  // sinP/cosP are derived PER CAR: a hit's yaw kick (below) changes
  // state.heading, and the next car's contact must use the fresh basis.
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i];
    const dxc = state.x - car.x;
    const dzc = state.z - car.z;
    if (dxc * dxc + dzc * dzc > earlySq) continue;
    const sinP = Math.sin(state.heading);
    const cosP = Math.cos(state.heading);
    // Snapshot the center BEFORE moving (torque arms + revert use it).
    const px = state.x;
    const pz = state.z;
    const c = bodyContact(
      px, pz, sinP, cosP,
      car.x, car.z, Math.sin(car.heading + car.yawOffset), Math.cos(car.heading + car.yawOffset),
      r, off
    );
    if (!c.hit) continue;

    // Positional: the player takes the full MTV — unless it would be
    // pressed into a static solid (wedged against a wall/parked car by the
    // shove); then the traffic offset takes the whole separation instead.
    let applied = true;
    if (world) {
      const nx1 = px + c.nx * c.pen + sinP * off;
      const nz1 = pz + c.nz * c.pen + cosP * off;
      const nx2 = px + c.nx * c.pen - sinP * off;
      const nz2 = pz + c.nz * c.pen - cosP * off;
      if (world.overlapsSolid(nx1, nz1, r) || world.overlapsSolid(nx2, nz2, r)) applied = false;
    }
    if (applied) {
      state.x = px + c.nx * c.pen;
      state.z = pz + c.nz * c.pen;
      addOffset(car, -c.nx * c.pen * 0.5, -c.nz * c.pen * 0.5, T.TRAFFIC_OFFSET_MAX_M);
    } else {
      addOffset(car, -c.nx * c.pen, -c.nz * c.pen, T.TRAFFIC_OFFSET_MAX_M);
    }

    // Momentum exchange along the contact normal (module header).
    const cvx = car.tangentX * car.speed + car.kickVx;
    const cvz = car.tangentZ * car.speed + car.kickVz;
    const vn = (state.vx - cvx) * c.nx + (state.vz - cvz) * c.nz;
    if (vn >= 0) continue; // separating (e.g. overlap left by a shove) — no impulse

    const impactSpeed = -vn;
    const dv = Math.min((1 + T.RESTITUTION) * 0.5 * impactSpeed, T.MAX_IMPULSE_MS);
    const jx = c.nx * dv;
    const jz = c.nz * dv;
    state.vx += jx;
    state.vz += jz;
    addKick(car, -jx, -jz, T.TRAFFIC_KICK_MAX_MS);

    // Spin: torque of the contact impulse about each body center, +Y
    // convention ((r x J)_y = rz*Jx - rx*Jz — matches heading = rotation.y).
    const torqueP = (c.cz - pz) * jx - (c.cx - px) * jz;
    state.heading += clampAbs(torqueP / T.BODY_INERTIA * T.PLAYER_SPIN_SCALE, T.PLAYER_YAW_KICK_MAX_RAD);
    const torqueT = (c.cz - car.z) * -jx - (c.cx - car.x) * -jz;
    car.yawRate = clampAbs(car.yawRate + torqueT / T.BODY_INERTIA * T.TRAFFIC_SPIN_SCALE, T.TRAFFIC_YAW_RATE_MAX_RPS);

    // Rate-limited impact hook (same channel as wall hits).
    player.notifyImpact({ speed: impactSpeed, normalX: c.nx, normalZ: c.nz });
  }
}

/**
 * Car-capsule contact between two 2-circle bodies (module header for the
 * model): the DEEPER of (a) the deepest of the four circle-circle pairs and
 * (b) the closest-points test between the two body axes. (a) is exact for
 * head-on / rear-end / near-axis hits; (b) additionally covers the hull
 * between the circles (a hit in the other car's "waist"), and its
 * degenerate collinear case (coincident closest points) is exactly where
 * (a) is authoritative. Uses a module-level scratch record — read the
 * fields before the next call (single-threaded per-tick use).
 *
 * @param {number} ax Body A center x (m).
 * @param {number} az Body A center z (m).
 * @param {number} aHx Body A forward unit x.
 * @param {number} aHz Body A forward unit z.
 * @param {number} bx Body B center x (m).
 * @param {number} bz Body B center z (m).
 * @param {number} bHx Body B forward unit x.
 * @param {number} bHz Body B forward unit z.
 * @param {number} r Body circle radius (m).
 * @param {number} off Circle offset from the body center along forward (m).
 * @returns {{ hit: boolean, nx: number, nz: number, pen: number, cx: number, cz: number }}
 *   hit: the capsules overlap; n: unit normal from B toward A; pen: overlap
 *   depth (m); c: contact point (circle-pair midpoint or midpoint of the
 *   closest axis points).
 */
const contact = { hit: false, nx: 0, nz: 0, pen: 0, cx: 0, cz: 0 };
function bodyContact(ax, az, aHx, aHz, bx, bz, bHx, bHz, r, off) {
  // --- (a) deepest circle-circle pair ---------------------------------------
  let bestPen = 0;
  let haveCircle = false;
  let cnx = 0;
  let cnz = 0;
  let ccx = 0;
  let ccz = 0;
  for (let sa = 1; sa >= -1; sa -= 2) {
    const axc = ax + aHx * off * sa;
    const azc = az + aHz * off * sa;
    for (let sb = 1; sb >= -1; sb -= 2) {
      const bxc = bx + bHx * off * sb;
      const bzc = bz + bHz * off * sb;
      const dx = axc - bxc;
      const dz = azc - bzc;
      const d = Math.sqrt(dx * dx + dz * dz);
      const pen = 2 * r - d;
      if (pen > bestPen) {
        bestPen = pen;
        if (pen > 0) {
          haveCircle = true;
          if (d > 1e-9) {
            cnx = dx / d;
            cnz = dz / d;
          } else {
            // Coincident circle centers: A's left normal is a stable choice.
            cnx = -aHz;
            cnz = aHx;
          }
          ccx = 0.5 * (axc + bxc);
          ccz = 0.5 * (azc + bzc);
        }
      }
    }
  }

  // --- (b) closest points between the two body axes -------------------------
  let segPen = 0;
  let haveSeg = false;
  let snx = 0;
  let snz = 0;
  let scx = 0;
  let scz = 0;
  {
    const p1x = ax - aHx * off;
    const p1z = az - aHz * off;
    const q1x = ax + aHx * off;
    const q1z = az + aHz * off;
    const p2x = bx - bHx * off;
    const p2z = bz - bHz * off;
    const q2x = bx + bHx * off;
    const q2z = bz + bHz * off;
    const d1x = q1x - p1x;
    const d1z = q1z - p1z;
    const d2x = q2x - p2x;
    const d2z = q2z - p2z;
    const rx = p1x - p2x;
    const rz = p1z - p2z;
    const a = d1x * d1x + d1z * d1z;
    const e = d2x * d2x + d2z * d2z;
    const f = d2x * rx + d2z * rz;
    const c = d1x * rx + d1z * rz;
    const b = d1x * d2x + d1z * d2z;
    const EPS = 1e-12;
    let s = 0;
    let t = 0;
    if (a <= EPS && e <= EPS) {
      s = 0; // both axes degenerate to points (cannot happen at off > 0)
    } else if (a <= EPS) {
      s = 0;
      t = Math.min(1, Math.max(0, f / e));
    } else if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
    const c1x = p1x + d1x * s;
    const c1z = p1z + d1z * s;
    const c2x = p2x + d2x * t;
    const c2z = p2z + d2z * t;
    const dx = c1x - c2x;
    const dz = c1z - c2z;
    const d = Math.sqrt(dx * dx + dz * dz);
    segPen = 2 * r - d;
    if (segPen > 0 && d > 1e-9) {
      // d ~ 0 means coincident closest points (collinear axes) — exactly
      // the case the circle-pair test above resolves correctly, so skip.
      haveSeg = true;
      snx = dx / d;
      snz = dz / d;
      scx = 0.5 * (c1x + c2x);
      scz = 0.5 * (c1z + c2z);
    }
  }

  // --- deeper contact wins ----------------------------------------------------
  let nx = 0;
  let nz = 0;
  let pen = 0;
  let cx = 0;
  let cz = 0;
  let hit = false;
  if (haveSeg && segPen > bestPen) {
    hit = true;
    nx = snx;
    nz = snz;
    pen = segPen;
    cx = scx;
    cz = scz;
  } else if (haveCircle) {
    hit = true;
    nx = cnx;
    nz = cnz;
    pen = bestPen;
    cx = ccx;
    cz = ccz;
  }
  if (hit) {
    // Outward check: a separation normal must move the body centers APART.
    // In deep "crossed-circles" penetrations (center distance below the
    // circle-offset sum — only reachable via huge staged overlaps, never by
    // one tick's motion) the circle-pair normal inverts, and in the exact
    // endpoint-touching coaxial case it degenerates to a perpendicular —
    // either would grind the bodies together or sideways; fall back to the
    // between-centers direction, keeping the deepest penetration.
    const cdx = ax - bx;
    const cdz = az - bz;
    const cd = Math.sqrt(cdx * cdx + cdz * cdz);
    if (cd > 1e-9 && nx * cdx + nz * cdz <= 1e-9) {
      nx = cdx / cd;
      nz = cdz / cd;
    }
    contact.nx = nx;
    contact.nz = nz;
    contact.pen = pen;
    contact.cx = cx;
    contact.cz = cz;
  }
  contact.hit = hit;
  if (!hit) contact.pen = 0;
  return contact;
}

/**
 * Add to a traffic car's kick velocity, clamping the magnitude and
 * snapping to 0 below the epsilon so traffic.update()'s fast path
 * re-engages (mirrors its own defensive clamp).
 * @param {import('./traffic.js').TrafficCar} car Car to kick.
 * @param {number} dvx Kick velocity x delta (m/s).
 * @param {number} dvz Kick velocity z delta (m/s).
 * @param {number} maxMs Magnitude clamp (m/s).
 * @returns {void}
 */
function addKick(car, dvx, dvz, maxMs) {
  let vx = car.kickVx + dvx;
  let vz = car.kickVz + dvz;
  const magSq = vx * vx + vz * vz;
  if (magSq > maxMs * maxMs) {
    const mag = Math.sqrt(magSq);
    vx = (vx / mag) * maxMs;
    vz = (vz / mag) * maxMs;
  }
  car.kickVx = vx;
  car.kickVz = vz;
}

/**
 * Add to a traffic car's positional offset, clamping each axis.
 * @param {import('./traffic.js').TrafficCar} car Car to offset.
 * @param {number} dx Offset x delta (m).
 * @param {number} dz Offset z delta (m).
 * @param {number} maxM Per-axis clamp (m).
 * @returns {void}
 */
function addOffset(car, dx, dz, maxM) {
  car.offX = clampAbs(car.offX + dx, maxM);
  car.offZ = clampAbs(car.offZ + dz, maxM);
}

/**
 * Clamp a value to [-limit, limit].
 * @param {number} v Value.
 * @param {number} limit Limit (>= 0).
 * @returns {number} Clamped value.
 */
function clampAbs(v, limit) {
  return v > limit ? limit : v < -limit ? -limit : v;
}
