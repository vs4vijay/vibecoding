#!/usr/bin/env bun
/**
 * QA player probe (task 3.4; kept as the entity regression tool). Same
 * browser flags as shot.mjs, plus --js-flags=--expose-gc for the heap check.
 * Since task 4.3 the probe installs qa/player_stage.js in-page (a fresh
 * createPlayer instance, never the live RUN mode's player):
 *
 * Usage: bun .qa/player_probe.mjs <url> [--settle-ms 2500] [--live-ms 8000]
 *
 * Verifies, in ONE page load of ?qa=1&mode=run&scene=game:
 *  1. lane change: eased x reaches the target lane within CONFIG
 *     laneChangeTime (+1 step), monotone smoothstep, clamped no-ops at the
 *     outer lanes, mid-ease re-target from the current body position;
 *  2. jump: profile.y0 follows the discrete parabola (apex ~= v0^2/2g,
 *     airtime ~= 2 v0/g), lands back to run, cadence (phase) resumes;
 *  3. slide: profile.y1 caps at slideTop for exactly the CONFIG window,
 *     y0 stays 0, then run resumes;
 *  4. request rules: jump during slide ignored, slide during jump ignored,
 *     jump+slide latched together -> jump wins, lane change mid-air allowed;
 *  5. render interpolation: sample(1) of step k == sample(0) of step k+1
 *     (boundary-continuous), mid-alpha samples pop-free, phase unwrap clean
 *     across the TAU wrap (mid-alpha hip ~= midpoint of the bracket);
 *  6. die(): crumple settles (dead weight -> 1, y -> 0), profile stays live;
 *  7. EXACT added draw/tri cost via __QA_PLAYER.measure() (root hidden vs
 *     shown around a direct renderer.render) + the shadow-pass A/B via
 *     measureShadow() (castShadow off vs on);
 *  8. allocation: forced GC -> 600 fixed+render steps with cycling requests
 *     -> forced GC (retained delta ~= 0), then a heap series across live-ms.
 * Prints one JSON report; touches nothing in the page outside __QA_*.
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args[0];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const settleMs = parseInt(opt("settle-ms", "2500"), 10);
const liveMs = parseInt(opt("live-ms", "8000"), 10);
const waitMs = parseInt(opt("wait", "12000"), 10);

if (!url) {
  console.error("usage: bun .qa/player_probe.mjs <url> [--settle-ms n] [--live-ms n]");
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
    "--js-flags=--expose-gc",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") consoleWarns.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
const ready = await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
    timeout: Math.max(waitMs, 1000),
    polling: 250,
  })
  .then(() => true)
  .catch(() => false);
if (!ready) await page.waitForTimeout(waitMs);
await page.waitForTimeout(settleMs);

// Probe-side fixture (task 4.3): qa/player_stage.js now installs in-page
// (main.js no longer constructs/ticks it — the probe drives synchronously).
await page.evaluate(async () => {
  const m = await import("/qa/player_stage.js");
  m.createPlayerStage(window.__QA_AUDIT.scene, (await import("/js/core/assets.js")).materialLibrary);
});

// Quiet the capture autopilot once; every block below resets the player and
// runs synchronously (the rAF loop cannot interleave inside an evaluate).
await page.evaluate(() => window.__QA_PLAYER.auto(false));

// 1-4: state machine truth (lane easing / jump arc / slide window / rules).
const sim = await page.evaluate(() => {
  const q = window.__QA_PLAYER;
  const p = q.player;
  const C = q.cfg;
  const DT = 1 / 60;
  const LANE = 3.4; // CONFIG.LANE_W — the obstacle_probe precedent
  const step = (n = 1, sp = q.stage.speed) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      p.fixedUpdate(DT, sp);
      out.push({ x: p.profile.x, y0: p.profile.y0, y1: p.profile.y1, st: p.state });
    }
    return out;
  };
  const near = (a, b, eps) => Math.abs(a - b) <= eps;
  const cases = [];
  const ck = (name, pass, got) => cases.push({ name, pass, got });

  // -- lane change ----------------------------------------------------------
  p.reset();
  p.requestLeft();
  const xs = step(14).map((s) => s.x);
  const targetSteps = xs.findIndex((x) => near(x, -LANE, 1e-6)) + 1;
  ck("lane: eased to target within laneChangeTime (+1 step)",
    targetSteps > 0 && targetSteps <= Math.ceil(C.laneChangeTime / DT) + 1, targetSteps);
  let mono = true;
  for (let i = 1; i < targetSteps; i++) if (xs[i] > xs[i - 1] + 1e-12) mono = false;
  ck("lane: monotone ease (no overshoot/pop)", mono, null);
  ck("lane: stays at outer lane after settle", near(xs[13], -LANE, 1e-9), xs[13]);
  p.requestLeft(); // clamped no-op
  step(12);
  ck("lane: edge request is a no-op", p.lane === -1 && near(p.profile.x, -LANE, 1e-9), p.lane);
  p.reset();
  p.requestRight();
  step(3);
  p.requestLeft(); // re-target mid-ease from the current body position (lane 1 -> 0)
  const midX = p.profile.x;
  const back = step(14).map((s) => s.x);
  ck("lane: mid-ease re-target eases from mid x to the new lane",
    near(back[back.length - 1], 0, 1e-9) && midX > 0 && midX < LANE,
    { midX, end: back[back.length - 1] });

  // -- jump arc -------------------------------------------------------------
  p.reset();
  p.requestJump();
  const arc = step(80);
  const air = arc.filter((s) => s.st === "jump");
  const apex = Math.max(...air.map((s) => s.y0));
  const airSteps = (2 * C.jump.v0 / C.jump.gravity) / DT;
  // discrete reference: the exact semi-implicit recurrence the sim runs
  const k = Math.floor(airSteps / 2);
  const apexDisc = C.jump.v0 * k * DT - C.jump.gravity * DT * DT * k * (k + 1) / 2;
  const apexT = C.jump.v0 * C.jump.v0 / (2 * C.jump.gravity);
  ck("jump: apex matches the discrete recurrence",
    near(apex, apexDisc, 1e-9), { apex, apexDisc });
  ck("jump: apex ~= v0^2/2g (integration droop < 8%)",
    near(apex, apexT, apexT * 0.08), { apex, apexT });
  ck("jump: airtime ~= 2 v0/g (+-3 steps)", Math.abs(air.length - airSteps) <= 3,
    { airSteps: air.length, want: airSteps });
  ck("jump: lands back to run", arc[79].st === "run" && arc[79].y0 === 0, arc[79]);
  const ph0 = p.w.phase;
  step(10);
  ck("jump: cadence resumes (phase advances)", p.w.phase !== ph0, null);
  ck("jump: run profile y1 = standTop", p.profile.y1 === C.profile.standTop, p.profile.y1);

  // -- slide ----------------------------------------------------------------
  p.reset();
  p.requestSlide();
  const sl = step(50);
  const slideSteps = sl.filter((s) => s.st === "slide").length;
  const wantSlide = Math.round(C.slideTime / DT) - 1; // profile reflects END of step
  ck("slide: y1 caps at slideTop for the CONFIG window",
    slideSteps === wantSlide && sl.every((s) => (s.st === "slide" ? s.y1 === C.profile.slideTop : true)),
    { slideSteps, wantSlide });
  ck("slide: y0 stays 0 throughout", sl.every((s) => s.y0 === 0), null);
  ck("slide: resumes run after the window", sl[49].st === "run" && sl[49].y1 === C.profile.standTop, sl[49]);

  // -- request rules --------------------------------------------------------
  p.reset();
  p.requestSlide();
  step(2);
  p.requestJump();
  step(2);
  ck("rules: jump during slide ignored", p.state === "slide", p.state);
  p.reset();
  p.requestJump();
  step(2);
  p.requestSlide();
  step(2);
  ck("rules: slide during jump ignored", p.state === "jump", p.state);
  p.requestRight();
  step(2);
  ck("rules: lane change mid-air allowed", p.lane === 1 && p.state === "jump", p.lane);
  p.reset();
  p.requestJump();
  p.requestSlide();
  step(2);
  ck("rules: jump+slide latched together -> jump wins", p.state === "jump", p.state);
  p.reset();
  p.die();
  p.requestJump();
  step(2);
  ck("rules: requests ignored while dead", p.state === "dead" && p.w.tuck === 0, p.state);

  return { cases, allPass: cases.every((c) => c.pass) };
});

// 5: render interpolation continuity (per alpha + across the step boundary +
// phase unwrap across a TAU wrap).
const interp = await page.evaluate(() => {
  const q = window.__QA_PLAYER;
  const p = q.player;
  const step = () => p.fixedUpdate(1 / 60, q.stage.speed);
  p.reset();
  for (let i = 0; i < 100; i++) step(); // settle cadence; phase wraps TAU
  p.requestJump();
  step();
  const alphas = [0, 0.25, 0.5, 0.75, 1];
  const a = alphas.map((al) => q.sample(al));
  let maxPop = 0;
  for (let i = 1; i < a.length; i++) {
    maxPop = Math.max(maxPop, Math.abs(a[i].hip - a[i - 1].hip));
  }
  const endA = q.sample(1);
  step();
  const startB = q.sample(0);
  const boundaryGap = Math.abs(endA.hip - startB.hip)
    + Math.abs(endA.y - startB.y) + Math.abs(endA.x - startB.x);
  // phase unwrap: mid-alpha must sit between the brackets (sin/cos applied
  // after the scalar lerp, so the midpoint error stays tiny when clean and
  // explodes at a wrap).
  const mid = q.sample(0.5);
  const lo = Math.min(a[0].hip, a[4].hip);
  const hi = Math.max(a[0].hip, a[4].hip);
  const midOk = mid.hip >= lo - 0.01 && mid.hip <= hi + 0.01;
  const monotone = a.every((s, i) => i === 0 || s.y >= a[i - 1].y - 1e-9);
  return {
    boundaryGap,
    maxMidStepPop: maxPop,
    fullStepHipDelta: Math.abs(a[4].hip - a[0].hip),
    midWithinBrackets: midOk,
    yMonotoneRising: monotone,
    pass: boundaryGap < 1e-9 && midOk && monotone,
  };
});

// 6: death crumple.
const death = await page.evaluate(() => {
  const q = window.__QA_PLAYER;
  const p = q.player;
  p.reset();
  p.fixedUpdate(1 / 60, q.stage.speed);
  p.die();
  for (let i = 0; i < 90; i++) p.fixedUpdate(1 / 60, q.stage.speed);
  return {
    state: p.state,
    deadWeight: p.w.dead,
    y: p.profile.y0,
    profileLive: p.profile.state === "dead",
    pass: p.state === "dead" && p.w.dead > 0.98 && p.profile.y0 < 1e-6,
  };
});

// 7: exact added draw/tri cost + shadow-pass A/B. reset() parks the player
// at z 0 (behind the camera after the ?time= skip), so stage it back on the
// conveyor spot in front of the rig before counting draws.
const measure = await page.evaluate(() => {
  const q = window.__QA_PLAYER;
  const p = q.player;
  p.reset();
  p.z = window.__QA_SHELL.dolly().z + q.stage.zAhead;
  p.fixedUpdate(1 / 60, q.stage.speed);
  p.updateRender(1);
  return q.measure();
});
const shadow = await page.evaluate(() => window.__QA_PLAYER.measureShadow());

// 8: allocation — GC-bracketed 600-step hot path with cycling requests, then
// a heap series across the live window (the stage's rAF ticks continue).
const heap = await page.evaluate(
  async (ms) => {
    const q = window.__QA_PLAYER;
    const p = q.player;
    const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const hasGc = typeof window.gc === "function";
    const fire = ["left", "right", "jump", "slide"];
    if (hasGc) window.gc();
    const h0 = mem();
    p.reset();
    for (let i = 0; i < 600; i++) {
      if (i % 24 === 12) {
        const a = fire[(i / 24 | 0) % fire.length];
        if (a === "left") p.requestLeft();
        else if (a === "right") p.requestRight();
        else if (a === "jump") p.requestJump();
        else p.requestSlide();
      }
      p.fixedUpdate(1 / 60, q.stage.speed);
      p.updateRender(0.5);
    }
    if (hasGc) window.gc();
    const h1 = mem();
    const series = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 1000));
      series.push(mem());
    }
    const min = Math.min(...series);
    const max = Math.max(...series);
    return {
      hasGc,
      probeRetainedBytes: h1 - h0,
      series,
      seriesGrowthBytes: max - min,
    };
  },
  liveMs,
);

await browser.close();

const simPass = sim.allPass;
console.log(
  JSON.stringify(
    {
      ok: simPass && interp.pass && death.pass,
      url,
      ready,
      sim,
      interp,
      death,
      measure,
      shadow,
      heap,
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 4),
      pageErrors,
    },
    null,
    2,
  ),
);
