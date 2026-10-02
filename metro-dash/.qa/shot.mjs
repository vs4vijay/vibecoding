#!/usr/bin/env bun
/**
 * QA screenshot tool for the visual pipeline. (Main-agent tool; sub-agents must
 * not use browsers.)
 *
 * Usage:
 *   bun .qa/shot.mjs <url> <out.png> [--wait ms] [--width n] [--height n] [--quiet]
 *
 * Launches headless Chromium with SwiftShader WebGL, waits for the engine
 * (window.__QA.screenshotReady if present), saves a PNG, prints a JSON report
 * with console errors / page errors / engine debug state.
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const waitMs = parseInt(opt("wait", "5000"), 10);
const width = parseInt(opt("width", "1600"), 10);
const height = parseInt(opt("height", "900"), 10);
const quiet = args.includes("--quiet");

if (!url || !out) {
  console.error("usage: bun .qa/shot.mjs <url> <out.png> [--wait ms] [--width n] [--height n]");
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
  const txt = m.text();
  if (t === "error") consoleErrors.push(txt);
  else if (t === "warning") consoleWarns.push(txt);
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

// Wait for the engine's own "screenshot safe" signal, bounded by waitMs.
const ready = page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady instanceof Promise, null, { timeout: waitMs })
  .then(() => page.evaluate(() => window.__QA.screenshotReady).catch(() => {}))
  .catch(() => "timeout");

await Promise.race([ready, new Promise((r) => setTimeout(r, waitMs))]);
// Present a fresh compositor frame before capturing — without this, headless
// screenshots of the animating WebGL canvas can grab a stale/blank buffer.
await page.evaluate(
  "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"
).catch(() => {});
await page.waitForTimeout(200);

const state = await page
  .evaluate(`(() => ({
    engine: !!window.__ENGINE,
    phase: window.__ENGINE && window.__ENGINE.run ? window.__ENGINE.run.phase : null,
    perf: window.__PERF ? { fps: Math.round(window.__PERF.fps), tier: window.__PERF.tier } : null,
    world: window.__WORLD || null,
  }))()`)
  .catch(() => null);

await mkdir(dirname(out), { recursive: true });

await page.screenshot({ path: out, type: "png", timeout: 90000 });
await browser.close();

// Objective blankness score: mean absolute Laplacian of a grayscale downscale.
// Smooth gradients (fog-wash / blank frames) score ~0-3; real scenes score 15+.
let detail = null;
try {
  const { spawnSync } = await import("node:child_process");
  const py = spawnSync("python3", ["-c", `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert("L").resize((160, 90))
px = im.load()
lap = 0
for y in range(1, 89):
    for x in range(1, 159):
        i = px[x, y]
        lap += abs(4*i - px[x-1,y] - px[x+1,y] - px[x,y-1] - px[x,y+1])
print(round(lap/(158*88), 1))
`, out]);
  if (py.status === 0) detail = { laplacian: parseFloat(py.stdout.toString().trim()) };
} catch {}
const report = { url, out, detail, state, consoleErrors, consoleWarns, pageErrors };
if (!quiet) console.log(JSON.stringify(report, null, 2));
if (pageErrors.length || consoleErrors.length) process.exit(1);
