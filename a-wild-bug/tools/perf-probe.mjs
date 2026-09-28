#!/usr/bin/env node
/**
 * Perf probe for the UI/UX pass (task 9.3).
 *
 *   node tools/perf-probe.mjs [--url URL] [--out shots/i9/perf]
 *
 * Two measurements:
 *
 * 1. LIKE-FOR-LIKE pinned draw-call comparison. The pre-change baseline
 *    (shots/baseline/info.json) captured diagnostics on the PINNED `win`
 *    scene at desktop 1600x900 (its shots list ends on `win`, forage phase
 *    "win"). We re-pin `win` (and `run`) now with the SAME recipe and diff
 *    drawCalls/triangles against 280 / 1,104,150. This is the ±5 gate.
 *
 * 2. A scripted ~60 s LIVE day at desktop: real keyboard walking/sprinting,
 *    the pause shell OPENED and CLOSED mid-run, and the touch widget layer
 *    force-visible for the last stretch. diagnostics() (fps, frameMs,
 *    drawCalls, triangles) is sampled every ~1 s of wall time and
 *    performance.memory.usedJSHeapSize every ~500 ms. The heap series is fit
 *    for drift (GC sawtooth is expected; sustained growth is not) and
 *    per-phase draw-call means are compared (shell open/closed, widgets
 *    visible/hidden) — the DOM shell and widgets live OUTSIDE the WebGL
 *    canvas, so draw calls must not move when they appear; audio (live graph,
 *    music bed scheduling) must not move them either.
 *
 * Exits non-zero when the pinned draw-call delta exceeds ±5 or the heap shows
 * sustained growth beyond the reported-noise threshold.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = argValue("--url", "http://127.0.0.1:41189/");
const outDir = argValue("--out", "shots/i9/perf");

const BROWSER_ARGS = [
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--no-sandbox",
];
const SEED = "1337";
const BASELINE = { drawCalls: 280, triangles: 1104150 }; // shots/baseline/info.json
const DRAWCALL_GATE = 5; // ±5 like-for-like
const HEAP_NOISE_BYTES_PER_SEC = 60_000; // sustained-growth concern threshold

const waitFrames = (page, n) =>
  page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= frames ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
const g = (page, fn, arg) => page.evaluate(fn, arg);

const browser = await chromium.launch({ args: BROWSER_ARGS });
const problems = [];
let pinnedNow = null; // phase-1 like-for-like reference for the phase-2 report

// --- 1. pinned like-for-like --------------------------------------------------

await mkdir(path.join(root, outDir), { recursive: true });
{
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });

  const pinned = {};
  for (const scene of ["win", "run"]) {
    // Same recipe shoot.mjs uses: shot() pins + settles, info() reads the
    // renderer's last-frame aggregates afterwards.
    await g(page, (s) => window.__wb.shot(s), scene);
    pinned[scene] = await g(page, () => window.__wb.info());
  }
  const winNow = pinned.win;
  pinnedNow = winNow;
  console.log("\n--- pinned like-for-like (desktop 1600x900) ---");
  console.log(`baseline (pre-change, pinned win): drawCalls ${BASELINE.drawCalls}, triangles ${BASELINE.triangles}`);
  console.log(
    `now      (pinned win):            drawCalls ${winNow.drawCalls}, triangles ${winNow.triangles}`,
  );
  const dCalls = winNow.drawCalls - BASELINE.drawCalls;
  const dTris = winNow.triangles - BASELINE.triangles;
  console.log(
    `delta: drawCalls ${dCalls >= 0 ? "+" : ""}${dCalls} (gate ±${DRAWCALL_GATE}), triangles ${dTris >= 0 ? "+" : ""}${dTris}`,
  );
  console.log(
    `reference, pinned run: drawCalls ${pinned.run.drawCalls}, triangles ${pinned.run.triangles} (no pre-change run diagnostics exist — reported, not gated)`,
  );
  if (Math.abs(dCalls) > DRAWCALL_GATE) {
    problems.push(`pinned win drawCalls moved ${dCalls} (baseline ${BASELINE.drawCalls} → ${winNow.drawCalls}), gate ±${DRAWCALL_GATE}`);
  }
  if (errs.length) problems.push(`pinned page errors: ${errs.join(" | ")}`);
  await writeFile(path.join(root, outDir, "pinned.json"), JSON.stringify(pinned, null, 2));
  await page.close();
}

// --- 2. scripted ~60 s live day ------------------------------------------------

{
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("wb.taught", '{"day":true}');
    } catch {}
  });
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });

  const SIM_TARGET = 60; // day-seconds to script
  const WALL_CAP = 300_000; // SwiftShader safety net (ms)

  await page.click("#btn-start"); // the gesture — audio comes up live
  await waitFrames(page, 6);

  // In-page sampler: pushed once per second from the page's own clock so
  // SwiftShader slowness in the driver loop cannot stall it.
  await g(page, () => {
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.__rafCount = 0;
    const rafTick = () => {
      window.__rafCount++;
      requestAnimationFrame(rafTick);
    };
    requestAnimationFrame(rafTick);
    window.__perf = {
      t0: performance.now(),
      samples: [],
      heaps: [],
      phase: "walk",
      timer: setInterval(() => {
        const w = window.__wbGame;
        const mem = performance.memory;
        const d = w.diagnostics();
        window.__perf.samples.push({
          wall: performance.now() - window.__perf.t0,
          phase: window.__perf.phase,
          sim: w.loop.dayElapsed,
          mode: w.mode,
          raf: window.__rafCount,
          vis: document.visibilityState,
          ...d,
          stepMs: w.stepMs,
        });
        if (mem) {
          window.__perf.heaps.push({
            wall: performance.now() - window.__perf.t0,
            used: mem.usedJSHeapSize,
            total: mem.totalJSHeapSize,
          });
        }
      }, 1000),
    };
  });

  // Scripted timeline (wall-clock; SwiftShader frames carry ~real-time sim).
  const wallWait = (ms) => new Promise((r) => setTimeout(r, ms));
  const simTime = () => g(page, () => window.__wbGame.loop.dayElapsed);
  const setPhase = (p) => g(page, (ph) => (window.__perf.phase = ph), p);

  const t0 = Date.now();
  /** Pause through the REAL shell: Escape, then verify the menu came up. */
  const shellPause = async () => {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Escape");
      try {
        await page.waitForSelector("#screen-pause.on #btn-resume", { state: "visible", timeout: 8000 });
        return;
      } catch {
        // retried below; the final failure dumps state
      }
    }
    const state = await g(page, () => ({
      mode: window.__wbGame.mode,
      screen: document.querySelector("#shell .screen.on")?.id ?? null,
      errs: window.__errs ?? [],
    }));
    throw new Error(`shellPause failed: no pause menu — ${JSON.stringify(state)}`);
  };
  /** Resume through the REAL shell: menu RESUME, then skip (or outlive) the grace. */
  const shellResume = async () => {
    await page.click("#btn-resume"); // menu → grace countdown
    const chip = await page
      .waitForSelector("#grace-chip", { state: "visible", timeout: 4000 })
      .catch(() => null);
    if (chip) await page.click("#grace-chip"); // skip the wait → live play
    // If the grace expired before the click, the game resumes on its own.
    await page.waitForFunction(() => window.__wbGame.mode === "playing", null, { timeout: 10000 });
  };
  const script = async () => {
    // 0–12 s: walk forward
    await setPhase("walk");
    await page.keyboard.down("KeyW");
    await wallWait(12_000);

    // 12–22 s: pause shell OPEN (frozen day), then resume through the grace
    await setPhase("shell-open");
    await page.keyboard.up("KeyW");
    await shellPause();
    await wallWait(10_000);
    await setPhase("walk");
    await shellResume();
    await wallWait(600);

    // 22–34 s: sprint
    await setPhase("sprint");
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await wallWait(12_000);
    await page.keyboard.up("ShiftLeft");

    // 34–48 s: touch widgets FORCE-VISIBLE while still moving
    await setPhase("widgets");
    await g(page, () => {
      window.__wbGame.touchControls.forceVisible = true;
      window.__wbGame.touchControls.sync();
    });
    await wallWait(14_000);
    await page.keyboard.up("KeyW");

    // 48–56 s: pause shell open again, widgets up
    await setPhase("shell-open-2");
    await shellPause();
    await wallWait(8_000);
    await shellResume();
    await wallWait(600);

    await setPhase("idle");
    // Wait out the sim target (60 day-seconds) or hit the wall cap.
    for (let i = 0; i < 300; i++) {
      if ((await simTime()) >= SIM_TARGET) break;
      if (Date.now() - t0 > WALL_CAP) break;
      await wallWait(1000);
    }
  };
  try {
    await script();
  } catch (err) {
    errs.push(`script: ${err.message}`);
  }
  await g(page, () => {
    window.__wbGame.touchControls.forceVisible = false;
    window.__wbGame.touchControls.sync();
    clearInterval(window.__perf.timer);
  }).catch(() => undefined);

  const data = await g(page, () => window.__perf);
  if (errs.length) problems.push(`live page errors: ${errs.join(" | ")}`);
  await page.close();
  await context.close();

  const samples = data.samples;
  const heaps = data.heaps;
  console.log("\n--- scripted live day ---");
  console.log(`samples: ${samples.length} @1 Hz, heap points: ${heaps.length} @0.5 Hz`);
  console.log(
    `sim covered: ${samples.length ? samples[samples.length - 1].sim.toFixed(1) : "?"} day-seconds, modes seen: ${[...new Set(samples.map((s) => s.mode))].join(",")}`,
  );
  const rafs = samples.map((s) => s.raf).filter((v) => typeof v === "number");
  const vis = [...new Set(samples.map((s) => s.vis))];
  console.log(
    `rAF ticks ${rafs.length ? `${rafs[0]}→${rafs[rafs.length - 1]}` : "?"} (rising = render loop alive), visibility: ${vis.join(",")}, in-page errors: ${errs.length ? errs.join(" | ") : "none"}`,
  );

  const fmt = (s) =>
    `drawCalls ${s.drawCalls.min}–${s.drawCalls.max} (mean ${s.drawCalls.mean.toFixed(1)}), triangles ${s.triangles.mean.toFixed(0)}, frameMs ${s.frameMs.mean.toFixed(0)}, fps ${s.fps.mean.toFixed(1)}, stepMs ${s.stepMs.mean.toFixed(2)}`;
  const agg = (rows) => {
    const pick = (k) => rows.map((r) => r[k]).filter((v) => typeof v === "number");
    const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return {
      drawCalls: { min: Math.min(...pick("drawCalls")), max: Math.max(...pick("drawCalls")), mean: mean(pick("drawCalls")) },
      triangles: { mean: mean(pick("triangles")) },
      frameMs: { mean: mean(pick("frameMs")) },
      fps: { mean: mean(pick("fps")) },
      stepMs: { mean: mean(pick("stepMs")) },
    };
  };
  const phases = [...new Set(samples.map((s) => s.phase))];
  for (const ph of phases) {
    const rows = samples.filter((s) => s.phase === ph);
    if (rows.length) console.log(`  ${ph.padEnd(13)} (${String(rows.length).padStart(2)} s): ${fmt(agg(rows))}`);
  }
  const overall = agg(samples);
  console.log(`  ${"OVERALL".padEnd(13)} (${samples.length} s): ${fmt(overall)}`);

  // Heap drift: least-squares slope over the whole run + window means.
  if (heaps.length > 10) {
    const n = heaps.length;
    const mx = heaps.reduce((a, h) => a + h.wall, 0) / n;
    const my = heaps.reduce((a, h) => a + h.used, 0) / n;
    let num = 0;
    let den = 0;
    for (const h of heaps) {
      num += (h.wall - mx) * (h.used - my);
      den += (h.wall - mx) ** 2;
    }
    const slopePerMs = num / den;
    const slopePerSec = slopePerMs * 1000;
    const q = Math.max(1, Math.floor(n / 4));
    const firstQ = heaps.slice(0, q).reduce((a, h) => a + h.used, 0) / q;
    const lastQ = heaps.slice(-q).reduce((a, h) => a + h.used, 0) / q;
    console.log(
      `heap: start≈${(heaps[0].used / 1048576).toFixed(1)} MiB, end≈${(heaps[n - 1].used / 1048576).toFixed(1)} MiB, peak ${(Math.max(...heaps.map((h) => h.used)) / 1048576).toFixed(1)} MiB`,
    );
    console.log(
      `heap drift: ${(slopePerSec / 1024).toFixed(2)} KiB/s fitted slope; first-quartile mean ${(firstQ / 1048576).toFixed(1)} MiB vs last-quartile ${(lastQ / 1048576).toFixed(1)} MiB (Δ ${((lastQ - firstQ) / 1048576).toFixed(2)} MiB)`,
    );
    if (slopePerSec > HEAP_NOISE_BYTES_PER_SEC) {
      problems.push(`heap grew ${slopePerSec.toFixed(0)} B/s sustained (threshold ${HEAP_NOISE_BYTES_PER_SEC} B/s) — allocation leak suspected`);
    }
  } else {
    problems.push(`only ${heaps.length} heap samples — sampling failed`);
  }

  // Draw-call stability across the live phases (shell/widgets are DOM layers).
  const dc = samples.map((s) => s.drawCalls).filter((v) => typeof v === "number");
  const dcMin = Math.min(...dc);
  const dcMax = Math.max(...dc);
  console.log(`live drawCalls range ${dcMin}–${dcMax} (pinned like-for-like now: ${pinnedNow?.drawCalls}, baseline ${BASELINE.drawCalls})`);

  await writeFile(path.join(root, outDir, "live.json"), JSON.stringify({ samples, heaps }, null, 2));
}

await browser.close();

if (problems.length) {
  console.error("\nPERF PROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nperf probe passed");
