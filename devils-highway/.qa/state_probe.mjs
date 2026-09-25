#!/usr/bin/env bun
/**
 * QA state-machine probe (task 2.2): drives MENU -> GAME -> PAUSED ->
 * GAMEOVER -> retry/quit with real CDP keyboard events plus the QA-gated
 * window.__QA_SHELL handle (main.js), reads window.__QA / __QA_ACTIONS /
 * __WORLD and the DOM state, and prints one JSON report. Also stages the
 * ?scene=paused and ?scene=gameover boot paths and a same-seed determinism
 * pair (scene=gameover is fully boot-deterministic: the run ends during
 * boot, before the first wall-clock frame).
 *
 * Usage: bun .qa/state_probe.mjs [base-url]  (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8123";
const problems = [];
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
let envNoise = 0; // documented ANGLE/SwiftShader boot notices (qa report 1.1)
const ENV_NOISE = /GPU stall due to ReadPixels/i;

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

async function openPage(url) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") consoleErrors.push(m.text());
    else if (t === "warning") {
      if (ENV_NOISE.test(m.text())) envNoise++;
      else consoleWarns.push(m.text());
    }
  });
  page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const ready = await page
    .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
      timeout: 25000,
      polling: 200,
    })
    .then(() => true)
    .catch(() => false);
  if (!ready) problems.push(`screenshotReady timeout: ${url}`);
  return page;
}

const check = (label, got, want) => {
  if (got !== want) problems.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const checkNear = (label, got, want, eps = 1e-6) => {
  if (!(Math.abs(got - want) < eps)) problems.push(`${label}: got ${got} want ~${want}`);
};
const shell = (page) =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    paused: window.__QA_SHELL.paused(),
    stats: window.__QA_SHELL.stats(),
    dolly: window.__QA_SHELL.dolly(),
    frames: window.__QA_SHELL.frames,
    routed: window.__QA_SHELL.routed.length,
    qaPaused: window.__QA.paused,
    qaScene: window.__QA.scene,
    qaSeed: window.__QA.seed,
    chunks: window.__WORLD ? window.__WORLD.chunks : -1,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    sel: document.querySelector("#menu .card.sel")?.dataset.mode || null,
  }));

// ---- phase 1: transitions + routing on the live menu page -----------------
let p = await openPage(`${base}/?qa=1&scene=menu&seed=7`);
let s = await shell(p);
check("boot state menu", s.state, "menu");
check("boot not paused", s.paused, false);
check("boot __QA.paused mirror", s.qaPaused, false);
check("boot menu on", s.menuOn, true);

// Esc in MENU must NOT pause (gameplay keys inert; menu keys unchanged)
await p.keyboard.press("Escape");
s = await shell(p);
check("esc in menu stays menu", s.state, "menu");
check("esc in menu not paused", s.paused, false);
check("esc in menu mirror false", s.qaPaused, false);

// menu keys unchanged: 1/2 select, Enter starts
await p.keyboard.press("1");
check("key 1 selects run", (await shell(p)).sel, "run");
await p.keyboard.press("2");
check("key 2 selects drive", (await shell(p)).sel, "drive");
await p.keyboard.press("Enter");
s = await shell(p);
check("enter -> game", s.state, "game");
check("gameui on", s.gameOn, true);
check("menu hidden", s.menuOn, false);

// GAME unpaused: dolly advances, gameplay actions reach the mode shim
const z1 = s.dolly.z;
await p.waitForTimeout(350);
s = await shell(p);
check("game dolly advances", s.dolly.z > z1, true);
const r1 = s.routed;
await p.keyboard.press("a");
s = await shell(p);
check("left routed to mode", s.routed, r1 + 1);
await p.keyboard.press("Space");
s = await shell(p);
check("jump routed to mode", s.routed, r1 + 2);

// Esc pauses: dolly frozen numerically, render continues, no menu exit
await p.keyboard.press("Escape");
s = await shell(p);
check("esc pauses", s.paused, true);
check("__QA.paused mirror true", s.qaPaused, true);
check("pause does not exit (menu off)", s.menuOn, false);
check("pause keeps gameui", s.gameOn, true);
const z3 = s.dolly.z;
const p3 = s.dolly.prevZ; // lags z by one sim step; must freeze with it
const t3 = s.dolly.simTime;
await p.waitForTimeout(400);
s = await shell(p);
check("paused dolly z constant", s.dolly.z, z3);
check("paused dolly prevZ constant", s.dolly.prevZ, p3);
check("paused simTime constant", s.dolly.simTime, t3);
const f3 = s.frames;
await p.waitForTimeout(700);
s = await shell(p);
check("paused still renders (frames++)", s.frames > f3, true);

// gameplay actions ignored while paused
const rPaused = s.routed;
await p.keyboard.press("d");
await p.keyboard.press("w");
s = await shell(p);
check("no routing while paused", s.routed, rPaused);
check("still paused after gameplay keys", s.paused, true);

// Esc resumes: one press = one toggle (the dual "back" must not exit)
await p.keyboard.press("Escape");
s = await shell(p);
check("esc resumes", s.paused, false);
check("__QA.paused mirror false", s.qaPaused, false);
check("resume stays in game", s.state, "game");
check("resume keeps menu hidden", s.menuOn, false);
const z4 = s.dolly.z;
await p.waitForTimeout(350);
check("resumed dolly advances", (await shell(p)).dolly.z > z4, true);

// death injection GAME -> GAMEOVER (world renders, dolly halted)
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 4321 }));
s = await shell(p);
check("endRun -> gameover", s.state, "gameover");
check("gameover unpaused", s.paused, false);
check(
  "stats injected override",
  JSON.stringify(s.stats),
  JSON.stringify({ distance: 4321, pickups: 0, score: 0 }),
);
const z5 = s.dolly.z;
const f5 = s.frames;
await p.waitForTimeout(700);
s = await shell(p);
check("gameover dolly halted", s.dolly.z, z5);
check("gameover still renders (frames++)", s.frames > f5, true);
check("gameover shows no menu", s.menuOn, false);

// GAMEOVER + confirm (Enter) -> fresh GAME, same mode
await p.keyboard.press("Enter");
s = await shell(p);
check("enter retries into game", s.state, "game");
check("retry clears stats", s.stats, null);
check("retry unpaused", s.paused, false);
const z6 = s.dolly.z;
await p.waitForTimeout(350);
check("retry dolly advances", (await shell(p)).dolly.z > z6, true);

// default endRun stats (measured distance) + Space-as-confirm retry
await p.evaluate(() => window.__QA_SHELL.endRun());
s = await shell(p);
check("default endRun -> gameover", s.state, "gameover");
check("default distance measured", s.stats.distance >= 0 && s.stats.distance < 60, true);
check("default pickups zero", s.stats.pickups, 0);
await p.keyboard.press("Space");
check("space retries into game", (await shell(p)).state, "game");

// Esc in GAMEOVER quits to MENU ("pause" half is ignored there)
await p.evaluate(() => window.__QA_SHELL.endRun());
check("gameover again", (await shell(p)).state, "gameover");
await p.keyboard.press("Escape");
s = await shell(p);
check("esc in gameover -> menu", s.state, "menu");
check("menu shown after quit", s.menuOn, true);
check("gameui hidden after quit", s.gameOn, false);

// __QA_SHELL.quit + __QA_SHELL.retry handles
await p.keyboard.press("Enter"); // menu -> game
check("re-entered game", (await shell(p)).state, "game");
await p.evaluate(() => window.__QA_SHELL.quit());
check("handle quit -> menu", (await shell(p)).state, "menu");
await p.keyboard.press("Enter");
await p.evaluate(() => window.__QA_SHELL.endRun());
await p.evaluate(() => window.__QA_SHELL.retry());
check("handle retry -> game", (await shell(p)).state, "game");
await p.close();

// ---- phase 2: ?scene=paused staging ---------------------------------------
p = await openPage(`${base}/?qa=1&scene=paused&mode=run&seed=7`);
s = await shell(p);
check("scene=paused boots into game", s.state, "game");
check("scene=paused is paused", s.paused, true);
check("scene=paused mirror", s.qaPaused, true);
check("scene=paused __QA.scene", s.qaScene, "paused");
check("scene=paused gameui on", s.gameOn, true);
const z7 = s.dolly.z;
const f7 = s.frames;
await p.waitForTimeout(700);
s = await shell(p);
check("scene=paused dolly frozen", s.dolly.z, z7);
check("scene=paused renders (frames++)", s.frames > f7, true);
await p.close();

// ---- phase 3: ?scene=gameover staging (deterministic) ---------------------
p = await openPage(`${base}/?qa=1&scene=gameover&mode=run&time=5&seed=7`);
s = await shell(p);
check("scene=gameover boots ended", s.state, "gameover");
check("scene=gameover distance 38", s.stats.distance, 38); // round(7.5 m/s * 5 s)
check("scene=gameover dolly 57.5", s.dolly.z, 57.5); // 20 + 37.5, exact
check("scene=gameover gameui on", s.gameOn, true);
check("scene=gameover __QA.scene", s.qaScene, "gameover");
await p.close();

// ---- phase 4: same-seed determinism pair ----------------------------------
const snap = async (url) => {
  const pg = await openPage(url);
  const sh = await shell(pg);
  await pg.close();
  return sh;
};
const a = await snap(`${base}/?qa=1&scene=gameover&mode=drive&time=7&seed=42`);
const b = await snap(`${base}/?qa=1&scene=gameover&mode=drive&time=7&seed=42`);
check("seed repro: seed echoed", a.qaSeed, "42");
check("seed repro: dolly equal", a.dolly.z, b.dolly.z);
check("seed repro: distance equal", a.stats.distance, b.stats.distance);
check("seed repro: chunk count equal", a.chunks, b.chunks);
checkNear("seed repro: dolly at staged end", a.dolly.z, 202); // 20 + 26 * 7

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
      envNoiseWarnings: envNoise,
      consoleErrors,
      consoleWarns,
      pageErrors,
    },
    null,
    2,
  ),
);
