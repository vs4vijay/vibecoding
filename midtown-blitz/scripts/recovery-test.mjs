#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/recovery.js (task 3.3).
 *
 * Plain-node asserts over the two exports, mirroring how main.js uses them:
 *
 *   1. findNearestRoadPosition — every queried point (block interior, points
 *      near a vertical road, near a horizontal road, city corner, far out of
 *      bounds) lands ON a road: on a centerline (within road width, hence
 *      surfaceHeightAt == 0 via the real collision world), inside the world
 *      bounds, with a heading aligned to the chosen road's direction.
 *   2. Nearest-line choice — a point clearly closer to a horizontal road
 *      resets onto the horizontal line (and the mirror case for vertical),
 *      with the matching road-aligned heading.
 *   3. Determinism — repeated calls (and a deterministic 500-point sweep
 *      across and beyond the whole map) give identical, always-on-road
 *      results.
 *   4. createStuckMonitor — stationary + throttle held fires isStuck /
 *      promptVisible at ~2 s (not at 1.9 s); releasing the throttle clears
 *      it immediately; moving with throttle never sticks; parked without
 *      throttle never sticks; sustained penetration (embed) fires at ~2 s;
 *      leaving the drivable bounds fires IMMEDIATELY; reset() clears; a
 *      stuckMonitor.reset() mirrors what main.js does on R.
 *
 * Run: node scripts/recovery-test.mjs   (plain node, no dependencies)
 */
import { generateCity, GRID_N, ROAD_M } from '../src/game/city-gen.js';
import { createCollisionWorld } from '../src/game/collision.js';
import { createRng } from '../src/engine/rng.js';
import { findNearestRoadPosition, createStuckMonitor } from '../src/game/recovery.js';

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

/** Wrap an angle into [0, PI) modulo PI (road-axis alignment test helper). */
function modPi(angle) {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  return a;
}

console.log('recovery-test: reset targeting + stuck detection verification\n');

// --- shared fixtures -----------------------------------------------------------
const city = generateCity();
const world = createCollisionWorld(city); // real surfaceHeightAt cross-check
const { grid, blocks, world: bounds } = city;
const rng = createRng('recovery-test-v1');
const DT = 1 / 60;

/**
 * Common on-road assertions for any result: on a centerline of the axis the
 * heading declares, inside road width, on flat asphalt, in bounds.
 * @param {{x: number, z: number, heading: number}} res Reset target.
 * @param {string} label Context for failure messages.
 * @returns {boolean} True when every sub-assertion passed.
 */
function checkOnRoad(res, label) {
  const vertical = modPi(res.heading) === 0; // heading 0 or PI -> along z
  const okAxis = vertical || Math.abs(modPi(res.heading) - Math.PI / 2) < 1e-9;
  check(okAxis, `${label}: heading ${res.heading} is aligned with a road axis`);
  // The position sits exactly on the nearest centerline of its axis.
  const nearestLine = vertical
    ? grid.linesX.reduce((a, b) => (Math.abs(b - res.x) < Math.abs(a - res.x) ? b : a))
    : grid.linesZ.reduce((a, b) => (Math.abs(b - res.z) < Math.abs(a - res.z) ? b : a));
  const onLine = vertical
    ? Math.abs(res.x - nearestLine) <= 1e-9
    : Math.abs(res.z - nearestLine) <= 1e-9;
  check(onLine, `${label}: lies on a road centerline (offset ${vertical ? Math.abs(res.x - nearestLine) : Math.abs(res.z - nearestLine)} m <= ${ROAD_M / 2} m road half-width)`);
  check(world.surfaceHeightAt(res.x, res.z) === 0, `${label}: surfaceHeightAt is 0 (drivable asphalt, not a curb/block surface)`);
  const inBounds =
    res.x >= bounds.minX - 1e-9 && res.x <= bounds.maxX + 1e-9 &&
    res.z >= bounds.minZ - 1e-9 && res.z <= bounds.maxZ + 1e-9;
  check(inBounds, `${label}: stays inside the world bounds`);
  return onLine && okAxis;
}

// --- 1. Targeted cases from the task text ---------------------------------------
{
  console.log('  findNearestRoadPosition targeted cases');
  // (a) Block interior: block (0,0) center sits mid-block; nearest road wins.
  const b0 = blocks[0];
  const resBlock = findNearestRoadPosition(city, b0.x, b0.z);
  checkOnRoad(resBlock, 'block-interior point');
  check(resBlock.x === grid.linesX[0] || resBlock.x === grid.linesX[1] || resBlock.z === grid.linesZ[0] || resBlock.z === grid.linesZ[1],
    'block-interior point resets onto one of the surrounding roads');

  // (b) Near a vertical road: 5 m east of linesX[3], far from any z line.
  const zNear = grid.linesZ[4] + 22; // 22 m off linesZ[4], 56 m off linesZ[5]
  const xNearV = grid.linesX[3] + 5;
  const resV = findNearestRoadPosition(city, xNearV, zNear);
  checkOnRoad(resV, 'near-vertical-road point');
  check(Math.abs(resV.x - grid.linesX[3]) <= 1e-9, `near-vertical point clamps to the nearest vertical centerline (x = ${resV.x})`);
  check(Math.abs(resV.z - zNear) <= 1e-9, 'near-vertical point keeps z (projected onto the vertical road)');
  check(resV.heading === 0, 'vertical road reset faces along the road (+Z, heading 0)');

  // (c) City corner far out of bounds: still lands on a real road.
  const resCorner = findNearestRoadPosition(city, bounds.minX - 500, bounds.minZ - 500);
  checkOnRoad(resCorner, 'far-out-of-bounds corner point');
  check(Math.abs(resCorner.x - grid.linesX[0]) <= 1e-9 && Math.abs(resCorner.z - grid.linesZ[0]) <= 1e-9,
    'corner point lands on the outermost intersection');

  // (d) Astronomically out of bounds: clamped onto the grid.
  const resFar = findNearestRoadPosition(city, 1e6, -1e6);
  checkOnRoad(resFar, 'astronomically out-of-bounds point');
  check(Math.abs(resFar.x - grid.linesX[GRID_N]) <= 1e-9 && Math.abs(resFar.z - grid.linesZ[0]) <= 1e-9,
    'far point clamps to the grid edge (max x line, min z line)');
}

// --- 2. Nearest-line choice (horizontal vs vertical) ------------------------------
{
  console.log('  nearest-line choice');
  // Clearly closer to a HORIZONTAL road: 5 m off linesZ[4], 30 m off linesX[2].
  const xCloserH = grid.linesX[2] + 30;
  const zCloserH = grid.linesZ[4] + 5;
  const resH = findNearestRoadPosition(city, xCloserH, zCloserH);
  checkOnRoad(resH, 'horizontal-closer point');
  check(Math.abs(resH.z - grid.linesZ[4]) <= 1e-9, `point closer to a horizontal road resets onto it (z = ${resH.z} = linesZ[4])`);
  check(Math.abs(resH.x - xCloserH) <= 1e-9, 'horizontal reset keeps x (projected onto the horizontal road)');
  check(Math.abs(resH.heading - Math.PI / 2) <= 1e-9, 'horizontal road reset faces along the road (+X, heading PI/2)');

  // Mirror: closer to a VERTICAL road -> vertical line wins despite the
  // horizontal candidate existing.
  const xCloserV = grid.linesX[5] + 4;
  const zCloserV = grid.linesZ[6] + 30;
  const resV2 = findNearestRoadPosition(city, xCloserV, zCloserV);
  check(Math.abs(resV2.x - grid.linesX[5]) <= 1e-9, 'mirror case: vertical-closer point resets onto the vertical line');
  check(resV2.heading === 0, 'mirror case: heading along the vertical road');

  // Deterministic tie-breaks: exact inter-axis tie picks the vertical road;
  // exact between-two-lines pick keeps the lower index.
  const mid = blocks[13]; // some interior block
  const tie = findNearestRoadPosition(city, mid.x, mid.z);
  check(tie.heading === 0, 'inter-axis distance tie resolves to the vertical road (heading 0, documented tie-break)');
  const again = findNearestRoadPosition(city, mid.x, mid.z);
  check(tie.x === again.x && tie.z === again.z && tie.heading === again.heading, 'repeated identical queries give identical results');
}

// --- 3. Deterministic sweep over the whole map ------------------------------------
{
  console.log('  deterministic 500-point sweep');
  let badRoad = 0;
  let badHeading = 0;
  for (let i = 0; i < 500; i += 1) {
    const x = rng.float(bounds.minX - 200, bounds.maxX + 200);
    const z = rng.float(bounds.minZ - 200, bounds.maxZ + 200);
    const res = findNearestRoadPosition(city, x, z);
    const vertical = modPi(res.heading) === 0;
    const distToLine = vertical ? Math.abs(res.x - grid.linesX.reduce((a, b) => (Math.abs(b - res.x) < Math.abs(a - res.x) ? b : a)))
                                : Math.abs(res.z - grid.linesZ.reduce((a, b) => (Math.abs(b - res.z) < Math.abs(a - res.z) ? b : a)));
    if (distToLine > ROAD_M / 2 || world.surfaceHeightAt(res.x, res.z) !== 0) badRoad += 1;
    const aligned = vertical ? true : Math.abs(modPi(res.heading) - Math.PI / 2) < 1e-9;
    if (!aligned) badHeading += 1;
  }
  check(badRoad === 0, `all 500 random points (incl. 200 m outside the map) land on drivable road (${badRoad} failures)`);
  check(badHeading === 0, `all sweep headings align with their road's direction (${badHeading} failures)`);
}

// --- 4. Stuck monitor: stationary + throttle --------------------------------------
{
  console.log('  stuck monitor: stationary despite throttle fires at ~2 s');
  const m = createStuckMonitor({ bounds });
  // 114 ticks = 1.9 s of full throttle at zero speed (wedged): not yet stuck.
  for (let t = 0; t < 114; t += 1) {
    m.update(DT, { x: 0, z: -117, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 1 });
  }
  check(!m.isStuck(), `not stuck after 1.9 s of throttle-at-zero-speed (timer ${m.stuckTimer().toFixed(2)} s)`);
  check(!m.promptVisible(), 'prompt not visible before the threshold');
  // 7 more ticks (2.017 s total): the sustained threshold must have fired.
  for (let t = 0; t < 7; t += 1) {
    m.update(DT, { x: 0, z: -117, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 1 });
  }
  check(m.isStuck(), `stuck fires by ~2 s of sustained throttle-at-zero-speed (timer ${m.stuckTimer().toFixed(2)} s)`);
  check(m.promptVisible(), 'promptVisible tracks the stuck state (reset prompt would show)');
  check(Math.abs(m.stuckTimer() - 2) <= 1e-9, 'stuckTimer saturates at stuckTimeS (2 s)');

  // Releasing the throttle clears the stuck state on the next tick (player
  // gave up -> parked, not stuck).
  m.update(DT, { x: 0, z: -117, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 0 });
  check(!m.isStuck() && !m.promptVisible(), 'releasing the throttle clears the stuck state immediately');
  check(m.stuckTimer() === 0, 'timer resets to 0 when no stuck condition holds');

  // reset() (what main.js does when the player presses R) clears too.
  for (let t = 0; t < 130; t += 1) {
    m.update(DT, { x: 0, z: -117, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 1 });
  }
  check(m.isStuck(), 'stuck again after another 2+ s wedged');
  m.reset();
  check(!m.isStuck() && !m.promptVisible() && m.stuckTimer() === 0, 'monitor reset() clears the stuck state (post-R cleanup)');
}

// --- 5. Stuck monitor: non-stuck driving -------------------------------------------
{
  console.log('  stuck monitor: driving and parking never stick');
  const m = createStuckMonitor({ bounds });
  // 5 s of normal driving at speed with throttle held.
  for (let t = 0; t < 300; t += 1) {
    m.update(DT, { x: 0, z: -117 + t * 0.5, speed: 30, lastTickMaxPenetration: 0 }, { throttle: 1 });
  }
  check(!m.isStuck(), '5 s of moving-with-throttle never sticks');
  // 5 s parked (zero throttle, zero speed).
  for (let t = 0; t < 300; t += 1) {
    m.update(DT, { x: 0, z: -117, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 0 });
  }
  check(!m.isStuck(), '5 s parked without throttle never sticks (not "flipped")');
  // Reverse creeping / crawl below threshold WITH throttle still moves: speed
  // at threshold boundary counts as moving (strict <).
  for (let t = 0; t < 300; t += 1) {
    m.update(DT, { x: 0, z: 0, speed: 0.5, lastTickMaxPenetration: 0 }, { throttle: 1 });
  }
  check(!m.isStuck(), 'speed exactly at the threshold counts as moving (no false stick)');
}

// --- 6. Stuck monitor: embed + out-of-bounds ---------------------------------------
{
  console.log('  stuck monitor: embed and out-of-bounds triggers');
  const m = createStuckMonitor({ bounds });
  // Sustained residual penetration (an embed the resolver cannot clear),
  // even without throttle: fires at ~2 s.
  for (let t = 0; t < 114; t += 1) {
    m.update(DT, { x: 0, z: 0, speed: 0, lastTickMaxPenetration: 0.1 }, { throttle: 0 });
  }
  check(!m.isStuck(), 'sustained embed not yet stuck at 1.9 s');
  for (let t = 0; t < 7; t += 1) {
    m.update(DT, { x: 0, z: 0, speed: 0, lastTickMaxPenetration: 0.1 }, { throttle: 0 });
  }
  check(m.isStuck(), 'sustained embed (penetration > 0.05 m) fires stuck at ~2 s without throttle');
  // Sub-threshold penetration is a non-event.
  m.update(DT, { x: 0, z: 0, speed: 0, lastTickMaxPenetration: 0.01 }, { throttle: 0 });
  check(!m.isStuck(), 'penetration at/below the threshold does not accumulate stuck');

  // Out of drivable bounds: IMMEDIATE stuck (same tick), clears on return.
  m.reset();
  m.update(DT, { x: bounds.maxX + 6, z: 0, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 0 });
  check(m.isStuck() && m.promptVisible(), 'leaving the drivable world bounds fires the prompt immediately');
  check(m.outOfBounds(), 'outOfBounds flag is reported');
  m.update(DT, { x: 0, z: -117, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 0 });
  check(!m.isStuck() && !m.outOfBounds(), 'returning in bounds clears the out-of-bounds stuck state');

  // Margin slack: exactly on the bound (+ margin) is still drivable.
  m.reset();
  m.update(DT, { x: bounds.maxX + 1, z: bounds.maxZ + 1, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 0 });
  check(!m.outOfBounds(), 'position within the out-of-bounds margin counts as drivable');

  // Monitor without bounds works (out-of-bounds trigger disabled).
  const noBounds = createStuckMonitor();
  noBounds.update(DT, { x: 1e9, z: 1e9, speed: 0, lastTickMaxPenetration: 0 }, { throttle: 1 });
  check(!noBounds.outOfBounds(), 'a bounds-less monitor never reports out-of-bounds');
}

console.log(`\nrecovery-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`recovery-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('recovery-test: ALL PASS');
