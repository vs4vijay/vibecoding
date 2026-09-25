#!/usr/bin/env bun
/**
 * QA draw-call audit (task 1.2): per-material-group draw breakdown of the
 * live scene. Same browser flags as shot.mjs.
 *
 * Usage: bun .qa/draw_audit.mjs <url> [--settle-ms 2500] [--width 1600] [--height 900]
 *
 * Method: waits for screenshotReady + settle, then in one evaluate() pass
 *   1. tags every renderable with an onBeforeRender that counts calls per
 *      material name and per top-level scene subtree (three r172 fires
 *      onBeforeRender once per render item, i.e. once per material-group
 *      draw, and NOT for the shadow depth pass),
 *   2. does one direct renderer.render(scene, camera) with info.reset(),
 *   3. derives shadow-pass draws = direct total - counted main draws, and
 *      composer/post draws = __PERF.drawCalls - direct total.
 * Prints one JSON report; touches nothing persistent in the page (the
 * patched callbacks are read back synchronously and the page closes after).
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args[0];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const settleMs = parseInt(opt("settle-ms", "2500"), 10);
const width = parseInt(opt("width", "1600"), 10);
const height = parseInt(opt("height", "900"), 10);
const waitMs = parseInt(opt("wait", "8000"), 10);

if (!url) {
  console.error("usage: bun .qa/draw_audit.mjs <url> [--settle-ms n]");
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
if (!ready) await page.waitForTimeout(waitMs);
await page.waitForTimeout(settleMs);

const report = await page.evaluate(() => {
  const A = window.__QA_AUDIT;
  if (!A) return { ok: false, reason: "window.__QA_AUDIT missing (?qa=1 required)" };
  const byMat = {};
  const byTree = {};
  let mainDraws = 0;
  const objects = [];
  A.scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
    let p = o;
    let owner = null;
    while (p && p !== A.scene) {
      owner = p;
      p = p.parent;
    }
    const label = owner
      ? `${owner.name || owner.type}${owner.position.z ? ` @z=${Math.round(owner.position.z)}` : ""}`
      : "(scene root)";
    o.onBeforeRender = (r, s, c, g, mat) => {
      const name = (mat && (mat.name || mat.type)) || "unnamed";
      byMat[name] = (byMat[name] || 0) + 1;
      byTree[label] = (byTree[label] || 0) + 1;
      mainDraws++;
    };
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    objects.push({
      label,
      cls: o.isInstancedMesh ? "inst" : o.isPoints ? "points" : "mesh",
      mats: mats.map((m) => (m && (m.name || m.type)) || "unnamed"),
      count: o.isInstancedMesh ? o.count : 1,
      cast: !!o.castShadow,
      visible: o.visible,
    });
  });
  A.renderer.info.reset();
  A.renderer.render(A.scene, A.camera);
  const totalDirect = A.renderer.info.render.calls;
  const perf = window.__PERF || {};
  const world = window.__WORLD || {};
  const sortObj = (o) =>
    Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
  return {
    ok: true,
    mainDraws,
    totalDirect,
    shadowDraws: totalDirect - mainDraws,
    frameCalls: perf.drawCalls,
    frameTris: perf.tris,
    postDraws: (perf.drawCalls || 0) - totalDirect,
    worldChunks: world.chunks,
    byMat: sortObj(byMat),
    byTree: sortObj(byTree),
    objects,
  };
});

await browser.close();

console.log(
  JSON.stringify(
    { ok: report.ok === true, url, ready, consoleErrors, consoleWarns, pageErrors, ...report },
    null,
    2,
  ),
);
