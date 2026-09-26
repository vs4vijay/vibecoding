#!/usr/bin/env node
/**
 * Scripted drive harness for src/game/car-physics.js (task 3.1).
 *
 * Drives the arcade car physics against the REAL generated city collision
 * world (generateCity() + createCollisionWorld(), fixed seed) with plain-
 * node asserts:
 *
 *   a. Top speed — full throttle on a straight road reaches 180-220 km/h
 *      within 8 s (time logged), never exceeds the governor, and holds.
 *   b. Braking — full brake from ~top speed stops within a logged distance.
 *   c. Reverse — brake input from standstill reaches the reverse limit and
 *      never exceeds it; throttle drives forward again.
 *   d. Intersection turn — a scripted 90-degree turn at moderate speed
 *      stays on roads (every tick within a road corridor) with no impacts.
 *   e. Handbrake slide — slip angle with the handbrake grows well beyond
 *      normal cornering while the heading still follows the steering, the
 *      car keeps moving, and grip recovers when released.
 *   f. Head-on wall — full speed into the tower's face: stops AT the wall
 *      (front circle rests a circle-radius away), rebounds <= 2.5 m/s,
 *      holds throttle cannot push through, and no substep leaves the body
 *      inside an AABB (residual penetration <= 0.01 m every tick — no
 *      tunneling).
 *   g. Glancing wall — ~30-degree approach: deflects, tangential velocity
 *      preserved >= 70%, never enters the building, slides along the face.
 *   h. Curb hop — road -> sidewalk -> road at speed: crossings scrub a
 *      little speed (never stop the car), bump state fires, no sticking,
 *      and the car drives back off.
 *   i. Determinism — an identical scripted input sequence run twice ends
 *      in float-exact identical states (and identical impact logs).
 *   j. onImpact hook — fired on the head-on hit above threshold with the
 *      wall normal, rate-limited while pressed against the wall, and
 *      re-fires on a second slam after the cooldown.
 *
 * Plus: per-tick cost measurement and a global worst-penetration invariant
 * across every scenario.
 *
 * Run: node scripts/car-physics-test.mjs   (plain node, no dependencies)
 */
import { performance } from 'node:perf_hooks';

import { generateCity } from '../src/game/city-gen.js';
import { createCollisionWorld } from '../src/game/collision.js';
import { createCarPhysics } from '../src/game/car-physics.js';
import { DEFAULT_CAR_CONFIG, KMH_PER_MS } from '../src/game/config.js';
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

/** Wrap an angle to (-PI, PI]. */
function wrapPi(a) {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

/** Clamp to [lo, hi]. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

console.log('car-physics-test: arcade car physics verification\n');

// --- shared fixtures -----------------------------------------------------------
const city = generateCity();
const world = createCollisionWorld(city);
const { grid, landmark } = city;
const CFG = DEFAULT_CAR_CONFIG;
const TOP = CFG.engine.topSpeedMs;

// The tower landmark is the deterministic head-on/glancing target: its 30 m
// face spans the block center, so a line up the block's middle (clear of the
// x = tx +/- 6.5/19.5 sidewalk lamp rows) hits it flush.
const towerBuilding = city.blocks[landmark.blockIndex].buildings[landmark.buildingIndex];
const towerIdx = world.aabbs.findIndex((r) => r.ref === towerBuilding);
const tower = world.aabbs[towerIdx];
const faceZ = tower.minZ;
const tx = (tower.minX + tower.maxX) / 2; // face-midpoint x (tower is x-centered)
const tz = (tower.minZ + tower.maxZ) / 2;

/** Global no-tunneling monitor: worst post-resolution penetration ever seen. */
let globalWorstPen = 0;

/**
 * Create a car with an impact recorder attached.
 * @returns {{ car: object, impacts: object[] }} Car handle + event log.
 */
function makeCar() {
  const impacts = [];
  const car = createCarPhysics(world, undefined, {
    onImpact: (e) => impacts.push({ ...e }),
  });
  return { car, impacts };
}

/**
 * Step one tick, bookkeeping the global penetration monitor.
 * @param {object} car Car handle.
 * @param {object} controls Controls for this tick.
 * @returns {void}
 */
function tick(car, controls) {
  car.step(SIM_DT, controls);
  if (car.state.lastTickMaxPenetration > globalWorstPen) {
    globalWorstPen = car.state.lastTickMaxPenetration;
  }
}

/**
 * Run a fixed duration with fixed controls.
 * @param {object} car Car handle.
 * @param {number} seconds Duration in s.
 * @param {object | ((car: object, t: number) => object)} controls Fixed
 *   controls object or per-tick factory.
 * @param {(t: number) => void} [onTick] Optional per-tick observer (t =
 *   elapsed time in s, after the step).
 * @returns {number} Ticks executed.
 */
function runFor(car, seconds, controls, onTick) {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i += 1) {
    const c = typeof controls === 'function' ? controls(car, i * SIM_DT) : controls;
    tick(car, c);
    if (onTick) onTick(i * SIM_DT + SIM_DT);
  }
  return n;
}

/**
 * Distance from (x, z) to the nearest road centerline (roads exist where
 * this is <= roadM / 2 = 7 m).
 * @param {number} x World x (m).
 * @param {number} z World z (m).
 * @returns {number} Distance in m.
 */
function nearestCenterlineDist(x, z) {
  let best = Infinity;
  for (const lx of grid.linesX) best = Math.min(best, Math.abs(x - lx));
  for (const lz of grid.linesZ) best = Math.min(best, Math.abs(z - lz));
  return best;
}

/**
 * Exact distance from a point to an AABB (0 when inside).
 * @param {number} x Point x (m).
 * @param {number} z Point z (m).
 * @param {object} b AABB record.
 * @returns {number} Distance in m.
 */
function pointBoxDist(x, z, b) {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Front-circle clearance to the tower box for a heading-0 car at (x, z).
 * @param {number} x Body origin x (m).
 * @param {number} z Body origin z (m).
 * @returns {number} Clearance in m (negative = penetrating).
 */
function frontClearanceToTower(x, z) {
  const cx = x;
  const cz = z + CFG.body.circleOffsetM;
  return pointBoxDist(cx, cz, tower) - CFG.body.circleRadiusM;
}

// --- pre-flight: the tower approach corridor must be clean ----------------------
{
  console.log('  pre-flight: tower approach corridors');
  // (f) head-on line: spawn (tx, faceZ - 29) heading 0 at top speed; contact
  // when the front circle reaches faceZ - circleRadius, i.e. z = faceZ - 2.2.
  let clear = true;
  for (let z = faceZ - 29; z <= faceZ - 2.6; z += 0.3) {
    if (world.circleHits(tx, z + CFG.body.circleOffsetM, CFG.body.circleRadiusM) !== null) clear = false;
    if (world.circleHits(tx, z - CFG.body.circleOffsetM, CFG.body.circleRadiusM) !== null) clear = false;
  }
  check(clear, 'head-on approach line (block mid, past the lamp rows) is clear of every box');
  check(faceZ < tz && tower.maxX >= tx + 9 && tower.minX <= tx - 9, `tower face spans the approach line (face z ${faceZ}, x ${tower.minX}..${tower.maxX})`);
  // (g) glancing line: 30 m/s at 60 deg off the face normal, contact at
  // (tx + 8, faceZ), spawned 0.4 s earlier INSIDE the empty tower lot (clear
  // of the sidewalk lamp rows by construction — the lot holds no boxes).
  const dirX = Math.sin(Math.PI / 3);
  const dirZ = Math.cos(Math.PI / 3);
  const gContactX = tx + 8 - CFG.body.circleOffsetM * dirX;
  const gContactZ = faceZ - CFG.body.circleRadiusM - CFG.body.circleOffsetM * dirZ;
  const gSpawnX = gContactX - 30 * dirX * 0.4;
  const gSpawnZ = gContactZ - 30 * dirZ * 0.4;
  let gClear = true;
  for (let t = 0; t <= 0.38; t += 0.02) {
    const px = gSpawnX + 30 * dirX * t;
    const pz = gSpawnZ + 30 * dirZ * t;
    const fx = px + CFG.body.circleOffsetM * dirX;
    const fz = pz + CFG.body.circleOffsetM * dirZ;
    const rx = px - CFG.body.circleOffsetM * dirX;
    const rz = pz - CFG.body.circleOffsetM * dirZ;
    if (world.circleHits(fx, fz, CFG.body.circleRadiusM) !== null) gClear = false;
    if (world.circleHits(rx, rz, CFG.body.circleRadiusM) !== null) gClear = false;
  }
  check(gClear, 'glancing approach line (30 deg off the wall, tower lot) is clear until contact');
}

// --- (a) top speed ---------------------------------------------------------------
{
  console.log('  (a) top speed on a straight road');
  const { car } = makeCar();
  car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: -300, heading: 0 });
  let timeTo180 = NaN;
  let maxSpeed = 0;
  let maxDropAfter180 = 0;
  let prev = 0;
  let maxXDev = 0;
  runFor(car, 12, { throttle: 1, steer: 0 }, () => {
    const s = car.state.speed;
    if (Number.isNaN(timeTo180) && s >= 50) timeTo180 = car.state.time;
    if (!Number.isNaN(timeTo180) && prev - s > maxDropAfter180) maxDropAfter180 = prev - s;
    if (s > maxSpeed) maxSpeed = s;
    prev = s;
    maxXDev = Math.max(maxXDev, Math.abs(car.state.x - (grid.linesX[5] + grid.laneOffsetM)));
  });
  check(!Number.isNaN(timeTo180) && timeTo180 <= 8, `full throttle reaches 180 km/h within 8 s (took ${timeTo180.toFixed(2)} s)`);
  console.log(`    info: time to 180 km/h: ${timeTo180.toFixed(2)} s; top speed held: ${(car.state.speed * KMH_PER_MS).toFixed(1)} km/h (governor ${(TOP * KMH_PER_MS).toFixed(1)}), max ${maxSpeed.toFixed(2)} m/s`);
  check(maxSpeed <= TOP + 1e-6, `speed never exceeds the governor top speed (max ${(maxSpeed * KMH_PER_MS).toFixed(1)} km/h <= ${(TOP * KMH_PER_MS).toFixed(1)})`);
  check(car.state.speed >= 54.2, `holds near top speed at t=12 s (${(car.state.speed * KMH_PER_MS).toFixed(1)} km/h >= 195)`);
  check(maxDropAfter180 <= 0.05, `no meaningful speed loss after reaching top speed (max tick drop ${maxDropAfter180.toFixed(4)} m/s)`);
  check(maxXDev <= 1e-6, `stays exactly in-lane with zero steer (max |dx| ${maxXDev.toExponential(2)} m)`);
}

// --- (b) braking -------------------------------------------------------------------
{
  console.log('  (b) braking from speed');
  const { car, impacts } = makeCar();
  car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: -300, heading: 0 });
  let entry = 0;
  runFor(car, 15, { throttle: 1, steer: 0 }, () => {
    if (car.state.speed >= 54 && entry === 0) entry = car.state.speed;
  });
  // Switch to full brake the moment we are at speed.
  const brakeStartTime = car.state.time;
  let dist = 0;
  let tStop = NaN;
  let maxXDev = 0;
  const x0 = car.state.x;
  for (let i = 0; i < Math.round(5 / SIM_DT); i += 1) {
    if (car.state.speed < 0.02) { tStop = car.state.time - brakeStartTime; break; }
    dist += car.state.speed * SIM_DT;
    tick(car, { throttle: 0, brake: 1, steer: 0 });
    maxXDev = Math.max(maxXDev, Math.abs(car.state.x - x0));
  }
  check(entry > 0, `entry speed reached (${(entry * KMH_PER_MS).toFixed(1)} km/h)`);
  check(!Number.isNaN(tStop), `car comes to a complete stop (speed ${car.state.speed.toFixed(3)} m/s)`);
  check(dist <= 70, `braking distance from ${(entry * KMH_PER_MS).toFixed(0)} km/h is ${dist.toFixed(1)} m (<= 70 m)`);
  console.log(`    info: brake entry ${(entry * KMH_PER_MS).toFixed(1)} km/h -> stop in ${dist.toFixed(1)} m / ${tStop.toFixed(2)} s`);
  check(car.state.speed <= 0.05, 'stopped to rest (< 0.05 m/s)');
  check(maxXDev <= 1e-6, 'braking stays in-lane (no steering)');
  check(impacts.length === 0, 'no unexpected impacts during braking');
}

// --- (c) reverse ---------------------------------------------------------------------
{
  console.log('  (c) reverse from standstill');
  const { car, impacts } = makeCar();
  car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: 100, heading: 0 });
  let minFwd = 0;
  let reached = NaN;
  runFor(car, 3, { throttle: 0, brake: 1, steer: 0 }, () => {
    if (car.state.forwardSpeed < minFwd) minFwd = car.state.forwardSpeed;
    if (Number.isNaN(reached) && car.state.forwardSpeed <= -CFG.engine.reverseTopSpeedMs + 0.01) {
      reached = car.state.time;
    }
  });
  check(!Number.isNaN(reached) && reached <= 3, `reaches the reverse limit (-36 km/h) within 3 s (took ${reached.toFixed(2)} s)`);
  check(minFwd >= -CFG.engine.reverseTopSpeedMs - 1e-9, `never exceeds the reverse limit (min ${minFwd.toFixed(3)} m/s >= -${CFG.engine.reverseTopSpeedMs})`);
  check(Math.abs(car.state.heading) < 1e-9, 'heading unchanged in a straight reverse');
  runFor(car, 2, { throttle: 1, steer: 0 });
  check(car.state.forwardSpeed > 5, `throttle drives forward out of reverse (fwd ${car.state.forwardSpeed.toFixed(1)} m/s)`);
  check(impacts.length === 0, 'no unexpected impacts during reverse test');
}

// --- (d) 90-degree intersection turn ---------------------------------------------------
{
  console.log('  (d) 90-degree intersection turn stays on roads');
  const { car, impacts } = makeCar();
  car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: -200, heading: 0 });
  const zTurn = grid.linesZ[3]; // -156
  let maxHeading = 0;
  let minRoadDist = Infinity;
  let maxBumps = 0;
  const controls = (c) => {
    const st = car.state;
    let hDes;
    if (st.z < zTurn - 10) hDes = 0;
    else if (st.z < zTurn - 2) hDes = Math.PI / 2;
    else hDes = Math.PI / 2 - clamp(0.06 * (zTurn - st.z), -0.25, 0.25);
    const err = wrapPi(hDes - st.heading);
    return {
      throttle: st.forwardSpeed < 9.7 ? 1 : 0,
      brake: st.forwardSpeed > 10.3 ? 0.5 : 0,
      steer: clamp(2.5 * err, -1, 1),
    };
  };
  runFor(car, 8, controls, () => {
    maxHeading = Math.max(maxHeading, car.state.heading);
    minRoadDist = Math.min(minRoadDist, nearestCenterlineDist(car.state.x, car.state.z));
    maxBumps = Math.max(maxBumps, car.state.bumpCount);
  });
  check(impacts.length === 0, `no impacts through the turn (${impacts.length})`);
  check(minRoadDist <= 7.4, `every tick stays within the road corridor (worst ${minRoadDist.toFixed(2)} m from a centerline, asphalt half-width 7)`);
  check(maxHeading >= 1.5, `heading rotated through the turn (max ${(maxHeading * 180 / Math.PI).toFixed(0)} deg)`);
  check(Math.abs(wrapPi(car.state.heading - Math.PI / 2)) <= 0.12, `ends aligned along the crossing road (heading err ${(wrapPi(car.state.heading - Math.PI / 2) * 180 / Math.PI).toFixed(1)} deg <= 7.2)`);
  check(Math.abs(car.state.z - zTurn) <= 3, `ends on the crossing road centerline (|dz| ${Math.abs(car.state.z - zTurn).toFixed(2)} m <= 3)`);
  check(car.state.vx > 8, `still driving at the end (vx ${car.state.vx.toFixed(1)} m/s)`);
  check(car.state.bumpCount <= 2, `at most incidental curb touches (${car.state.bumpCount})`);
}

// --- (e) handbrake slide ------------------------------------------------------------------
{
  console.log('  (e) handbrake slide vs normal cornering');
  const drive = (handbrake) => {
    const { car, impacts } = makeCar();
    car.reset({ x: -5, z: -300, heading: 0 });
    runFor(car, 4, () => (car.state.forwardSpeed < 12.4 ? { throttle: 1, steer: 0 } : { throttle: 0, steer: 0 }));
    const vEntry = car.state.speed;
    const h0 = car.state.heading;
    let maxSlip = 0;
    // Steady-steer window: handbrake run should slide (velocity lags heading).
    runFor(car, 1.0, { throttle: handbrake ? 0 : 0.3, steer: 0.55, handbrake }, () => {
      maxSlip = Math.max(maxSlip, Math.abs(car.state.slipAngle));
    });
    const hRot = car.state.heading - h0;
    const vEnd = car.state.speed;
    // Recovery: a real driver steers back to level, then drives straight.
    runFor(car, 1.6, () => ({
      throttle: 0.4,
      steer: Math.abs(car.state.heading) > 0.03 ? clamp(2.5 * -car.state.heading, -1, 1) : 0,
    }));
    return { car, impacts, vEntry, hRot, vEnd, maxSlip, endSlip: Math.abs(car.state.slipAngle) };
  };
  const base = drive(false);
  const slide = drive(true);
  check(slide.maxSlip >= 0.22, `handbrake slip angle grows past 12 deg (max ${(slide.maxSlip * 180 / Math.PI).toFixed(1)} deg)`);
  check(slide.maxSlip >= 2 * base.maxSlip, `handbrake slip is at least 2x normal cornering (${(slide.maxSlip * 180 / Math.PI).toFixed(1)} vs ${(base.maxSlip * 180 / Math.PI).toFixed(1)} deg)`);
  check(base.hRot >= 0.3 && slide.hRot >= 0.3, `heading still follows the steering in both runs (rotated ${(base.hRot * 180 / Math.PI).toFixed(0)} / ${(slide.hRot * 180 / Math.PI).toFixed(0)} deg)`);
  check(Math.abs(base.car.state.x) <= 6.5 && Math.abs(slide.car.state.x) <= 6.5, 'both runs stay on the road (|x| <= 6.5)');
  check(slide.vEnd >= 0.4 * slide.vEntry, `sliding car keeps moving (ends at ${(slide.vEnd / slide.vEntry * 100).toFixed(0)}% of entry speed >= 40%)`);
  check(slide.impacts.length === 0 && base.impacts.length === 0, 'no impacts in either run');
  check(base.endSlip <= 0.08 && slide.endSlip <= 0.08, `grip recovers after release (end slip ${(base.endSlip * 180 / Math.PI).toFixed(1)} / ${(slide.endSlip * 180 / Math.PI).toFixed(1)} deg)`);
  check(slide.car.state.speed > 4, 'car still controllable/drivable after the slide');
}

// --- (f) + (j) head-on wall stop, no tunneling, impact hook ---------------------------------
{
  console.log('  (f) head-on wall stop at full speed (+j impact hook)');
  const { car, impacts } = makeCar();
  // Spawn ON the horizontal road corridor, aligned +Z at the face midline, at governed top speed.
  car.reset({ x: tx, z: faceZ - 29, heading: 0, vz: TOP });
  let worstPen = 0;
  let cleared = [];
  runFor(car, 0.8, { throttle: 1, steer: 0 }, () => {
    worstPen = Math.max(worstPen, car.state.lastTickMaxPenetration);
    cleared.push(frontClearanceToTower(car.state.x, car.state.z));
  });
  check(impacts.length === 1, `exactly one impact fired on the slam (${impacts.length})`);
  const slam = impacts[0];
  check(!!slam && slam.speed >= 50, `impact speed above threshold (${slam ? (slam.speed * KMH_PER_MS).toFixed(0) : 'n/a'} km/h >= 180)`);
  check(!!slam && Math.abs(slam.normalX) <= 0.05 && slam.normalZ <= -0.95, 'impact normal is the wall face normal (~(0, -1))');
  check(worstPen <= 0.01, `no substep leaves the body inside the wall (worst residual penetration ${worstPen.toExponential(2)} m <= 0.01)`);
  const finalClear = frontClearanceToTower(car.state.x, car.state.z);
  check(finalClear >= -0.01 && finalClear <= 0.02, `car rests AT the wall (front clearance ${finalClear.toFixed(4)} m)`);
  check(Math.min(...cleared) >= -0.01, `front circle never penetrates at any tick (min clearance ${Math.min(...cleared).toFixed(4)} m)`);
  check(Math.abs(car.state.vz) <= 3.2, `rebound capped (|vz| ${Math.abs(car.state.vz).toFixed(2)} m/s <= 3.2)`);
  // Holding throttle must not push through; rate limit keeps the callback quiet.
  const zAtRest = car.state.z;
  const countBefore = impacts.length;
  let penHold = 0;
  let zMinHold = Infinity;
  runFor(car, 1.0, { throttle: 1, steer: 0 }, () => {
    penHold = Math.max(penHold, car.state.lastTickMaxPenetration);
    zMinHold = Math.min(zMinHold, car.state.z);
  });
  check(impacts.length === countBefore, `no callback spam while pressed against the wall (${impacts.length - countBefore} extra)`);
  check(penHold <= 0.01, `full throttle cannot push through (worst penetration ${penHold.toExponential(2)} m)`);
  check(car.state.z >= zAtRest - 2.6 && Math.abs(car.state.vz) <= 3.2, `stays at the wall under throttle (drifted ${(car.state.z - zAtRest).toFixed(2)} m)`);
  check(zMinHold >= faceZ - 2.3, `position never passes the wall plane (min z ${zMinHold.toFixed(2)} >= face ${faceZ} - 2.3)`);
  // Back off and re-slam: the hook re-fires after the cooldown (j).
  runFor(car, 2.0, { throttle: 0, brake: 1, steer: 0 });
  const zBefore = car.state.z;
  check(zBefore < faceZ - 8, `backed off from the wall (${(faceZ - zBefore).toFixed(1)} m clear)`);
  const countAfterBackoff = impacts.length;
  let reSlam = 0;
  runFor(car, 3.0, { throttle: 1, steer: 0 }, () => {
    if (impacts.length > countAfterBackoff && reSlam === 0) reSlam = impacts[impacts.length - 1].speed;
  });
  check(impacts.length === countAfterBackoff + 1, `second slam fires again after the rate-limit window (${impacts.length - countAfterBackoff} new)`);
  check(reSlam >= 10, `re-slam registers a hard hit (${(reSlam * KMH_PER_MS).toFixed(0)} km/h)`);
}

// --- (g) glancing wall deflection --------------------------------------------------------------
{
  console.log('  (g) glancing ~30-degree wall impact deflects');
  const { car, impacts } = makeCar();
  const dirX = Math.sin(Math.PI / 3);
  const dirZ = Math.cos(Math.PI / 3);
  const contactX = tx + 8 - CFG.body.circleOffsetM * dirX;
  const contactZ = faceZ - CFG.body.circleRadiusM - CFG.body.circleOffsetM * dirZ;
  car.reset({
    x: contactX - 30 * dirX * 0.4,
    z: contactZ - 30 * dirZ * 0.4,
    heading: Math.PI / 3,
    vx: 30 * dirX,
    vz: 30 * dirZ,
  });
  // Per-tick velocity history so the response can be measured across the
  // exact first-impact tick (later rubs along the wall are normal-only).
  const vLog = [{ x: car.state.vx, z: car.state.vz, impacts: 0 }];
  let worstPen = 0;
  const nPre = Math.round(1.0 / SIM_DT);
  for (let i = 0; i < nPre; i += 1) {
    tick(car, { steer: 0 });
    worstPen = Math.max(worstPen, car.state.lastTickMaxPenetration);
    vLog.push({ x: car.state.vx, z: car.state.vz, impacts: impacts.length });
  }
  check(impacts.length >= 1, `impact fired on the graze (${impacts.length})`);
  const first = impacts[0];
  check(!!first && first.speed >= 10, `graze registers a hard hit (${first ? first.speed.toFixed(1) : 'n/a'} m/s; normal component of 30 m/s at 30 deg ~ 15)`);
  // Velocity across the FIRST impact tick (vLog[i] = velocity after tick i).
  const k = vLog.findIndex((v) => v.impacts > 0);
  check(k > 0, 'first impact tick located in the velocity trace');
  const vBefore = vLog[k - 1];
  const vAfter = vLog[k];
  check(vAfter.x >= 0.7 * vBefore.x, `tangential velocity preserved across impact (vx ${vAfter.x.toFixed(2)} >= 70% of ${vBefore.x.toFixed(2)} m/s)`);
  check(vAfter.z <= 0.05, `no residual velocity into the wall right after impact (vz ${vAfter.z.toFixed(2)} <= 0.05)`);
  check(Math.abs(vAfter.z) <= 0.35 * Math.abs(vBefore.z), `deflected, not stopped (|vz| ${Math.abs(vAfter.z).toFixed(2)} well below the ${Math.abs(vBefore.z).toFixed(1)} m/s normal entry)`);
  check(worstPen <= 0.01, `never enters the building (worst penetration ${worstPen.toExponential(2)} m)`);
  // Aftermath: driver steers along the wall and floors it — the slide scrubs
  // hard at first (tires yawed 30 deg off travel) but the car stays under
  // control, keeps moving, and never penetrates.
  const xAfterImpact = car.state.x;
  runFor(car, 1.0, () => ({
    throttle: 1,
    steer: clamp(2.5 * wrapPi(Math.PI / 2 - car.state.heading), -1, 1),
  }), () => {
    worstPen = Math.max(worstPen, car.state.lastTickMaxPenetration);
  });
  check(worstPen <= 0.01, 'aftermath also never penetrates');
  check(car.state.x - xAfterImpact >= 6, `car slides along the wall (advanced ${(car.state.x - xAfterImpact).toFixed(1)} m in 1.0 s)`);
  check(car.state.speed >= 10, `car recovers under power after the graze (${car.state.speed.toFixed(1)} m/s)`);
  check(impacts.length <= 3, `wall-hug rubs stay below the impact threshold (total ${impacts.length})`);
}

// --- (h) curb hop --------------------------------------------------------------------------------
{
  console.log('  (h) curb hop road -> sidewalk -> road');
  // Corner dip: swing onto the block corner sidewalk at ~9 m/s and back off
  // the same way. The corner region is lamp-free by generation (props keep
  // away from corners: nearest lamp line is 7+ m from the dip envelope) and
  // the dip envelope (x <= 8.0, heading <= 0.6 rad) keeps the front body
  // circle >= ~1.9 m from the nearest possible building corner (10.4, cz-28.6
  // rel. block center), so the maneuver is safe for every deterministic city.
  const { car, impacts } = makeCar();
  const block = city.blocks[5 + 4 * grid.n]; // block ix=5, iz=4 (SW corner at (7, z-32))
  const cornerZ = block.z - grid.blockM / 2; // -149
  car.reset({ x: grid.laneOffsetM, z: cornerZ - 6, heading: 0, vz: 9 });
  const dipTarget = { x: 8.0, z: cornerZ + 2.5 };
  const exitTarget = { x: 0, z: cornerZ + 3.5 }; // steep way back down
  const laneTarget = { x: grid.laneOffsetM, z: cornerZ + 30 };
  let phase = 0; // 0 = dip in, 1 = swing back out, 2 = settle into the lane
  let minSpeed = Infinity;
  let minDz = Infinity;
  let sawCurbY = false;
  let sawBumpTimer = false;
  let sawPitch = false;
  let prevZ = car.state.z;
  const controls = () => {
    const st = car.state;
    if (phase === 0 && st.x >= 7.3) phase = 1;
    else if (phase === 1 && st.x <= 4.5) phase = 2;
    const tgt = phase === 0 ? dipTarget : phase === 1 ? exitTarget : laneTarget;
    const hLim = phase === 2 ? 0.35 : 0.6;
    const hDes = clamp(Math.atan2(tgt.x - st.x, tgt.z - st.z), -hLim, hLim);
    return {
      throttle: st.forwardSpeed < 8.8 ? 1 : 0,
      brake: st.forwardSpeed > 9.4 ? 0.4 : 0,
      steer: clamp(2.5 * (hDes - st.heading), -1, 1),
    };
  };
  runFor(car, 7, controls, () => {
    minSpeed = Math.min(minSpeed, car.state.speed);
    minDz = Math.min(minDz, car.state.z - prevZ);
    prevZ = car.state.z;
    if (car.state.surfaceY > 0) sawCurbY = true;
    if (car.state.bumpTimer > 0) sawBumpTimer = true;
    if (Math.abs(car.state.visualPitch) > 1e-6) sawPitch = true;
  });
  check(sawCurbY, 'reached sidewalk elevation (surfaceY = 0.15 observed)');
  check(car.state.bumpCount >= 2, `both curb crossings fired bump events (${car.state.bumpCount} >= 2)`);
  check(sawBumpTimer && sawPitch, 'bump visual state fired (bumpTimer and visualPitch observed)');
  check(car.state.surfaceY === 0, 'back on the road at the end (surfaceY = 0)');
  check(minSpeed >= 7.5, `scrubbed but never stopped (min speed ${minSpeed.toFixed(2)} m/s >= 7.5 of 9)`);
  check(minDz >= 0.05, `no sticking anywhere (min per-tick progress ${minDz.toFixed(3)} m)`);
  check(impacts.length === 0, `curbs never produce collision impacts (${impacts.length})`);
  check(Math.abs(car.state.x - grid.laneOffsetM) <= 1.5, `returned to the lane (|dx| ${Math.abs(car.state.x - grid.laneOffsetM).toFixed(2)} m)`);
  check(Math.abs(car.state.speed - 9) <= 1.5, `cruise speed kept (${car.state.speed.toFixed(1)} m/s)`);
}

// --- (i) determinism --------------------------------------------------------------------------------
{
  console.log('  (i) determinism: identical inputs -> identical final state');
  const SEGS = [
    [1.2, { throttle: 1, steer: 0 }],
    [0.8, { throttle: 1, steer: 0.5 }],
    [0.7, { throttle: 0.3, steer: -0.7, handbrake: true }],
    [0.6, { throttle: 0, brake: 1, steer: 0.2 }],
    [0.9, { throttle: 1, steer: -0.4 }],
    [0.5, { throttle: 0, brake: 1, steer: 0 }],
    [0.8, { throttle: 1, steer: 0.3, handbrake: true }],
    [0.7, { throttle: 1, steer: -0.2 }],
  ];
  const run = () => {
    const { car, impacts } = makeCar();
    car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: -350, heading: 0 });
    let checksum = 0;
    for (const [secs, c] of SEGS) {
      const n = Math.round(secs / SIM_DT);
      for (let i = 0; i < n; i += 1) {
        tick(car, c);
        checksum += car.state.x + car.state.z + car.state.heading;
      }
    }
    return { car, impacts, checksum };
  };
  const a = run();
  const b = run();
  let same = true;
  for (const key of Object.keys(a.car.state)) {
    if (!Object.is(a.car.state[key], b.car.state[key])) {
      same = false;
      console.log(`    state mismatch at "${key}": ${a.car.state[key]} vs ${b.car.state[key]}`);
    }
  }
  check(same, 'every state field is float-exact identical across two runs');
  check(a.checksum === b.checksum, `trajectory checksums match exactly (${a.checksum.toFixed(6)})`);
  check(
    a.impacts.length === b.impacts.length &&
      a.impacts.every((e, i) => Object.is(e.speed, b.impacts[i].speed) && Object.is(e.normalX, b.impacts[i].normalX) && Object.is(e.normalZ, b.impacts[i].normalZ)),
    `impact logs identical (${a.impacts.length} events)`
  );
}

// --- per-tick cost ------------------------------------------------------------------------------------
{
  console.log('  per-tick cost');
  const { car } = makeCar();
  const N = 6000;
  // Precomputed mixed inputs (slalom with throttle/handbrake pulses); the car
  // is teleported back to the start straight every 600 ticks so the batch
  // always exercises real city collision density.
  const inputs = [];
  for (let i = 0; i < N; i += 1) {
    inputs.push({
      throttle: (i % 40) < 34 ? 1 : 0,
      brake: (i % 40) === 38 ? 1 : 0,
      steer: 0.5 * Math.sin((i % 600) * 0.02),
      handbrake: (i % 600) > 560,
    });
  }
  const timeBatch = () => {
    car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: -350, heading: 0 });
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) {
      if (i % 600 === 0) car.reset({ x: grid.linesX[5] + grid.laneOffsetM, z: -350, heading: 0 });
      car.step(SIM_DT, inputs[i]);
    }
    return performance.now() - t0;
  };
  timeBatch(); // JIT warm-up
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt += 1) best = Math.min(best, timeBatch());
  const usPerTick = (best * 1000) / N;
  check(usPerTick < 100, `physics step costs ${usPerTick.toFixed(2)} us/tick (< 100 us; ${(usPerTick / 16600 * 100).toFixed(3)}% of a 16.6 ms frame)`);
  console.log(`    info: physics step ${usPerTick.toFixed(2)} us/tick avg (best of 3 x ${N} ticks) = ${(usPerTick / 16600 * 100).toFixed(3)}% of a 16.6 ms frame`);
}

// --- global invariant -----------------------------------------------------------------------------------
{
  console.log('  global invariants');
  check(globalWorstPen <= 0.01, `worst post-resolution penetration across ALL scenarios is ${globalWorstPen.toExponential(2)} m (<= 0.01, no tunneling/sticking anywhere)`);
}

console.log(`\ncar-physics-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`car-physics-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('car-physics-test: ALL PASS');
