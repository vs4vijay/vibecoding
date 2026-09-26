#!/usr/bin/env node
/**
 * Scripted verification harness for task 3.2's car view
 * (src/game/car-view.js).
 *
 * Everything runs in plain node against the REAL three.js classes and the
 * real game modules (no DOM, no WebGL): the view is constructed headless,
 * driven with synthetic CarState objects, and finally cross-checked against
 * the actual car physics on the actual generated city collision world.
 *
 *   1. Structure — the car builds with meshes, exactly 4 wheel groups, 2
 *      front steer groups, 2 brake-light meshes, shadow flags set, and the
 *      wheels placed on the config's wheelbase/track at wheel-radius height.
 *   2. Pose — update() applies the interpolated position (between the
 *      app-provided prev tick pair) and shortest-arc interpolated heading
 *      at alpha 0 / 0.5 / 1.
 *   3. Heading wrap — a headingPrev -> heading jump across ±PI interpolates
 *      the SHORT way (no long-way spin).
 *   4. Wheels — steer groups take state.steerAngle (fronts only), all four
 *      wheels spin with wheelSpin (mod 2π, monotonic increments), and the
 *      rear wheels' parent stays unrotated.
 *   5. Brake lights — swap dark->lit on brake pedal, on handbrake alone,
 *      and back off when released (material identity, no allocation).
 *   6. Elevation + curb pitch — y eases toward surfaceY without popping;
 *      body pitches by -visualPitch while bumpTimer > 0 and levels after.
 *   7. dispose() — releases every geometry/material the view created
 *      (verified by instrumentation), is idempotent, and detaches the group.
 *   8. Physics integration — driving the REAL car physics 2 s of full
 *      throttle from the app's spawn keeps the view glued to the state
 *      (position/rotation within 1e-9), the wheels spin forward, and a
 *      steering phase shows on the steer groups with the physics' sign.
 *
 * Run: node scripts/car-view-test.mjs   (plain node, no dependencies beyond
 * the repo's own three install)
 */
import * as THREE from 'three';

import { generateCity } from '../src/game/city-gen.js';
import { createCollisionWorld } from '../src/game/collision.js';
import { createCarPhysics } from '../src/game/car-physics.js';
import { DEFAULT_CAR_CONFIG } from '../src/game/config.js';
import { createCarView } from '../src/game/car-view.js';
import { SIM_DT } from '../src/engine/loop.js';

let checks = 0;
let failed = 0;

/**
 * Record a single assertion.
 * @param {boolean} cond Condition to assert.
 * @param {string} label Human-readable assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function check(cond, label) {
  checks += 1;
  if (!cond) {
    failed += 1;
    console.log(`    FAIL ${label}`);
  }
  return cond;
}

/**
 * Assert |actual - expected| <= tol.
 * @param {number} actual Actual value.
 * @param {number} expected Expected value.
 * @param {number} tol Absolute tolerance.
 * @param {string} label Assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function checkClose(actual, expected, tol, label) {
  return check(
    Math.abs(actual - expected) <= tol,
    `${label} (got ${actual}, want ${expected} +/- ${tol})`
  );
}

/**
 * Smallest signed angular difference b - a in (-PI, PI] (rad).
 * @param {number} a First angle.
 * @param {number} b Second angle.
 * @returns {number} Wrapped difference.
 */
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Build a plain CarState-shaped object with everything neutral except the
 * given overrides (the view reads a fixed field set).
 * @param {object} [overrides] Fields to overlay.
 * @returns {object} A CarState-like plain object.
 */
function makeState(overrides = {}) {
  return {
    x: 0,
    z: 0,
    heading: 0,
    headingPrev: 0,
    steerAngle: 0,
    surfaceY: 0,
    bumpTimer: 0,
    visualPitch: 0,
    wheelSpin: 0,
    wheelSpinRate: 0,
    speed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipAngle: 0,
    bumpCount: 0,
    time: 0,
    ...overrides,
  };
}

const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false });

console.log('car-view-test: low-poly car view verification\n');

// --- 1. Structure -------------------------------------------------------------
let view;
{
  const name = 'structure';
  console.log(`  ${name}`);
  view = createCarView();
  const { group } = view;
  check(group.name === 'car', 'root group is named "car"');
  let meshCount = 0;
  group.traverse((o) => {
    if (o.isMesh) meshCount += 1;
  });
  check(meshCount > 0, `car builds real meshes (${meshCount} meshes)`);

  const wheelNames = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr'];
  const wheels = wheelNames.map((n) => group.getObjectByName(n));
  check(wheels.every((w) => w && w.isGroup), 'all four wheel groups exist by name');
  const steerGroups = ['steer-fl', 'steer-fr'].map((n) => group.getObjectByName(n));
  check(steerGroups.every((s) => s && s.isGroup), 'both front steer groups exist by name');
  check(
    wheels[0].parent === steerGroups[0] && wheels[1].parent === steerGroups[1],
    'front wheels are children of the steer groups'
  );
  check(
    wheels[2].parent === group && wheels[3].parent === group,
    'rear wheels hang directly off the root (no steer group)'
  );

  // Wheel placement from the physics config: axles at +/-wheelbase/2, tucked
  // inside the fenders, centers one wheel-radius above the ground origin.
  // Front wheels are zeroed inside their steer groups, so read the mount
  // transform (the steer group's position for fronts, the wheel's otherwise).
  const mountOf = (w) => (w.parent.name.startsWith('steer-') ? w.parent.position : w.position);
  const body = DEFAULT_CAR_CONFIG.body;
  checkClose(mountOf(wheels[0]).z, body.wheelbaseM / 2, 1e-9, 'front axle sits at +wheelbase/2');
  checkClose(mountOf(wheels[2]).z, -body.wheelbaseM / 2, 1e-9, 'rear axle sits at -wheelbase/2');
  checkClose(mountOf(wheels[0]).y, body.wheelRadiusM, 1e-9, 'wheel centers sit one wheel-radius up');
  check(
    Math.abs(mountOf(wheels[0]).x) < body.widthM / 2,
    'wheels tuck inside the body width'
  );
  check(
    mountOf(wheels[0]).x > 0 && mountOf(wheels[1]).x < 0,
    'left/right wheels are on opposite sides (+x = left of +Z-forward car)'
  );

  const brakeLights = ['brake-light-left', 'brake-light-right'].map((n) =>
    group.getObjectByName(n)
  );
  check(brakeLights.every((m) => m && m.isMesh), 'both brake-light meshes exist by name');
  const chassis = group.getObjectByName('chassis');
  check(chassis && chassis.castShadow === true, 'chassis casts shadows (high tier shows the car)');
  check(wheels[0].children.some((m) => m.isMesh && m.castShadow), 'wheels cast shadows too');
}

// --- 2. Pose interpolation -------------------------------------------------------
{
  const name = 'pose interpolation (position + heading, alpha 0/0.5/1)';
  console.log(`  ${name}`);
  const { group } = view;
  const state = makeState({ x: 10, z: -5, heading: 1.1, headingPrev: 0.9 });
  const prev = { x: 8, z: -3 };

  view.update(state, NEUTRAL, 0, prev);
  checkClose(group.position.x, 8, 1e-9, 'alpha 0 shows the previous tick position (x)');
  checkClose(group.position.z, -3, 1e-9, 'alpha 0 shows the previous tick position (z)');
  checkClose(group.rotation.y, 0.9, 1e-9, 'alpha 0 shows the previous tick heading');

  view.update(state, NEUTRAL, 0.5, prev);
  checkClose(group.position.x, 9, 1e-9, 'alpha 0.5 midpoints the position (x)');
  checkClose(group.position.z, -4, 1e-9, 'alpha 0.5 midpoints the position (z)');
  checkClose(group.rotation.y, 1.0, 1e-9, 'alpha 0.5 midpoints the heading');

  view.update(state, NEUTRAL, 0.999, prev);
  checkClose(group.position.x, 10 - (10 - 8) * 0.001, 1e-9, 'alpha -> 1 approaches the current position');
}

// --- 3. Shortest-arc heading wrap -------------------------------------------------
{
  const name = 'shortest-arc heading wrap';
  console.log(`  ${name}`);
  const { group } = view;
  // 3.0 -> -3.0 crosses the +/-PI seam: the short way is +0.283 rad (through
  // PI), not -6.0 rad. The midpoint must land ON PI, nowhere near -3.
  const state = makeState({ headingPrev: 3.0, heading: -3.0 });
  view.update(state, NEUTRAL, 0.5, { x: 0, z: 0 });
  checkClose(angleDiff(Math.PI, group.rotation.y), 0, 1e-9, 'wrap midpoint lands on +PI (short way)');
  check(
    Math.abs(group.rotation.y) > 3,
    `midpoint is NOT the naive lerp's long-way pose 0 (got ${group.rotation.y.toFixed(3)})`
  );
  view.update(state, NEUTRAL, 0, { x: 0, z: 0 });
  checkClose(angleDiff(3.0, group.rotation.y), 0, 1e-9, 'alpha 0 still shows headingPrev exactly');
  // Reverse crossing (-3 -> 3) takes the mirrored short arc.
  const back = makeState({ headingPrev: -3.0, heading: 3.0 });
  view.update(back, NEUTRAL, 0.5, { x: 0, z: 0 });
  checkClose(Math.abs(angleDiff(-Math.PI, group.rotation.y)), 0, 1e-9, 'reverse wrap midpoint lands on -PI');
}

// --- 4. Wheels: steer + spin ------------------------------------------------------
{
  const name = 'wheels (steer groups + spin)';
  console.log(`  ${name}`);
  const { group } = view;
  const fl = group.getObjectByName('wheel-fl');
  const fr = group.getObjectByName('wheel-fr');
  const rl = group.getObjectByName('wheel-rl');
  const rr = group.getObjectByName('wheel-rr');
  const steerL = group.getObjectByName('steer-fl');
  const steerR = group.getObjectByName('steer-fr');

  const state = makeState({ steerAngle: 0.3, wheelSpin: 5.0 });
  view.update(state, NEUTRAL, 1, null);
  checkClose(steerL.rotation.y, 0.3, 1e-9, 'left steer group takes state.steerAngle');
  checkClose(steerR.rotation.y, 0.3, 1e-9, 'right steer group takes state.steerAngle');
  checkClose(rl.parent.rotation.y, 0, 1e-9, 'rear wheels are not steered (parent yaw stays 0)');
  checkClose(fl.rotation.x, 5.0, 1e-9, 'wheel spin applies state.wheelSpin');
  checkClose(rr.rotation.x, 5.0, 1e-9, 'all four wheels share the spin');

  state.wheelSpin = 5.2;
  view.update(state, NEUTRAL, 1, null);
  checkClose(fl.rotation.x, 5.2, 1e-9, 'spin increments track wheelSpin increments');

  state.wheelSpin = Math.PI * 2 * 1000 + 0.7;
  view.update(state, NEUTRAL, 1, null);
  checkClose(fl.rotation.x, 0.7, 1e-9, 'wheelSpin is applied mod 2PI (no angle growth)');

  // Spin sign: positive wheelSpin = rolling forward (+rotation.x moves the
  // wheel top toward +Z, the car's forward).
  check(state.wheelSpin > 0 && fl.rotation.x > 0, 'forward spin reads positive about the axle');
}

// --- 5. Brake lights ---------------------------------------------------------------
{
  const name = 'brake lights';
  console.log(`  ${name}`);
  const { group } = view;
  const lights = [
    group.getObjectByName('brake-light-left'),
    group.getObjectByName('brake-light-right'),
  ];
  const ON = 0xff3b2f;
  const OFF = 0x4a120e;

  view.update(makeState(), NEUTRAL, 1, null);
  check(
    lights.every((m) => m.material.color.getHex() === OFF),
    'coasting: brake lamps show the dark (off) lens'
  );
  check(
    lights[0].material === lights[1].material,
    'both lamps share one material (swap is allocation-free)'
  );

  view.update(makeState(), { throttle: 0, brake: 1, steer: 0, handbrake: false }, 1, null);
  check(
    lights.every((m) => m.material.color.getHex() === ON),
    'brake pedal lights both lamps bright red'
  );

  view.update(makeState(), { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1, null);
  check(
    lights.every((m) => m.material.color.getHex() === ON),
    'handbrake alone also lights the lamps'
  );

  view.update(makeState(), NEUTRAL, 1, null);
  check(
    lights.every((m) => m.material.color.getHex() === OFF),
    'releasing everything dims the lamps again'
  );
}

// --- 6. Elevation easing + curb-bump pitch ------------------------------------------
{
  const name = 'elevation easing + curb pitch';
  console.log(`  ${name}`);
  const { group } = view;
  const bodyGroup = group.getObjectByName('body');

  const state = makeState({ surfaceY: 0.15 });
  let lastY = 0;
  let monotone = true;
  for (let i = 0; i < 40; i += 1) {
    view.update(state, NEUTRAL, 1, null);
    if (group.position.y < lastY - 1e-12) monotone = false;
    lastY = group.position.y;
  }
  check(group.position.y > 0.1, 'y eases up toward the curb surface (no instant pop)');
  check(monotone, 'easing is monotonic (never overshoots or dips)');
  checkClose(group.position.y, 0.15, 1e-3, `y settles on surfaceY (got ${group.position.y.toFixed(5)})`);

  state.bumpTimer = 0.2;
  state.visualPitch = 0.06;
  view.update(state, NEUTRAL, 1, null);
  checkClose(bodyGroup.rotation.x, -0.06, 1e-9, 'bump pitch tips the body nose-up (-visualPitch)');
  const wheelWorld = new THREE.Vector3();
  group.getObjectByName('wheel-fl').getWorldPosition(wheelWorld);
  checkClose(
    wheelWorld.y,
    0.15 + DEFAULT_CAR_CONFIG.body.wheelRadiusM,
    0.01,
    'wheels stay grounded on the group while the body pitches'
  );

  state.bumpTimer = 0;
  view.update(state, NEUTRAL, 1, null);
  checkClose(bodyGroup.rotation.x, 0, 1e-12, 'body levels once the bump state ends');
}

// --- 7. dispose ----------------------------------------------------------------------
{
  const name = 'dispose';
  console.log(`  ${name}`);
  const { group } = view;
  /** @type {Set<THREE.BufferGeometry | THREE.Material>} */
  const resources = new Set();
  group.traverse((o) => {
    if (o.isMesh) {
      resources.add(o.geometry);
      if (Array.isArray(o.material)) o.material.forEach((m) => resources.add(m));
      else resources.add(o.material);
    }
  });
  const disposed = new Set();
  for (const res of resources) {
    const original = res.dispose.bind(res);
    res.dispose = () => {
      disposed.add(res);
      original();
    };
  }
  const scene = new THREE.Scene();
  scene.add(group);
  view.dispose();
  check(disposed.size === resources.size, `dispose releases every geometry/material (${disposed.size}/${resources.size})`);
  check(group.parent === null, 'dispose detaches the group from its parent');
  let threw = false;
  try {
    view.dispose(); // idempotent
  } catch {
    threw = true;
  }
  check(!threw, 'second dispose() is a safe no-op');
}

// --- 8. Real physics integration ------------------------------------------------------
{
  const name = 'integration with the real car physics on the real city';
  console.log(`  ${name}`);
  const layout = generateCity();
  const world = createCollisionWorld(layout);
  const car = createCarPhysics(world);
  // The app's spawn: right-hand lane (driver's right = -X when heading +Z)
  // of the center north-south road, mid-block between the z=-156 and z=-78
  // centerlines, facing +Z.
  car.reset({ x: -layout.grid.laneOffsetM, z: -117, heading: 0 });
  const carView = createCarView();

  const controls = { throttle: 1, brake: 0, steer: 0, handbrake: false };
  const prev = { x: car.state.x, z: car.state.z };
  for (let i = 0; i < 120; i += 1) {
    prev.x = car.state.x;
    prev.z = car.state.z;
    car.step(SIM_DT, controls);
  }
  carView.update(car.state, controls, 1, prev);
  const g = carView.group;
  checkClose(g.position.x, car.state.x, 1e-9, 'view x tracks the driven physics state exactly');
  checkClose(g.position.z, car.state.z, 1e-9, 'view z tracks the driven physics state exactly');
  checkClose(angleDiff(car.state.heading, g.rotation.y), 0, 1e-9, 'view heading tracks the physics heading');
  check(car.state.speed > 10, `two seconds of full throttle actually moved the car (${car.state.speed.toFixed(1)} m/s)`);
  check(car.state.wheelSpin > 0, 'forward drive accumulates positive wheelSpin');
  checkClose(
    g.getObjectByName('wheel-fl').rotation.x,
    car.state.wheelSpin % (Math.PI * 2),
    1e-9,
    'wheel rotation matches the physics wheelSpin (mod 2PI)'
  );
  check(g.position.y === 0, 'car sits on the road surface at spawn (y eased from 0 to 0)');

  // Steering phase: fresh reset, accelerate to a moderate speed (the grip
  // budget caps the steer angle to ~0.01 rad at 50 m/s, so steer where the
  // cap is meaningful), then a right steer input — the steer groups must
  // mirror the physics' steerAngle including its sign (+ = toward +X).
  car.reset({ x: layout.grid.laneOffsetM, z: -117, heading: 0 });
  const prev2 = { x: car.state.x, z: car.state.z };
  for (let i = 0; i < 40; i += 1) {
    prev2.x = car.state.x;
    prev2.z = car.state.z;
    car.step(SIM_DT, controls); // throttle still 1, steer 0
  }
  controls.steer = 1;
  for (let i = 0; i < 30; i += 1) {
    prev2.x = car.state.x;
    prev2.z = car.state.z;
    car.step(SIM_DT, controls);
  }
  carView.update(car.state, controls, 1, prev2);
  check(
    car.state.speed > 5 && car.state.speed < 30,
    `steering phase runs at a moderate speed (${car.state.speed.toFixed(1)} m/s)`
  );
  check(car.state.steerAngle > 0.05, `steering phase built a real steer angle (${car.state.steerAngle.toFixed(3)} rad)`);
  checkClose(
    carView.group.getObjectByName('steer-fl').rotation.y,
    car.state.steerAngle,
    1e-9,
    'steer groups mirror the physics steerAngle (sign included)'
  );

  carView.dispose();
  check(carView.group.parent === null, 'integration view disposed cleanly');
}

console.log(`\ncar-view-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`car-view-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('car-view-test: ALL PASS');
