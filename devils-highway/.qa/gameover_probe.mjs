#!/usr/bin/env bun
/**
 * QA gameover-UI probe (tasks 2.4 + 2.5): drives the gameover overlay with real CDP
 * keyboard / mouse / touch events plus window.__QA_SHELL (main.js), and
 * prints one JSON report. Verifies: endRun(stats) renders the exact injected
 * stats; the NEW BEST flag follows injected save state (both branches);
 * RETRY is the primary action via Enter, Space AND touch tap, each with a
 * measured performance.now() round-trip into a fresh run (pooled
 * world.reset(), no reload, <= ~1 s); MENU/back paths quit; the dolly stays
 * halted while the world renders behind the scrim; ?scene=gameover boots to
 * a settled, deterministic screen (screenshotReady waits out the overlay
 * fade, CONFIG.STAGED_GAMEOVER). Persistence (2.5): exactly ONE localStorage
 * write per death (best + currency), best recorded only when improved,
 * currency accrues across deaths, the menu RUN card shows the recorded best
 * after reload, the gameover view keeps showing the PREVIOUS best, and the
 * quit-from-pause path writes nothing.
 *
 * Usage: bun .qa/gameover_probe.mjs [base-url]  (default http://127.0.0.1:8123)
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

async function openPage(url, initScript = null) {
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
  if (initScript) await page.addInitScript(initScript);
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

const dom = (page) =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    stats: window.__QA_SHELL.stats(),
    dolly: window.__QA_SHELL.dolly(),
    frames: window.__QA_SHELL.frames,
    chunks: window.__WORLD ? window.__WORLD.chunks : -1,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    goOn: document.getElementById("gameover").classList.contains("on"),
    goOpacity: getComputedStyle(document.getElementById("gameover")).opacity,
    retryOpacity: getComputedStyle(document.getElementById("go-retry")).opacity,
    distance: document.getElementById("go-distance").textContent,
    score: document.getElementById("go-score").textContent,
    pickups: document.getElementById("go-pickups").textContent,
    best: document.getElementById("go-best").textContent,
    flagOn: document.getElementById("go-flag").classList.contains("on"),
  }));

const menuTexts = (page) =>
  page.evaluate(() => ({
    footer: document.getElementById("menu-best").textContent,
    run: document.querySelector('.card[data-mode="run"] .card-best').textContent,
    drive: document.querySelector('.card[data-mode="drive"] .card-best').textContent,
    ride: document.querySelector('.card[data-mode="ride"] .card-best').textContent,
  }));

// localStorage write counting (task 2.5): wraps Storage.prototype.setItem so
// every saveSave() (and any other writer) is counted. Survives until the
// page's context dies (navigation/reload) — re-arm after those.
const armWrites = (page) =>
  page.evaluate(() => {
    if (window.__QA_WRITES !== undefined) return;
    window.__QA_WRITES = 0;
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      window.__QA_WRITES++;
      return orig.call(this, k, v);
    };
  });
const resetWrites = (page) => page.evaluate(() => { window.__QA_WRITES = 0; });
const readWrites = (page) => page.evaluate(() => window.__QA_WRITES);
const readSave = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("endless.save.v1") || "null"));

const waitForReady = (page) =>
  page
    .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
      timeout: 25000,
      polling: 200,
    })
    .then(() => true)
    .catch(() => false);

/**
 * Retry round trip (performance.now, page clock): fire one input, resolve
 * when the shell is back in GAME, the screen is hidden and the dolly has
 * advanced past its frozen death-frame z (fresh sim + re-streamed world).
 * Returns elapsed ms.
 */
const retryMs = async (page, fire) => {
  await page.evaluate(() => window.__QA_SHELL.endRun());
  const staged0 = await dom(page);
  check("timed retry staged into gameover", staged0.state, "gameover");
  const t0 = await page.evaluate(() => performance.now());
  await fire();
  await page.waitForFunction(
    (z) =>
      window.__QA_SHELL.state() === "game" &&
      !document.getElementById("gameover").classList.contains("on") &&
      window.__QA_SHELL.dolly().z > z,
    null,
    { timeout: 5000, polling: 25 },
    staged0.dolly.z,
  );
  const t1 = await page.evaluate(() => performance.now());
  const ms = Math.round((t1 - t0) * 10) / 10;
  if (ms >= 1000) problems.push(`retry round-trip ${ms} ms >= 1000 ms`);
  return ms;
};

const touchTap = (page, selector) =>
  page.evaluate((sel) => {
    const box = document.querySelector(sel).getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const down = new PointerEvent("pointerdown", { pointerId: 1, clientX: x, clientY: y, bubbles: true });
    const up = new PointerEvent("pointerup", { pointerId: 1, clientX: x, clientY: y, bubbles: true });
    window.dispatchEvent(down);
    window.dispatchEvent(up);
    document.querySelector(sel).click();
  }, selector);

// ---- phase 1: stats rendering, halted world, settled reveal ----------------
let p = await openPage(`${base}/?qa=1&scene=menu&seed=7`);
let s = await dom(p);
check("boot gameover hidden", s.goOn, false);
check("boot gameover opacity 0", s.goOpacity, "0");

await p.keyboard.press("Enter"); // menu -> game
s = await dom(p);
check("enter -> game", s.state, "game");
check("game gameover hidden", s.goOn, false);

const chunks0 = s.chunks;
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 4321, pickups: 7, score: 5000 }));
s = await dom(p);
check("endRun -> gameover", s.state, "gameover");
check("gameover screen on", s.goOn, true);
check("stats distance text", s.distance, "4,321");
check("stats score text", s.score, "5,000");
check("stats pickups text", s.pickups, "7");
check("default save best line", s.best, "BEST — —");
check("new best flag on (4321 > 0)", s.flagOn, true);
const z0 = s.dolly.z;
const f0 = s.frames;
await p.waitForTimeout(700);
s = await dom(p);
check("gameover dolly halted", s.dolly.z, z0);
check("gameover still renders (frames++)", s.frames > f0, true);
check("world still streamed behind", s.chunks, chunks0);
await p.waitForTimeout(1200); // reveal: last delay 0.46s + 0.6s duration
s = await dom(p);
check("gameover screen fade settled", s.goOpacity, "1");
check("retry button revealed", s.retryOpacity, "1");

// retry round trips: Enter, Space, touch tap on RETRY (each measured)
const msEnter = await retryMs(p, () => p.keyboard.press("Enter"));
const msSpace = await retryMs(p, () => p.keyboard.press("Space"));
const msTap = await retryMs(p, () => touchTap(p, "#go-retry"));
s = await dom(p);
check("retry re-streams chunks", s.chunks, chunks0);
const zr = s.dolly.z;
await p.waitForFunction((z) => window.__QA_SHELL.dolly().z > z, null, { timeout: 5000, polling: 25 }, zr);
check("retry dolly advances", true, true);

// MENU button click -> menu
await p.evaluate(() => window.__QA_SHELL.endRun());
await p.click("#go-menu");
s = await dom(p);
check("menu button -> menu", s.state, "menu");
check("menu button shows menu", s.menuOn, true);
check("menu button hides gameui", s.gameOn, false);
check("menu button hides screen", s.goOn, false);

// back-btn quit path from GAMEOVER (Esc's "back" half) -> menu
await p.keyboard.press("Enter");
await p.evaluate(() => window.__QA_SHELL.endRun());
await p.keyboard.press("Escape");
s = await dom(p);
check("esc in gameover -> menu", s.state, "menu");
check("esc hides screen", s.goOn, false);
check("esc shows menu", s.menuOn, true);
await p.close();

// ---- phase 2: injected save — NEW BEST flag both branches ------------------
p = await openPage(`${base}/?qa=1&scene=menu&mode=run&seed=7`, () => {
  localStorage.setItem(
    "endless.save.v1",
    JSON.stringify({
      v: 1,
      settings: { quality: null, timeOfDay: null },
      best: { run: 5000, drive: 0, ride: 0 },
      currency: 0,
      lastMode: "run",
    }),
  );
});
await p.keyboard.press("Enter"); // -> game (run)
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 4321, pickups: 2, score: 4600 }));
s = await dom(p);
check("injected best line", s.best, "BEST — 5,000 M");
check("flag off below best", s.flagOn, false);
await p.keyboard.press("Space"); // retry into game
s = await dom(p);
check("space retry clears stats", s.stats, null);
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 6000, pickups: 3, score: 6300 }));
s = await dom(p);
check("flag on above best", s.flagOn, true);
check("stats above best", s.distance, "6,000");
check("best line still previous best", s.best, "BEST — 5,000 M");
await p.evaluate(() => window.__QA_SHELL.quit());
check("quit handle hides screen", (await dom(p)).goOn, false);
await p.close();

// ---- phase 2.5: persistence (task 2.5) -------------------------------------
// Fresh save -> first death records best + credits currency in ONE write;
// the gameover view still shows the PREVIOUS best (2.4 display contract).
// Reload -> the menu RUN card reads the recorded best. Death below best ->
// best unchanged, currency accrues, one write. Beating death -> best
// updates, currency accumulates. Quit from PAUSE -> zero writes.
// Seed idempotently at document start (each browser.newPage is its own
// storage context): seeds only while storage is empty, so the recorded best
// survives the probe's reloads untouched.
const SEED_FRESH = () => {
  if (!localStorage.getItem("endless.save.v1")) {
    localStorage.setItem(
      "endless.save.v1",
      JSON.stringify({
        v: 1,
        settings: { quality: null, timeOfDay: null },
        best: { run: 0, drive: 0, ride: 0 },
        currency: 0,
        lastMode: "run",
      }),
    );
  }
};
p = await openPage(`${base}/?qa=1&scene=menu&mode=run&seed=7`, SEED_FRESH);
await armWrites(p);
await p.keyboard.press("Enter"); // -> game (run)
await resetWrites(p); // enterGame's pre-existing lastMode settings write is out of scope
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 4321, pickups: 7, score: 5000 }));
s = await dom(p);
check("persist: one write on new-best death", await readWrites(p), 1);
let sv = await readSave(p);
check("persist: best.run recorded", sv && sv.best.run, 4321);
check("persist: currency credited 7x5", sv.currency, 35);
check("persist: view keeps previous best", s.best, "BEST — —");
check("persist: flag on over fresh save", s.flagOn, true);

// Reload -> menu readback: RUN card carries the recorded best; the other
// cards stay "—" (footer's cross-mode line mirrors the run best).
await p.reload({ waitUntil: "domcontentloaded" });
check("persist: reload ready", await waitForReady(p), true);
await armWrites(p); // reload reset the page context
let mt = await menuTexts(p);
check("menu card run best after reload", mt.run, "BEST — 4,321 M");
check("menu card drive best untouched", mt.drive, "BEST — —");
check("menu card ride best untouched", mt.ride, "BEST — —");
check("menu footer cross-mode best", mt.footer, "BEST — 4,321 M");

// Death BELOW best: best unchanged, currency accrues, still one write, and
// the view keeps the previous best with the flag OFF.
await p.keyboard.press("Enter"); // -> game (run)
await resetWrites(p);
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 100, pickups: 2, score: 200 }));
s = await dom(p);
check("persist: one write below best", await readWrites(p), 1);
sv = await readSave(p);
check("persist: best unchanged below best", sv.best.run, 4321);
check("persist: currency accrues 35+2x5", sv.currency, 45);
check("persist: view shows previous best", s.best, "BEST — 4,321 M");
check("persist: flag off below best", s.flagOn, false);

// Beating death: best updates, currency accumulates across the two deaths.
await p.keyboard.press("Space"); // retry -> fresh game
await resetWrites(p);
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 5000, pickups: 3, score: 5300 }));
s = await dom(p);
check("persist: one write beating best", await readWrites(p), 1);
sv = await readSave(p);
check("persist: best updated", sv.best.run, 5000);
check("persist: currency accumulates 45+3x5", sv.currency, 60);
check("persist: view still previous best on beat", s.best, "BEST — 4,321 M");
check("persist: flag on beating best", s.flagOn, true);

// Reload again -> the card follows the new best.
await p.reload({ waitUntil: "domcontentloaded" });
check("persist: reload 2 ready", await waitForReady(p), true);
mt = await menuTexts(p);
check("menu card run best after best beat", mt.run, "BEST — 5,000 M");
check("menu footer cross-mode best after beat", mt.footer, "BEST — 5,000 M");

// Quit from PAUSE: no save write at all, save contents untouched.
await p.keyboard.press("Enter"); // -> game (run)
await p.keyboard.press("Escape"); // pause
check("persist: paused before quit", await p.evaluate(() => window.__QA.paused), true);
await resetWrites(p);
await p.click("#pause-quit");
s = await dom(p);
check("persist: quit -> menu", s.state, "menu");
check("persist: quit writes nothing", await readWrites(p), 0);
sv = await readSave(p);
check("persist: quit keeps best", sv.best.run, 5000);
check("persist: quit keeps currency", sv.currency, 60);
mt = await menuTexts(p);
check("menu card run best on quit path", mt.run, "BEST — 5,000 M");
await p.close();

// ---- phase 3: ?scene=gameover staged boot (deterministic, settled) ---------
// FRESH clears storage at document start: these phases assert fresh-save
// display and must not depend on what earlier phases left in localStorage.
const FRESH = () => localStorage.clear();
p = await openPage(`${base}/?qa=1&scene=gameover&mode=run&time=5&seed=7`, FRESH);
s = await dom(p);
check("staged boots ended", s.state, "gameover");
check("staged distance 38", s.stats.distance, 38);
check("staged dolly 57.5", s.dolly.z, 57.5);
check("staged screen on", s.goOn, true);
check("staged screen settled", s.goOpacity, "1");
check("staged retry settled", s.retryOpacity, "1");
check("staged distance text", s.distance, "38");
check("staged best line (fresh save)", s.best, "BEST — —");
check("staged flag on (38 > 0)", s.flagOn, true);
const zs = s.dolly.z;
await p.keyboard.press("Enter"); // staged retry
s = await dom(p);
check("staged retry -> game", s.state, "game");
check("staged retry hides screen", s.goOn, false);
await p.waitForFunction((z) => window.__QA_SHELL.dolly().z > z, null, { timeout: 5000, polling: 25 }, zs);
check("staged retry dolly advances", true, true);
await p.close();

// ---- phase 4: staged capture determinism pair (two loads) ------------------
const snap = async () => {
  const pg = await openPage(`${base}/?qa=1&scene=gameover&mode=run&time=5&seed=7`, FRESH);
  const d = await dom(pg);
  await pg.close();
  return d;
};
const a = await snap();
const b = await snap();
check(
  "determinism: rendered stats equal",
  `${a.distance}|${a.score}|${a.pickups}|${a.best}|${a.flagOn}`,
  `${b.distance}|${b.score}|${b.pickups}|${b.best}|${b.flagOn}`,
);
check("determinism: stats() equal", JSON.stringify(a.stats), JSON.stringify(b.stats));
check("determinism: dolly equal", a.dolly.z, b.dolly.z);

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
      retryMs: { enter: msEnter, space: msSpace, tap: msTap },
      envNoiseWarnings: envNoise,
      consoleErrors,
      consoleWarns,
      pageErrors,
    },
    null,
    2,
  ),
);
