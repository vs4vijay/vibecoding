/**
 * Low-poly stylized player-car view (Midtown Blitz, task 3.2).
 *
 * Builds the visible player car — a paint body with glass cabin, four
 * cylinder wheels (the front pair wrapped in steer groups), bumper and
 * headlight trim, and brake lights — and, once per rendered frame, applies
 * the arcade car physics state ({@link module:src/game/car-physics}) to it:
 *
 *  - Pose: the group sits at the interpolated body origin. Position comes
 *    from the previous/current tick x/z pair the app keeps (the physics
 *    state itself only carries headingPrev); heading is lerped
 *    shortest-arc from `headingPrev` to `heading` so wrap-around at ±PI
 *    never spins the mesh the long way. Easing toward `surfaceY` (roads 0,
 *    block surfaces CURB_M) absorbs the curb step visually; the physics'
 *    curb hop itself shows as a body pitch from `visualPitch` while
 *    `bumpTimer > 0`.
 *  - Wheels: every wheel spins about its axle (`rotation.x = wheelSpin`,
 *    positive = rolling forward, mod 2π for float hygiene); the front
 *    steer groups take `rotation.y = steerAngle`, so steering and spin
 *    compose cleanly (parent yaw, child pitch).
 *  - Brake lights: two unlit (MeshBasicMaterial) boxes at the tail light
 *    up on brake input or handbrake — a material swap, never a per-frame
 *    allocation.
 *
 * Geometry is sized from DEFAULT_CAR_CONFIG.body (wheel radius, wheelbase,
 * length/width) so the view stays glued to the physics numbers by
 * construction. The group origin is the body origin at GROUND level (+Z
 * forward, `rotation.y = heading` directly — the shared heading
 * convention). Every visible mesh sets `castShadow` so the high quality
 * tier's sun picks the car up.
 *
 * Like city-view.js, this module builds real three.js meshes without a
 * renderer, so the plain-node harness (scripts/car-view-test.mjs) drives
 * the exact code the browser runs. `dispose()` releases every geometry and
 * material it created (idempotent).
 */

import * as THREE from 'three';
import { DEFAULT_CAR_CONFIG } from './config.js';

/** Body paint — arcade red-orange, readable against the grey city. */
const PAINT_COLOR = 0xd8432c;
/** Slightly darker paint for the roof slab and mirror caps. */
const PAINT_DARK_COLOR = 0xb02f1e;
/** Cabin glass. */
const GLASS_COLOR = 0x223140;
/** Tires. */
const TIRE_COLOR = 0x1c1f24;
/** Wheel hubs (light metal). */
const HUB_COLOR = 0xc9ccd2;
/** Front/rear bumper trim. */
const TRIM_COLOR = 0x2a2d33;
/** Headlamp lenses (always on — daytime running lights). */
const HEADLIGHT_COLOR = 0xf2e8c8;
/** Brake lamp lens, unlit. */
const BRAKE_OFF_COLOR = 0x4a120e;
/** Brake lamp lens, lit (unlit material — reads as emissive). */
const BRAKE_ON_COLOR = 0xff3b2f;

/**
 * Fraction of the remaining surfaceY error the y smoothing closes per
 * rendered frame (update() runs once per frame; frame-rate independence
 * does not matter for this purely cosmetic easing).
 */
const Y_SMOOTH_PER_FRAME = 0.25;

/** Two-pi, for wheelSpin modding. */
const TWO_PI = Math.PI * 2;

/**
 * Shortest-arc angular difference from `from` to `to` in rad — the signed
 * equivalent delta in (-PI, PI] (so a heading wrap at ±PI interpolates the
 * short way instead of spinning the long way).
 *
 * @param {number} from Start angle (rad).
 * @param {number} to End angle (rad).
 * @returns {number} Signed delta in (-PI, PI].
 */
function shortestArcDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * Handle for a created car view.
 *
 * @typedef {object} CarView
 * @property {THREE.Group} group The car's root group (add to a scene;
 *   origin at the ground under the body origin, +Z forward).
 * @property {CarViewUpdateFn} update Apply a (possibly interpolated)
 *   physics state to the group's transforms, wheels, and brake lights.
 * @property {() => void} dispose Release every geometry/material this view
 *   created and detach the group (idempotent).
 */

/**
 * Per-frame view update.
 *
 * @callback CarViewUpdateFn
 * @param {import('./car-physics.js').CarState} state Live physics state
 *   (read-only here; mutated by CarPhysics.step).
 * @param {import('./car-physics.js').CarControls} [controls] Controls the
 *   sim was last driven with (brake/handbrake light the brake lamps).
 * @param {number} [alpha=1] Render interpolation alpha in [0, 1): 0 shows
 *   the previous tick's state, 1 the current one (heading is lerped
 *   shortest-arc; position between `prev` and `state`).
 * @param {object} [prev] Previous tick's body origin `{ x, z }` — the app
 *   snapshots it per tick because the physics state carries only
 *   `headingPrev`. Omitted (or null) reads position straight from `state`
 *   (no position interpolation; boot frames before the first tick).
 * @returns {void}
 */

/**
 * Build the low-poly stylized player car.
 *
 * @returns {CarView} The car view handle.
 */
export function createCarView() {
  const body = DEFAULT_CAR_CONFIG.body;
  const wheelR = body.wheelRadiusM;
  const axleZ = body.wheelbaseM / 2; // front axle +, rear axle -
  const trackX = body.widthM / 2 - 0.13; // tuck the wheels just inside the fenders
  const wheelW = 0.26;

  // --- materials (all created once, tracked for dispose) ---------------------
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

  const paintMat = track(new THREE.MeshLambertMaterial({ color: PAINT_COLOR }));
  const paintDarkMat = track(new THREE.MeshLambertMaterial({ color: PAINT_DARK_COLOR }));
  const glassMat = track(new THREE.MeshLambertMaterial({ color: GLASS_COLOR }));
  const trimMat = track(new THREE.MeshLambertMaterial({ color: TRIM_COLOR }));
  const headlightMat = track(new THREE.MeshBasicMaterial({ color: HEADLIGHT_COLOR }));
  const brakeOffMat = track(new THREE.MeshBasicMaterial({ color: BRAKE_OFF_COLOR }));
  const brakeOnMat = track(new THREE.MeshBasicMaterial({ color: BRAKE_ON_COLOR }));
  const tireMat = track(new THREE.MeshLambertMaterial({ color: TIRE_COLOR }));
  const hubMat = track(new THREE.MeshLambertMaterial({ color: HUB_COLOR }));

  // --- shared geometries (one per archetype, tracked for dispose) ------------
  /** Axis-aligned box helper.
   * @param {number} w Width (x, m).
   * @param {number} h Height (y, m).
   * @param {number} d Depth (z, m).
   * @returns {THREE.BoxGeometry} Tracked geometry.
   */
  function box(w, h, d) {
    return track(new THREE.BoxGeometry(w, h, d));
  }
  const tireGeo = track(new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 10));
  tireGeo.rotateZ(Math.PI / 2); // axle along local X so rotation.x spins the wheel
  const hubGeo = track(new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, wheelW + 0.02, 8));
  hubGeo.rotateZ(Math.PI / 2);

  // --- root + pitched body group ----------------------------------------------
  // The root group carries the interpolated pose; `body` carries everything
  // above the axles so curb-bump pitch (visualPitch) tips the body WITHOUT
  // lifting the wheels off the ground.
  const group = new THREE.Group();
  group.name = 'car';
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'body';
  group.add(bodyGroup);

  /**
   * Add one box mesh to the body group.
   * @param {THREE.BufferGeometry} geo Geometry (usually shared).
   * @param {THREE.Material} mat Material.
   * @param {number} x Local x (m).
   * @param {number} y Local y (m).
   * @param {number} z Local z (m).
   * @param {string} [name] Optional node name (harness/debug seam).
   * @returns {THREE.Mesh} The added mesh.
   */
  function addBodyBox(geo, mat, x, y, z, name) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (name) mesh.name = name;
    bodyGroup.add(mesh);
    return mesh;
  }

  // Chassis: spans y 0.30–0.80 (ground clearance under the 0.34 m wheels).
  addBodyBox(box(body.widthM - 0.1, 0.5, body.lengthM - 0.2), paintMat, 0, 0.55, 0, 'chassis');
  // Cabin glass block sits rear-of-center on top of the chassis.
  addBodyBox(box(1.5, 0.5, 2.0), glassMat, 0, 1.05, -0.3, 'cabin');
  // Thin paint roof slab capping the glass.
  addBodyBox(box(1.45, 0.08, 1.9), paintDarkMat, 0, 1.34, -0.3, 'roof');
  // Bumpers: dark trim capping nose and tail.
  addBodyBox(box(1.86, 0.22, 0.24), trimMat, 0, 0.42, body.lengthM / 2 - 0.02, 'bumper-front');
  addBodyBox(box(1.86, 0.22, 0.24), trimMat, 0, 0.42, -(body.lengthM / 2 - 0.02), 'bumper-rear');
  // Daytime headlamps.
  addBodyBox(box(0.3, 0.12, 0.06), headlightMat, 0.55, 0.68, body.lengthM / 2, 'headlight-left');
  addBodyBox(box(0.3, 0.12, 0.06), headlightMat, -0.55, 0.68, body.lengthM / 2, 'headlight-right');
  // Brake lamps: unlit dark red until brake/handbrake swaps the material.
  const brakeOffGeo = box(0.34, 0.12, 0.06);
  addBodyBox(brakeOffGeo, brakeOffMat, 0.6, 0.68, -(body.lengthM / 2), 'brake-light-left');
  addBodyBox(brakeOffGeo, brakeOffMat, -0.6, 0.68, -(body.lengthM / 2), 'brake-light-right');

  // --- wheels -------------------------------------------------------------------
  /**
   * Build one spinning wheel (tire + protruding hub) named for lookup.
   * @param {string} name Node name ('wheel-fl' … 'wheel-rr').
   * @returns {THREE.Group} Wheel group; rotate .rotation.x to spin.
   */
  function makeWheel(name) {
    const wheel = new THREE.Group();
    wheel.name = name;
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    wheel.add(tire, hub);
    return wheel;
  }

  /** @type {THREE.Group[]} The four spin groups, in wheelSpin order. */
  const wheels = [];
  /** @type {THREE.Group[]} The two front steer groups. */
  const steerGroups = [];
  for (const [sx, sz, tag] of [
    [trackX, axleZ, 'fl'],
    [-trackX, axleZ, 'fr'],
    [trackX, -axleZ, 'rl'],
    [-trackX, -axleZ, 'rr'],
  ]) {
    const wheel = makeWheel(`wheel-${tag}`);
    wheel.position.set(sx, wheelR, sz);
    wheels.push(wheel);
    if (sz > 0) {
      // Front: wrap in a steer group so steering (yaw) and spin (pitch)
      // compose as parent rotation.y -> child rotation.x.
      const steer = new THREE.Group();
      steer.name = `steer-${tag}`;
      steer.position.copy(wheel.position);
      wheel.position.set(0, 0, 0);
      steer.add(wheel);
      group.add(steer);
      steerGroups.push(steer);
    } else {
      group.add(wheel);
    }
  }

  // --- per-frame scratch/state ---------------------------------------------------
  /** @type {THREE.Mesh[]} Brake lamp meshes (material-swapped). */
  const brakeLights = [
    /** @type {THREE.Mesh} */ (bodyGroup.getObjectByName('brake-light-left')),
    /** @type {THREE.Mesh} */ (bodyGroup.getObjectByName('brake-light-right')),
  ];
  let brakeLightsOn = false;
  let ySmooth = 0; // eased group elevation (m)

  /**
   * @type {CarViewUpdateFn}
   */
  function update(state, controls, alpha = 1, prev = null) {
    // Pose: interpolated position + shortest-arc heading.
    const px = prev ? prev.x : state.x;
    const pz = prev ? prev.z : state.z;
    group.position.x = px + (state.x - px) * alpha;
    group.position.z = pz + (state.z - pz) * alpha;
    const dh = shortestArcDelta(state.headingPrev, state.heading);
    group.rotation.y = state.headingPrev + dh * alpha;

    // Elevation: ease toward the sampled surface (roads 0, curbs 0.15 m).
    ySmooth += (state.surfaceY - ySmooth) * Y_SMOOTH_PER_FRAME;
    group.position.y = ySmooth;

    // Curb hop: tip the body while the bump state is live (+pitch = nose up,
    // and three's +rotation.x pitches the nose DOWN, hence the negation).
    bodyGroup.rotation.x = state.bumpTimer > 0 ? -state.visualPitch : 0;

    // Wheels: spin about the axle (mod 2π keeps the angle small forever);
    // fronts steer via their parent group.
    const spin = state.wheelSpin % TWO_PI;
    for (let i = 0; i < wheels.length; i += 1) wheels[i].rotation.x = spin;
    for (let i = 0; i < steerGroups.length; i += 1) {
      steerGroups[i].rotation.y = state.steerAngle;
    }

    // Brake lamps: lit on brake pedal or handbrake (material swap only).
    const braking = (controls?.brake ?? 0) > 0 || !!(controls?.handbrake);
    if (braking !== brakeLightsOn) {
      brakeLightsOn = braking;
      const mat = braking ? brakeOnMat : brakeOffMat;
      for (let i = 0; i < brakeLights.length; i += 1) brakeLights[i].material = mat;
    }
  }

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

  return { group, update, dispose };
}
