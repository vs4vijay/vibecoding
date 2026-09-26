#!/usr/bin/env node
/**
 * Scripted verification harness for src/engine/loop.js (task 1.2).
 *
 * Stands in for the "DevTools CPU 6x throttling" manual check by driving the
 * loop's `frame(nowMs)` step with scripted frame timestamps:
 *
 *   1. steady 60 fps for 30 s  -> sim clock matches wall clock within 2%
 *   2. stuttered 20 fps for 30 s -> sim clock matches wall clock within 2%
 *   3. jittered ~60 fps for 30 s -> sim clock matches wall clock within 2%
 *   4. 60 fps with 1 s stalls  -> at most 5 catch-up ticks per frame, dropped
 *      time reported, and time conservation holds (wall = sim + dropped)
 *   5. 6x-throttle-like 10 fps for 10 s -> catch-up clamp holds; the sim
 *      lags wall clock only by the deliberately dropped time (informational)
 *   6. rAF driver smoke test   -> render hook receives alpha per frame and
 *      stop() halts the loop
 *
 * Every scenario additionally asserts: interpolation alpha in [0, 1),
 * visual time always within one tick of the sim clock (never ahead of the
 * latest simulated state) and never jumping backwards.
 *
 * Run: node scripts/loop-test.mjs   (plain node, no dependencies)
 */
import { createFixedTimestepLoop, SIM_DT, MAX_TICKS_PER_FRAME } from '../src/engine/loop.js';

const TOL = 1e-9;
const REL_TOL = 0.02; // spec: sim clock tracks wall clock within ~2%

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
 * Timestamps at a steady frames-per-second cadence.
 * @param {number} fps Frame rate.
 * @param {number} seconds Total wall-clock seconds covered.
 * @returns {number[]} rAF-style millisecond timestamps.
 */
function steadyStamps(fps, seconds) {
  const stepMs = 1000 / fps;
  const stamps = [];
  for (let k = 0; k <= Math.round(seconds * fps); k += 1) stamps.push(k * stepMs);
  return stamps;
}

/**
 * Drive the loop over a scripted timestamp stream and collect per-frame info.
 * @param {number[]} stamps rAF-style millisecond timestamps.
 * @returns {{perFrame: object[], visualMonotonic: boolean, totalTicks: number}} Collected frames.
 */
function runFrames(stamps) {
  const perFrame = [];
  let prevVisual = null;
  let visualMonotonic = true;
  let totalTicks = 0;
  const loop = createFixedTimestepLoop({ update: () => {}, render: () => {} });
  for (const t of stamps) {
    const info = loop.frame(t);
    perFrame.push(info);
    totalTicks += info.ticks;
    if (prevVisual !== null && info.visualTime < prevVisual - TOL) visualMonotonic = false;
    prevVisual = info.visualTime;
  }
  return { perFrame, visualMonotonic, totalTicks };
}

/**
 * Invariants that must hold in every scenario.
 * @param {string} name Scenario name.
 * @param {{perFrame: object[], visualMonotonic: boolean}} res Collected frames.
 * @returns {void}
 */
function checkCommonInvariants(name, res) {
  let alphaOk = true;
  let bandOk = true;
  let clampOk = true;
  for (const f of res.perFrame) {
    if (!(f.alpha >= 0 && f.alpha < 1)) alphaOk = false;
    if (!(f.visualTime >= f.simTime - SIM_DT - TOL && f.visualTime <= f.simTime + TOL)) bandOk = false;
    if (f.ticks > MAX_TICKS_PER_FRAME) clampOk = false;
  }
  check(alphaOk, `${name}: interpolation alpha within [0, 1) on every frame`);
  check(bandOk, `${name}: visual time stays within one tick of the sim clock (never more than one tick ahead of simulated state)`);
  check(clampOk, `${name}: no frame ever runs more than ${MAX_TICKS_PER_FRAME} catch-up ticks`);
  check(res.visualMonotonic, `${name}: visual time never jumps backwards between consecutive rendered frames`);
}

/**
 * Assert time conservation: wall delta = sim time + dropped time + pending accumulator.
 * @param {number[]} stamps Scripted timestamps.
 * @param {object[]} perFrame Per-frame infos.
 * @param {string} name Scenario name.
 * @returns {void}
 */
function checkConservation(stamps, perFrame, name) {
  const wall = (stamps[stamps.length - 1] - stamps[0]) / 1000;
  const last = perFrame[perFrame.length - 1];
  const dropped = perFrame.reduce((sum, f) => sum + f.droppedTime, 0);
  const pending = last.alpha * SIM_DT; // accumulator remainder left for the next frame
  checkClose(last.simTime + dropped + pending, wall, 1e-6, `${name}: wall = sim + dropped + pending (time conservation)`);
  return { wall, sim: last.simTime, dropped };
}

/**
 * Scenario: sim clock must track wall clock within 2%.
 * @param {string} name Scenario name.
 * @param {number[]} stamps Scripted timestamps.
 * @returns {void}
 */
function runTrackingScenario(name, stamps) {
  console.log(`  ${name}`);
  const res = runFrames(stamps);
  const last = res.perFrame[res.perFrame.length - 1];
  const wall = (stamps[stamps.length - 1] - stamps[0]) / 1000;
  checkCommonInvariants(name, res);
  checkClose(last.simTime, wall, wall * REL_TOL, `${name}: sim clock matches wall clock within ${REL_TOL * 100}% over ${wall} s`);
  checkConservation(stamps, res.perFrame, name);
}

console.log('loop-test: scripted fixed-timestep loop verification\n');

// --- 1. Steady 60 fps, 30 s -------------------------------------------------
runTrackingScenario('60 fps / 30 s', steadyStamps(60, 30));

// --- 2. Stuttered 20 fps, 30 s ---------------------------------------------
runTrackingScenario('20 fps / 30 s', steadyStamps(20, 30));

// --- 3. Jittered ~60 fps, 30 s ---------------------------------------------
{
  const stamps = [0];
  let seed = 0x2f6e2b1; // fixed seed: deterministic jitter stream
  let t = 0;
  while (t < 30000) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const jitter = ((seed / 0x7fffffff) - 0.5) * 12; // +/- 6 ms around 16.67 ms
    t += 1000 / 60 + jitter;
    stamps.push(t);
  }
  runTrackingScenario('jittered ~60 fps / 30 s', stamps);
}

// --- 4. 60 fps with periodic 1 s stalls ------------------------------------
{
  const name = '60 fps with 1 s stalls';
  console.log(`  ${name}`);
  const stamps = [0];
  let t = 0;
  let k = 0;
  while (t < 30000) {
    k += 1;
    t += k % 150 === 0 ? 1000 : 1000 / 60; // every ~2.5 s the frame stalls for 1 s
    stamps.push(t);
  }
  const res = runFrames(stamps);
  checkCommonInvariants(name, res);

  let stallFrames = 0;
  let clampOk = true;
  let dropOk = true;
  for (const f of res.perFrame) {
    if (f.frameDelta > 0.5) {
      stallFrames += 1;
      if (f.ticks !== MAX_TICKS_PER_FRAME) clampOk = false;
      if (!(f.droppedTime >= 1 - MAX_TICKS_PER_FRAME * SIM_DT - 1e-9)) dropOk = false;
    }
  }
  check(stallFrames > 0, `${name}: stall frames were exercised (${stallFrames} seen)`);
  check(clampOk, `${name}: each 1 s stall frame performs at most (exactly) ${MAX_TICKS_PER_FRAME} catch-up ticks`);
  check(dropOk, `${name}: each 1 s stall frame drops the backlog beyond the clamp instead of simulating it`);
  const totals = checkConservation(stamps, res.perFrame, name);
  check(
    totals.dropped > 0 && totals.sim < totals.wall,
    `${name}: sim clock lags wall clock after stalls only by the dropped time (${totals.sim.toFixed(2)} s sim vs ${totals.wall.toFixed(2)} s wall, ${totals.dropped.toFixed(2)} s dropped)`
  );

  // Visual time advance per rendered frame is bounded by clamp + interpolation slack.
  let maxVisualJump = 0;
  for (let i = 1; i < res.perFrame.length; i += 1) {
    maxVisualJump = Math.max(maxVisualJump, res.perFrame[i].visualTime - res.perFrame[i - 1].visualTime);
  }
  check(
    maxVisualJump <= (MAX_TICKS_PER_FRAME + 1) * SIM_DT + TOL,
    `${name}: visual time advance between rendered frames bounded by ${MAX_TICKS_PER_FRAME} catch-up ticks + one interpolation tick (max seen ${(maxVisualJump / SIM_DT).toFixed(2)} ticks)`
  );
}

// --- 5. 6x-throttle-like 10 fps, 10 s (informational) -----------------------
{
  const name = '6x-throttle-like 10 fps / 10 s';
  console.log(`  ${name}`);
  const res = runFrames(steadyStamps(10, 10));
  checkCommonInvariants(name, res);
  const totals = checkConservation(steadyStamps(10, 10), res.perFrame, name);
  // 10 fps needs 6 ticks/frame to keep pace; the clamp allows 5, so the rest
  // is dropped by design (documented catch-up limit, not drift).
  const expectedSim = res.totalTicks * SIM_DT;
  checkClose(totals.sim, expectedSim, 1e-9, `${name}: sim time equals executed ticks x SIM_DT`);
  console.log(
    `    info: 10 fps x 5-tick clamp caps sim at ${(res.totalTicks * SIM_DT).toFixed(2)} s of ${totals.wall.toFixed(2)} s wall (${(((res.totalTicks * SIM_DT) / totals.wall) * 100).toFixed(1)}%); the shortfall is deliberate dropped time, per the max-5 catch-up design`
  );
}

// --- 6. rAF driver + render hook smoke test ---------------------------------
{
  const name = 'rAF driver + render hook';
  console.log(`  ${name}`);
  const stepMs = 1000 / 60;
  let now = 0;
  let queue = [];
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => (queue.push(cb), queue.length);
  globalThis.cancelAnimationFrame = () => {};

  const updates = [];
  const renders = [];
  const loop = createFixedTimestepLoop({
    update: (dt, simTime) => updates.push({ dt, simTime }),
    render: (alpha, info) => renders.push({ alpha, info }),
  });
  loop.start();
  for (let i = 0; i < 120; i += 1) {
    now += stepMs;
    const cbs = queue;
    queue = [];
    for (const cb of cbs) cb(now);
  }
  // 120 pumped frames -> the first is the start() baseline (dt 0, no ticks),
  // so exactly 119 ticks ran and the render hook still fired 120 times.
  check(updates.length === 119, `${name}: first pumped frame is the start() baseline, then exactly one tick per 16.67 ms frame (${updates.length} ticks)`);
  check(renders.length === 120, `${name}: render hook called once per frame (${renders.length})`);
  check(
    renders.every((r) => r.alpha >= 0 && r.alpha < 1),
    `${name}: render hook receives alpha in [0, 1) on every frame`
  );
  check(
    renders.every((r, i) => r.info.simTime <= i * SIM_DT + TOL && r.info.simTime >= i * SIM_DT - SIM_DT - TOL),
    `${name}: render hook sim clock never runs ahead of the frames elapsed and at most one tick behind (fp jitter)`
  );
  check(
    renders.every((r, i) => i === 0 || r.info.simTime >= renders[i - 1].info.simTime - TOL),
    `${name}: render hook sim clock never goes backwards`
  );
  check(Math.abs(loop.simTime - (119 / 60)) < 1e-6, `${name}: loop.simTime getter reports ~1.983 s after 120 frames (${loop.simTime.toFixed(4)} s)`);
  loop.stop();
  const afterStop = renders.length;
  for (let i = 0; i < 5; i += 1) {
    now += stepMs;
    const cbs = queue;
    queue = [];
    for (const cb of cbs) cb(now);
  }
  check(renders.length === afterStop, `${name}: stop() halts the rAF driver (no renders after stop)`);
  globalThis.requestAnimationFrame = prevRaf;
  globalThis.cancelAnimationFrame = prevCancel;
}

console.log(`\nloop-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`loop-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('loop-test: ALL PASS');
