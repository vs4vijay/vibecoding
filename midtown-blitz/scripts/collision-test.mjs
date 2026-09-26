#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/collision.js (task 2.3).
 *
 * Builds the collision world from the generated layout (generateCity(),
 * fixed seed) and checks it with plain-node asserts:
 *
 *   1. Build + registration — every building and every blocking prop is
 *      indexed exactly once (stats match layout counts), hash cells are
 *      healthy, and the build itself is fast (< 100 ms).
 *   2. Building interiors — a circle query inside a known building
 *      footprint (the tower landmark + a regular building) hits that
 *      building's AABB.
 *   3. Props — circle queries at lamp post / tree trunk positions (layout
 *      coords + collisionRadius) hit their thin AABBs; a probe just past
 *      the box misses it; boxes carry the expected shape and y extent.
 *   4. Road centers clear — lane-center points (grid midpoints offset by
 *      laneOffsetM) and intersection centers along every road segment are
 *      hit-free at car radius, and `circleHits` returns null (not []).
 *   5. Cross-validation — 2000 random circle queries and 600 random
 *      capsule queries return EXACTLY the same hit sets as brute-force
 *      scans over all AABBs (validates hash coverage vs the math).
 *   6. Surface elevation — surfaceHeightAt: intersections/lane points 0,
 *      block centers + sidewalk ring + curb line 0.15, road margin 0.
 *   7. Performance — 10k circle queries in < 5 ms total (well under a
 *      16.6 ms frame); capsule and overlapsSolid batches likewise.
 *   8. Capsule semantics — a two-circle body straddling a building edge
 *      hits; a long segment crossing a building with both endpoints well
 *      outside still hits (exact segment test); an empty-lane capsule
 *      hits nothing.
 *   9. addAabb — registering a parked car post-construction makes it
 *      solid to queries without invalidating existing indices (seam for
 *      task 4.3).
 *
 * Run: node scripts/collision-test.mjs   (plain node, no dependencies)
 */
import { performance } from 'node:perf_hooks';

import { generateCity, CURB_M, GRID_N } from '../src/game/city-gen.js';
import { createCollisionWorld, HASH_CELL_M, COLLISION_VERSION } from '../src/game/collision.js';
import { createRng } from '../src/engine/rng.js';

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
 * Compare two hit-index sets for exact equality (order-insensitive).
 * @param {number[] | null} a Hash-query result (shared buffer or null).
 * @param {number[]} b Brute-force result (ascending).
 * @returns {boolean} True when the sets are identical.
 */
function sameHitSets(a, b) {
  if (a === null || a === undefined) return b.length === 0;
  if (a.length !== b.length) return false;
  const sa = [...a].sort((p, q) => p - q);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== b[i]) return false;
  }
  return true;
}

console.log('collision-test: static collision world verification\n');

// --- shared fixtures -----------------------------------------------------------
const city = generateCity();
const tBuild = performance.now();
const world = createCollisionWorld(city);
const buildMs = performance.now() - tBuild;
const { grid, props, blocks, counts, world: worldBounds, landmark } = city;
const rng = createRng('collision-test-v1');
const CAR_RADIUS = 1.5; // typical car-body circle radius for clearance probes

/** Brute-force circle hit set over all AABBs (independent of the hash). */
function bruteCircleHits(x, z, r) {
  const rSq = r * r;
  const out = [];
  for (let i = 0; i < world.aabbs.length; i += 1) {
    const b = world.aabbs[i];
    const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
    const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
    if (dx * dx + dz * dz <= rSq) out.push(i);
  }
  return out;
}

/** Squared distance between two closed segments (independent impl for brute force). */
function bruteSegSegDistSq(p1x, p1z, q1x, q1z, p2x, p2z, q2x, q2z) {
  const d1x = q1x - p1x, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2z = q2z - p2z;
  const rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  const c = d1x * rx + d1z * rz;
  const b = d1x * d2x + d1z * d2z;
  const EPS = 1e-12;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  let s;
  let t;
  if (a <= EPS) {
    s = 0;
    t = e > EPS ? clamp01(f / e) : 0;
  } else if (e <= EPS) {
    t = 0;
    s = clamp01(-c / a);
  } else {
    const denom = a * e - b * b;
    s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp01(-c / a); }
    else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  }
  const dx = p1x + d1x * s - (p2x + d2x * t);
  const dz = p1z + d1z * s - (p2z + d2z * t);
  return dx * dx + dz * dz;
}

/** Brute-force capsule hit set over all AABBs (independent of the hash). */
function bruteCapsuleHits(x1, z1, x2, z2, r) {
  const rSq = r * r;
  const out = [];
  const inside = (x, z, b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  for (let i = 0; i < world.aabbs.length; i += 1) {
    const b = world.aabbs[i];
    if (inside(x1, z1, b) || inside(x2, z2, b)) {
      out.push(i);
      continue;
    }
    const top = bruteSegSegDistSq(x1, z1, x2, z2, b.minX, b.maxZ, b.maxX, b.maxZ);
    const bottom = bruteSegSegDistSq(x1, z1, x2, z2, b.minX, b.minZ, b.maxX, b.minZ);
    const left = bruteSegSegDistSq(x1, z1, x2, z2, b.minX, b.minZ, b.minX, b.maxZ);
    const right = bruteSegSegDistSq(x1, z1, x2, z2, b.maxX, b.minZ, b.maxX, b.maxZ);
    if (Math.min(top, bottom, left, right) <= rSq) out.push(i);
  }
  return out;
}

// --- lane-center sample points on the road network (used by sections 4, 6, 7) ---
/** @type {number[][]} [x, z] pairs at lane centers, open asphalt everywhere. */
const lanePoints = [];
for (let i = 0; i <= GRID_N; i += 1) {
  for (let j = 0; j < GRID_N; j += 1) {
    for (const t of [0.25, 0.5, 0.75]) {
      const z = grid.linesZ[j] + (grid.linesZ[j + 1] - grid.linesZ[j]) * t;
      lanePoints.push([grid.linesX[i] + grid.laneOffsetM, z]);
      lanePoints.push([grid.linesX[i] - grid.laneOffsetM, z]);
      const x = grid.linesX[j] + (grid.linesX[j + 1] - grid.linesX[j]) * t;
      lanePoints.push([x, grid.linesZ[i] + grid.laneOffsetM]);
      lanePoints.push([x, grid.linesZ[i] - grid.laneOffsetM]);
    }
  }
}

// --- 1. Build + registration ---------------------------------------------------
{
  console.log('  build + registration');
  check(world.version === COLLISION_VERSION, `world reports version ${COLLISION_VERSION}`);
  check(world.cellSizeM === HASH_CELL_M && HASH_CELL_M >= 16 && HASH_CELL_M <= 32, `hash cell size ${HASH_CELL_M} m inside the 16-32 m design range`);
  check(world.aabbCount === counts.buildings + counts.props, `aabb count ${world.aabbCount} = buildings ${counts.buildings} + props ${counts.props}`);
  check(world.stats.buildings === counts.buildings, `stats.buildings matches layout counts (${counts.buildings})`);
  check(world.stats.props === counts.props, `stats.props matches layout counts (${counts.props} — all props carry collisionRadius > 0)`);
  check(world.stats.cells >= GRID_N * GRID_N, `hash occupies ${world.stats.cells} cells (>= one per block)`);
  check(world.stats.avgPerCell < 5 && world.stats.maxPerCell < 20, `hash is well spread (avg ${world.stats.avgPerCell.toFixed(2)}, max ${world.stats.maxPerCell} per cell)`);
  check(buildMs < 100, `world build is fast (took ${buildMs.toFixed(1)} ms)`);
  // Elevation contract data present.
  check(Math.abs(grid.curbM - CURB_M) <= 1e-9 && grid.curbM > 0 && grid.curbM < 0.5, `curb step is the low bump-over height ${CURB_M} m`);
}

// --- 2. Building interiors hit ---------------------------------------------------
{
  console.log('  building interiors are solid');
  // (a) the tower landmark: query dead center of its known footprint.
  const towerBuilding = blocks[landmark.blockIndex].buildings[landmark.buildingIndex];
  const towerIdx = world.aabbs.findIndex((r) => r.ref === towerBuilding);
  check(towerIdx >= 0, 'tower building is registered in the world');
  const towerRec = world.aabbs[towerIdx];
  check(
    Math.abs(towerRec.minX - (towerBuilding.x - towerBuilding.w / 2)) <= 1e-9 &&
    Math.abs(towerRec.maxZ - (towerBuilding.z + towerBuilding.d / 2)) <= 1e-9,
    'tower AABB footprint matches its layout rect (x/z/w/d)'
  );
  check(
    Math.abs(towerRec.minY - blocks[landmark.blockIndex].surfaceY) <= 1e-9 &&
    Math.abs(towerRec.maxY - (blocks[landmark.blockIndex].surfaceY + towerBuilding.height)) <= 1e-9,
    `tower AABB spans block surface -> surface+height (${towerRec.minY} -> ${towerRec.maxY} m)`
  );
  const centerHits = world.circleHits(towerBuilding.x, towerBuilding.z, 1);
  check(!!centerHits && centerHits.includes(towerIdx), `circle query inside the tower footprint hits it (r=1 at ${towerBuilding.x}, ${towerBuilding.z})`);
  // (a) a regular building too.
  const regBlock = blocks.find((b) => b.type === 'buildings' && b.buildings.length > 0);
  const regB = regBlock.buildings[0];
  const regIdx = world.aabbs.findIndex((r) => r.ref === regB);
  const regHits = world.circleHits(regB.x, regB.z, 0.75);
  check(regIdx >= 0 && !!regHits && regHits.includes(regIdx), `circle query inside a regular building hits it (${regB.w}x${regB.d} m footprint)`);
  check([...(regHits || [])].every((i) => world.aabbs[i].tag === 'building'), 'building-interior hits are all building-tagged boxes');
}

// --- 3. Props hit (lamp posts, trees) --------------------------------------------
{
  console.log('  lamp posts and trees are solid');
  const lamps = props.filter((p) => p.kind === 'lamp');
  const trees = props.filter((p) => p.kind === 'tree');
  let lampHits = 0;
  let lampMisses = 0;
  for (const lamp of lamps.slice(0, 25)) {
    const idx = world.aabbs.findIndex((r) => r.ref === lamp);
    const hits = world.circleHits(lamp.x, lamp.z, lamp.collisionRadius);
    if (idx >= 0 && hits && hits.includes(idx)) lampHits += 1;
    // A probe just past the thin box must not hit THIS lamp's box.
    const probe = world.circleHits(lamp.x + lamp.collisionRadius + 0.3, lamp.z, 0.25);
    if (!probe || !probe.includes(idx)) lampMisses += 1;
  }
  check(lampHits === Math.min(25, lamps.length), `circle query at lamp post positions (x, z, collisionRadius) hits each lamp (${lampHits}/${Math.min(25, lamps.length)})`);
  check(lampMisses === Math.min(25, lamps.length), `probe ${0.3} m past a lamp's thin box no longer hits it (${lampMisses}/${Math.min(25, lamps.length)})`);
  const lamp0 = lamps[0];
  const lampRec = world.aabbs[world.aabbs.findIndex((r) => r.ref === lamp0)];
  check(
    Math.abs(lampRec.minX - (lamp0.x - lamp0.collisionRadius)) <= 1e-9 &&
    Math.abs(lampRec.maxX - (lamp0.x + lamp0.collisionRadius)) <= 1e-9 &&
    Math.abs(lampRec.minY - lamp0.y) <= 1e-9 &&
    Math.abs(lampRec.maxY - (lamp0.y + lamp0.height)) <= 1e-9,
    `lamp AABB is the thin pole box (half-width ${lamp0.collisionRadius} m, y ${lampRec.minY} -> ${lampRec.maxY})`
  );
  let treeOk = 0;
  for (const tree of trees.slice(0, 10)) {
    const idx = world.aabbs.findIndex((r) => r.ref === tree);
    const hits = world.circleHits(tree.x, tree.z, tree.collisionRadius);
    if (idx >= 0 && hits && hits.includes(idx)) treeOk += 1;
  }
  check(treeOk === Math.min(10, trees.length), `circle query at tree trunk positions hits each trunk box (${treeOk}/${Math.min(10, trees.length)})`);
}

// --- 4. Road centers clear ---------------------------------------------------------
{
  console.log('  road centers are clear');
  let clear = 0;
  let nonNull = 0;
  for (const [x, z] of lanePoints) {
    const hits = world.circleHits(x, z, CAR_RADIUS);
    if (hits === null) clear += 1;
    else nonNull += 1;
  }
  check(nonNull === 0, `all ${lanePoints.length} lane-center samples (grid midpoints offset by laneOffsetM ${grid.laneOffsetM} m) are hit-free at car radius ${CAR_RADIUS} m`);
  check(clear === lanePoints.length, 'circleHits returns null (not an empty array) on clear road');
  let intersections = 0;
  let intersectionHits = 0;
  for (const x of grid.linesX) {
    for (const z of grid.linesZ) {
      intersections += 1;
      if (world.circleHits(x, z, CAR_RADIUS) !== null) intersectionHits += 1;
    }
  }
  check(intersectionHits === 0, `all ${intersections} intersection centers are hit-free at car radius`);
}

// --- 5. Cross-validation: hash vs brute force --------------------------------------
{
  console.log('  cross-validation vs brute force');
  let circleMismatch = 0;
  let hitCount = 0;
  for (let q = 0; q < 2000; q += 1) {
    const x = rng.float(worldBounds.minX + 2, worldBounds.maxX - 2);
    const z = rng.float(worldBounds.minZ + 2, worldBounds.maxZ - 2);
    const r = rng.float(0.4, 3);
    const got = world.circleHits(x, z, r) || [];
    const want = bruteCircleHits(x, z, r);
    if (got.length > 0) hitCount += 1;
    if (!sameHitSets(got, want)) circleMismatch += 1;
  }
  const hitRate = hitCount / 2000;
  check(circleMismatch === 0, `2000 random circle queries return exactly the brute-force hit sets (${circleMismatch} mismatches)`);
  check(hitRate > 0.15, `random queries exercise real hits, not only empty road (hit rate ${(hitRate * 100).toFixed(1)}%)`);

  let capsuleMismatch = 0;
  for (let q = 0; q < 600; q += 1) {
    const cx = rng.float(worldBounds.minX + 4, worldBounds.maxX - 4);
    const cz = rng.float(worldBounds.minZ + 4, worldBounds.maxZ - 4);
    const ang = rng.float(0, Math.PI * 2);
    const half = rng.float(0.5, 4);
    const r = rng.float(0.4, 2);
    const x1 = cx - Math.cos(ang) * half;
    const z1 = cz - Math.sin(ang) * half;
    const x2 = cx + Math.cos(ang) * half;
    const z2 = cz + Math.sin(ang) * half;
    const got = world.queryCapsule(x1, z1, x2, z2, r) || [];
    const want = bruteCapsuleHits(x1, z1, x2, z2, r);
    if (!sameHitSets(got, want)) capsuleMismatch += 1;
  }
  check(capsuleMismatch === 0, `600 random capsule queries return exactly the brute-force hit sets (${capsuleMismatch} mismatches)`);

  // overlapsSolid must agree with circleHits emptiness on random samples.
  let solidMismatch = 0;
  for (let q = 0; q < 500; q += 1) {
    const x = rng.float(worldBounds.minX + 2, worldBounds.maxX - 2);
    const z = rng.float(worldBounds.minZ + 2, worldBounds.maxZ - 2);
    const r = rng.float(0.4, 3);
    const hits = world.circleHits(x, z, r);
    if (world.overlapsSolid(x, z, r) !== !!(hits && hits.length > 0)) solidMismatch += 1;
  }
  check(solidMismatch === 0, `overlapsSolid agrees with circleHits on 500 random samples (${solidMismatch} mismatches)`);
}

// --- 6. Surface elevation (curb step data) ------------------------------------------
{
  console.log('  surface elevation steps');
  const curb = grid.curbM;
  let roadZero = 0;
  let roadBad = 0;
  for (const [x, z] of lanePoints) {
    if (world.surfaceHeightAt(x, z) === 0) roadZero += 1;
    else roadBad += 1;
  }
  check(roadBad === 0, `surfaceHeightAt is 0 at all ${roadZero} lane-center road samples`);
  check(world.surfaceHeightAt(grid.linesX[3], grid.linesZ[4]) === 0, 'surfaceHeightAt is 0 at an intersection');

  let blockOk = 0;
  for (const block of blocks) {
    if (world.surfaceHeightAt(block.x, block.z) === curb) blockOk += 1;
  }
  check(blockOk === blocks.length, `surfaceHeightAt is ${CURB_M} at all ${blockOk} block centers (sidewalk lots, park lawn, tower lot alike)`);
  const b0 = blocks[0];
  const half = grid.blockM / 2;
  const ringPoints = [
    [b0.x - (half - 1.5), b0.z], // west sidewalk ring
    [b0.x + (half - 1.5), b0.z], // east sidewalk ring
    [b0.x, b0.z - (half - 1.5)], // north sidewalk ring
    [b0.x, b0.z + (half - 1.5)], // south sidewalk ring
    [b0.x - half, b0.z], // exact curb line: inclusive block edge
    [b0.x, b0.z + half],
  ];
  check(ringPoints.every(([x, z]) => world.surfaceHeightAt(x, z) === curb), `surfaceHeightAt is ${CURB_M} on the sidewalk ring and at the exact curb line`);
  const midRoadZ = (grid.linesZ[4] + grid.linesZ[5]) / 2;
  check(world.surfaceHeightAt(grid.linesX[2], midRoadZ) === 0, 'surfaceHeightAt is 0 at a road centerline between intersections');
  check(
    world.surfaceHeightAt(worldBounds.maxX + 1, 0) === 0 &&
    world.surfaceHeightAt(worldBounds.minX - 1, 0) === 0,
    'surfaceHeightAt is 0 on the flat margin outside the city'
  );
  const park = blocks[city.park.blockIndex];
  check(world.surfaceHeightAt(park.x + 10, park.z + 10) === curb, `surfaceHeightAt is ${CURB_M} on the park lawn off the crossing paths`);
}

// --- 7. Performance -------------------------------------------------------------------
{
  console.log('  performance');
  // Precompute the 10k query positions (half road lanes, half random) so
  // only the query calls are inside the timed region.
  const positions = [];
  for (let i = 0; i < 10000; i += 1) {
    if (i % 2 === 0) {
      const p = lanePoints[(i / 2) % lanePoints.length | 0];
      positions.push([p[0], p[1]]);
    } else {
      positions.push([
        rng.float(worldBounds.minX + 2, worldBounds.maxX - 2),
        rng.float(worldBounds.minZ + 2, worldBounds.maxZ - 2),
      ]);
    }
  }
  const segments = [];
  for (let i = 0; i < 10000; i += 1) {
    const cx = rng.float(worldBounds.minX + 4, worldBounds.maxX - 4);
    const cz = rng.float(worldBounds.minZ + 4, worldBounds.maxZ - 4);
    const ang = rng.float(0, Math.PI * 2);
    const half = rng.float(1.0, 2.0); // car-body scale (two-circle hull)
    segments.push([cx - Math.cos(ang) * half, cz - Math.sin(ang) * half, cx + Math.cos(ang) * half, cz + Math.sin(ang) * half]);
  }

  // Warm-up (JIT) so the measured batch is steady-state, like in-game use.
  for (let i = 0; i < 2000; i += 1) {
    world.circleHits(positions[i][0], positions[i][1], CAR_RADIUS);
    world.queryCapsule(segments[i][0], segments[i][1], segments[i][2], segments[i][3], 0.9);
    world.overlapsSolid(positions[i][0], positions[i][1], CAR_RADIUS);
  }

  // Measure best-of-3 batches: scheduler noise from other processes can
  // inflate a single run; the minimum is the code's true steady-state cost.
  const timeBatch = (runBatch) => {
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const t0 = performance.now();
      runBatch();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  const circleMs = timeBatch(() => {
    for (const [x, z] of positions) world.circleHits(x, z, CAR_RADIUS);
  });
  const capsuleMs = timeBatch(() => {
    for (const [x1, z1, x2, z2] of segments) world.queryCapsule(x1, z1, x2, z2, 0.9);
  });
  const solidMs = timeBatch(() => {
    for (const [x, z] of positions) world.overlapsSolid(x, z, CAR_RADIUS);
  });

  check(circleMs < 5, `10k circle queries complete in < 5 ms (took ${circleMs.toFixed(2)} ms, ${(circleMs * 1e6 / 10000).toFixed(0)} ns/query)`);
  check(capsuleMs < 5, `10k capsule queries complete in < 5 ms (took ${capsuleMs.toFixed(2)} ms, ${(capsuleMs * 1e6 / 10000).toFixed(0)} ns/query)`);
  check(solidMs < 5, `10k overlapsSolid queries complete in < 5 ms (took ${solidMs.toFixed(2)} ms, ${(solidMs * 1e6 / 10000).toFixed(0)} ns/query)`);
  const frameShare = (circleMs / 16.6) * 100;
  console.log(`    info: circle batch is ${frameShare.toFixed(2)}% of a 16.6 ms frame budget`);
}

// --- 8. Capsule semantics ---------------------------------------------------------------
{
  console.log('  capsule query semantics');
  const towerBuilding = blocks[landmark.blockIndex].buildings[landmark.buildingIndex];
  const towerIdx = world.aabbs.findIndex((r) => r.ref === towerBuilding);
  const rec = world.aabbs[towerIdx];
  const zMid = (rec.minZ + rec.maxZ) / 2;
  const xOut = rec.maxX + 1.0; // 1 m clear of the face: a r=0.5 circle misses
  check(!world.circleHits(xOut, zMid, 0.5)?.includes(towerIdx), 'circle at the outside endpoint does not hit the tower yet');
  check(world.overlapsSolid(towerBuilding.x, towerBuilding.z, 0.5), 'overlapsSolid confirms the tower interior is solid');
  const straddle = world.queryCapsule(xOut, zMid, towerBuilding.x, zMid, 0.5);
  check(!!straddle && straddle.includes(towerIdx), 'capsule straddling the building edge (outside point -> center) hits it');
  // Long segment crossing the whole footprint, both endpoints well outside.
  const xFar = rec.minX - 5;
  const xFar2 = rec.maxX + 5;
  const cross = world.queryCapsule(xFar, zMid, xFar2, zMid, 0.5);
  check(!!cross && cross.includes(towerIdx), 'capsule crossing the full footprint with BOTH endpoints 5 m outside still hits it (exact segment test)');
  check(!world.circleHits(xFar, zMid, 0.5)?.includes(towerIdx) && !world.circleHits(xFar2, zMid, 0.5)?.includes(towerIdx), 'neither crossing-segment endpoint circle hits alone');
  // Zero-hit capsule on open road.
  const roadCapsule = world.queryCapsule(lanePoints[0][0] - 2, lanePoints[0][1], lanePoints[0][0] + 2, lanePoints[0][1], CAR_RADIUS);
  check(roadCapsule === null, 'capsule on an open lane returns null');
  // Zero-length capsule behaves like a circle.
  const degenerate = world.queryCapsule(towerBuilding.x, towerBuilding.z, towerBuilding.x, towerBuilding.z, 1);
  check(!!degenerate && degenerate.includes(towerIdx), 'zero-length capsule degenerates to the circle query');
}

// --- 9. addAabb after construction (task 4.3 seam) ----------------------------------------
{
  console.log('  addAabb post-construction (parked cars)');
  const before = world.aabbCount;
  const [px, pz] = lanePoints[10];
  check(world.circleHits(px, pz, CAR_RADIUS) === null, 'chosen lane spot is clear before parking');
  const parked = world.addAabb({ x: px, z: pz, w: 4.2, d: 1.8, y: 0, height: 1.4, tag: 'parked-car', ref: { label: 'test-parked-car' } });
  check(world.aabbCount === before + 1, 'aabbCount grew by exactly 1');
  check(parked.tag === 'parked-car' && Math.abs(parked.minX - (px - 2.1)) <= 1e-9, 'stored record keeps the descriptor (center/full extents -> min/max)');
  const hits = world.circleHits(px, pz, CAR_RADIUS);
  check(!!hits && hits.includes(before), 'circle query at the parked car now hits it (new index = old aabbCount)');
  check(world.overlapsSolid(px, pz, CAR_RADIUS) === true, 'overlapsSolid reports the parked lane spot as solid');
  // A distant intersection was verified clear in section 4 and must stay clear.
  check(world.overlapsSolid(grid.linesX[0], grid.linesZ[0], CAR_RADIUS) === false, 'distant intersection stays clear after addAabb');
  // Existing indices stayed valid: the tower interior check still resolves.
  const towerBuilding = blocks[landmark.blockIndex].buildings[landmark.buildingIndex];
  const towerIdx = world.aabbs.findIndex((r) => r.ref === towerBuilding);
  check(!!world.circleHits(towerBuilding.x, towerBuilding.z, 1)?.includes(towerIdx), 'pre-existing indices stay valid after addAabb');
}

console.log(`\ncollision-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`collision-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('collision-test: ALL PASS');
