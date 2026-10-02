#!/usr/bin/env bun
/**
 * Objective render metrics for the QA loop (main-agent tool).
 *
 * Loads the game with ?freeze=1 (deterministic frame, loop stopped), then:
 *  1. renders frame A via __ENGINE.renderOnce()
 *  2. toggles every castShadow light off, renders frame B
 *  3. diffs A/B -> shadowCoveragePct (direct measurement of visible shadows)
 *  4. luminance stats per horizontal band + blowout/crush percentages
 *
 * Usage: bun .qa/metrics.mjs <url>
 */
import { chromium } from "playwright-core";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun .qa/metrics.mjs <url>");
  process.exit(2);
}
const withFreeze = url.includes("?") ? url + "&freeze=1" : url + "?freeze=1";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("PAGEERR:", String(e.message).slice(0, 200)));
await page.goto(withFreeze, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4500);

// Two identical warmup renders to confirm determinism, then the A/B shadow diff.
const metrics = await page.evaluate(
  `;(async () => {
    const e = window.__ENGINE;
    if (!e) return { error: "no engine" };
    e.renderOnce();
    const grab = () => {
      const c = document.getElementById("gameCanvas");
      const t = document.createElement("canvas");
      t.width = 400; t.height = Math.round((c.height / c.width) * 400);
      t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
      return t.getContext("2d").getImageData(0, 0, t.width, t.height).data;
    };
    e.renderOnce();
    const d0 = grab();
    e.renderOnce();
    const d1 = grab(); // should equal d0 (determinism check)
    let determinismDiff = 0;
    for (let i = 0; i < d0.length; i += 4) {
      if (Math.abs(d0[i] - d1[i]) + Math.abs(d0[i+1] - d1[i+1]) + Math.abs(d0[i+2] - d1[i+2]) > 8) determinismDiff++;
    }
    // toggle shadows off
    const lights = [];
    e.scene.traverse((o) => { if (o.isLight && o.castShadow) { o.castShadow = false; lights.push(o); } });
    e.renderer.shadowMap.needsUpdate = true;
    e.renderOnce();
    const d2 = grab();
    const W = 400, H = d0.length / 4 / W;
    let shadowPx = 0, blown = 0, crushed = 0;
    const sky = [], mid = [], low = [];
    for (let p = 0, n = W * H; p < n; p++) {
      const i = p * 4;
      const diff = Math.abs(d0[i] - d2[i]) + Math.abs(d0[i+1] - d2[i+1]) + Math.abs(d0[i+2] - d2[i+2]);
      if (diff > 24) shadowPx++;
      const l = (0.2126 * d0[i] + 0.7152 * d0[i+1] + 0.0722 * d0[i+2]) / 255;
      const fy = Math.floor(p / W) / H;
      if (fy < 0.33) sky.push(l); else if (fy < 0.66) mid.push(l); else low.push(l);
      if (l >= 0.97) blown++;
      if (l <= 0.03) crushed++;
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
    return {
      shadowCoveragePct: +((shadowPx / (W * H)) * 100).toFixed(2),
      determinismDiff,
      skyMeanLum: +mean(sky).toFixed(3), skyStdLum: +std(sky).toFixed(3),
      midMeanLum: +mean(mid).toFixed(3), midStdLum: +std(mid).toFixed(3),
      lowMeanLum: +mean(low).toFixed(3), lowStdLum: +std(low).toFixed(3),
      blownPct: +((blown / (W * H)) * 100).toFixed(2),
      crushedPct: +((crushed / (W * H)) * 100).toFixed(2),
      shadowLightsToggled: lights.length,
    };
  })()`,
  null,
  { timeoutMs: 3000 }
).catch((e) => ({ error: e.message }));

console.log(JSON.stringify({ url, ...metrics }, null, 2));
await browser.close();
