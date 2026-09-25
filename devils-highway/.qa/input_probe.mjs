#!/usr/bin/env bun
/**
 * QA input probe (task 2.1): drives real keyboard events + CDP touch events
 * through the page, reads the QA-only window.__QA_ACTIONS trace (qa/hooks.js)
 * and the menu/game DOM state, and prints one JSON report. Temporary
 * verification tool for the input slice; touches nothing in the page.
 *
 * Usage: bun .qa/input_probe.mjs [base-url]  (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8123";
const url = `${base}/?qa=1&scene=menu`;

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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

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
await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
    timeout: 15000,
    polling: 250,
  })
  .catch(() => {});

const cdp = await page.context().newCDPSession(page);
const problems = [];
const mark = (name) =>
  page.evaluate(
    (n) => window.__QA_ACTIONS.push({ t: 0, action: `MARK:${n}`, code: "", dx: 0, dy: 0 }),
    name,
  );
const state = () =>
  page.evaluate(() => ({
    sel: document.querySelector("#menu .card.sel")?.dataset.mode || null,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    paused: (window.__QA || {}).paused === true, // live PAUSED mirror (task 2.2)
  }));
const check = (label, got, want) => {
  if (got !== want) problems.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
/** Trace entries after a MARK marker, markers stripped. */
const since = (marker) =>
  page.evaluate((m) => {
    const all = window.__QA_ACTIONS;
    const i = all.findIndex((a) => a.action === `MARK:${m}`);
    return all.slice(i + 1).filter((a) => !a.action.startsWith("MARK:"));
  }, marker);

// ---- phase m: menu keys must keep working (select / back / start) --------
let s = await state();
check("boot selection", s.sel, "drive");
check("boot menu on", s.menuOn, true);
await mark("m");
await page.keyboard.press("1");
check("key1 select run", (await state()).sel, "run");
await page.keyboard.press("2");
check("key2 select drive", (await state()).sel, "drive");
await page.keyboard.press("Escape"); // in MENU: pause+back emitted, menu stays
s = await state();
check("esc in menu keeps menu", s.menuOn, true);
check("esc in menu not game", s.gameOn, false);
await page.keyboard.press("Enter");
s = await state();
check("enter starts game", s.gameOn, true);
check("enter hides menu", s.menuOn, false);
const mSeq = (await since("m")).map((a) => a.action);
check(
  "menu-phase emissions",
  JSON.stringify(mSeq),
  JSON.stringify(["mode-1", "mode-2", "pause", "back", "confirm"]),
);

// ---- phase k: gameplay keyboard, edge-triggered ---------------------------
await mark("k");
for (const [key, action] of [
  ["a", "left"], ["d", "right"], ["ArrowLeft", "left"], ["ArrowRight", "right"],
  ["w", "jump"], ["ArrowUp", "jump"], ["Space", "jump"],
  ["s", "slide"], ["ArrowDown", "slide"],
]) {
  const before = (await since("k")).length;
  await page.keyboard.press(key);
  const entries = await since("k");
  check(`key ${key} adds one entry`, entries.length, before + 1);
  check(`key ${key} action`, entries[entries.length - 1].action, action);
  check(`key ${key} code`, entries[entries.length - 1].code !== "touch", true);
}
// Hold: OS auto-repeat must NOT spam (e.repeat dropped) — exactly 1 more.
await page.keyboard.down("a");
await page.waitForTimeout(900);
await page.keyboard.up("a");
const kAfterHold = await since("k");
check("hold A adds exactly one", kAfterHold.length, 10);
check("held A action", kAfterHold[kAfterHold.length - 1].action, "left");
// Esc in GAME now PAUSES the run (task 2.2 spec change; was: exits to menu).
await page.keyboard.press("Escape");
s = await state();
check("esc in game pauses (stays in game)", s.gameOn && !s.menuOn, true);
check("esc in game sets paused flag", s.paused, true);
const kTail = (await since("k")).slice(-2).map((a) => a.action);
check("esc in game dual emission", JSON.stringify(kTail), JSON.stringify(["pause", "back"]));
await page.keyboard.press("Escape"); // second press resumes (one press = one toggle)
s = await state();
check("second esc resumes", s.paused, false);
check("resume keeps gameui", s.gameOn, true);

// ---- phase t: touch swipes + tap via CDP, in GAME -------------------------
await page.keyboard.press("Enter");
check("re-enter game", (await state()).gameOn, true);
await mark("t");
const swipe = async (x0, y0, x1, y1) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  if (x1 !== x0 || y1 !== y0) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1, y: y1 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(30);
};
await swipe(400, 500, 310, 500); // left (dx -90)
await swipe(400, 500, 490, 500); // right (dx +90)
await swipe(400, 500, 400, 410); // up (dy -90)
await swipe(400, 500, 400, 590); // down (dy +90)
await swipe(400, 500, 400, 500); // tap (delta below CONFIG.INPUT.swipePx)
const tSeq = await since("t");
check("touch count", tSeq.length, 5);
check(
  "touch actions",
  JSON.stringify(tSeq.map((a) => a.action)),
  JSON.stringify(["left", "right", "jump", "slide", "tap"]),
);
check("touch code tag", tSeq.every((a) => a.code === "touch"), true);
check("swipe left dx", tSeq[0].dx < -24 && tSeq[0].dy === 0, true);
check("swipe right dx", tSeq[1].dx > 24 && tSeq[1].dy === 0, true);
check("swipe up dy", tSeq[2].dy < -24 && tSeq[2].dx === 0, true);
check("swipe down dy", tSeq[3].dy > 24 && tSeq[3].dx === 0, true);
check("tap under threshold", Math.abs(tSeq[4].dx) < 24 && Math.abs(tSeq[4].dy) < 24, true);
s = await state();
check("tap did not hit back-btn", s.gameOn, true);

// ---- report ---------------------------------------------------------------
const full = await page.evaluate(() => window.__QA_ACTIONS || null);
const counts = {};
for (const a of full || []) {
  if (a.action.startsWith("MARK:")) continue;
  counts[a.action] = (counts[a.action] || 0) + 1;
}
await browser.close();
console.log(
  JSON.stringify(
    {
      ok: problems.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0,
      problems,
      counts,
      consoleErrors,
      consoleWarns,
      pageErrors,
      actions: full,
    },
    null,
    2,
  ),
);
