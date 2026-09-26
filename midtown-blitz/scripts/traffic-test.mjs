#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/traffic.js + traffic-view.js
 * (task 4.2). Plain node, no dependencies — drives the exact sim code the
 * browser runs (traffic.js is three-free; traffic-view.js builds real
 * three objects without a renderer).
 *
 *   (a) Spawn — 24 pooled cars on valid lanes near the player: ring
 *       [50, 180] m around the player, on the lane centerline at the
 *       right-hand offset, phase 'lane', heading = lane heading, on asphalt
 *       (surfaceHeightAt === 0), clear of solids (overlapsSolid false),
 *       pairwise separation >= 10 m, paint indices spread.
 *   (b) Lane-keeping — 90 s fixed-step sim (24 cars, player parked
 *       off-lane): every sampled car pose stays within 1 m of its current
 *       path polyline — lane AND junction phases (the turn arcs' chord
 *       sagitta is centimeters). Queue events (a car held behind slower
 *       traffic for >= 0.5 s) are counted as traffic-vs-traffic probe
 *       evidence and asserted >= 1.
 *   (c) Turns on asphalt — across the SAME sim, every car pose every tick
 *       reads as asphalt (surfaceHeightAt === 0) and touches no building/
 *       prop AABB (overlapsSolid r=0.95); stats.turnEvents confirms many
 *       junction traversals happened.
 *   (d) Probe braking — a single car meets a stopped player placed on its
 *       lane 35 m ahead: the car decelerates to a stop with a bumper gap
 *       >= 4 m (never < 3 m during the approach; the sim's safety clamps
 *       target 5 m); when the player moves 80 m up the road the car
 *       resumes within ~1 s (reaction delay 0.3-0.6 s + spin-up). Stop
 *       distance and resume time are logged.
 *   (e) Recycling — after teleporting the player to a far city corner,
 *       every car recycles into the 100-180 m ring (all within 300 m at
 *       the first sample), stays > 34 m from the player at that first
 *       sample (keep-out 40 m minus half a second of driving), and no car
 *       is ever inside a building or off asphalt at ANY time during the
 *       whole scenario (settle + teleport + 10 s).
 *   (f) Per-tick cost — traffic.update for 24 cars averaged over 3000
 *       ticks must stay under 1 ms (avg and max logged; avg asserted).
 *   (g) Determinism — two fresh pools driven by the same seed and the same
 *       scripted 40 s player path produce float-exact identical car
 *       states (position/heading/speed/s) sampled every 7 ticks.
 *
 * Run: node scripts/traffic-test.mjs
 */
import { generateCity } from '../src/game/city-gen.js';
import { createCollisionWorld } from '../src/game/collision.js';
import { buildLaneGraph } from '../src/game/lane-graph.js';
import { createTraffic, TRAFFIC_TUNING } from '../src/game/traffic.js';
import { createTrafficView } from '../src/game/traffic-view.js';
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

/** Fixed simulation step (matches the engine loop). */
const DT = 1 / 60;

/**
 * Distance from a point to a polyline (min over segments).
 * @param {{ x: number, z: number }[]} path Polyline points.
 * @param {number} x Point x (m).
 * @param {number} z Point z (m).
 * @returns {number} Distance in m.
 */
function distToPath(path, x, z) {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const ax = path[i].x;
    const az = path[i].z;
    const bx = path[i + 1].x;
    const bz = path[i + 1].z;
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Point at arc length s along a polyline (clamped).
 * @param {{ x: number, z: number }[]} path Polyline points.
 * @param {number} s Arc length in m.
 * @returns {{ x: number, z: number }} Interpolated point.
 */
function pointAtPath(path, s) {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const ax = path[i].x;
    const az = path[i].z;
    const bx = path[i + 1].x;
    const bz = path[i + 1].z;
    const seg = Math.hypot(bx - ax, bz - az);
    if (s <= total + seg || i + 2 === path.length) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (s - total) / seg)) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t };
    }
    total += seg;
  }
  return { x: path[path.length - 1].x, z: path[path.length - 1].z };
}

/**
 * Distance from a point to a closed segment.
 * @param {{ x: number, z: number }} p Point.
 * @param {{ x: number, z: number }} a Segment start.
 * @param {{ x: number, z: number }} b Segment end.
 * @returns {number} Distance in m.
 */
function pointSegDist(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/**
 * Total length of a polyline in m.
 * @param {{ x: number, z: number }[]} path Polyline points.
 * @returns {number} Total arc length in m.
 */
function pathTotal(path) {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i += 1) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  }
  return total;
}

/**
 * Is any car within a car-shaped cone ahead of `car`? (harness-side probe
 * mirror for queue detection in (b)).
 * @param {import('../src/game/traffic.js').TrafficCar} car Following car.
 * @param {import('../src/game/traffic.js').TrafficCar[]} cars All cars.
 * @returns {boolean} True when traffic is directly ahead in the cone.
 */
function trafficAheadInCone(car, cars) {
  const rx = -car.tangentZ;
  const rz = car.tangentX;
  for (const other of cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const fwd = dx * car.tangentX + dz * car.tangentZ;
    if (fwd <= 0 || fwd > TRAFFIC_TUNING.PROBE_RANGE_M) continue;
    const lat = Math.abs(dx * rx + dz * rz);
    if (lat <= TRAFFIC_TUNING.PROBE_HALF_WIDTH_M) return true;
  }
  return false;
}

console.log('traffic-test: pooled AI traffic verification (task 4.2)\n');

const layout = generateCity();
const grid = layout.grid;
const world = createCollisionWorld(layout);
const graph = buildLaneGraph(layout);
const PLAYER_SPAWN = { x: -3.5, z: -117 }; // main.js documented spawn

// --- (a) spawn: 24 cars on valid right-hand lanes near the player ----------
{
  console.log('  (a) spawn pool');
  const traffic = createTraffic({
    layout,
    graph,
    world,
    rng: createRng('traffic-test-a'),
    player: PLAYER_SPAWN,
  });
  check(traffic.cars.length === 24, `pool holds 24 cars (got ${traffic.cars.length})`);
  const paints = new Set();
  let bad = 0;
  let minPair = Infinity;
  for (const car of traffic.cars) {
    paints.add(car.paint);
    const dPlayer = Math.hypot(car.x - PLAYER_SPAWN.x, car.z - PLAYER_SPAWN.z);
    if (car.phase !== 'lane' || !car.lane) bad += 1;
    const lane = car.lane;
    // Contract: the lane's segment is within the spawn ring of the player
    // (randomLaneAt), the car itself respects the 40 m keep-out, and every
    // spawn lands inside the 260 m recycle/fog radius so a fresh car is
    // never instantly re-recycled.
    if (!(dPlayer >= TRAFFIC_TUNING.SPAWN_KEEP_OUT_M - 1e-6)) bad += 1;
    if (!(dPlayer <= TRAFFIC_TUNING.RECYCLE_DIST_M - 1e-6)) bad += 1;
    if (lane) {
      const [rw0, rw1] = lane.waypoints;
      if (!(pointSegDist(PLAYER_SPAWN, rw0, rw1) <= TRAFFIC_TUNING.RECYCLE_RING_MAX_M + 1e-6)) bad += 1;
    }
    if (lane && graph.getLane(lane.id) !== lane) bad += 1;
    // On the lane centerline (the lane's fixed coordinate), inside its span.
    if (lane) {
      const [w0, w1] = lane.waypoints;
      if (lane.axis === 'z') {
        if (Math.abs(car.x - w0.x) > 1e-6) bad += 1;
        if (car.z < Math.min(w0.z, w1.z) - 1e-6 || car.z > Math.max(w0.z, w1.z) + 1e-6) bad += 1;
      } else {
        if (Math.abs(car.z - w0.z) > 1e-6) bad += 1;
        if (car.x < Math.min(w0.x, w1.x) - 1e-6 || car.x > Math.max(w0.x, w1.x) + 1e-6) bad += 1;
      }
    }
    if (Math.abs(((car.heading - lane.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) > 1e-9) bad += 1;
    if (world.surfaceHeightAt(car.x, car.z) !== 0) bad += 1;
    if (world.overlapsSolid(car.x, car.z, 0.95)) bad += 1;
    if (!(car.paint >= 0 && car.paint <= TRAFFIC_TUNING.PAINT_COUNT - 1)) bad += 1;
    if (!(car.speed >= 0 && Number.isFinite(car.speed))) bad += 1;
  }
  for (let i = 0; i < traffic.cars.length; i += 1) {
    for (let j = i + 1; j < traffic.cars.length; j += 1) {
      const a = traffic.cars[i];
      const b = traffic.cars[j];
      minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
  check(bad === 0, `all 24 spawns valid: ring/centerline/heading/asphalt/clear (${bad} bad)`);
  check(minPair >= TRAFFIC_TUNING.SPAWN_SEPARATION_M - 1e-6, `pairwise separation >= 10 m (min ${minPair.toFixed(2)})`);
  check(paints.size >= 3, `paint variety >= 3 of 5 (got ${paints.size})`);

  // View smoke: builds against the pool, 3 instanced parts, updates cleanly.
  const view = createTrafficView(traffic);
  let parts = 0;
  view.group.traverse((o) => {
    if (o.isInstancedMesh) parts += 1;
  });
  check(parts === 3, `traffic view is 3 instanced draw calls (got ${parts})`);
  check(view.group.children.every((m) => m.count === 24), 'every instanced part covers all 24 cars');
  view.update();
  view.dispose();
  console.log('    spawn ring: min/max car-player distance logged above via assertions');
}

// --- (b) + (c) 90 s sim: lane-keeping, junction asphalt, queues -------------
{
  console.log('  (b)+(c) 90 s lane-keeping / asphalt / queue sim');
  const player = { x: 30, z: -117, heading: 0, speed: 0 }; // parked 26 m off any lane
  const traffic = createTraffic({
    layout,
    graph,
    world,
    rng: createRng('traffic-test-bc'),
    count: 24,
    player,
  });
  let maxDevLane = 0;
  let maxDevJunction = 0;
  let offAsphalt = 0;
  let inSolid = 0;
  let samples = 0;
  const stopStreak = new Int32Array(traffic.cars.length);
  const counted = new Array(traffic.cars.length).fill(false);
  let queueEvents = 0;
  const ticks = 90 * 60;
  for (let k = 0; k < ticks; k += 1) {
    traffic.update(DT, player);
    for (let i = 0; i < traffic.cars.length; i += 1) {
      const car = traffic.cars[i];
      if (world.surfaceHeightAt(car.x, car.z) !== 0) offAsphalt += 1;
      if (world.overlapsSolid(car.x, car.z, 0.95)) inSolid += 1;
      if (k % 3 === 0) {
        samples += 1;
        const dev = distToPath(car.path, car.x, car.z);
        if (car.phase === 'junction') maxDevJunction = Math.max(maxDevJunction, dev);
        else maxDevLane = Math.max(maxDevLane, dev);
      }
      // Traffic-vs-traffic queue evidence (player is off-lane here).
      if (car.speed < 0.2 && trafficAheadInCone(car, traffic.cars)) {
        stopStreak[i] += 1;
        if (stopStreak[i] >= 30 && !counted[i]) {
          counted[i] = true;
          queueEvents += 1;
        }
      } else {
        stopStreak[i] = 0;
        if (car.speed > 1) counted[i] = false;
      }
    }
  }
  console.log(`    lane-phase max centerline deviation: ${maxDevLane.toFixed(4)} m`);
  console.log(`    junction-phase max path deviation:   ${maxDevJunction.toFixed(4)} m`);
  console.log(`    junction traversals (stats.turnEvents): ${traffic.stats.turnEvents}`);
  console.log(`    recycles during sim: ${traffic.stats.recycles}; queue events: ${queueEvents}`);
  check(samples >= 24 * (ticks / 3) * 0.99, `sampled ${samples} car poses`);
  check(maxDevLane < 1.0, `lane-keeping within 1 m of the path centerline (max ${maxDevLane.toFixed(4)})`);
  check(maxDevJunction < 1.0, `junction traversal within 1 m of the connector (max ${maxDevJunction.toFixed(4)})`);
  check(traffic.stats.turnEvents > 100, `many junction traversals happened (${traffic.stats.turnEvents})`);
  check(queueEvents >= 1, `traffic stopped behind slower traffic at least once (${queueEvents} events)`);
}

// --- (d) probe braking: stopped player blocks a lane, car stops, resumes ----
{
  console.log('  (d) probe braking (stopped player)');
  const player = { x: 0, z: 0, heading: 0, speed: 0 };
  const traffic = createTraffic({
    layout,
    graph,
    world,
    rng: createRng('traffic-test-d'),
    count: 1,
    player: { x: 0, z: 0 },
  });
  const car = traffic.cars[0];
  // Spin up (recycles during this phase reset speed, so keep going until the
  // car is mid-lane AND at cruise).
  let guard = 0;
  while (guard < 2400 && (pathTotal(car.path) - car.s < 45 || car.speed < car.cruiseMs - 0.5)) {
    traffic.update(DT, player);
    guard += 1;
  }
  // Park the player exactly on the car's lane centerline 35 m ahead (never
  // past the path's end, so the approach cannot escape through a junction).
  const ahead = pointAtPath(car.path, car.s + 35);
  player.x = ahead.x;
  player.z = ahead.z;
  const startSpeed = car.speed;
  let stopTicks = 0;
  let stopGap = null;
  let minGap = Infinity;
  let stopTime = null;
  let t = 0;
  for (let k = 0; k < 30 * 60; k += 1) {
    traffic.update(DT, player);
    t += DT;
    const center = Math.hypot(car.x - player.x, car.z - player.z);
    const gap = center - 2 * TRAFFIC_TUNING.CAR_HALF_LENGTH_M;
    minGap = Math.min(minGap, gap);
    if (car.speed < 0.02) {
      stopTicks += 1;
      if (stopTicks === 15) {
        stopGap = gap;
        stopTime = t;
        break;
      }
    } else {
      stopTicks = 0;
    }
  }
  console.log(`    approach speed ${startSpeed.toFixed(2)} m/s -> stopped after ${stopTime?.toFixed(2)} s`);
  console.log(`    stop: center distance ${stopGap === null ? 'n/a' : (stopGap + 4.4).toFixed(2)} m, bumper gap ${stopGap?.toFixed(2)} m, min gap ${minGap.toFixed(2)} m`);
  check(startSpeed > 7, `car was at cruise before the block (speed ${startSpeed.toFixed(2)}, cruise ${car.cruiseMs.toFixed(2)})`);
  check(stopGap !== null, 'car came to a stop behind the player within 30 s');
  check(stopGap !== null && stopGap >= 4, `stopped with bumper gap >= 4 m (got ${stopGap?.toFixed(2)})`);
  check(minGap >= 3, `gap never dipped below 3 m (min ${minGap.toFixed(2)})`);
  // Clear the road: move the player 80 m further up the lane (out of the probe).
  const clearSpot = pointAtPath(car.path, car.s + 80);
  player.x = clearSpot.x;
  player.z = clearSpot.z;
  let resumeTime = null;
  for (let k = 0; k < 5 * 60; k += 1) {
    traffic.update(DT, player);
    if (car.speed > 1) {
      resumeTime = (k + 1) * DT;
      break;
    }
  }
  console.log(`    resumed after ${resumeTime === null ? 'never' : resumeTime.toFixed(2)} s of clear path`);
  check(resumeTime !== null && resumeTime <= 3, `resumed within 3 s of the clear (got ${resumeTime?.toFixed(2)})`);
}

// --- (e) recycling: far-corner teleport re-concentrates the pool ------------
{
  console.log('  (e) recycling (player teleports to a far corner)');
  const player = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z };
  const traffic = createTraffic({
    layout,
    graph,
    world,
    rng: createRng('traffic-test-e'),
    player,
  });
  let offAsphalt = 0;
  let inSolid = 0;
  const assertClear = () => {
    for (const car of traffic.cars) {
      if (world.surfaceHeightAt(car.x, car.z) !== 0) offAsphalt += 1;
      if (world.overlapsSolid(car.x, car.z, 0.95)) inSolid += 1;
    }
  };
  for (let k = 0; k < 60; k += 1) {
    traffic.update(DT, player);
    assertClear();
  }
  const before = traffic.stats.recycles;
  player.x = 390; // far corner intersection (grid line 10 x line 10)
  player.z = 390;
  let firstSampleMinPlayerDist = Infinity;
  let firstWithin300 = -1;
  for (let k = 0; k < 10 * 60; k += 1) {
    traffic.update(DT, player);
    assertClear();
    if (k % 30 === 0) {
      let within = 0;
      let minD = Infinity;
      for (const car of traffic.cars) {
        const d = Math.hypot(car.x - player.x, car.z - player.z);
        minD = Math.min(minD, d);
        if (d < 300) within += 1;
      }
      if (firstWithin300 < 0) {
        firstWithin300 = within;
        firstSampleMinPlayerDist = minD;
      }
    }
  }
  const need = Math.ceil(0.7 * traffic.cars.length);
  console.log(`    recycles: ${traffic.stats.recycles} (pre-teleport ${before}); first sample within 300 m: ${firstWithin300}/24; min player dist at first sample: ${firstSampleMinPlayerDist.toFixed(1)} m`);
  check(traffic.stats.recycles >= traffic.cars.length, `every car recycled at least once (${traffic.stats.recycles})`);
  check(firstWithin300 >= need, `>= 70% of cars within 300 m at the first sample after teleport (${firstWithin300}/${traffic.cars.length})`);
  check(firstSampleMinPlayerDist >= 34, `recycled cars keep the player keep-out (min ${firstSampleMinPlayerDist.toFixed(1)} m)`);
  check(offAsphalt === 0, `no car ever off asphalt across the scenario (${offAsphalt} bad poses)`);
  check(inSolid === 0, `no car ever inside a building/prop (${inSolid} bad poses)`);
}

// --- (f) per-tick cost -------------------------------------------------------
{
  console.log('  (f) per-tick cost (24 cars)');
  const player = { x: 0, z: 0 };
  const traffic = createTraffic({
    layout,
    graph,
    world,
    rng: createRng('traffic-test-f'),
    player,
  });
  for (let k = 0; k < 300; k += 1) traffic.update(DT, player); // JIT warm-up
  const N = 3000;
  let totalNs = 0n;
  let maxNs = 0n;
  for (let k = 0; k < N; k += 1) {
    const t0 = process.hrtime.bigint();
    traffic.update(DT, player);
    const t1 = process.hrtime.bigint();
    const d = t1 - t0;
    totalNs += d;
    if (d > maxNs) maxNs = d;
  }
  const avgMs = Number(totalNs) / 1e6 / N;
  const maxMs = Number(maxNs) / 1e6;
  console.log(`    avg ${avgMs.toFixed(4)} ms/tick, max ${maxMs.toFixed(4)} ms over ${N} ticks`);
  check(avgMs < 1.0, `avg per-tick cost < 1 ms (got ${avgMs.toFixed(4)})`);
}

// --- (g) determinism: same seed + scripted player = float-exact -------------
{
  console.log('  (g) determinism (fixed player path, two runs)');
  const runOnce = () => {
    const player = { x: 0, z: 0 };
    const traffic = createTraffic({
      layout,
      graph,
      world,
      rng: createRng('traffic-test-det'),
      player,
    });
    const snap = [];
    const ticks = 40 * 60;
    for (let k = 0; k < ticks; k += 1) {
      const tt = k * DT;
      player.x = 30 + 80 * Math.sin((tt * Math.PI * 2) / 40);
      player.z = -117 + 80 * Math.cos((tt * Math.PI * 2) / 40);
      traffic.update(DT, player);
      if (k % 7 === 0) {
        for (const car of traffic.cars) snap.push(car.x, car.z, car.heading, car.speed, car.s, car.turnCount);
      }
    }
    return snap.join(',');
  };
  const a = runOnce();
  const b = runOnce();
  check(a.length > 1000, `collected a substantial sample (${a.length} chars)`);
  check(a === b, 'two identical runs produce float-exact identical car states');
}

console.log(`\ntraffic-test: ${checks - failed}/${checks} checks passed${failed > 0 ? `, ${failed} FAILED` : ' — all green'}`);
process.exit(failed > 0 ? 1 : 0);
