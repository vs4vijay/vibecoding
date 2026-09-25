#!/usr/bin/env bun
/**
 * QA zombie-system probe (task 3.1; kept as the entity system's regression
 * tool). Same browser flags as shot.mjs, plus --js-flags=--expose-gc for the
 * heap check. Since task 4.3 the probe constructs its OWN fixture in-page
 * (qa/entity_stage.js — a fresh manager, never the live RUN mode's systems):
 *
 * Usage: bun .qa/zombie_probe.mjs <url> [--settle-ms 2500] [--live-ms 10000]
 *
 * Verifies, in ONE page load of ?qa=1&mode=run&scene=game:
 *  1. pool fills to max live records; body mesh count = 32x14, eyes 32x2;
 *  2. EXACT added draw/tri cost via __QA_ZOMBIES.measure() (the two zombie
 *     meshes hidden vs shown around a direct renderer.render — no post, no
 *     cross-load variance);
 *  3. poses animate: root matrix translations + gait phase change across
 *     synchronously driven fixed steps;
 *  4. allocation: forced GC -> 600 synchronous fixedUpdate steps -> forced
 *     GC (retained delta ~= 0 proves the pose path allocates nothing), then
 *     a heap series sampled across `live-ms` of live animation (practical
 *     no-steady-growth proxy);
 *  5. console/page error collections stay empty.
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
const liveMs = parseInt(opt("live-ms", "10000"), 10);
const waitMs = parseInt(opt("wait", "12000"), 10);

if (!url) {
  console.error("usage: bun .qa/zombie_probe.mjs <url> [--settle-ms n] [--live-ms n]");
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

// Probe-side fixture (task 4.3): a fresh manager + full pack anchored around
// the live focus. Nothing ticks it but the probe (synchronous blocks).
await page.evaluate(async () => {
  const stg = await import("/qa/entity_stage.js");
  stg.stageZombies().fixedUpdate(0, window.__QA_SHELL.dolly().z);
});

const counts = await page.evaluate(() => {
  const q = window.__QA_ZOMBIES;
  return {
    live: q.count(),
    max: q.max,
    bodyCount: q.meshes.body.count,
    eyeCount: q.meshes.eyes.count,
    poses: q.records.filter((r) => r.alive).map((r) => r.pose)
      .reduce((acc, p) => ((acc[p] = (acc[p] || 0) + 1), acc), {}),
  };
});

// Exact added cost of the two instanced meshes (main + shadow passes only).
const measure = await page.evaluate(() => window.__QA_ZOMBIES.measure());

// Pose animation: drive the manager synchronously, sample the first live
// zombie's pelvis matrix + gait phase per batch (nothing ticks it in rAF).
const anim = await page.evaluate(
  (ms) => {
    const q = window.__QA_ZOMBIES;
    const grab = () => {
      const rec = q.records.find((r) => r.alive);
      const arr = q.meshes.body.instanceMatrix.array;
      const i = rec.id * 14 * 16; // pelvis matrix
      return {
        phase: Number(rec.phase.toFixed(5)),
        tx: Number(arr[i + 12].toFixed(4)),
        ty: Number(arr[i + 13].toFixed(4)),
        tz: Number(arr[i + 14].toFixed(4)),
      };
    };
    const samples = [grab()];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      q.run(12); // 0.2 s of gait per sample
      samples.push(grab());
    }
    return samples;
  },
  Math.min(liveMs, 3000),
);

// Allocation: GC-bracketed 600-step micro-probe (10 s of fixed steps), then
// a heap series across the remaining live window (steady-growth proxy).
const heap = await page.evaluate(
  async (ms) => {
    const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const hasGc = typeof window.gc === "function";
    if (hasGc) window.gc();
    const h0 = mem();
    window.__QA_ZOMBIES.run(600);
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

const animChanged = new Set(anim.map((s) => `${s.tx},${s.ty},${s.tz},${s.phase}`)).size > 1;
console.log(
  JSON.stringify(
    {
      ok: true,
      url,
      ready,
      counts,
      measure,
      animSamples: anim,
      animChanged,
      heap,
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 4),
      pageErrors,
    },
    null,
    2,
  ),
);
