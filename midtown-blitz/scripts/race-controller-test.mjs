#!/usr/bin/env node
/**
 * Race controller + Blitz routes harness (Midtown Blitz — task 5.4).
 *
 * Plain node, DOM-free: the race controller and the route data are pure
 * logic/data, so the harness drives them directly with real collaborators
 * (createCountdown, the generated city layout, the lane graph) and stub
 * hud/audio handles. The tick order mirrors main.js's update hook exactly:
 * the countdown controller is advanced FIRST, then race.update() — the
 * controller observes the GO boundary, it never ticks the countdown.
 *
 * Sections:
 *   A. Route data valid (the verification spec's check a + h): three Blitz
 *      routes; ids/names equal the menu's MENU_EVENTS; CRUISE_EVENT.id
 *      equals CRUISE_EVENT_ID; every checkpoint is an exact grid junction
 *      (on asphalt, road surface y = 0); consecutive checkpoints 100-500 m
 *      apart straight-line; start on a road, heading aligned with it;
 *      thresholds strictly ordered gold < silver < bronze < timeLimit;
 *      data frozen and deterministic; and every consecutive checkpoint
 *      pair connects through the road network (BFS over lane-graph nodes).
 *   B. Countdown: controls locked from begin() until GO; no race time
 *      accumulates while locked; the phase flips to running exactly on the
 *      GO boundary tick and the clock starts there (0 at GO).
 *   C. Win path: a scripted car (teleported onto each current target per
 *      tick) finishes all three medal bands by varying the simulated
 *      elapsed time — gold / silver / bronze — plus the over-bronze win
 *      (null medal), each with the correct result payload and exactly one
 *      onFinish and zero onFail.
 *   D. Fail path: an idle car runs the clock past the limit — onFail fires
 *      on the FIRST tick whose accumulated time reaches timeLimit (not a
 *      tick later), with elapsedMs === timeLimitMs exactly, phase 'failed',
 *      and no further callbacks afterwards.
 *   E. Out-of-order: parking the car on checkpoint 2's gate while
 *      checkpoint 1 is the target does nothing.
 *   F. Cruise: 10 minutes of simulated driving — no finish, no fail, no
 *      checkpoints, no HUD timer (setTimer(null) only), phase 'cruising'.
 *   G. Teardown: dispose() mid-race stops every callback (waiting past the
 *      limit and teleporting across gates fire nothing afterwards), and a
 *      fresh controller for the same event runs a complete new win
 *      ("restart builds fresh").
 *
 * Run: node scripts/race-controller-test.mjs   (plain node, no dependencies)
 */
import { generateCity } from '../src/game/city-gen.js';
import { buildLaneGraph } from '../src/game/lane-graph.js';
import { createCountdown } from '../src/game/countdown.js';
import { createRaceController } from '../src/game/race-controller.js';
import {
  RACE_EVENTS,
  RACE_EVENT_BY_ID,
  CRUISE_EVENT,
  resolveRaceEvent,
  medalForTime,
} from '../src/game/races.js';
import { MENU_EVENTS, CRUISE_EVENT_ID } from '../src/ui/main-menu.js';
import { TEST_ROUTE_PASS_RADIUS_M } from '../src/game/test-route.js';

const checks = [];
/**
 * @param {boolean} cond
 * @param {string} label
 */
function check(cond, label) {
  checks.push([!!cond, label]);
  if (!cond) console.log(`    FAIL ${label}`);
}
/** @param {string} name */
function section(name) {
  console.log(`  ${name}`);
}

/** Fixed sim step, same as the engine loop. */
const DT = 1 / 60;
const DT_MS = DT * 1000;

// ---------------------------------------------------------------------------
// Stub collaborators (the controller's exact dependency surface).
// ---------------------------------------------------------------------------

/**
 * HUD stub recording setTimer/setCheckpoint calls; parts.timer mirrors the
 * real HUD's urgency-tint seam.
 * @returns {object} Stub hud.
 */
function makeStubHud() {
  /** @type {Array<number | null>} */
  const timers = [];
  /** @type {Array<object | null>} */
  const checkpoints = [];
  const timerEl = { style: { color: '' } };
  return {
    timers,
    checkpoints,
    timerEl,
    parts: { timer: timerEl },
    /** @param {number | null} ms */
    setTimer(ms) {
      timers.push(ms);
    },
    /** @param {object | null} target */
    setCheckpoint(target) {
      checkpoints.push(target);
    },
  };
}

/**
 * Wire a controller with real countdown + stub hud/audio, recording every
 * callback.
 * @param {object} event Race/cruise event definition.
 * @returns {{ race: object, hud: object, audio: object, countdown: object,
 *   calls: { finish: object[], fail: object[], checkpoint: object[] } }}
 *   Handles + recorded calls.
 */
function makeSession(event) {
  const hud = makeStubHud();
  const audio = {
    blips: 0,
    /** @returns {void} */
    blip() {
      this.blips += 1;
    },
  };
  const countdown = createCountdown({});
  const calls = { finish: [], fail: [], checkpoint: [] };
  const race = createRaceController({
    event,
    hud,
    countdown,
    audio,
    onFinish: (result) => calls.finish.push(result),
    onFail: (failure) => calls.fail.push(failure),
    onCheckpoint: (progress) => calls.checkpoint.push(progress),
  });
  return { race, hud, audio, countdown, calls };
}

/**
 * One main.js-order sim tick: countdown first, then the race controller.
 * @param {ReturnType<typeof makeSession>} session Session handles.
 * @param {{ x: number, z: number }} carState Car position (mutated by the
 *   caller between ticks).
 * @returns {void}
 */
function tick(session, carState) {
  session.countdown.update(DT);
  session.race.update(DT, carState);
}

/**
 * Pump n ticks.
 * @param {ReturnType<typeof makeSession>} session Session handles.
 * @param {{ x: number, z: number }} carState Car position.
 * @param {number} n Tick count.
 * @returns {void}
 */
function pump(session, carState, n) {
  for (let i = 0; i < n; i += 1) tick(session, carState);
}

/**
 * Ticks needed to pass the countdown (3 s of numbers + GO boundary).
 * @param {number} [seconds] Total countdown seconds.
 * @returns {number} Tick count.
 */
const COUNTDOWN_TICKS = Math.ceil(3 / DT);

// ---------------------------------------------------------------------------
// Shared data: city grid + lane graph for the on-road/BFS checks.
// ---------------------------------------------------------------------------
const layout = generateCity();
const graph = buildLaneGraph(layout);
const { linesX, linesZ, roadM } = layout.grid;
const HALF_ROAD = roadM / 2;

/**
 * Index of the grid line exactly at a coordinate (-1 when none).
 * @param {number[]} lines Centerline coordinates.
 * @param {number} v Coordinate.
 * @returns {number} Line index or -1.
 */
function lineIndexAt(lines, v) {
  return lines.findIndex((line) => line === v);
}

/**
 * Lane-graph node index for a grid junction (ix + iz * linesX.length).
 * @param {number} ix Column index.
 * @param {number} iz Row index.
 * @returns {number} Node index.
 */
const nodeIndex = (ix, iz) => ix + iz * linesX.length;

/**
 * BFS reachability over the lane graph's node adjacency (undirected: a
 * road segment is drivable in its lane direction, and every grid segment
 * carries both directions, so lane edges as undirected edges are exactly
 * "connected by roads").
 * @param {number} from Start node index.
 * @param {number} to Goal node index.
 * @returns {boolean} Whether a road path exists.
 */
function roadConnected(from, to) {
  const n = graph.nodes.length;
  /** @type {number[][]} */
  const adj = Array.from({ length: n }, () => []);
  for (const lane of graph.lanes) {
    adj[lane.fromNode].push(lane.toNode);
    adj[lane.toNode].push(lane.fromNode);
  }
  const seen = new Uint8Array(n);
  const queue = [from];
  seen[from] = 1;
  while (queue.length > 0) {
    const cur = /** @type {number} */ (queue.pop());
    if (cur === to) return true;
    for (const next of adj[cur]) {
      if (!seen[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return false;
}

// ===========================================================================
// A. Route data valid (spec checks a + h)
// ===========================================================================
section('A. route data');

check(Array.isArray(RACE_EVENTS) && RACE_EVENTS.length === 3,
  `exactly three Blitz routes (got ${RACE_EVENTS.length})`);
check(RACE_EVENTS.every((event) => event.type === 'blitz'), 'all routes are type blitz');
check(
  JSON.stringify(RACE_EVENTS.map((event) => event.id)) === JSON.stringify(MENU_EVENTS.map((event) => event.id)),
  'route ids match MENU_EVENTS ids in order'
);
check(
  JSON.stringify(RACE_EVENTS.map((event) => event.name)) === JSON.stringify(MENU_EVENTS.map((event) => event.name)),
  'route names match MENU_EVENTS names in order'
);
check(CRUISE_EVENT.id === CRUISE_EVENT_ID, 'CRUISE_EVENT.id === menu CRUISE_EVENT_ID');
check(CRUISE_EVENT.type === 'cruise' && !Array.isArray(CRUISE_EVENT.checkpoints) && CRUISE_EVENT.timeLimitMs === undefined,
  'cruise event: no checkpoints, no timer');
check(resolveRaceEvent('blitz-tower') === RACE_EVENT_BY_ID['blitz-tower'] &&
  resolveRaceEvent('cruise') === CRUISE_EVENT && resolveRaceEvent('bogus') === null,
  'resolveRaceEvent maps blitz/cruise/unknown correctly');

/** Route-level structural expectations, checked per route below. */
for (const event of RACE_EVENTS) {
  const tag = event.id;
  const { start, checkpoints, timeLimitMs, thresholds } = event;

  // >= 3 checkpoints, finite, labeled.
  check(checkpoints.length >= 3, `${tag}: >= 3 checkpoints (got ${checkpoints.length})`);
  check(checkpoints.every((cp) => Number.isFinite(cp.x) && Number.isFinite(cp.z) && typeof cp.label === 'string'),
    `${tag}: checkpoints finite + labeled`);

  // Every checkpoint is an EXACT grid junction: on both a linesX and a
  // linesZ centerline -> on asphalt, road surface (surfaceHeight) 0, inside
  // the junction box (junction half-size = HALF_ROAD; distance 0 to center).
  const junctionOk = checkpoints.every((cp) => lineIndexAt(linesX, cp.x) >= 0 && lineIndexAt(linesZ, cp.z) >= 0);
  check(junctionOk, `${tag}: every checkpoint sits exactly on a grid junction (road level 0)`);

  // Consecutive checkpoints 100-500 m apart straight-line (the shipped
  // pitch is 78 m, so single-block hops are deliberately excluded).
  let hopsOk = true;
  let totalDriveM = 0;
  let prev = { x: start.x, z: start.z };
  for (const cp of checkpoints) {
    const straight = Math.hypot(cp.x - prev.x, cp.z - prev.z);
    totalDriveM += Math.abs(cp.x - prev.x) + Math.abs(cp.z - prev.z);
    if (straight < 100 || straight > 500) hopsOk = false;
    prev = cp;
  }
  check(hopsOk, `${tag}: consecutive checkpoints all 100-500 m apart`);
  check(totalDriveM >= 1000 && totalDriveM <= 4000,
    `${tag}: driving length ~1-4 km (got ${Math.round(totalDriveM)} m)`);

  // Start on a road, heading aligned with it (heading 0/PI -> vertical road;
  // +-PI/2 -> horizontal road), lane offset within the asphalt.
  const vertical = Math.abs(Math.sin(start.heading)) < 1e-9;
  const horizontal = Math.abs(Math.cos(start.heading)) < 1e-9;
  check(vertical || horizontal, `${tag}: start heading along a road axis`);
  const laneOffsetOk = vertical
    ? linesX.some((line) => Math.abs(start.x - line) <= HALF_ROAD)
    : linesZ.some((line) => Math.abs(start.z - line) <= HALF_ROAD);
  check(laneOffsetOk, `${tag}: start position on the road it heads along (within asphalt)`);

  // Thresholds strictly ordered, positive integers; limit strictly above bronze.
  const { gold, silver, bronze } = thresholds;
  check(Number.isInteger(gold) && Number.isInteger(silver) && Number.isInteger(bronze) && Number.isInteger(timeLimitMs),
    `${tag}: thresholds + limit are integer ms`);
  check(gold > 0 && gold < silver && silver < bronze && bronze < timeLimitMs,
    `${tag}: gold ${gold} < silver ${silver} < bronze ${bronze} < limit ${timeLimitMs}`);

  // Drivability: consecutive checkpoints connect through the road network
  // (BFS over lane-graph junction nodes, including start junction -> cp1).
  let connected = true;
  let prevNode = null;
  for (const cp of checkpoints) {
    const ix = /** @type {number} */ (lineIndexAt(linesX, cp.x));
    const iz = /** @type {number} */ (lineIndexAt(linesZ, cp.z));
    const node = nodeIndex(ix, iz);
    if (prevNode !== null && !roadConnected(/** @type {number} */ (prevNode), node)) connected = false;
    prevNode = node;
  }
  check(connected, `${tag}: consecutive checkpoints road-connected (lane-graph BFS)`);

  // Gold pace sanity: gold requires <= ~33 m/s (60% of the 55.56 m/s top
  // speed) average INCLUDING turns — achievable at 60-70% top speed.
  const goldPace = totalDriveM / (gold / 1000);
  check(goldPace > 25 && goldPace <= 34,
    `${tag}: gold pace ${goldPace.toFixed(1)} m/s (~56-70% of top speed)`);
}

// Deterministic pure data: identical stringifies + deep-frozen.
check(JSON.stringify(RACE_EVENTS) === JSON.stringify(RACE_EVENTS), 'route data stringifies stably');
check(RACE_EVENTS.every((event) =>
  Object.isFrozen(event) && Object.isFrozen(event.checkpoints) && Object.isFrozen(event.thresholds) &&
  Object.isFrozen(event.start)),
  'route definitions deep-frozen');

// ===========================================================================
// B. Countdown: locked until GO, timer starts at GO
// ===========================================================================
section('B. countdown lock + GO boundary');

{
  const downtown = /** @type {typeof RACE_EVENTS[number]} */ (RACE_EVENT_BY_ID['blitz-downtown']);
  const session = makeSession(downtown);
  const far = { x: 1e6, z: 1e6 }; // nowhere near any gate

  const first = session.race.begin();
  check(first === downtown.checkpoints[0], 'begin() returns the first gate');
  check(session.race.phase() === 'countdown', "phase 'countdown' right after begin()");
  check(session.countdown.isActive() && session.countdown.controlsLocked(),
    'begin() started the countdown with the controls locked');
  check(session.hud.checkpoints[session.hud.checkpoints.length - 1] === first,
    'HUD guidance set to the first gate at begin()');
  check(session.hud.timers[session.hud.timers.length - 1] === downtown.timeLimitMs,
    'HUD timer set to the full limit at begin()');
  check(session.race.elapsedMs() === 0 && session.race.remainingMs() === downtown.timeLimitMs,
    'clock at zero, remaining = limit at begin()');
  check(session.race.begin() === null, 'begin() is idempotent (second call no-op)');

  // Locked phase: 100 ticks (~1.67 s) — no clock movement, still countdown.
  pump(session, far, 100);
  check(session.race.phase() === 'countdown' && session.race.elapsedMs() === 0,
    'no race time accumulates while the countdown runs');
  check(session.countdown.controlsLocked(), 'controls still locked mid-countdown');

  // Cross the GO boundary exactly: after COUNTDOWN_TICKS the countdown has
  // fired onGo and unlocked; the controller must be running with elapsed 0.
  pump(session, far, COUNTDOWN_TICKS - 100);
  check(!session.countdown.controlsLocked(), 'GO unlocked the controls');
  check(session.race.phase() === 'running', "phase 'running' on the GO boundary tick");
  check(session.race.elapsedMs() === 0, 'race clock starts AT the GO boundary (0 elapsed there)');

  // One more tick moves the clock by exactly one dt.
  pump(session, far, 1);
  check(Math.abs(session.race.elapsedMs() - DT_MS) < 1e-9,
    `clock advanced by one sim tick after GO (${session.race.elapsedMs().toFixed(2)} ms)`);
}

// ===========================================================================
// C. Win path: all three medal bands + the over-bronze win
// ===========================================================================
section('C. win path + medal bands');

{
  const downtown = /** @type {typeof RACE_EVENTS[number]} */ (RACE_EVENT_BY_ID['blitz-downtown']);
  const { gold, silver, bronze } = downtown.thresholds;
  const { timeLimitMs } = downtown;

  /**
   * Drive a full scripted win: hold the car far from gate 1 until the race
   * clock reaches roughly `waitMs` (so the finish time lands in the wanted
   * medal band), then teleport onto each current target per tick until the
   * race finishes. Returns the observed finish.
   * @param {number} waitMs Simulated ms to burn before the first gate.
   * @returns {{ result: object | null, session: ReturnType<typeof makeSession> }}
   *   The onFinish payload (null when it never fired) + session.
   */
  function driveAndWait(waitMs) {
    const session = makeSession(downtown);
    const car = { x: 1e6, z: 1e6 };
    session.race.begin();
    pump(session, car, COUNTDOWN_TICKS); // GO
    // Burn time away from the gates (idle start line — clock runs).
    while (session.race.elapsedMs() < waitMs && session.race.phase() === 'running') {
      tick(session, car);
    }
    // Teleport through the gates in order (0 m from each target: inside the
    // 12 m pass radius by construction).
    let guard = 0;
    while (session.race.phase() === 'running' && guard < 100) {
      const target = session.race.currentTarget();
      if (target) {
        car.x = target.x;
        car.z = target.z;
      }
      tick(session, car);
      guard += 1;
    }
    return { result: session.calls.finish[0] ?? null, session };
  }

  // The bands: <= gold, (gold, silver], (silver, bronze], (bronze, limit).
  const bands = [
    { name: 'gold', waitMs: 5000, medal: 'gold' },
    { name: 'silver', waitMs: gold + (silver - gold) / 2, medal: 'silver' },
    { name: 'bronze', waitMs: silver + (bronze - silver) / 2, medal: 'bronze' },
    { name: 'none (over bronze, under limit)', waitMs: bronze + (timeLimitMs - bronze) / 2, medal: null },
  ];
  for (const band of bands) {
    const { result, session } = driveAndWait(band.waitMs);
    check(!!result, `${band.name}: race finished (onFinish fired)`);
    if (!result) continue;
    check(session.calls.fail.length === 0, `${band.name}: no onFail`);
    check(session.calls.finish.length === 1, `${band.name}: exactly one onFinish`);
    check(result.eventId === 'blitz-downtown', `${band.name}: result carries the event id`);
    check(result.medal === band.medal,
      `${band.name}: medal ${JSON.stringify(result.medal)} as expected (time ${Math.round(result.timeMs)} ms)`);
    check(result.timeMs >= band.waitMs && result.timeMs < timeLimitMs,
      `${band.name}: finish time inside the simulated band`);
    check(session.race.phase() === 'finished', `${band.name}: phase 'finished'`);
    check(session.race.currentTarget() === null, `${band.name}: no target after the final gate`);
    check(session.hud.timers[session.hud.timers.length - 1] === result.timeMs,
      `${band.name}: HUD timer frozen on the finish time`);
    // Chimes: one per gate pass INCLUDING the final gate.
    check(session.audio.blips === downtown.checkpoints.length,
      `${band.name}: chime on every gate (${session.audio.blips}/${downtown.checkpoints.length})`);
  }

  // medalForTime boundaries (inclusive cutoffs).
  const th = downtown.thresholds;
  check(medalForTime(th.gold, th) === 'gold' && medalForTime(th.gold + 1, th) === 'silver' &&
    medalForTime(th.silver, th) === 'silver' && medalForTime(th.silver + 1, th) === 'bronze' &&
    medalForTime(th.bronze, th) === 'bronze' && medalForTime(th.bronze + 1, th) === null &&
    medalForTime(-1, th) === null && medalForTime(NaN, th) === null,
    'medalForTime cutoff boundaries inclusive, invalid times null');

  // Every route is winnable well under its limit in the harness model
  // (guards against a route whose limit is shorter than its own drive).
  for (const event of RACE_EVENTS) {
    const session = makeSession(event);
    const car = { x: 1e6, z: 1e6 };
    session.race.begin();
    pump(session, car, COUNTDOWN_TICKS);
    let guard = 0;
    while (session.race.phase() === 'running' && guard < 200) {
      const target = session.race.currentTarget();
      if (target) {
        car.x = target.x;
        car.z = target.z;
      }
      tick(session, car);
      guard += 1;
    }
    const result = session.calls.finish[0];
    check(!!result && result.timeMs < event.timeLimitMs && result.medal === 'gold',
      `${event.id}: flat-out teleport run wins gold under the limit (${result ? Math.round(result.timeMs) : 'no'} ms)`);
  }
}

// ===========================================================================
// D. Fail path: expiry on the EXACT tick, payload = limit
// ===========================================================================
section('D. fail path (timer expiry)');

{
  const downtown = /** @type {typeof RACE_EVENTS[number]} */ (RACE_EVENT_BY_ID['blitz-downtown']);
  const session = makeSession(downtown);
  const car = { x: 1e6, z: 1e6 }; // never reaches a gate
  session.race.begin();
  pump(session, car, COUNTDOWN_TICKS);

  // Tick until the callback fires, recording the clock just before.
  let preElapsed = 0;
  let ticksAfterGo = 0;
  while (session.calls.fail.length === 0 && ticksAfterGo < 100000) {
    preElapsed = session.race.elapsedMs();
    tick(session, car);
    ticksAfterGo += 1;
  }
  check(session.calls.fail.length === 1, 'onFail fired exactly once');
  check(preElapsed < downtown.timeLimitMs,
    `clock was still under the limit the tick before (${preElapsed.toFixed(2)} < ${downtown.timeLimitMs})`);
  check(session.race.elapsedMs() >= downtown.timeLimitMs,
    'clock reached the limit on the firing tick');
  const failure = /** @type {object} */ (session.calls.fail[0]);
  check(failure.elapsedMs === downtown.timeLimitMs,
    `failure payload elapsedMs === timeLimit exactly (${failure.elapsedMs})`);
  check(failure.eventId === 'blitz-downtown', 'failure payload carries the event id');
  check(session.race.phase() === 'failed', "phase 'failed' after expiry");
  check(session.calls.finish.length === 0, 'no onFinish on the fail path');
  check(session.race.remainingMs() === 0, 'remaining clamped at 0');

  // Terminal: further ticks fire nothing more.
  const failCount = session.calls.fail.length;
  pump(session, car, 500);
  check(session.calls.fail.length === failCount && session.calls.finish.length === 0,
    'no further callbacks after the failure (terminal)');

  // The boot-style HUD readout: last timer write is 0 (0:00.0 on screen).
  check(session.hud.timers[session.hud.timers.length - 1] === 0, 'HUD timer showed 0 at expiry');
}

// ===========================================================================
// E. Out-of-order gates do nothing
// ===========================================================================
section('E. out-of-order checkpoints');

{
  const downtown = /** @type {typeof RACE_EVENTS[number]} */ (RACE_EVENT_BY_ID['blitz-downtown']);
  const session = makeSession(downtown);
  const car = { x: 1e6, z: 1e6 };
  session.race.begin();
  pump(session, car, COUNTDOWN_TICKS);

  // Sit ON gate 2 (and 3) while gate 1 is the target: nothing may advance.
  const cp2 = /** @type {object} */ (downtown.checkpoints[1]);
  const cp3 = /** @type {object} */ (downtown.checkpoints[2]);
  car.x = cp2.x;
  car.z = cp2.z;
  pump(session, car, 30);
  check(session.race.currentTarget() === downtown.checkpoints[0], 'still targeting gate 1 while sitting on gate 2');
  check(session.calls.checkpoint.length === 0 && session.audio.blips === 0, 'no advance/chime for a later gate');
  car.x = cp3.x;
  car.z = cp3.z;
  pump(session, car, 30);
  check(session.race.currentTarget() === downtown.checkpoints[0], 'still targeting gate 1 while sitting on gate 3');

  // Now take gate 1 properly: exactly one advance, target moves to gate 2.
  const cp1 = /** @type {object} */ (downtown.checkpoints[0]);
  car.x = cp1.x;
  car.z = cp1.z;
  tick(session, car);
  check(session.calls.checkpoint.length === 1, 'passing the CURRENT gate advances exactly once');
  check(session.calls.checkpoint[0].index === 1 && session.calls.checkpoint[0].total === downtown.checkpoints.length,
    'advance payload carries index/total');
  check(session.race.currentTarget() === cp2, 'target switched to gate 2 in order');
  check(session.audio.blips === 1, 'one chime for the pass');
}

// ===========================================================================
// F. Cruise: 10 minutes of sim, no finish/fail/timer
// ===========================================================================
section('F. cruise never ends');

{
  const session = makeSession(CRUISE_EVENT);
  const car = { x: 0, z: -117 };
  const first = session.race.begin();
  check(first === null, 'cruise begin() returns no target');
  check(session.hud.timers.every((ms) => ms === null),
    'cruise HUD timer stays the dimmed placeholder (setTimer(null) only)');
  check(session.countdown.isActive() && session.countdown.controlsLocked(),
    'cruise still starts (controls lock through the countdown)');
  pump(session, car, COUNTDOWN_TICKS);
  check(session.race.phase() === 'cruising', "phase 'cruising' after GO");

  // 10 minutes of simulated driving, wandering anywhere.
  const TEN_MIN_TICKS = 600 / DT;
  for (let i = 0; i < TEN_MIN_TICKS; i += 1) {
    car.x = Math.sin(i / 500) * 300;
    car.z = Math.cos(i / 370) * 300;
    tick(session, car);
  }
  check(session.calls.finish.length === 0, 'no onFinish in 10 min');
  check(session.calls.fail.length === 0, 'no onFail in 10 min');
  check(session.calls.checkpoint.length === 0, 'no checkpoints in cruise');
  check(session.audio.blips === 0, 'no chimes in cruise');
  check(session.race.phase() === 'cruising' && session.race.isCruise() && !session.race.isDisposed(),
    'still cruising after 10 min');
  check(session.race.remainingMs() === null && session.race.elapsedMs() === 0,
    'no timer ever ran (remaining null, clock never started)');
}

// ===========================================================================
// G. Teardown: disposed sessions never fire again; restart builds fresh
// ===========================================================================
section('G. teardown + restart');

{
  const downtown = /** @type {typeof RACE_EVENTS[number]} */ (RACE_EVENT_BY_ID['blitz-downtown']);
  const session = makeSession(downtown);
  const car = { x: 1e6, z: 1e6 };
  session.race.begin();
  pump(session, car, COUNTDOWN_TICKS);
  // Pass the first gate mid-race, then tear the session down.
  car.x = /** @type {object} */ (downtown.checkpoints[0]).x;
  car.z = /** @type {object} */ (downtown.checkpoints[0]).z;
  tick(session, car);
  check(session.calls.checkpoint.length === 1, 'mid-race: first gate taken');
  session.race.dispose();
  session.race.dispose(); // idempotent
  check(session.race.isDisposed(), 'dispose() marks the session disposed');

  // Try hard to make the dead session fire: wait past the limit, teleport
  // across every remaining gate.
  const before = {
    finish: session.calls.finish.length,
    fail: session.calls.fail.length,
    checkpoint: session.calls.checkpoint.length,
    blips: session.audio.blips,
  };
  pump(session, { x: 1e6, z: 1e6 }, Math.ceil(downtown.timeLimitMs / DT_MS) + 100);
  for (const cp of downtown.checkpoints.slice(1)) {
    car.x = cp.x;
    car.z = cp.z;
    tick(session, car);
  }
  check(session.calls.finish.length === before.finish &&
    session.calls.fail.length === before.fail &&
    session.calls.checkpoint.length === before.checkpoint &&
    session.audio.blips === before.blips,
    'zero callbacks after dispose (waiting past the limit + gate teleports included)');

  // Restart: a FRESH controller for the same event runs a complete new win.
  const fresh = makeSession(downtown);
  const car2 = { x: 1e6, z: 1e6 };
  fresh.race.begin();
  pump(fresh, car2, COUNTDOWN_TICKS);
  let guard = 0;
  while (fresh.race.phase() === 'running' && guard < 100) {
    const target = fresh.race.currentTarget();
    if (target) {
      car2.x = target.x;
      car2.z = target.z;
    }
    tick(fresh, car2);
    guard += 1;
  }
  check(fresh.calls.finish.length === 1 && fresh.race.phase() === 'finished',
    'restart builds a fresh session that finishes normally');
}

// ---------------------------------------------------------------------------

const failed = checks.filter(([ok]) => !ok).length;
console.log(
  failed === 0
    ? `  race-controller-test: ${checks.length}/${checks.length} checks passed — all green`
    : `  race-controller-test: ${failed}/${checks.length} checks FAILED`
);
process.exitCode = failed === 0 ? 0 : 1;
