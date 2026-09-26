#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/lane-graph.js (task 4.1).
 *
 * Builds the lane graph from the deterministic city layout and checks:
 *
 *   1. Coverage — the graph spans the full grid: 121 nodes (11x11), 220
 *      road segments (11 lines x 10 segments x 2 axes), 440 directed lanes
 *      (2 per segment); every (axis, dir, line, segment) tuple and every
 *      lane id exists exactly once; lane waypoints sit at their nodes'
 *      junction-box edges (roadM/2 from the node centers); node in/out
 *      degrees follow the boundary arithmetic (corners 2, edges 3,
 *      interior 4, sums 440); every node is reachable from node 0 (BFS).
 *   2. Connectivity — for EVERY node, EVERY incoming lane and EVERY
 *      available choice: the exit lane starts at the node; choice
 *      waypoints begin exactly at the incoming lane's end and end exactly
 *      at the exit lane's start (within 1e-9); waypoints are finite with
 *      non-degenerate steps; straight connectors cross the junction box
 *      collinearly; turn arcs carry the exact tangent radius
 *      (roadM/2 -/+ laneOffsetM); nextChoice() (the rng path) only returns
 *      offered options and accepts node/lane as index, id, or object.
 *   3. Right-hand rule — every lane's fixed coordinate is offset to the
 *      driver's right per the module rule (rightOfDir(dx,dz) = (-dz,dx),
 *      evidenced by the main.js spawn: heading +Z -> lane at x = -3.5):
 *      +Z -> x-line - offset, -Z -> +offset, +X -> z-line +offset,
 *      -X -> -offset; 110 lanes per travel direction; headings match the
 *      forward = (sin, cos) convention; the lane under the documented
 *      player spawn (-3.5, -117) is z+5:3, heading 0.
 *   4. Turns stay on roads — ~100 sampled (node, incoming lane, choice)
 *      triples (4 corners, edge + center nodes, rng-picked extras, ALL
 *      choices each): every connector waypoint lies within roadM/2 of a
 *      road centerline, reads as asphalt (collision surfaceHeightAt == 0),
 *      touches no building/prop AABB (collision overlapsSolid r=0.9), and
 *      turn arcs curve toward the maneuver's side.
 *   5. No U-turns — across ALL choices in the graph, no exit reverses its
 *      incoming lane (same travel axis, opposite dir, same road line).
 *   6. Determinism — two builds from two generateCity() runs plus a fresh
 *      process build produce byte-identical JSON dumps; a synthetic
 *      3x3-line grid builds identically twice.
 *   7. Synthetic mini grid — 3x3 lines: 9 nodes / 24 lanes / 44 choices,
 *      corners offer exactly one choice, the interior three, and a
 *      southbound arrival at corner (0,0) must exit right onto x+0:0.
 *
 * Run: node scripts/lane-graph-test.mjs   (plain node, no dependencies)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateCity } from '../src/game/city-gen.js';
import { createCollisionWorld } from '../src/game/collision.js';
import { buildLaneGraph, LANE_GRAPH_VERSION } from '../src/game/lane-graph.js';
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
 * Compare two JSON-serializable values byte-for-byte via their dumps.
 * @param {unknown} a First value.
 * @param {unknown} b Second value.
 * @returns {boolean} True when JSON dumps are identical.
 */
function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Distance from a point to the nearest road centerline of a grid (min
 * over all vertical/horizontal lines).
 * @param {{ linesX: number[], linesZ: number[] }} grid Grid description.
 * @param {number} x Point x (m).
 * @param {number} z Point z (m).
 * @returns {number} Distance in m.
 */
function distToNearestCenterline(grid, x, z) {
  let best = Infinity;
  for (const lx of grid.linesX) best = Math.min(best, Math.abs(x - lx));
  for (const lz of grid.linesZ) best = Math.min(best, Math.abs(z - lz));
  return best;
}

/** Synthetic 3x3-line grid (2x2 blocks) mirroring the shipped constants. */
const MINI_LAYOUT = {
  grid: {
    linesX: [-78, 0, 78],
    linesZ: [-78, 0, 78],
    roadM: 14,
    laneOffsetM: 3.5,
  },
};

console.log('lane-graph-test: lane graph verification (task 4.1)\n');

const layout = generateCity();
const graph = buildLaneGraph(layout);
const grid = layout.grid;
const H = grid.roadM / 2;
const OFF = grid.laneOffsetM;
const EPS = 1e-9;

// --- 1. Coverage: full-grid node/segment/lane counts and structure ----------
{
  console.log('  coverage (full grid)');
  check(LANE_GRAPH_VERSION === 1, 'graph module version is 1');
  check(graph.version === LANE_GRAPH_VERSION, 'graph carries the module version');
  const nX = grid.linesX.length;
  const nZ = grid.linesZ.length;
  check(nX === 11 && nZ === 11, `grid has 11 centerlines per axis (got ${nX}, ${nZ})`);
  check(graph.nodes.length === nX * nZ, `node count is 121 (got ${graph.nodes.length})`);
  const expectedSegments = nX * (nZ - 1) + nZ * (nX - 1);
  check(expectedSegments === 220, `expected segment count is 220 (got ${expectedSegments})`);
  check(graph.lanes.length === 2 * expectedSegments, `lane count is 440 (got ${graph.lanes.length})`);

  // Every (axis, dir, line, segment) tuple and every id exactly once.
  const tuples = new Set();
  const ids = new Set();
  let duplicates = 0;
  for (const lane of graph.lanes) {
    const key = `${lane.axis}${lane.dir}:${lane.line}:${lane.segment}`;
    if (tuples.has(key) || ids.has(lane.id)) duplicates += 1;
    tuples.add(key);
    ids.add(lane.id);
  }
  check(duplicates === 0, `no duplicate lane tuples/ids (${duplicates} dupes)`);
  check(tuples.size === 440, `unique (axis,dir,line,segment) tuples is 440 (got ${tuples.size})`);

  // Lane endpoints at junction-box edges of the correct nodes.
  let endpointFailures = 0;
  let nodeRefFailures = 0;
  for (const lane of graph.lanes) {
    const from = graph.nodes[lane.fromNode];
    const to = graph.nodes[lane.toNode];
    if (!from || !to) {
      nodeRefFailures += 1;
      continue;
    }
    const [w0, w1] = lane.waypoints;
    if (lane.axis === 'z') {
      const cx = grid.linesX[lane.line];
      const zA = grid.linesZ[lane.segment];
      const zB = grid.linesZ[lane.segment + 1];
      const expX = lane.dir > 0 ? cx - OFF : cx + OFF;
      const sZ = lane.dir > 0 ? zA + H : zB - H;
      const eZ = lane.dir > 0 ? zB - H : zA + H;
      if (w0.x !== expX || w1.x !== expX || w0.z !== sZ || w1.z !== eZ) endpointFailures += 1;
      if (from.x !== cx || to.x !== cx) nodeRefFailures += 1;
      if (Math.abs(from.z - sZ) > H + EPS || Math.abs(to.z - eZ) > H + EPS) nodeRefFailures += 1;
    } else {
      const cz = grid.linesZ[lane.line];
      const xA = grid.linesX[lane.segment];
      const xB = grid.linesX[lane.segment + 1];
      const expZ = lane.dir > 0 ? cz + OFF : cz - OFF;
      const sX = lane.dir > 0 ? xA + H : xB - H;
      const eX = lane.dir > 0 ? xB - H : xA + H;
      if (w0.z !== expZ || w1.z !== expZ || w0.x !== sX || w1.x !== eX) endpointFailures += 1;
      if (from.z !== cz || to.z !== cz) nodeRefFailures += 1;
      if (Math.abs(from.x - sX) > H + EPS || Math.abs(to.x - eX) > H + EPS) nodeRefFailures += 1;
    }
    if (Math.hypot(lane.end.x - lane.start.x, lane.end.z - lane.start.z) !== lane.lengthM) {
      endpointFailures += 1;
    }
  }
  check(nodeRefFailures === 0, `lane node references match line/segment arithmetic (${nodeRefFailures} bad)`);
  check(endpointFailures === 0, `lane waypoints sit at junction-box edges (${endpointFailures} bad)`);

  // Degree structure: corners 2, edges 3, interior 4; sums equal lane count.
  let degreeFailures = 0;
  let sumIn = 0;
  let sumOut = 0;
  for (const node of graph.nodes) {
    const onXEdge = node.ix === 0 || node.ix === nX - 1;
    const onZEdge = node.iz === 0 || node.iz === nZ - 1;
    const degree = onXEdge && onZEdge ? 2 : onXEdge || onZEdge ? 3 : 4;
    if (node.inLanes.length !== degree || node.outLanes.length !== degree) degreeFailures += 1;
    sumIn += node.inLanes.length;
    sumOut += node.outLanes.length;
  }
  check(degreeFailures === 0, `node in/out degrees follow the boundary arithmetic (${degreeFailures} bad)`);
  check(sumIn === 440 && sumOut === 440, `degree sums are 440/440 (got ${sumIn}/${sumOut})`);

  // Full coverage: BFS from node 0 reaches every node via lanes.
  const visited = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const ni = queue.shift();
    for (const li of graph.nodes[ni].outLanes) {
      const to = graph.lanes[li].toNode;
      if (!visited.has(to)) {
        visited.add(to);
        queue.push(to);
      }
    }
  }
  check(visited.size === graph.nodes.length, `every node reachable from node 0 (${visited.size}/${graph.nodes.length})`);
}

// --- 2. Connectivity: every lane connects, every choice bridges exactly -----
{
  console.log('  connectivity (all nodes x incoming lanes x choices)');
  let exitFailures = 0;
  let continuityFailures = 0;
  let shapeFailures = 0;
  let totalChoices = 0;
  for (const node of graph.nodes) {
    for (const inLaneIndex of node.inLanes) {
      const inLane = graph.lanes[inLaneIndex];
      if (graph.nodes[inLane.toNode] !== node) exitFailures += 1;
      const options = graph.choicesAt(node, inLane);
      if (options.length === 0) {
        shapeFailures += 1;
        continue;
      }
      for (const choice of options) {
        totalChoices += 1;
        if (!node.outLanes.includes(choice.exitLane.index)) exitFailures += 1;
        const wps = choice.waypoints;
        // Bridge contract: starts at the incoming lane's end, ends at the
        // exit lane's start.
        if (Math.hypot(wps[0].x - inLane.end.x, wps[0].z - inLane.end.z) > EPS) continuityFailures += 1;
        if (
          Math.hypot(
            wps[wps.length - 1].x - choice.exitLane.start.x,
            wps[wps.length - 1].z - choice.exitLane.start.z
          ) > EPS
        ) {
          continuityFailures += 1;
        }
        // Shape: straight = 2-point box crossing, turn = 5-point arc.
        if (choice.turn === 'straight' && wps.length !== 2) shapeFailures += 1;
        if (choice.turn !== 'straight' && wps.length !== 5) shapeFailures += 1;
        for (let i = 0; i + 1 < wps.length; i += 1) {
          const step = Math.hypot(wps[i + 1].x - wps[i].x, wps[i + 1].z - wps[i].z);
          if (!Number.isFinite(step) || step <= 0.5) shapeFailures += 1;
        }
        // Arc radius: exact tangent circle per turn type.
        const expectedR = choice.turn === 'right' ? H - OFF : choice.turn === 'left' ? H + OFF : 0;
        if (Math.abs(choice.arcRadiusM - expectedR) > 1e-6) shapeFailures += 1;
      }
    }
  }
  check(exitFailures === 0, `every choice exits via an out-lane of its node (${exitFailures} bad)`);
  check(continuityFailures === 0, `choice waypoints bridge incoming end -> exit start within 1e-9 (${continuityFailures} bad)`);
  check(shapeFailures === 0, `connector shapes/radii well-formed (${shapeFailures} bad)`);
  const expectedChoices = 4 * 2 + 36 * 6 + 81 * 12; // corners(1/in-lane) / edges(2) / interior(3)
  check(totalChoices === expectedChoices, `total choice count is ${expectedChoices} (got ${totalChoices})`);

  // nextChoice draws only from the offered options and accepts all arg forms.
  const rng = createRng('lane-graph-test-next-choice');
  const node5 = graph.nodes[5 * 11 + 5];
  const inLane5 = graph.lanes[node5.inLanes[0]];
  const offered = new Set(graph.choicesAt(node5, inLane5).map((c) => `${c.exitLane.id}:${c.turn}`));
  let pickFailures = 0;
  for (let i = 0; i < 60; i += 1) {
    const picked = graph.nextChoice(node5, inLane5, rng);
    if (!offered.has(`${picked.exitLane.id}:${picked.turn}`)) pickFailures += 1;
  }
  check(pickFailures === 0, `nextChoice returns only offered options (${pickFailures} bad of 60 draws)`);
  const byIndex = graph.nextChoice(5 * 11 + 5, inLane5.index, rng);
  const byId = graph.nextChoice(node5.id, inLane5.id, rng);
  const byObject = graph.nextChoice(node5, inLane5, rng);  check(
    jsonEqual(byIndex, byObject) && jsonEqual(byId, byObject),
    'nextChoice accepts node/lane as index, id, or object'
  );
  let threwMismatch = false;
  try {
    graph.nextChoice(graph.nodes[0], inLane5, rng); // lane does not end there
  } catch {
    threwMismatch = true;
  }
  check(threwMismatch, 'nextChoice rejects a lane that does not end at the node');
}

// --- 3. Right-hand rule: every lane offset to the driver's right ------------
{
  console.log('  right-hand rule (all 440 lanes + spawn cross-check)');
  let sideFailures = 0;
  let headingFailures = 0;
  const buckets = { zPos: 0, zNeg: 0, xPos: 0, xNeg: 0 };
  for (const lane of graph.lanes) {
    const [w0, w1] = lane.waypoints;
    if (lane.axis === 'z') {
      const cx = grid.linesX[lane.line];
      const expectedX = lane.dir > 0 ? cx - OFF : cx + OFF;
      if (w0.x !== expectedX || w1.x !== expectedX) sideFailures += 1;
      buckets[lane.dir > 0 ? 'zPos' : 'zNeg'] += 1;
    } else {
      const cz = grid.linesZ[lane.line];
      const expectedZ = lane.dir > 0 ? cz + OFF : cz - OFF;
      if (w0.z !== expectedZ || w1.z !== expectedZ) sideFailures += 1;
      buckets[lane.dir > 0 ? 'xPos' : 'xNeg'] += 1;
    }
    // Heading matches the (sin, cos) forward convention exactly.
    const fx = Math.round(Math.sin(lane.heading) * 1e6) / 1e6;
    const fz = Math.round(Math.cos(lane.heading) * 1e6) / 1e6;
    const ex = lane.axis === 'z' ? 0 : lane.dir;
    const ez = lane.axis === 'z' ? lane.dir : 0;
    if (fx !== ex || fz !== ez) headingFailures += 1;
  }
  check(sideFailures === 0, `every lane offset is on the driver's right (${sideFailures} bad)`);
  check(headingFailures === 0, `lane headings match forward = (sin, cos) (${headingFailures} bad)`);
  check(
    buckets.zPos === 110 && buckets.zNeg === 110 && buckets.xPos === 110 && buckets.xNeg === 110,
    `110 lanes per travel direction (got ${JSON.stringify(buckets)})`
  );

  // Spawn cross-check: the documented player spawn sits on right-hand lane
  // z+5:3 (heading +Z on the center-x line — main.js SPAWN_* contract).
  const rng = createRng('lane-graph-test-spawn');
  const spawnLane = graph.randomLaneAt(-3.5, -117, 5, rng);
  check(!!spawnLane, 'randomLaneAt finds a lane under the player spawn');
  check(
    !!spawnLane &&
      spawnLane.id === 'z+5:3' &&
      spawnLane.axis === 'z' &&
      spawnLane.dir === 1 &&
      spawnLane.line === 5 &&
      spawnLane.segment === 3 &&
      spawnLane.heading === 0,
    `spawn lane is z+5:3 heading +Z (got ${spawnLane ? spawnLane.id : 'null'})`
  );
  check(
    !!spawnLane && spawnLane.midpoint.x === -3.5 && spawnLane.midpoint.z === -117,
    'spawn lane midpoint is the spawn point'
  );
  check(graph.randomLaneAt(5000, 5000, 10, rng) === null, 'randomLaneAt returns null far outside the grid');
  check(graph.getLane('z+5:3') === spawnLane, 'getLane resolves ids to the same lane object');
}

// --- 4. Turns stay on roads: sampled triples, every waypoint on asphalt -----
{
  console.log('  turns stay on roads (sampled triples, collision-checked)');
  const world = createCollisionWorld(layout);
  const sampleRng = createRng('lane-graph-test-turn-samples');
  const nX = grid.linesX.length;
  const nZ = grid.linesZ.length;
  /** @type {{ix: number, iz: number}[]} */
  const sampled = [
    { ix: 0, iz: 0 }, // four corners: exactly one choice each
    { ix: nX - 1, iz: 0 },
    { ix: 0, iz: nZ - 1 },
    { ix: nX - 1, iz: nZ - 1 },
    { ix: 5, iz: 5 }, // center: 3 choices per incoming lane
    { ix: 5, iz: 0 }, // edge nodes: mixed availability
    { ix: 0, iz: 5 },
  ];
  while (sampled.length < 14) {
    sampled.push({ ix: sampleRng.int(0, nX - 1), iz: sampleRng.int(0, nZ - 1) });
  }
  let triples = 0;
  let waypointsChecked = 0;
  let offRoad = 0;
  let notAsphalt = 0;
  let insideSolid = 0;
  let curvedWrong = 0;
  const turnMix = { straight: 0, left: 0, right: 0 };
  for (const { ix, iz } of sampled) {
    const node = graph.nodes[ix + iz * nX];
    for (const inLaneIndex of node.inLanes) {
      const inLane = graph.lanes[inLaneIndex];
      for (const choice of graph.choicesAt(node, inLane)) {
        triples += 1;
        turnMix[choice.turn] += 1;
        for (const p of choice.waypoints) {
          waypointsChecked += 1;
          if (distToNearestCenterline(grid, p.x, p.z) > H + 1e-6) offRoad += 1;
          if (world.surfaceHeightAt(p.x, p.z) !== 0) notAsphalt += 1;
          if (world.overlapsSolid(p.x, p.z, 0.9)) insideSolid += 1;
        }
        // Turns curve toward their side: the 50% arc point (index 2) sits
        // on the maneuver's side of the incoming travel direction, at the
        // 45-degree chord depth r * (1 - sqrt(1/2)) along the right axis.
        if (choice.turn !== 'straight') {
          const fwdX = inLane.axis === 'z' ? 0 : inLane.dir;
          const fwdZ = inLane.axis === 'z' ? inLane.dir : 0;
          const rightX = -fwdZ;
          const rightZ = fwdX;
          const mid = choice.waypoints[2];
          const dot = (mid.x - inLane.end.x) * rightX + (mid.z - inLane.end.z) * rightZ;
          const expected = (choice.turn === 'right' ? 1 : -1) * choice.arcRadiusM * (1 - Math.SQRT1_2);
          if (Math.sign(dot) !== Math.sign(expected) || Math.abs(dot - expected) > 0.05) {
            curvedWrong += 1;
          }
        }
      }
    }
  }
  check(triples >= 30, `sampled at least 30 (node, incoming, choice) triples (${triples})`);
  check(turnMix.straight > 0 && turnMix.left > 0 && turnMix.right > 0,
    `sample covers straight/left/right (got ${JSON.stringify(turnMix)})`);
  check(offRoad === 0, `every sampled waypoint is within roadM/2 of a centerline (${offRoad} bad)`);
  check(notAsphalt === 0, `every sampled waypoint reads as asphalt, surfaceHeightAt == 0 (${notAsphalt} bad)`);
  check(insideSolid === 0, `no sampled waypoint touches a building/prop AABB at r=0.9 (${insideSolid} bad)`);
  check(curvedWrong === 0, `turn arcs curve toward their maneuver side (${curvedWrong} bad)`);
  check(waypointsChecked >= 2 * triples, `checked ${waypointsChecked} waypoints across ${triples} triples`);
}

// --- 5. No U-turns: global sweep --------------------------------------------
{
  console.log('  no U-turns (all choices)');
  let uTurns = 0;
  let total = 0;
  for (const node of graph.nodes) {
    for (const inLaneIndex of node.inLanes) {
      const inLane = graph.lanes[inLaneIndex];
      for (const choice of graph.choicesAt(node, inLane)) {
        total += 1;
        const out = choice.exitLane;
        if (inLane.axis === out.axis && inLane.dir === -out.dir && inLane.line === out.line) uTurns += 1;
      }
    }
  }
  check(uTurns === 0, `no choice reverses its incoming lane (${uTurns} U-turns in ${total} choices)`);
}

// --- 6. Determinism: identical dumps across runs and module instances -------
{
  console.log('  determinism (two builds, fresh process, mini grid)');
  const dumpA = JSON.stringify(buildLaneGraph(generateCity()));
  const dumpB = JSON.stringify(buildLaneGraph(generateCity()));
  check(dumpA === dumpB, 'two builds from two generateCity() runs are byte-identical');

  const baseDir = fileURLToPath(import.meta.url).replace(/scripts[\\/]lane-graph-test\.mjs$/, '');
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        `import { pathToFileURL } from 'node:url';`,
        `const cityGen = await import(pathToFileURL(process.argv[1]).href);`,
        `const laneGraph = await import(pathToFileURL(process.argv[2]).href);`,
        `process.stdout.write(JSON.stringify(laneGraph.buildLaneGraph(cityGen.generateCity())));`,
      ].join('\n'),
      `${baseDir}src/game/city-gen.js`,
      `${baseDir}src/game/lane-graph.js`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  check(child.status === 0, `child process exited cleanly (status ${child.status})`);
  check(child.stdout === dumpA, 'fresh-process build dump is byte-identical');

  const miniA = JSON.stringify(buildLaneGraph(MINI_LAYOUT));
  const miniB = JSON.stringify(buildLaneGraph(MINI_LAYOUT));
  check(miniA === miniB && miniA.length > 0, 'synthetic mini grid builds identically twice');
}

// --- 7. Synthetic mini grid: boundary logic on 3x3 lines --------------------
{
  console.log('  synthetic mini grid (3x3 lines, 2x2 blocks)');
  const mini = buildLaneGraph(MINI_LAYOUT);
  check(mini.nodes.length === 9, `9 nodes (got ${mini.nodes.length})`);
  check(mini.lanes.length === 24, `24 lanes (got ${mini.lanes.length})`);
  const corner = mini.nodes[0];
  check(corner.inLanes.length === 2 && corner.outLanes.length === 2, 'corner node has 2 in / 2 out');
  const center = mini.nodes[1 + 1 * 3];
  check(center.inLanes.length === 4 && center.outLanes.length === 4, 'center node has 4 in / 4 out');
  let choiceTotal = 0;
  let cornerOfferings = 0;
  let interiorOfferings = 0;
  for (const node of mini.nodes) {
    for (const inLaneIndex of node.inLanes) {
      const options = mini.choicesAt(node, mini.lanes[inLaneIndex]);
      choiceTotal += options.length;
      if (node.ix === 0 && node.iz === 0) cornerOfferings += options.length;
      if (node.ix === 1 && node.iz === 1) interiorOfferings += options.length;
    }
  }
  check(cornerOfferings === 2, `corner node offers exactly 1 choice per incoming lane (got ${cornerOfferings})`);
  check(interiorOfferings === 12, `center node offers 3 choices per incoming lane (got ${interiorOfferings})`);
  check(choiceTotal === 44, `mini grid choice total is 44 (got ${choiceTotal})`);

  // One full corner traversal: southbound into (0,0) must exit +X (only option).
  const southbound = mini.lanes.find((l) => l.axis === 'z' && l.dir === -1 && l.line === 0 && l.segment === 0);
  const options = mini.choicesAt(mini.nodes[0], southbound);
  check(
    options.length === 1 && options[0].turn === 'right' && options[0].exitLane.id === 'x+0:0',
    `southbound into corner (0,0) must turn right onto x+0:0 (got ${options.map((o) => `${o.turn}/${o.exitLane.id}`).join(',')})`
  );
  const wps = options[0].waypoints;
  check(
    Math.hypot(wps[0].x - southbound.end.x, wps[0].z - southbound.end.z) <= 1e-9 &&
      Math.hypot(wps[wps.length - 1].x - options[0].exitLane.start.x, wps[wps.length - 1].z - options[0].exitLane.start.z) <= 1e-9,
    'corner connector bridges incoming end to exit start'
  );
}

console.log(`\nlane-graph-test: ${checks - failed}/${checks} checks passed${failed > 0 ? `, ${failed} FAILED` : ' — all green'}`);
process.exit(failed > 0 ? 1 : 0);
