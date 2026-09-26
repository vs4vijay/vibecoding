/**
 * Parked cars along the curbs (Midtown Blitz, task 4.3).
 *
 * Places ~48 parallel-parked cars in rows along block edges (design
 * Decision 7: "Parked cars are static positions in the collision world
 * plus instanced meshes") and registers each one as a static AABB in the
 * collision world, so the player physics (and every other solids query —
 * traffic spawn/recycle clearance, the debug helpers) treats them as walls.
 * Parked cars never move: there is no per-tick cost once placed.
 *
 * Placement rule (per street edge of every block, deterministic):
 *  - one candidate "parking strip" per block edge, on the ROAD side of the
 *    curb line — the parked car's center sits {@link PARKED_TUNING.CENTER_FROM_CURB_M}
 *    (0.9 m) outside the curb, so the 1.9 m body hugs the curb (outer face
 *    ~1.85 m out) and a 14 m road keeps ~11 m clear. Lane centers sit
 *    3.5 m from the curb, so every parked center is >= 2.6 m from any lane
 *    centerline — a lane-center traffic capsule (r = 0.95) still clears a
 *    parked AABB by ~0.7 m, and traffic probes (half-width 2.1 m) never
 *    sense parked centers (2.6 m off the probe ray), so lane keeping,
 *    probe braking and spawning are untouched (traffic spec: parked cars
 *    are obstacles for the PLAYER, not for lane-following AI).
 *  - parked cars face the travel direction of the adjacent lane (right-hand
 *    traffic, parallel-parking style): block W/E edges face ∓Z... concretely
 *    W → -Z (heading PI), E → +Z (heading 0), N → +X (heading PI/2),
 *    S → -X (heading -PI/2) — derived from the lane-graph right-hand rule.
 *  - centers stay >= JUNCTION_CLEARANCE_M (8 m) from the junction-box edges
 *    (the block edge IS the box edge), so turning traffic never sweeps them.
 *  - slots along a strip are spaced SPACING_M (5.2 m) apart (min bumper gap
 *    ~0.8 m); a fixed per-strip rng offset staggers rows so the city does
 *    not read as a grid of identical parking bays.
 *  - the exact set of parked spots is drawn with sequential sampling over
 *    all candidate slots (probability = remaining / candidates-left), giving
 *    exactly TARGET_COUNT spots spread over random strips — the draw count
 *    per candidate is fixed, so the result is seed-deterministic.
 *  - each spot is validated BEFORE its AABB is registered: the full body
 *    capsule (exact two-circle hull via `world.queryCapsule`) must be clear
 *    of every registered solid (props, buildings, and earlier parked cars)
 *    and the surface must be road (surfaceHeightAt === 0). Because each
 *    car's AABB is registered immediately after its check, the same call
 *    also enforces car-vs-car clearance.
 *
 * Visuals: two InstancedMesh draw calls (body + cabin boxes in the
 * traffic/player-car archetype proportions), per-instance muted paint
 * (whites/grays/dark reds/charcoal), per-instance rotation from the
 * heading. Static: the group is posed once at creation; there is no
 * update() to call. Shadows on (city-view owns the sun's tier wiring).
 *
 * Like the other view modules, this builds real three.js objects without a
 * renderer, so the plain-node harness (scripts/car-collisions-test.mjs)
 * can construct and dispose it.
 *
 * Purity: placement is plain math + the collision-world API + the caller's
 * rng (no Math.random, no clock) — byte-deterministic per seed. The only
 * three.js touch is the view half of the module.
 */

import * as THREE from 'three';

/**
 * Tunables for parked-car placement and visuals (meters, rad).
 */
export const PARKED_TUNING = Object.freeze({
  /** Exact number of spots drawn per seed (spec range ~30-60). */
  TARGET_COUNT: 48,
  /** Harness sanity bounds on the placed count. */
  MIN_COUNT: 30,
  MAX_COUNT: 60,
  /** Along-strip spacing between adjacent spot centers in m (4.4 m car
   *  + ~0.8 m bumper gap). */
  SPACING_M: 5.2,
  /** Parked-car center distance from the curb line in m (body hugging the
   *  curb: outer face ~1.85 m out; centers >= 2.6 m from lane centerlines,
   *  lane-center traffic capsules still clear the AABB by ~0.7 m). */
  CENTER_FROM_CURB_M: 0.9,
  /** Minimum center distance from a junction-box edge in m (the box edge
   *  is the block edge). */
  JUNCTION_CLEARANCE_M: 8,
  /** Body geometry — must match DEFAULT_CAR_CONFIG.body (two circles
   *  r 0.95 at ±1.25 along the heading). */
  BODY_LENGTH_M: 4.4,
  BODY_WIDTH_M: 1.9,
  BODY_HEIGHT_M: 1.4,
  CIRCLE_RADIUS_M: 0.95,
  CIRCLE_OFFSET_M: 1.25,
  /** Muted paint palette (whites/grays/dark reds/charcoal), rng-picked. */
  PALETTE: Object.freeze([
    0xd9dbde, // light silver-white
    0xb7bcbf, // pale gray
    0x8b9096, // medium gray
    0x6b332c, // dark oxide red
    0x30343a, // charcoal
  ]),
});

/**
 * One placed parked car — plain data plus its registered collision record.
 * The AABB is static; nothing mutates a parked car after creation.
 *
 * @typedef {object} ParkedCar
 * @property {number} x Body origin x (m; on the road-side parking strip).
 * @property {number} z Body origin z (m).
 * @property {number} heading Yaw in rad (forward = (sin, cos)); faces the
 *   adjacent lane's travel direction, aligned with the road axis.
 * @property {number} color Paint color as a hex number.
 * @property {{ axis: 'x' | 'z', coord: number, outward: number }} curb
 *   Placement metadata: the curb line is `axis === 'x' ? x = coord :
 *   z = coord`, and the road lies toward `outward` (+1 | -1) along that
 *   axis. Lets harnesses assert the strip geometry.
 * @property {import('./collision.js').CollisionAabb} aabb The registered
 *   static collision record (tag 'parked-car', ref === the ParkedCar).
 */

/**
 * Handle for the parked-car set.
 *
 * @typedef {object} ParkedCars
 * @property {ParkedCar[]} cars All placed cars (placement order).
 * @property {number} count cars.length (convenience).
 * @property {THREE.Group} group Root group (add to a scene): two
 *   InstancedMeshes (body + cabin), posed once at creation, frustum culling
 *   disabled (instances span the city).
 * @property {() => void} dispose Release the geometries/materials and
 *   detach the group (idempotent). NOTE: the collision-world AABBs stay
 *   registered — the world has no removal API; a disposed set is only
 *   meaningful in tests that rebuild the world anyway.
 */

/**
 * Place the parked cars for a generated city and register them as static
 * colliders (module header for the placement rule).
 *
 * @param {object} deps Collaborators.
 * @param {import('./city-gen.js').CityLayout} deps.layout Generated city
 *   layout (grid geometry + world reads only).
 * @param {import('./collision.js').CollisionWorld} deps.world Collision
 *   world: each accepted car is registered via `world.addAabb` (tag
 *   'parked-car'); placement validity uses `world.overlapsSolid` BEFORE
 *   its own registration, so spots never overlap any solid — including
 *   earlier parked cars.
 * @param {import('../engine/rng.js').Rng} deps.rng Caller-owned rng stream
 *   (row offsets, spot selection, paint picks — deterministic per seed).
 * @returns {ParkedCars} The parked-car set (data + static instanced view).
 * @throws {TypeError} If deps are missing or shaped wrong.
 */
export function createParkedCars({ layout, world, rng } = {}) {
  const P = PARKED_TUNING;
  if (!layout || !layout.grid || !Array.isArray(layout.blocks)) {
    throw new TypeError('createParkedCars: needs the city layout');
  }
  if (!world || typeof world.addAabb !== 'function' || typeof world.overlapsSolid !== 'function' || typeof world.surfaceHeightAt !== 'function') {
    throw new TypeError('createParkedCars: needs a CollisionWorld (addAabb + overlapsSolid + surfaceHeightAt)');
  }
  if (!rng || typeof rng.float !== 'function' || typeof rng.chance !== 'function' || typeof rng.pick !== 'function') {
    throw new TypeError('createParkedCars: needs a caller-owned rng (engine createRng)');
  }

  const half = layout.grid.blockM / 2; // block center -> curb line (32 m)
  // Usable center span along a strip: block edges ARE the junction-box
  // edges, so keeping JUNCTION_CLEARANCE_M inside them keeps every parked
  // center >= 8 m from the box.
  const usableSpanM = layout.grid.blockM - 2 * P.JUNCTION_CLEARANCE_M; // 48
  // Slot count that fits with car-length breathing room at both ends.
  const slotCount = Math.floor((usableSpanM - P.BODY_LENGTH_M) / P.SPACING_M) + 1; // 9
  const slotSpanM = (slotCount - 1) * P.SPACING_M; // 41.6

  /**
   * One candidate strip: the parking lane along one block edge.
   * @typedef {{ axis: 'x' | 'z', coord: number, outward: number, heading: number, along: number, rowOffset: number }} Strip
   * @type {Strip[]}
   */
  const strips = [];
  for (const block of layout.blocks) {
    // Heading per edge from the lane-graph right-hand rule (module header):
    // W/E edges border vertical roads (their block side carries -Z / +Z
    // travel), N/S edges border horizontal roads (+X / -X travel).
    strips.push({ axis: 'x', coord: block.x - half, outward: -1, heading: Math.PI, along: block.z, rowOffset: 0 });
    strips.push({ axis: 'x', coord: block.x + half, outward: 1, heading: 0, along: block.z, rowOffset: 0 });
    strips.push({ axis: 'z', coord: block.z - half, outward: -1, heading: Math.PI / 2, along: block.x, rowOffset: 0 });
    strips.push({ axis: 'z', coord: block.z + half, outward: 1, heading: -Math.PI / 2, along: block.x, rowOffset: 0 });
  }
  // One stagger draw per strip, in fixed order (fixed draw count).
  for (const strip of strips) {
    strip.rowOffset = rng.float(0, usableSpanM - slotSpanM + 1e-9);
  }

  /** @type {ParkedCar[]} */
  const cars = [];

  // Sequential sampling over every candidate slot: the chance at candidate
  // m is need / (total - m), which lands EXACTLY TARGET_COUNT spots spread
  // uniformly over the city — one rng.chance draw per candidate in fixed
  // order, so the placement is seed-deterministic.
  const totalCandidates = strips.length * slotCount;
  let need = P.TARGET_COUNT;
  for (let i = 0; i < strips.length && need > 0; i += 1) {
    const strip = strips[i];
    for (let k = 0; k < slotCount && need > 0; k += 1) {
      const m = i * slotCount + k;
      if (!rng.chance(need / (totalCandidates - m))) continue;

      // Spot center: CENTER_FROM_CURB_M toward the road, rowOffset + slot
      // stagger along the strip (kept >= 8 m from both junction boxes).
      const along = strip.along - usableSpanM / 2 + strip.rowOffset + k * P.SPACING_M;
      const lateral = strip.coord + strip.outward * P.CENTER_FROM_CURB_M;
      const x = strip.axis === 'x' ? lateral : along;
      const z = strip.axis === 'z' ? lateral : along;

      // Validate BEFORE registering (module header): the exact body capsule
      // (queryCapsule covers both circles AND the hull between them) must
      // be clear of every registered solid (props, buildings, earlier
      // parked cars) and the spot on asphalt. Rejects are simply skipped —
      // the sampling already guarantees the target count with margin.
      const sinH = Math.sin(strip.heading);
      const cosH = Math.cos(strip.heading);
      const fx = x + sinH * P.CIRCLE_OFFSET_M;
      const fz = z + cosH * P.CIRCLE_OFFSET_M;
      const bx = x - sinH * P.CIRCLE_OFFSET_M;
      const bz = z - cosH * P.CIRCLE_OFFSET_M;
      if (world.queryCapsule(bx, bz, fx, fz, P.CIRCLE_RADIUS_M) !== null) continue;
      if (world.surfaceHeightAt(x, z) !== 0) continue;

      // Axis-aligned footprint: cars sit along a road axis, so the AABB is
      // exact (1.9 x 4.4 or 4.4 x 1.9) — no approximation needed.
      const alongX = Math.abs(sinH) > 0.5;
      /** @type {ParkedCar} */
      const car = {
        x,
        z,
        heading: strip.heading,
        color: rng.pick(P.PALETTE),
        curb: { axis: strip.axis, coord: strip.coord, outward: strip.outward },
        aabb: null,
      };
      car.aabb = world.addAabb({
        x,
        z,
        w: alongX ? P.BODY_LENGTH_M : P.BODY_WIDTH_M,
        d: alongX ? P.BODY_WIDTH_M : P.BODY_LENGTH_M,
        y: 0,
        height: P.BODY_HEIGHT_M,
        tag: 'parked-car',
        ref: car,
      });
      cars.push(car);
      need -= 1;
    }
  }

  // --- static instanced view: 2 draw calls (body + cabin) -------------------
  /** @type {(THREE.Material | THREE.BufferGeometry)[]} */
  const resources = [];
  /**
   * Track a resource for dispose().
   * @template {THREE.Material | THREE.BufferGeometry} T
   * @param {T} res Material or geometry to track.
   * @returns {T} The same resource.
   */
  function track(res) {
    resources.push(res);
    return res;
  }

  // Traffic/player-car archetype proportions (chassis y ~0.2-0.8, cabin
  // atop); the body box reaches down to y 0.18 so the silhouette reads as
  // body + tires at ambient distance (same trick as the traffic skirt).
  const bodyGeo = track(new THREE.BoxGeometry(1.86, 0.6, 4.24));
  bodyGeo.translate(0, 0.48, 0);
  const cabinGeo = track(new THREE.BoxGeometry(1.5, 0.5, 2.0));
  cabinGeo.translate(0, 1.02, -0.3);
  const bodyMat = track(new THREE.MeshLambertMaterial({ color: 0xffffff })); // instanceColor-multiplied
  const cabinMat = track(new THREE.MeshLambertMaterial({ color: 0x22282e }));

  const group = new THREE.Group();
  group.name = 'parked-cars';

  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, cars.length);
  const cabinMesh = new THREE.InstancedMesh(cabinGeo, cabinMat, cars.length);
  for (const mesh of [bodyMesh, cabinMesh]) {
    mesh.frustumCulled = false; // instances span the city; never batch-cull
    mesh.matrixAutoUpdate = false; // identity root; instances carry the pose
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }

  const scratchMatrix = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3(1, 1, 1);
  const scratchColor = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);

  // Pose once (parked cars never move): position + rotation.y = heading.
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i];
    scratchPos.set(car.x, 0, car.z);
    scratchQuat.setFromAxisAngle(UP, car.heading);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    bodyMesh.setMatrixAt(i, scratchMatrix);
    cabinMesh.setMatrixAt(i, scratchMatrix);
    bodyMesh.setColorAt(i, scratchColor.setHex(car.color));
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  cabinMesh.instanceMatrix.needsUpdate = true;
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;

  /**
   * Release every geometry/material this view created and detach the group
   * from its parent (idempotent).
   * @returns {void}
   */
  function dispose() {
    for (let i = 0; i < resources.length; i += 1) resources[i].dispose();
    resources.length = 0;
    if (group.parent) group.parent.remove(group);
  }

  return { cars, count: cars.length, group, dispose };
}
