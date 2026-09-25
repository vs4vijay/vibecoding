#!/usr/bin/env bun
/**
 * QA contract matrix probe (task 6.1): boots EVERY documented scene/param
 * combination (the AGENTS.md contract table as consolidated in qa/hooks.js's
 * header) and asserts per cell — screenshotReady flips within a bounded wait,
 * __QA.{mode,scene,seed} mirror the URL, __PERF/__WORLD are populated inside
 * the bible budgets, gameplay cells advance/freeze/pause correctly, and the
 * console stays clean (errors: zero; warnings: only the documented
 * ANGLE/SwiftShader boot notices, qa report 1.1). Absent screens (shop) and
 * the mode_select -> menu alias are verified as documented. One page reused
 * across cells (full navigation per URL); console entries are attributed to
 * the cell that was loading when they fired. Camera-rig assertions use a
 * 0.5 fov / 0.25 up tolerance: the rig lerp keeps converging for a few
 * frames after the ready flip (rawDt clamped to 0.1 s at SwiftShader's ~6
 * fps), and the four rigs' fovs are > 1 apart, so 0.5 separates them safely.
 *
 * Usage: bun .qa/contract_probe.mjs [base-url]  (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8123";
const problems = [];
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
let envNoise = 0; // documented ANGLE/SwiftShader boot notices (qa report 1.1)
const ENV_NOISE = /GPU stall due to ReadPixels/i;
let cellTag = "(boot)";

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(`[${cellTag}] ${m.text()}`);
  else if (t === "warning") {
    if (ENV_NOISE.test(m.text())) envNoise++;
    else consoleWarns.push(`[${cellTag}] ${m.text()}`);
  }
});
page.on("pageerror", (e) =>
  pageErrors.push(`[${cellTag}] ${String(e?.stack || e?.message || e)}`),
);

const check = (label, got, want) => {
  if (got !== want)
    problems.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const checkNear = (label, got, want, eps = 1e-6) => {
  if (!(Math.abs(got - want) < eps))
    problems.push(`${label}: got ${got} want ~${want} (eps ${eps})`);
};
const checkTrue = (label, got) => {
  if (got !== true) problems.push(`${label}: got ${JSON.stringify(got)} want true`);
};

/**
 * One matrix cell: load, wait for the ready gate, optional post-ready settle
 * (the camera-rig lerp keeps converging for a few frames after the flip —
 * rawDt is clamped to 0.1 s and SwiftShader frames run long — so cells that
 * assert rig fov/up allow ~4 s before sampling), snapshot the surfaces.
 */
async function cell(name, url, waitMs = 15000, settleMs = 0) {
  cellTag = name;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const ready = await page
    .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
      timeout: waitMs,
      polling: 200,
    })
    .then(() => true)
    .catch(() => false);
  if (settleMs) await page.waitForTimeout(settleMs);
  const s = await page.evaluate(() => {
    const q = window.__QA || {};
    const perf = window.__PERF || {};
    const w = window.__WORLD || {};
    return {
      mode: q.mode,
      scene: q.scene,
      seed: q.seed,
      paused: q.paused,
      p: q.params || {},
      perf: { fps: perf.fps, tier: perf.tier, draws: perf.drawCalls, tris: perf.tris },
      chunks: w.chunks,
      state: window.__QA_SHELL ? window.__QA_SHELL.state() : null,
      stats: window.__QA_SHELL ? window.__QA_SHELL.stats() : null,
      dolly: window.__QA_SHELL ? window.__QA_SHELL.dolly() : null,
      frames: window.__QA_SHELL ? window.__QA_SHELL.frames : -1,
      runLive: !!window.__QA_RUN,
      hudOn: document.getElementById("hud")?.classList.contains("on") || false,
      menuOn: document.getElementById("menu")?.classList.contains("on") || false,
      camFov: window.__QA_AUDIT ? window.__QA_AUDIT.camera.fov : -1,
      camY: window.__QA_AUDIT ? window.__QA_AUDIT.camera.position.y : -1,
    };
  });
  if (!ready) problems.push(`${name}: screenshotReady did not flip within ${waitMs} ms`);
  // populated-surface + budget gates (bible: <= 220 draws, <= 500k tris)
  checkTrue(`${name}: __QA present`, !!s.mode && !!s.scene);
  checkTrue(`${name}: __PERF.drawCalls populated`, s.perf.draws > 0);
  checkTrue(`${name}: __PERF.tris populated`, s.perf.tris > 0);
  checkTrue(`${name}: __PERF.tier populated`, typeof s.perf.tier === "string");
  checkTrue(`${name}: __WORLD.chunks populated`, s.chunks >= 1);
  checkTrue(`${name}: draw budget <= 220`, s.perf.draws <= 220);
  checkTrue(`${name}: tri budget <= 500k`, s.perf.tris <= 500000);
  return { name, url, ready, ms: Date.now() - t0, ...s };
}

const matrix = [];
const run = async (name, url, waitMs, settleMs) => {
  const row = await cell(name, `${base}/${url}`, waitMs, settleMs);
  matrix.push({
    cell: row.name,
    url: row.url,
    ready: row.ready,
    ms: row.ms,
    scene: row.scene,
    mode: row.mode,
    seed: row.seed,
    state: row.state,
    paused: row.paused,
    draws: row.perf.draws,
    tris: row.perf.tris,
    fps: row.perf.fps,
    tier: row.perf.tier,
    chunks: row.chunks,
  });
  return row;
};

// ---- 1. menu (dusk + night) ------------------------------------------------
let r = await run("menu-dusk", "?qa=1&scene=menu&seed=1");
check("menu-dusk scene", r.scene, "menu");
check("menu-dusk default mode", r.mode, "drive");
check("menu-dusk seed mirror", r.seed, "1");
check("menu-dusk state", r.state, "menu");
check("menu-dusk menu on", r.menuOn, true);
check("menu-dusk hud hidden", r.hudOn, false);
check("menu-dusk tod", r.p.timeOfDay, "dusk");
const swReg = await page.evaluate(() =>
  navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : null,
);
check("menu-dusk no SW under qa=1", swReg == null, true);

r = await run("menu-night", "?qa=1&scene=menu&time=night&seed=1", 20000);
check("menu-night scene", r.scene, "menu");
check("menu-night tod", r.p.timeOfDay, "night");

// ---- 2. mode_select alias (menu IS the mode-select screen) -----------------
r = await run("mode-select-alias", "?qa=1&scene=mode_select&seed=1");
check("mode-select boots the menu", r.menuOn, true);
check("mode-select resolves to menu scene", r.scene, "menu");
check("mode-select state", r.state, "menu");

// ---- 3. scene=game + mode=run ------------------------------------------------
r = await run("game-run", "?qa=1&mode=run&scene=game&seed=11");
check("game-run mode", r.mode, "run");
check("game-run scene", r.scene, "game");
check("game-run state", r.state, "game");
check("game-run mode live", r.runLive, true);
check("game-run hud shown", r.hudOn, true);
check("game-run menu hidden", r.menuOn, false);
const z1 = r.dolly.z;
await page.waitForTimeout(400);
const z2 = await page.evaluate(() => window.__QA_SHELL.dolly().z);
checkTrue("game-run dolly advances", z2 > z1);

r = await run("game-run-freeze", "?qa=1&mode=run&scene=game&seed=11&freeze=1");
check("game-run-freeze param", r.p.freeze, true);
const fz = r.dolly.z;
const fFrames = r.frames;
await page.waitForTimeout(600);
const fzSnap = await page.evaluate(() => ({
  z: window.__QA_SHELL.dolly().z,
  frames: window.__QA_SHELL.frames,
}));
check("freeze holds dolly", fzSnap.z, fz);
checkTrue("freeze keeps rendering", fzSnap.frames > fFrames);

r = await run(
  "game-run-gauntlet-freeze",
  "?qa=1&mode=run&scene=game&staged=gauntlet&seed=11&freeze=1",
  25000,
);
check("gauntlet staged param", r.p.staged, "gauntlet");
check("gauntlet mode live", r.runLive, true);
check("gauntlet hud shown", r.hudOn, true);

r = await run("game-run-gauntlet-live", "?qa=1&mode=run&scene=game&staged=gauntlet&seed=11", 25000);
check("gauntlet-live staged param", r.p.staged, "gauntlet");
check("gauntlet-live state", r.state, "game");

r = await run("game-run-cam-close", "?qa=1&mode=run&scene=game&cam=close&seed=11", 15000, 4000);
check("cam-close param mirror", r.p.cam, "close");
checkNear("cam-close fov = RIGS.close", r.camFov, 66, 0.5);

r = await run("game-run-cam-side", "?qa=1&mode=run&scene=game&cam=side&seed=11", 15000, 4000);
check("cam-side param mirror", r.p.cam, "side");
checkNear("cam-side fov = RIGS.side", r.camFov, 58, 0.5);

r = await run("game-run-night", "?qa=1&mode=run&scene=game&time=night&seed=11", 25000);
check("game-run-night tod", r.p.timeOfDay, "night");

r = await run("game-run-time5", "?qa=1&mode=run&scene=game&time=5&seed=11");
check("time5 param parsed", r.p.time, 5);
// fast-forward ran; the live run keeps advancing past it until the sample
// (exactness is asserted on the frozen staged-gameover cells below)
checkTrue("time5 fast-forward applied", r.dolly.z >= 57.5); // START_Z 20 + 7.5 * 5

// ---- 4. gameover / paused ---------------------------------------------------
r = await run("gameover", "?qa=1&scene=gameover&mode=run&time=8&seed=11");
check("gameover scene echo", r.scene, "gameover");
check("gameover state", r.state, "gameover");
check("gameover deterministic distance", r.stats.distance, 60); // round(7.5 * 8)
check("gameover hud hidden", r.hudOn, false);

r = await run("paused", "?qa=1&scene=paused&mode=run&seed=11", 25000);
check("paused scene echo", r.scene, "paused");
check("paused state", r.state, "game");
check("paused flag", r.paused, true);
check("paused hud stays (under scrim)", r.hudOn, true);
const pz = r.dolly.z;
await page.waitForTimeout(500);
check("paused dolly frozen", await page.evaluate(() => window.__QA_SHELL.dolly().z), pz);

// ---- 5. cam overrides on the menu (front + the beauty RIG — all resolve) ----
r = await run("cam-front-menu", "?qa=1&scene=menu&cam=front&seed=1", 15000, 4000);
check("cam-front param mirror", r.p.cam, "front");
checkNear("cam-front fov = RIGS.front", r.camFov, 55, 0.5);
checkNear("cam-front up = RIGS.front", r.camY, 1.75, 0.25);

r = await run("cam-beauty-menu", "?qa=1&scene=menu&cam=beauty&seed=1", 15000, 4000);
check("cam-beauty param mirror", r.p.cam, "beauty");
checkNear("cam-beauty fov = RIGS.beauty", r.camFov, 57, 0.5);

// ---- 6. seed reproducibility spot-check (staged gameover is boot-exact) -----
const reproA = await run("seed-repro-a", "?qa=1&scene=gameover&mode=run&time=5&seed=7");
const reproB = await run("seed-repro-b", "?qa=1&scene=gameover&mode=run&time=5&seed=7");
check("seed repro seed mirror", reproA.seed, "7");
check("seed repro distance equal", reproB.stats.distance, reproA.stats.distance);
check("seed repro distance 38", reproA.stats.distance, 38); // round(7.5 * 5)
checkNear("seed repro dolly at staged end", reproA.dolly.z, 57.5);
check("seed repro dolly equal", reproB.dolly.z, reproA.dolly.z);

// ---- 7. documented extras: gameplay=1 menu boot + shop fallback (absent) ----
r = await run("menu-gameplay-flag", "?qa=1&scene=menu&seed=1&gameplay=1");
check("gameplay=1 boots menu", r.menuOn, true);
check("gameplay=1 gameplay param", r.p.gameplay, true);

r = await run("shop-absent-fallback", "?qa=1&scene=shop&seed=1");
check("shop falls back to menu", r.menuOn, true);
check("shop scene resolves to menu", r.scene, "menu");
check("shop boots clean", r.state, "menu");

await browser.close();

console.log(
  JSON.stringify(
    {
      ok:
        problems.length === 0 &&
        consoleErrors.length === 0 &&
        consoleWarns.length === 0 &&
        pageErrors.length === 0,
      problems,
      cells: matrix.length,
      envNoiseWarnings: envNoise,
      consoleErrors,
      consoleWarns,
      pageErrors,
      matrix,
    },
    null,
    2,
  ),
);
