#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/city-gen.js (task 2.1).
 *
 * Checks the deterministic city layout data:
 *
 *   1. Determinism — three generations, byte-identical JSON dumps:
 *      two fresh module instances in this process (query-string
 *      cache-busting on the file URL: `?run=a` / `?run=b`) plus one dump
 *      from a separate `node` child process; sha256 of each dump compared.
 *   2. Grid dims — 10x10 blocks, 11 centerlines per axis, pitch = 78 m,
 *      centerline span = 780 m, world extents sized to cover the asphalt.
 *   3. Sidewalks — every block (park/tower included) has its 4-strip ring,
 *      all at curb height, all inside the block bounds.
 *   4. Landmarks — exactly one park block and one tower landmark, distinct
 *      blocks, cross-referenced indices valid, park paths/trees present.
 *   5. Variety — buildings differ in height (>= 3 distinct), color (>= 3),
 *      footprint area (>= 3); footprints stay inside their block's lot
 *      (never on a road) and inside world extents.
 *   6. Props — lamps and trees both present, street props stand on their
 *      block's sidewalk band, everything inside world extents.
 *   7. Sanity — counts summary matches the arrays, dump contains no
 *      null/NaN (a NaN would stringify as null), and a different seed
 *      produces a different city.
 *   8. Speed — generateCity() completes in well under 1 s.
 *
 * Run: node scripts/city-gen-test.mjs   (plain node, no dependencies)
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { generateCity, CITY_SEED, GRID_N, PITCH_M, ROAD_M, BLOCK_M, CURB_M, SIDEWALK_M } from '../src/game/city-gen.js';

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
 * sha256 of a string (used to compare JSON dumps byte-for-byte).
 * @param {string} text Text to hash.
 * @returns {string} Hex digest.
 */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

console.log('city-gen-test: deterministic city layout verification\n');

// --- 1. Determinism: byte-identical JSON dumps across fresh module loads ----
{
  console.log('  determinism (fresh module instances + fresh process)');
  const modulePath = fileURLToPath(import.meta.url).replace(/scripts[\\/]city-gen-test\.mjs$/, 'src/game/city-gen.js');
  const moduleUrl = pathToFileURL(modulePath);
  const modA = await import(`${moduleUrl.href}?run=a`);
  const modB = await import(`${moduleUrl.href}?run=b`);
  const dumpA = JSON.stringify(modA.generateCity());
  const dumpB = JSON.stringify(modB.generateCity());
  const hashA = sha256(dumpA);
  const hashB = sha256(dumpB);

  // Third generation from a genuinely fresh node process (also proves the
  // module is plain-node runnable with no browser/Vite involvement).
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        `import { createHash } from 'node:crypto';`,
        `import { pathToFileURL } from 'node:url';`,
        `const mod = await import(pathToFileURL(process.argv[process.argv.length - 1]).href);`,
        `const dump = JSON.stringify(mod.generateCity());`,
        `console.log(createHash('sha256').update(dump, 'utf8').digest('hex'));`,
        `console.log(dump.length);`,
      ].join('\n'),
      modulePath,
    ],
    { encoding: 'utf8' }
  );
  check(child.status === 0, `child process exited cleanly (status ${child.status}, stderr: ${child.stderr.trim().slice(0, 200)})`);
  const childLines = String(child.stdout).trim().split('\n');
  const hashC = childLines[0];
  const dumpCLen = Number(childLines[1]);

  check(hashA === hashB, `two fresh in-process module instances produce identical sha256 dumps (${hashA.slice(0, 16)}...)`);
  check(hashA === hashC, `fresh child process produces the identical sha256 dump (${String(hashC).slice(0, 16)}...)`);
  check(dumpA.length > 10000, `dump is a substantial layout (${dumpA.length} bytes)`);
  check(dumpA.length === dumpCLen, `child process dump length matches (${dumpCLen} bytes)`);
  console.log(`    info: layout dump ${dumpA.length} bytes, sha256 ${hashA.slice(0, 32)}...`);
}

// --- shared fixture ----------------------------------------------------------
const t0 = performance.now();
const city = generateCity();
const genMs = performance.now() - t0;
const { world, grid, blocks, props, park, landmark, counts } = city;

// --- 2. Grid dimensions ------------------------------------------------------
{
  console.log('  grid dimensions');
  check(grid.n === GRID_N && GRID_N === 10, `grid.n is 10 (got ${grid.n})`);
  check(blocks.length === GRID_N * GRID_N, `blocks array holds 10x10 = 100 blocks (got ${blocks.length})`);
  check(grid.linesX.length === GRID_N + 1 && grid.linesZ.length === GRID_N + 1, `11 road centerlines per axis (got ${grid.linesX.length}x/${grid.linesZ.length}z)`);
  check(Math.abs(grid.pitchM - 78) <= 0.5, `pitch is ~78 m (got ${grid.pitchM})`);
  check(Math.abs(grid.blockM - 64) <= 0.5, `block size is ~64 m (got ${grid.blockM})`);
  check(Math.abs(grid.roadM - 14) <= 0.5, `road width is ~14 m (got ${grid.roadM})`);
  const spanX = grid.linesX[grid.linesX.length - 1] - grid.linesX[0];
  const spanZ = grid.linesZ[grid.linesZ.length - 1] - grid.linesZ[0];
  check(Math.abs(spanX - 780) <= 2 && Math.abs(spanZ - 780) <= 2, `centerline span is ~780 m on both axes (got ${spanX} x ${spanZ})`);
  check(Math.abs(world.roadSpanM - 780) <= 2, `world.roadSpanM reports ~780 m (got ${world.roadSpanM})`);
  let monotonic = true;
  for (let i = 1; i < grid.linesX.length; i += 1) {
    if (grid.linesX[i] <= grid.linesX[i - 1] || grid.linesZ[i] <= grid.linesZ[i - 1]) monotonic = false;
  }
  check(monotonic, 'centerlines ascend strictly on both axes');
  const outerAsphalt = grid.linesX[grid.linesX.length - 1] + grid.roadM / 2;
  check(world.maxX >= outerAsphalt && world.minX <= -outerAsphalt && world.maxZ >= outerAsphalt && world.minZ <= -outerAsphalt, `world extents cover the outer asphalt edge (+/-${outerAsphalt} m vs extents +/-${world.maxX})`);
  check(grid.laneOffsetM > 0 && grid.laneOffsetM < grid.roadM / 2, `lane offset sits inside the asphalt (got ${grid.laneOffsetM} m of ${grid.roadM} m road)`);
}

// --- 3. Sidewalks on every block --------------------------------------------
{
  console.log('  sidewalks with curbs');
  let allHaveRing = true;
  let allAtCurb = true;
  let allInside = true;
  const half = BLOCK_M / 2;
  for (const block of blocks) {
    if (block.sidewalkRects.length !== 4) allHaveRing = false;
    for (const r of block.sidewalkRects) {
      if (Math.abs(r.y - CURB_M) > 1e-9 || Math.abs(r.curbHeight - CURB_M) > 1e-9) allAtCurb = false;
      const within =
        r.x - r.w / 2 >= block.x - half - 1e-6 &&
        r.x + r.w / 2 <= block.x + half + 1e-6 &&
        r.z - r.d / 2 >= block.z - half - 1e-6 &&
        r.z + r.d / 2 <= block.z + half + 1e-6;
      if (!within) allInside = false;
    }
  }
  check(allHaveRing, 'every block has its 4-strip sidewalk ring');
  check(allAtCurb, `every sidewalk strip sits at curb height ${CURB_M} m with matching curbHeight`);
  check(allInside, 'every sidewalk strip lies inside its block bounds (never on a road)');
  check(Math.abs(grid.curbM - CURB_M) <= 1e-9 && grid.curbM > 0 && grid.curbM < 0.5, `grid.curbM is a low bump-over step (got ${grid.curbM} m)`);
  check(Math.abs(SIDEWALK_M - 3) <= 1e-9, `sidewalk width is 3 m (got ${SIDEWALK_M})`);
}

// --- 4. Exactly one park, one tower landmark ---------------------------------
{
  console.log('  landmarks: one park + one tower');
  const parks = blocks.filter((b) => b.type === 'park');
  const towers = blocks.filter((b) => b.type === 'tower');
  check(parks.length === 1, `exactly one park block (got ${parks.length})`);
  check(towers.length === 1, `exactly one tower block (got ${towers.length})`);
  check(parks[0].index !== towers[0].index, 'park and tower are distinct blocks');
  check(park.blockIndex === parks[0].index && park.ix === parks[0].ix && park.iz === parks[0].iz, 'park references the park block');
  check(landmark.kind === 'tower' && landmark.blockIndex === towers[0].index, 'landmark references the tower block');
  check(towers[0].buildings.length === 1 && landmark.buildingIndex === 0, 'tower block holds exactly one building, referenced by the landmark');
  const towerB = towers[0].buildings[landmark.buildingIndex];
  check(towerB.height >= 100, `tower is a skyline landmark (${towerB.height} m tall)`);
  check(Math.abs(towerB.x - landmark.x) < 1e-9 && Math.abs(towerB.z - landmark.z) < 1e-9, 'landmark center matches its building footprint center');
  check(parks[0].buildings.length === 0, 'park block holds no buildings');
  check(park.pathRects.length >= 2, `park has footpaths (${park.pathRects.length} rects)`);
  check(Math.abs(park.lawnY - CURB_M) <= 1e-9, 'park lawn sits at the curb-step elevation');
  check(park.propIndices.length >= 5, `park has trees (${park.propIndices.length})`);
  const parkPropsOk = park.propIndices.every((i, k) => props[i] && props[i].source === 'park' && props[i].blockIx === park.ix && props[i].blockIz === park.iz);
  check(parkPropsOk, 'park.propIndices point at park-source props on the park block');
  check(parks[0].ix >= 1 && parks[0].ix <= GRID_N - 2 && parks[0].iz >= 1 && parks[0].iz <= GRID_N - 2 && towers[0].ix >= 1 && towers[0].ix <= GRID_N - 2 && towers[0].iz >= 1 && towers[0].iz <= GRID_N - 2, 'both landmarks sit off the outer ring (orientation points inside the city)');
}

// --- 5. Building variety + footprint placement ------------------------------
{
  console.log('  building variety');
  const all = blocks.flatMap((b) => b.buildings);
  const regular = blocks.filter((b) => b.type === 'buildings').flatMap((b) => b.buildings);
  check(all.length >= 60, `city has a healthy building count (${all.length})`);
  const heights = new Set(regular.map((b) => b.height));
  const colors = new Set(all.map((b) => b.color));
  const areas = new Set(all.map((b) => Math.round(b.w * b.d * 2) / 2));
  check(heights.size >= 3, `at least 3 distinct building heights (got ${heights.size}: ${[...heights].sort((a, z) => a - z).slice(0, 8).join(', ')}...)`);
  check(colors.size >= 3, `at least 3 distinct building colors (got ${colors.size})`);
  check(areas.size >= 3, `at least 3 distinct footprint areas (got ${areas.size})`);

  const half = BLOCK_M / 2 - SIDEWALK_M; // lot region half-size
  let insideLots = true;
  let insideWorld = true;
  let saneSizes = true;
  for (const block of blocks) {
    for (const b of block.buildings) {
      if (
        b.x - b.w / 2 < block.x - half - 1e-6 ||
        b.x + b.w / 2 > block.x + half + 1e-6 ||
        b.z - b.d / 2 < block.z - half - 1e-6 ||
        b.z + b.d / 2 > block.z + half + 1e-6
      ) insideLots = false;
      if (b.w < 8 || b.d < 8 || b.height < 8 || !Number.isFinite(b.height)) saneSizes = false;
      if (
        b.x - b.w / 2 < world.minX || b.x + b.w / 2 > world.maxX ||
        b.z - b.d / 2 < world.minZ || b.z + b.d / 2 > world.maxZ
      ) insideWorld = false;
    }
  }
  check(insideLots, 'every building footprint stays inside its block lot (no building on a road)');
  check(saneSizes, 'every building has a sane finite footprint (>= 8 m) and height (>= 8 m)');
  check(insideWorld, 'every building lies inside world extents');
}

// --- 6. Props ----------------------------------------------------------------
{
  console.log('  street props');
  const lamps = props.filter((p) => p.kind === 'lamp');
  const trees = props.filter((p) => p.kind === 'tree');
  check(lamps.length > 0, `lamp posts exist (${lamps.length})`);
  check(trees.length > 0, `trees exist (${trees.length}, street + park)`);
  check(props.length === counts.props && lamps.length === counts.lamps && trees.length === counts.trees, 'counts summary matches the props array');
  check(counts.buildings === blocks.reduce((s, b) => s + b.buildings.length, 0), 'counts.buildings matches the block data');

  let insideWorld = true;
  let onSidewalk = true;
  const half = BLOCK_M / 2;
  for (const p of props) {
    if (p.x < world.minX || p.x > world.maxX || p.z < world.minZ || p.z > world.maxZ) insideWorld = false;
    if (p.source === 'street') {
      const block = blocks[p.blockIx + p.blockIz * GRID_N];
      const inset = Math.max(Math.abs(p.x - block.x), Math.abs(p.z - block.z));
      // Street props stand in the sidewalk band: between the lot edge and
      // the block edge (with the canopy/pole margin implied).
      if (!(inset <= half && inset >= half - SIDEWALK_M - 1e-6)) onSidewalk = false;
      if (!block) onSidewalk = false;
    } else {
      const block = blocks[p.blockIx + p.blockIz * GRID_N];
      if (!block || block.type !== 'park') onSidewalk = false;
    }
  }
  check(insideWorld, 'every prop lies inside world extents');
  check(onSidewalk, 'street props stand on their block sidewalk band; park props on the park block');
  check(lamps.every((p) => p.collisionRadius > 0 && p.height > 0) && trees.every((p) => p.collisionRadius > 0 && p.height > 0), 'every prop carries collision radius + height for task 2.3');
}

// --- 7. General sanity --------------------------------------------------------
{
  console.log('  sanity');
  const dump = JSON.stringify(city);
  check(!dump.includes('null') && !dump.includes('NaN') && !dump.includes('Infinity'), 'dump contains no null/NaN/Infinity (all fields are finite plain data)');
  check(city.seed === CITY_SEED && city.version >= 1, `layout reports its seed ("${city.seed}") and version (${city.version})`);
  check(Number.isInteger(city.seedHash) && city.seedHash >= 0, `seedHash is a uint32 (${city.seedHash})`);
  const other = generateCity('some-other-seed');
  check(sha256(JSON.stringify(other)) !== sha256(dump), 'a different seed produces a different city');
  check(other.world.roadSpanM === world.roadSpanM, 'grid geometry constants are seed-independent');
  let blocksIndexed = true;
  blocks.forEach((b, i) => {
    if (b.index !== i || b.ix + b.iz * GRID_N !== i) blocksIndexed = false;
  });
  check(blocksIndexed, 'blocks are row-major indexed (index === ix + iz * GRID_N)');
}

// --- 8. Generation speed ------------------------------------------------------
{
  console.log('  generation speed');
  check(genMs < 1000, `generateCity() completes in < 1 s (took ${genMs.toFixed(1)} ms)`);
  // Fresh-module runs are slower (parse + JIT-cold), measure those too.
  const tCold = performance.now();
  generateCity('cold-run-seed');
  const coldMs = performance.now() - tCold;
  check(coldMs < 1000, `repeat generation stays < 1 s (took ${coldMs.toFixed(1)} ms)`);
  console.log(`    info: generation ${genMs.toFixed(1)} ms for ${counts.blocks} blocks / ${counts.buildings} buildings / ${counts.props} props`);
}

console.log(`\ncity-gen-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`city-gen-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('city-gen-test: ALL PASS');
