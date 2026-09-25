#!/usr/bin/env bun
/**
 * QA perf probe (temporary, task 1.1): separates in-page SwiftShader fps from
 * capture overhead. Same browser flags as shot.mjs.
 *
 * Usage: bun .qa/perf_probe.mjs <url> [--settle-ms 3000] [--idle-ms 4000] [--shots 5] [--width 1600] [--height 900]
 *
 * Phases: warm up to screenshotReady -> settle (flush shader-compile stalls
 * from the 2 s perf window) -> count rAF frames with NO capture (idle fps) ->
 * continuously screenshot while counting rAF frames (capture fps).
 * Prints one JSON report; touches nothing in the page.
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args[0];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const settleMs = parseInt(opt("settle-ms", "3000"), 10);
const idleMs = parseInt(opt("idle-ms", "4000"), 10);
const shots = parseInt(opt("shots", "5"), 10);
const width = parseInt(opt("width", "1600"), 10);
const height = parseInt(opt("height", "900"), 10);
const waitMs = parseInt(opt("wait", "8000"), 10);

if (!url) {
  console.error("usage: bun .qa/perf_probe.mjs <url> [--settle-ms n] [--idle-ms n] [--shots n]");
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
  ],
});
const page = await browser.newPage({ viewport: { width, height } });

const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") consoleWarns.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
const ready = await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
    timeout: Math.max(waitMs, 1000),
    polling: 250,
  })
  .then(() => true)
  .catch(() => false);
const readyAfterMs = Date.now() - t0;
if (!ready) await page.waitForTimeout(waitMs);
const warnsBeforeAnyShot = consoleWarns.length; // screenshots have not run yet

// Steady-state settle so the perf window excludes warmup/compile stalls.
await page.waitForTimeout(settleMs);

// Phase A: idle fps — rAF frame count over idleMs, no capture active.
const idle = await page.evaluate(
  async (ms) => {
    let frames = 0;
    const start = performance.now();
    let worst = 0;
    let prev = start;
    await new Promise((resolve) => {
      function step(now) {
        frames++;
        const dt = now - prev;
        prev = now;
        if (dt > worst) worst = dt;
        if (now - start >= ms) resolve();
        else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    const elapsed = (performance.now() - start) / 1000;
    return { frames, elapsed, idleFps: Math.round((frames / elapsed) * 100) / 100, worstFrameMs: Math.round(worst) };
  },
  idleMs,
);
const perfIdle = await page.evaluate(() => window.__PERF);
const world = await page.evaluate(() => window.__WORLD);

// Phase B: capture fps — continuous screenshots while the rAF counter runs.
await page.evaluate(() => {
  window.__probe = { frames: 0, start: 0 };
  const step = () => {
    window.__probe.frames++;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  window.__probe.start = performance.now();
});
const shotMs = [];
let firstShotWarnCount = null;
for (let i = 0; i < shots; i++) {
  const s = Date.now();
  await page.screenshot({ path: `/tmp/probe_shot_${i}.png`, fullPage: false, timeout: 120000 });
  shotMs.push(Date.now() - s);
  if (i === 0) firstShotWarnCount = consoleWarns.length;
}
const capture = await page.evaluate(() => {
  const elapsed = (performance.now() - window.__probe.start) / 1000;
  return { frames: window.__probe.frames, elapsed, captureFps: Math.round((window.__probe.frames / elapsed) * 100) / 100 };
});

await browser.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      url,
      ready,
      readyAfterMs,
      warnsBeforeAnyShot,
      warnCountAfterFirstShot: firstShotWarnCount,
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 2),
      pageErrors,
      idle,
      perfIdle,
      world,
      capture: { ...capture, shotMs, avgShotMs: Math.round(shotMs.reduce((a, b) => a + b, 0) / shotMs.length) },
    },
    null,
    2,
  ),
);
