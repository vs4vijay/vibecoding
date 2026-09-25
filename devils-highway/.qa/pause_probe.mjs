#!/usr/bin/env bun
/**
 * QA pause-UI probe (task 2.3): drives the pause overlay with real CDP
 * keyboard / mouse / touch events plus window.__QA_SHELL (main.js), and
 * prints one JSON report. Verifies: Esc pauses with the screen fading in and
 * the sim bit-frozen; RESUME (mouse click AND touch tap) continues the run
 * from the frozen point; RESTART starts a fresh GAME; QUIT returns to a
 * live MENU (no paused-flag leak into the attract sim); visibility emulation
 * auto-pauses on hide and STAYS paused on return; ?scene=paused boots to a
 * settled paused capture (screenshotReady waits out the overlay fade).
 *
 * Usage: bun .qa/pause_probe.mjs [base-url]  (default http://127.0.0.1:8123)
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

const shell = (page) =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    paused: window.__QA_SHELL.paused(),
    stats: window.__QA_SHELL.stats(),
    dolly: window.__QA_SHELL.dolly(),
    frames: window.__QA_SHELL.frames,
    routed: window.__QA_SHELL.routed.length,
    qaPaused: window.__QA.paused,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    pauseOn: document.getElementById("pause").classList.contains("on"),
    pauseOpacity: getComputedStyle(document.getElementById("pause")).opacity,
    resumeOpacity: getComputedStyle(document.getElementById("pause-resume")).opacity,
  }));

/** visibilitychange emulation: main.js reads document.hidden inside the
 * event handler, so both the property and the event must be faked. */
const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { value: h, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

// ---- phase 1: pause screen over a live run ---------------------------------
let p = await openPage(`${base}/?qa=1&scene=menu&seed=7`);
let s = await shell(p);
check("boot menu on", s.menuOn, true);
check("boot pause hidden", s.pauseOn, false);
check("boot pause opacity 0", s.pauseOpacity, "0");

await p.keyboard.press("Enter"); // menu -> game
s = await shell(p);
check("enter -> game", s.state, "game");
check("game pause hidden", s.pauseOn, false);

// Esc pauses: screen shows, sim bit-frozen, render continues
await p.keyboard.press("Escape");
s = await shell(p);
check("esc pauses", s.paused, true);
check("esc shows pause screen", s.pauseOn, true);
check("esc mirror", s.qaPaused, true);
const z0 = s.dolly.z;
const p0 = s.dolly.prevZ;
const t0 = s.dolly.simTime;
const f0 = s.frames;
const r0 = s.routed;
await p.waitForTimeout(400);
s = await shell(p);
check("paused z constant", s.dolly.z, z0);
check("paused prevZ constant", s.dolly.prevZ, p0);
check("paused simTime constant", s.dolly.simTime, t0);
check("paused renders (frames++)", s.frames > f0, true);
await p.waitForTimeout(1500); // overlay fade 0.5s + last reveal 0.3+0.6s
s = await shell(p);
check("pause screen fade settled", s.pauseOpacity, "1");
check("resume button revealed", s.resumeOpacity, "1");
check("still frozen at settle", s.dolly.z, z0);

// gameplay keys stay inert while the screen is up
await p.keyboard.press("a");
s = await shell(p);
check("no routing with screen up", s.routed, r0);

// RESUME via real mouse click: unpauses, screen hides, run continues exactly
await p.click("#pause-resume");
s = await shell(p);
check("resume click unpauses", s.paused, false);
check("resume hides screen", s.pauseOn, false);
check("resume mirror", s.qaPaused, false);
check("resume stays in game", s.state, "game");
check("resumed from frozen z", s.dolly.z >= z0, true);
const rc0 = await shell(p);
const wall0 = Date.now();
await p.waitForTimeout(600);
const rc1 = await shell(p);
const wall1 = Date.now();
check("resumed dolly advances", rc1.dolly.z > rc0.dolly.z, true);
const rate = (rc1.dolly.z - rc0.dolly.z) / (rc0.dolly.speed * ((wall1 - wall0) / 1000));
check("resumed rate near cruise", rate > 0.2 && rate < 1.2, true); // SwiftShader sim/wall skew tolerance

// RESUME via touch tap (CDP) — the screen must be fully touch operable
await p.keyboard.press("Escape");
s = await shell(p);
check("esc repauses", s.pauseOn, true);
const box = await p.locator("#pause-resume").boundingBox();
const cdp = await p.context().newCDPSession(p);
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
});
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await p.waitForTimeout(60);
s = await shell(p);
check("touch tap on RESUME works", s.paused, false);
check("touch tap hides screen", s.pauseOn, false);

// RESTART via mouse click -> fresh GAME (current fresh-run path)
await p.keyboard.press("Escape");
s = await shell(p);
check("esc pauses for restart", s.pauseOn, true);
await p.click("#pause-restart");
s = await shell(p);
check("restart -> game", s.state, "game");
check("restart unpauses", s.paused, false);
check("restart clears stats", s.stats, null);
check("restart hides screen", s.pauseOn, false);
check("restart keeps gameui", s.gameOn, true);
const rz = s.dolly.z;
await p.waitForTimeout(350);
check("restart dolly advances", (await shell(p)).dolly.z > rz, true);

// QUIT via mouse click -> MENU, attract sim LIVE (paused flag must not leak)
await p.keyboard.press("Escape");
s = await shell(p);
check("esc pauses for quit", s.pauseOn, true);
await p.click("#pause-quit");
s = await shell(p);
check("quit -> menu", s.state, "menu");
check("quit shows menu", s.menuOn, true);
check("quit hides gameui", s.gameOn, false);
check("quit hides screen", s.pauseOn, false);
check("quit mirror false", s.qaPaused, false);
const qt0 = s.dolly.simTime;
await p.waitForTimeout(350);
s = await shell(p);
// MENU is a static-dolly diorama (fixedUpdate advances the dolly in GAME
// only, task 2.2); a leaked paused flag would freeze simTime instead.
check("quit attract sim live (simTime advances)", s.dolly.simTime > qt0, true);

// ---- phase 2: visibility emulation (hide pauses; return STAYS paused) ------
// In MENU: hide must do nothing (attract keeps animating).
await setHidden(p, true);
s = await shell(p);
check("menu hide: no pause", s.paused, false);
check("menu hide: menu stays", s.menuOn, true);
const mt0 = s.dolly.simTime;
await p.waitForTimeout(350);
s = await shell(p);
check("menu hide: attract live (simTime advances)", s.dolly.simTime > mt0, true);
await setHidden(p, false);
await p.close();

p = await openPage(`${base}/?qa=1&scene=menu&seed=7`);
await p.keyboard.press("Enter"); // -> game
await p.waitForTimeout(200);
await setHidden(p, true); // tab hidden mid-run
s = await shell(p);
check("hide auto-pauses", s.paused, true);
check("hide shows pause screen", s.pauseOn, true);
check("hide mirror", s.qaPaused, true);
const hz = s.dolly.z;
await p.waitForTimeout(300);
check("hidden run frozen", (await shell(p)).dolly.z, hz);
await setHidden(p, false); // tab returns
s = await shell(p);
check("return STAYS paused", s.paused, true);
check("return keeps screen up", s.pauseOn, true);
const rr0 = s.routed;
await p.keyboard.press("a"); // gameplay stays inert while paused
check("no routing after return", (await shell(p)).routed, rr0);
await p.click("#pause-resume");
s = await shell(p);
check("explicit resume works", s.paused, false);
const rz0 = s.dolly.z;
await p.waitForTimeout(400);
s = await shell(p);
check("resume after return advances", s.dolly.z > rz0, true);
await p.close();

// ---- phase 3: ?scene=paused boot stages a settled paused capture -----------
p = await openPage(`${base}/?qa=1&scene=paused&mode=run&seed=7`);
s = await shell(p);
check("scene=paused in game", s.state, "game");
check("scene=paused paused", s.paused, true);
check("scene=paused screen on", s.pauseOn, true);
check("scene=paused screen settled", s.pauseOpacity, "1");
const sz = s.dolly.z;
const sf = s.frames;
await p.waitForTimeout(700);
s = await shell(p);
check("scene=paused dolly frozen", s.dolly.z, sz);
check("scene=paused renders (frames++)", s.frames > sf, true);
await p.close();

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
