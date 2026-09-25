#!/usr/bin/env bun
/**
 * QA HUD probe (task 5.1): visibility per shell state, live numerals vs
 * score.snapshot(), write-count/no-redundant-write policy (patched
 * textContent setters over 300 steady rAF frames), layout-thrash A/B
 * (running vs paused forced-layout read counters), pause-chip wiring
 * (mouse click + CDP touch tap through the EXISTING `pause` action; the
 * #pause scrim must block the chip while paused), draw calls, and the
 * stub-mode / staged-boot coverage. The long-running phases ride
 * ?staged=gauntlet (run.js suppresses death while staged).
 *
 * Usage: bun .qa/hud_probe.mjs [base-url]  (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8123";
const FRAMES = 300; // steady-state write-count window (rAF frames)
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
      timeout: 30000,
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

const hudState = (page) =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    paused: window.__QA_SHELL.paused(),
    hudOn: document.getElementById("hud").classList.contains("on"),
    hudCls: document.getElementById("hud").className,
    dist: document.getElementById("hud-distance").textContent,
    score: document.getElementById("hud-score").textContent,
    picks: document.getElementById("hud-pickups").textContent,
    snap: window.__QA_RUN ? window.__QA_RUN.score.snapshot() : null,
    routed: window.__QA_SHELL.routed.length,
    perf: window.__PERF ? { drawCalls: window.__PERF.drawCalls, tris: window.__PERF.tris } : null,
  }));
const num = (t) => Number(String(t).replace(/,/g, ""));
// Chunked rAF-count (SwiftShader ~7 fps: one evaluate must not sit minutes).
const countFrames = (page, n) =>
  page.evaluate(
    (frames) =>
      new Promise((res) => {
        let left = frames;
        const tick = () => (--left <= 0 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
const countChunked = async (page, total) => {
  while (total > 0) {
    const n = Math.min(total, 60);
    await countFrames(page, n);
    total -= n;
  }
};

// ---- phase 1: MENU hidden -> GAME shown, numerals match the ledger ---------
let p = await openPage(`${base}/?qa=1&scene=menu&staged=gauntlet&mode=run&seed=11`);
let s = await hudState(p);
check("menu state", s.state, "menu");
check("menu hud hidden", s.hudOn, false);
check("menu hud class bare", s.hudCls, "screen");

await p.keyboard.press("1");
await p.keyboard.press("Enter");
s = await hudState(p);
check("enter -> game", s.state, "game");
check("game hud shown", s.hudOn, true);
check("game hud placement class", s.hudCls, "screen hud-run on");

// live values == snapshot() across several samples while running
for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(220);
  s = await hudState(p);
  check(`sample ${i} distance matches`, num(s.dist), s.snap.distance);
  check(`sample ${i} score matches`, num(s.score), s.snap.score);
  check(`sample ${i} pickups matches`, num(s.picks), s.snap.pickups);
}
const d0 = num(s.dist);
await p.waitForTimeout(220);
check("distance advances", num((await hudState(p)).dist) > d0, true);

// collection: an in-lane marker ahead of the runner -> ledger + DOM +1
const beforePickups = (await hudState(p)).snap.pickups;
const spawned = await p.evaluate(() => {
  const run = window.__QA_RUN;
  const rec = run.pickups.spawn({ x: run.player.group.position.x, z: run.focus() + 3 });
  return !!rec;
});
check("spawned pickup ahead", spawned, true);
await p.waitForTimeout(700);
s = await hudState(p);
check("ledger collected", s.snap.pickups, beforePickups + 1);
check("DOM pickups collected", num(s.picks), beforePickups + 1);
const perfGame = s.perf; // HUD visible, all systems live
check("game draws within cap with HUD", perfGame.drawCalls <= 220, true);

// ---- phase 2: write policy + layout thrash over FRAMES steady frames -------
await p.evaluate(() => {
  const w = {
    distance: 0, score: 0, pickups: 0,
    lastD: null, lastS: null, lastP: null,
    redundant: 0, layoutReads: 0,
  };
  // Descriptor lookup up the chain (textContent lives on Node.prototype).
  const descFor = (obj, prop) => {
    let o = obj;
    while (o) {
      const d = Object.getOwnPropertyDescriptor(o, prop);
      if (d) return d;
      o = Object.getPrototypeOf(o);
    }
    return null;
  };
  const watch = (el, key, lastKey) => {
    const d = descFor(el, "textContent"); // per-instance own property
    Object.defineProperty(el, "textContent", {
      get() {
        return d.get.call(el);
      },
      set(v) {
        w[key]++;
        if (w[lastKey] === v) w.redundant++; // a write that changed nothing
        w[lastKey] = v;
        d.set.call(el, v);
      },
      configurable: true,
    });
  };
  watch(document.getElementById("hud-distance"), "distance", "lastD");
  watch(document.getElementById("hud-score"), "score", "lastS");
  watch(document.getElementById("hud-pickups"), "pickups", "lastP");
  // Forced-synchronous-layout reads: count EVERY call app-wide during a
  // window — the HUD must add zero (A/B against the paused window below).
  for (const name of ["getBoundingClientRect", "getClientRects"]) {
    const fn = Element.prototype[name];
    Element.prototype[name] = function (...a) {
      w.layoutReads++;
      return fn.apply(this, a);
    };
  }
  for (const prop of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]) {
    const d = descFor(HTMLElement.prototype, prop); // accessors live here
    Object.defineProperty(HTMLElement.prototype, prop, {
      get() {
        w.layoutReads++;
        return d.get.call(this);
      },
      configurable: true,
    });
  }
  const gcs = window.getComputedStyle;
  window.getComputedStyle = function (...a) {
    w.layoutReads++;
    return gcs.apply(window, a);
  };
  window.__HUD_WRITES = w;
});
await p.evaluate(() => {
  const w = window.__HUD_WRITES;
  w.distance = 0; w.score = 0; w.pickups = 0; w.layoutReads = 0;
});
await countChunked(p, FRAMES);
let w = await p.evaluate(() => window.__HUD_WRITES);
const windowTotals = {
  frames: FRAMES,
  distanceWrites: w.distance,
  scoreWrites: w.score,
  pickupsWrites: w.pickups,
  redundant: w.redundant,
  layoutReadsRunning: w.layoutReads,
};
check("steady state: distance writes", w.distance > 0, true);
check("steady state: zero redundant writes", w.redundant, 0);
check(
  "steady state: score writes track distance+pickups",
  Math.abs(w.score - (w.distance + w.pickups)) <= 1,
  true,
);
check("steady state: zero layout reads (running)", w.layoutReads, 0);
s = await hudState(p);
check("post-window distance matches", num(s.dist), s.snap.distance);
check("post-window score matches", num(s.score), s.snap.score);
check("post-window pickups matches", num(s.picks), s.snap.pickups);

// layout A/B: same scene PAUSED (mode.update -> hud.update never fires):
// the read counter must stay at zero too (the HUD path adds no reads).
await p.keyboard.press("Escape");
s = await hudState(p);
check("esc pauses", s.paused, true);
check("paused hud still on (numerals stay)", s.hudOn, true);
await p.evaluate(() => {
  const w2 = window.__HUD_WRITES;
  w2.distance = 0; w2.score = 0; w2.pickups = 0; w2.layoutReads = 0;
});
await countChunked(p, 100);
w = await p.evaluate(() => window.__HUD_WRITES);
check("zero layout reads (paused A/B)", w.layoutReads, 0);
check("paused: zero numeral writes", w.distance + w.score + w.pickups, 0);
windowTotals.layoutReadsPaused = w.layoutReads;
await p.keyboard.press("Escape"); // resume
s = await hudState(p);
check("resumed", s.paused, false);
check("resumed hud still on", s.hudOn, true);

// ---- phase 3: pause chip — the shell's EXISTING `pause` action path --------
// The chip lands on routeAction("pause") — the same route Esc's action
// takes — so it does NOT appear in __QA_ACTIONS (that trace mirrors
// InputManager emissions only). Single-fire is proven by the flag: a
// double toggle would land back on false.
const rBefore = s.routed;
const actionsBefore = await p.evaluate(() => window.__QA_ACTIONS.length);
await p.click("#hud-pause");
await p.waitForTimeout(80);
s = await hudState(p);
const newActions = await p.evaluate(
  (n) => window.__QA_ACTIONS.slice(n).map((a) => a.action),
  actionsBefore,
);
check("chip click pauses (one toggle)", s.paused, true);
check("chip shows pause screen", await p.evaluate(() => document.getElementById("pause").classList.contains("on")), true);
check("chip mirror true", await p.evaluate(() => window.__QA.paused), true);
check("chip: only the inert tap precedes (2.3 ordering)",
  JSON.stringify(newActions),
  JSON.stringify(["tap"]));
check("chip tap routed to mode once (ignored)", s.routed - rBefore, 1);
check("paused hud stays on", s.hudOn, true);
const zFrozen = s.snap.distance;
await p.waitForTimeout(300);
s = await hudState(p);
check("chip pause froze the run", s.snap.distance, zFrozen);

// while paused the chip must be UNCLICKABLE (#pause scrim covers it)
const chipPt = await p.evaluate(() => {
  const b = document.getElementById("hud-pause").getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await p.mouse.click(chipPt.x, chipPt.y);
await p.waitForTimeout(80);
check("scrim blocks chip while paused (no toggle)", (await hudState(p)).paused, true);
check("blocked click leaves screen on", await p.evaluate(() => document.getElementById("pause").classList.contains("on")), true);

// RESUME via the pause screen; HUD must lose nothing
await p.click("#pause-resume");
await p.waitForTimeout(80);
s = await hudState(p);
check("resume unpauses", s.paused, false);
check("resume keeps hud on", s.hudOn, true);
check("resume keeps placement class", s.hudCls, "screen hud-run on");
check("resume keeps gameui", await p.evaluate(() => document.getElementById("gameui").classList.contains("on")), true);
const rAfter = s.snap.distance;
await p.waitForTimeout(300);
check("resumed distance advances", (await hudState(p)).snap.distance > rAfter, true);

// touch tap on the chip (CDP) — one tap = one toggle, same action path.
// (CDP touch emits touch + compat-mouse pointerups = two inert "tap" trace
// entries; the click — and only the click — routes the pause.)
const actionsBeforeTap = await p.evaluate(() => window.__QA_ACTIONS.length);
const box = await p.locator("#hud-pause").boundingBox();
const cdp = await p.context().newCDPSession(p);
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
});
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await p.waitForTimeout(80);
s = await hudState(p);
const tapActions = await p.evaluate(
  (n) => window.__QA_ACTIONS.slice(n).map((a) => a.action),
  actionsBeforeTap,
);
check("touch tap pauses (one toggle)", s.paused, true);
check("touch tap trace is taps only (no gameplay leak)",
  tapActions.every((a) => a === "tap") && tapActions.length >= 1,
  true);
await p.keyboard.press("Escape"); // resume for phase 4
check("resumed again", (await hudState(p)).paused, false);

// ---- phase 4: GAMEOVER / retry / quit coverage ------------------------------
await p.evaluate(() => window.__QA_SHELL.endRun());
s = await hudState(p);
check("gameover hud hidden", s.hudOn, false);
await p.keyboard.press("Enter"); // retry
s = await hudState(p);
check("retry hud shown", s.hudOn, true);
await p.waitForTimeout(250);
s = await hudState(p);
check("retry distance restarted near zero", num(s.dist) < 15, true);
await p.evaluate(() => window.__QA_SHELL.endRun()); // dead again...
await p.keyboard.press("Escape"); // ...Esc in GAMEOVER quits to MENU
s = await hudState(p);
check("quit -> menu", s.state, "menu");
check("menu hud hidden after quit", s.hudOn, false);
check("menu hud class bare after quit", s.hudCls, "screen");
await p.close();

// ---- phase 5: stub-mode GAME (drive) — HUD absent (regression guard) -------
p = await openPage(`${base}/?qa=1&scene=game&mode=drive&seed=1`);
s = await hudState(p);
check("drive stub: hud hidden", s.hudOn, false);
check("drive stub: no placement class", s.hudCls, "screen");
check("drive stub: numerals untouched", `${s.dist}|${s.score}|${s.picks}`, "0|0|0");
await p.close();

// ---- phase 6: staged paused boot — numerals stay (scrim covers) ------------
p = await openPage(`${base}/?qa=1&scene=paused&mode=run&seed=7`);
s = await hudState(p);
check("staged paused state", s.state, "game");
check("staged paused flag", s.paused, true);
check("staged paused hud stays on", s.hudOn, true);
await p.close();

// ---- phase 7: staged gameover boot — HUD hidden ----------------------------
p = await openPage(`${base}/?qa=1&scene=gameover&mode=run&time=5&seed=7`);
s = await hudState(p);
check("staged gameover hud hidden", s.hudOn, false);
check("staged gameover class (layout stays, hidden)", s.hudCls, "screen hud-run");
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
      windowTotals,
      perfGame,
      envNoiseWarnings: envNoise,
      consoleErrors,
      consoleWarns,
      pageErrors,
    },
    null,
    2,
  ),
);
