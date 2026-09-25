#!/usr/bin/env bun
/**
 * QA screenshot tool (main-agent only; sub-agents must not use browsers).
 * Usage: bun .qa/shot.mjs <url> <out.png> [--wait ms] [--width n] [--height n]
 * Waits for window.__QA.screenshotReady when present. Prints a JSON report.
 */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const waitMs = parseInt(opt("wait", "6000"), 10);
const width = parseInt(opt("width", "1600"), 10);
const height = parseInt(opt("height", "900"), 10);

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
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") consoleWarns.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

// Prefer the game's own readiness signal; fall back to fixed wait.
const ready = await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
    timeout: Math.max(waitMs, 1000),
    polling: 250,
  })
  .then(() => true)
  .catch(() => false);
if (!ready) await page.waitForTimeout(waitMs);

const qa = await page.evaluate(
  () => ({
    qa: window.__QA || null,
    perf: window.__PERF || null,
    world: window.__WORLD || null,
  }),
  null,
  { timeoutMs: 3000 }
).catch((e) => ({ evalErr: String(e?.message || e) }));

await mkdir(dirname(out), { recursive: true });
await page.screenshot({ path: out, fullPage: false, timeout: 120000 });
await browser.close();

console.log(
  JSON.stringify({ ok: true, out, ready, consoleErrors, consoleWarns, pageErrors, ...qa }, null, 2)
);
