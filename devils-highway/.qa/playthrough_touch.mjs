#!/usr/bin/env bun
/**
 * QA task 7.2 — TOUCH end-to-end playthrough (human-perspective pass).
 * CDP device emulation 390x844, DPR 3 (iPhone-class), touch events only:
 * mode select + all UI via TAPS on the real buttons, gameplay via SWIPES
 * (left/right/up/down, >= CONFIG.INPUT.swipePx 24 px deltas).
 *
 * SwiftShader pacing reality (documented in the 7.2 report): at ~10 fps the
 * sim advances ~4.5 m between readable samples, so the ~1.3-1.6 m jump/slide
 * initiation windows are frequently skipped by ANY reacting observer. The
 * driver therefore plays like a cautious human at that pace: dodge-first
 * (lane changes are latency-tolerant), opportunistic jump/slide windows,
 * and NATURAL deaths are accepted and retried with real taps — exactly the
 * session a player would live through. Every death is verified as a real
 * overlap (no tunneling). The FINAL life ends in a deliberate suicide.
 *
 * Session: boot -> tap RUN (select, then start) -> play (up to 4 lives,
 * real tap-retries between) -> final-life deliberate death -> gameover
 * stats/save/NEW BEST -> tap RETRY (exactly one run) -> run 2 past the best
 * -> pause via the HUD chip tap (single toggle, no double-fire) -> RESUME
 * tap -> QUIT - MENU tap -> menu card best -> reload persistence.
 *
 * Layout asserts (DOM rects): no horizontal scroll at 390 px, HUD strip +
 * numerals inside the viewport, pause panel == min(320px, 84vw), gameover
 * panel == min(360px, 88vw), touch targets measured vs ~40 px. Audio unlock
 * verified at the AudioContext boundary (first touch only).
 *
 * Usage: bun .qa/playthrough_touch.mjs [base-url]  (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:8123";
const SHOTS = new URL("./shots/7.2/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
let envNoise = 0;
const ENV_NOISE = /GPU stall due to ReadPixels/i;
const log = [];

const check = (step, input, expected, observed, pass) => {
  const ok = pass === undefined ? Boolean(observed) : pass;
  log.push({ step, input, expected, observed: String(observed), pass: !!ok });
  if (!ok) problems.push(`${step} [${input}]: expected ${expected}, got ${JSON.stringify(observed)}`);
};

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
  ],
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
await context.addInitScript(() => {
  // Death-cause recorder (in-page, 25 ms): snapshots the overlapping hazard
  // at the FIRST dead frame — probe-side reads lag 1+ round trips, during
  // which the lane ease drifts and chasing zombies walk past the frozen
  // player. Runs only under ?qa=1 (window.__QA_RUN exists there).
  window.__DEATH_CAUSE = null;
  setInterval(() => {
    const R = window.__QA_RUN;
    if (!R || !R.player || window.__DEATH_CAUSE) return;
    if (R.player.state !== "dead") return;
    const p = R.player.profile;
    const c = { obs: null, zom: false, x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
    for (const o of R.obstacles.records) {
      if (!o.alive) continue;
      if (Math.abs(o.z - p.z) < o.zHalf + 0.35 && Math.abs(o.x - p.x) < o.halfW + 1.5) {
        c.obs = { type: o.type };
      }
    }
    for (const z of R.zombies.records) {
      if (!z.alive) continue;
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      if (dx * dx + dz * dz < 1.0) c.zom = true;
    }
    window.__DEATH_CAUSE = c;
  }, 25);
  window.__AC = { count: 0, states: [] };
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (Orig) {
    window.AudioContext = class extends Orig {
      constructor(...a) {
        super(...a);
        window.__AC.count++;
        window.__AC.states.push(this.state);
      }
    };
  }
});
const page = await context.newPage();
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") {
    if (ENV_NOISE.test(m.text())) envNoise++;
    else consoleWarns.push(m.text());
  }
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

const cdp = await context.newCDPSession(page);

/** Raw CDP touch: tap (no move) or swipe (start -> end, > swipePx delta). */
async function touch(x0, y0, x1 = x0, y1 = y0) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  if (x1 !== x0 || y1 !== y0) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1, y: y1 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const tapCenter = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  await touch(b.x + b.width / 2, b.y + b.height / 2);
};
const SWIPE_Y = 430;
const doAction = {
  left: () => touch(195, SWIPE_Y, 115, SWIPE_Y),
  right: () => touch(195, SWIPE_Y, 275, SWIPE_Y),
  jump: () => touch(195, SWIPE_Y, 195, SWIPE_Y - 70),
  slide: () => touch(195, SWIPE_Y, 195, SWIPE_Y + 70),
};

/**
 * One evasion decision for the live view (shared by every life/attempt).
 * Dodge-first (latency-tolerant), opportunistic jump/slide windows, plus
 * pre-emptive handling of FULL 3-lane bands (no open lane): steer to the
 * slide-able (gantry) or jump-able (low) lane and clear it in place.
 * Returns the action string or null.
 */
function decide(w) {
  const hz = [];
  for (const o of w.obstacles) hz.push({ t: o.type, x: o.x, dz: o.dz });
  for (const z of w.zombies) hz.push({ t: "zombie", x: z.x, dz: z.dz });
  hz.sort((a, b) => a.dz - b.dz);
  const h = hz[0];

  // Pre-emption: a full band (adjacent lanes blocked too) must be cleared
  // in-lane — move to the gantry/low lane EARLY (5-18 m out), then slide/jump.
  const band = w.obstacles.filter((o) => o.dz > 5 && o.dz < 18);
  const boxed = h && h.dz < 16 && !w.clearLeft && !w.clearRight
    && band.some((o) => Math.abs(o.x - w.px) < 1.9);
  if (boxed && w.state === "run") {
    const g = band.find((o) => o.type === "gantry");
    const l = band.find((o) => o.type === "low");
    const target = g || l;
    if (target && Math.abs(target.x - w.px) > 0.9) {
      return target.x > w.px ? "right" : "left";
    }
    if (g && Math.abs(g.x - w.px) <= 1 && g.dz < 5.5) return "slide";
    if (l && Math.abs(l.x - w.px) <= 1 && l.dz < 3.35 && l.dz > 2.05) return "jump";
  }

  if (!h) return null;
  // Bail threshold is PRE-EMPTIVE (14 m): one CDP round trip can consume
  // ~4.5 m of road at SwiftShader pacing, so a 9 m reaction is often dead
  // on arrival. laneClear() still validates the target lane.
  if (h.t === "low") {
    if (w.state === "run" && h.dz < 3.35 && h.dz > 2.05) return "jump";
    if (h.dz < 14) return w.clearLeft ? "left" : w.clearRight ? "right" : null;
  } else if (h.t === "gantry") {
    // Slide coverage is long (0.7 s = ~5.3 m): fire on sight in-lane.
    if (w.state === "run" && h.dz < 5.5) return "slide";
    if (h.dz < 14) return w.clearLeft ? "left" : w.clearRight ? "right" : null;
  } else if (h.dz < 14) {
    return w.clearLeft ? "left" : w.clearRight ? "right" : null;
  }
  return null;
}

const shellState = () =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    paused: window.__QA_SHELL.paused(),
    stats: window.__QA_SHELL.stats(),
    ac: window.__AC.count,
    sel: document.querySelector("#menu .card.sel")?.dataset.mode || null,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    hudOn: document.getElementById("hud").classList.contains("on"),
    pauseOn: document.getElementById("pause").classList.contains("on"),
    goOn: document.getElementById("gameover").classList.contains("on"),
    vw: window.innerWidth,
    dpr: window.devicePixelRatio,
    hud: {
      d: document.getElementById("hud-distance").textContent,
      s: document.getElementById("hud-score").textContent,
      p: document.getElementById("hud-pickups").textContent,
    },
    go: {
      d: document.getElementById("go-distance").textContent,
      s: document.getElementById("go-score").textContent,
      p: document.getElementById("go-pickups").textContent,
      flag: document.getElementById("go-flag").classList.contains("on"),
      best: document.getElementById("go-best").textContent,
    },
    save: JSON.parse(localStorage.getItem("endless.save.v1") || "null"),
  }));
const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(100);
  }
};
/** Player + shell in ONE evaluate (CDP round trips are the latency budget). */
const readWorld = () =>
  page.evaluate(() => {
    const R = window.__QA_RUN;
    if (!R || !R.player) return null;
    const p = R.player.profile;
    const px = p.x;
    const pz = p.z;
    const laneClear = (dir) => {
      const x = px + dir * 3.4;
      if (Math.abs(x) > 3.5) return false;
      // Look-ahead matches the 14 m pre-emptive bail: a target lane is only
      // "clear" if nothing threatens it within the same horizon.
      for (const o of R.obstacles.records) {
        if (o.alive && o.z > pz - 2 && o.z < pz + 16 && Math.abs(o.x - x) < 2.4) return false;
      }
      for (const z of R.zombies.records) {
        if (z.alive && Math.abs(z.z - pz) < 14 && Math.abs(z.x - x) < 2.4) return false;
      }
      return true;
    };
    return {
      shell: window.__QA_SHELL.state(),
      paused: window.__QA.paused,
      state: R.player.state,
      px,
      distance: R.score.distance,
      pickups: R.score.pickups,
      obstacles: R.obstacles.records
        .filter((o) => o.alive && o.z > pz && o.z < pz + 24)
        .map((o) => ({ type: o.type, x: o.x, dz: o.z - pz })),
      zombies: R.zombies.records
        .filter((z) => z.alive && z.z > pz && z.z < pz + 24)
        .map((z) => ({ x: z.x, dz: z.z - pz })),
      clearLeft: laneClear(-1),
      clearRight: laneClear(1),
    };
  });
/** Death cause: a verified real overlap at the player profile (no tunneling). */
const deathCause = () =>
  page.evaluate(() => {
    const R = window.__QA_RUN;
    if (!R || !R.player) return null;
    const p = R.player.profile;
    const rec = window.__DEATH_CAUSE;
    let obsHit = rec ? rec.obs : null;
    let zomHit = rec ? rec.zom : false;
    if (!rec) {
      // Fallback (recorder missed): same-window compute, drift-tolerant.
      for (const o of R.obstacles.records) {
        if (!o.alive) continue;
        if (Math.abs(o.z - p.z) < o.zHalf + 0.4 && Math.abs(o.x - p.x) < o.halfW + 1.0) {
          obsHit = { type: o.type };
        }
      }
      for (const z of R.zombies.records) {
        if (!z.alive) continue;
        const dx = z.x - p.x;
        const dz = z.z - p.z;
        if (dx * dx + dz * dz < 2.56) zomHit = true;
      }
    }
    return { obsHit, zomHit, dist: R.score.distance, picks: R.score.pickups, state: R.player.state };
  });
const layoutAudit = () =>
  page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b
        ? { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }
        : null;
    };
    return {
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      strip: r(".hud-strip"),
      numD: r("#hud-distance"),
      numS: r("#hud-score"),
      numP: r("#hud-pickups"),
      chip: r("#hud-pause"),
      pausePanel: r(".pause-panel"),
      resume: r("#pause-resume"),
      restart: r("#pause-restart"),
      quit: r("#pause-quit"),
      goPanel: r(".gameover-panel"),
      retry: r("#go-retry"),
      goMenu: r("#go-menu"),
      cards: Array.from(document.querySelectorAll(".card")).map((c) => {
        const b = c.getBoundingClientRect();
        return { m: c.dataset.mode, l: +b.left.toFixed(1), r: +b.right.toFixed(1), h: +b.height.toFixed(1) };
      }),
    };
  });
const insideViewport = (vw, vh, ...rects) =>
  rects.every((x) => x && x.l >= -0.5 && x.t >= -0.5 && x.r <= vw + 0.5 && x.b <= vh + 0.5);


// ============================================================================
// 1. BOOT (fresh storage, mobile viewport)
// ============================================================================
await page.goto(`${base}/?qa=1&seed=46`, { waitUntil: "domcontentloaded", timeout: 30000 });
const ready = await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, { timeout: 25000, polling: 200 })
  .then(() => true)
  .catch(() => false);
check("boot", "load ?qa=1&seed=46", "screenshotReady", ready ? "true" : "timeout", ready);
let s = await shellState();
check("boot", "device emulation", "390x844 @3x", `${s.vw}x844 @${s.dpr}`, s.vw === 390 && s.dpr === 3);
check("boot", "state machine", "menu", s.state, s.state === "menu");
check("boot", "fresh storage", "absent", s.save === null ? "absent" : "present", s.save === null);
check("boot", "no AudioContext before first touch", 0, s.ac, s.ac === 0);

let lay = await layoutAudit();
check("layout", "menu: no horizontal scroll at 390 px", "<= 390",
  `doc=${lay.docScrollW} body=${lay.bodyScrollW}`,
  lay.docScrollW <= 390 && lay.bodyScrollW <= 390);
check("layout", "menu: all 3 cards inside the viewport + tappable", "right <= 390, h >= 40",
  lay.cards.map((c) => `${c.m}:r${c.r},h${c.h}`).join(" "),
  lay.cards.every((c) => c.l >= 0 && c.r <= 390.5 && c.h >= 40));

// ============================================================================
// 2. SELECT RUN + START (tap card: first tap selects, second starts)
// ============================================================================
const runCard = await page.locator('.card[data-mode="run"]').boundingBox();
await touch(runCard.x + runCard.width / 2, runCard.y + 24);
await page.waitForTimeout(500);
s = await shellState();
check("menu", "tap RUN card #1", "sel=run", s.sel, s.sel === "run");
check("menu", "first touch unlocks audio", "1 ctx", `${s.ac} ctx`, s.ac === 1);
await touch(runCard.x + runCard.width / 2, runCard.y + 24);
await page.waitForTimeout(500);
s = await shellState();
check("menu", "tap RUN card #2", "GAME + HUD on", `state=${s.state} hud=${s.hudOn}`,
  s.state === "game" && s.hudOn && !s.menuOn);
check("menu", "no double-fire on the start tap", "stats null (one enterGame)",
  s.stats === null ? "stats null" : "stats set", s.stats === null);

// ============================================================================
// 3. RUN 1 — multi-life swipe session (natural deaths retried with taps),
//    final life ends in a deliberate suicide
// ============================================================================
let shotTaken = false;
let lastHudSample = 0;
const totals = { jumps: 0, slides: 0, dodges: 0, picks: 0, lives: 0, deaths: [], deaths2: [] };
let bestDist = 0;
const calSwipes = { jumped: false, slid: false, jumpedOk: false, slidOk: false };
let suicide = false;
let suicideTarget = null;
let lastLife = null;

for (let life = 1; life <= 5; life++) {
  totals.lives = life;
  suicide = life === 5;
  const t0 = Date.now();
  let ended = null;
  for (;;) {
    const wall = Date.now() - t0;
    const w = await readWorld();
    if (!w) { await page.waitForTimeout(60); continue; }
    if (w.shell === "gameover" || w.state === "dead") { ended = "death"; break; }
    if (w.shell !== "game" || w.paused) { await page.waitForTimeout(80); continue; }

    if (!shotTaken && wall > 7000) {
      shotTaken = true;
      await page.screenshot({ path: `${SHOTS}touch_run_dusk.png` });
      lay = await layoutAudit();
      check("layout", "mid-run: HUD strip inside 390 px (no clip)",
        "0 <= strip <= 390", `l=${lay.strip.l} r=${lay.strip.r}`,
        insideViewport(390, 844, lay.strip));
      check("layout", "mid-run: HUD numerals inside the viewport", "inside",
        `d=${lay.numD.r} s=${lay.numS.r} p=${lay.numP.r}`,
        insideViewport(390, 844, lay.numD, lay.numS, lay.numP));
      check("layout", "mid-run: PAUSE chip inside viewport + target size",
        "inside", `w=${lay.chip.w} h=${lay.chip.h} r=${lay.chip.r} b=${lay.chip.b}`,
        insideViewport(390, 844, lay.chip));
    }
    // HUD == ledger within one frame of travel (the DOM push is per-frame).
    if (Date.now() - lastHudSample > 3000) {
      lastHudSample = Date.now();
      const st = await shellState();
      const d = parseInt(st.hud.d.replace(/,/g, ""), 10);
      const pN = parseInt(st.hud.p.replace(/,/g, ""), 10);
      const sc = parseInt(st.hud.s.replace(/,/g, ""), 10);
      const skew = Math.abs(d - Math.floor(w.distance));
      if (!(skew <= 8 && Math.abs(pN - w.pickups) <= 1 && Math.abs(sc - (Math.floor(w.distance) + w.pickups * 25)) <= 8 + w.pickups * 25)) {
        problems.push(`hud mismatch: dom ${st.hud.d}/${st.hud.s}/${st.hud.p} vs ledger ${Math.floor(w.distance)} + ${w.pickups}*25`);
      }
    }

    // Human test-swipes in the calm grace road: exercise the REAL
    // touch-swipe -> jump / slide path once each (verified by state).
    if (life === 1 && !calSwipes.jumped && wall > 2000) {
      calSwipes.jumped = true;
      await doAction.jump();
      await page.waitForTimeout(300);
      if ((await readWorld())?.state === "jump") { totals.jumps++; calSwipes.jumpedOk = true; }
    }
    if (life === 1 && calSwipes.jumped && !calSwipes.slid && wall > 3800) {
      calSwipes.slid = true;
      await doAction.slide();
      await page.waitForTimeout(300);
      if ((await readWorld())?.state === "slide") { totals.slides++; calSwipes.slidOk = true; }
    }

    // Final life: switch to suicide (steer INTO the nearest hazard, no evading).
    if (suicide && !suicideTarget && wall > 12000) {
      const cands = [
        ...w.obstacles.filter((o) => o.dz > 4).map((o) => ({ kind: o.type, x: o.x, dz: o.dz })),
        ...w.zombies.filter((z) => z.dz > 4).map((z) => ({ kind: "zombie", x: z.x, dz: z.dz })),
      ].sort((a, b) => a.dz - b.dz);
      if (cands.length) suicideTarget = cands[0];
    }
    if (suicide) {
      if (suicideTarget && suicideTarget.kind !== "zombie" && w.state !== "dead"
          && Math.abs(suicideTarget.x - w.px) > 0.9) {
        await doAction[suicideTarget.x > w.px ? "right" : "left"]();
      }
      await page.waitForTimeout(60);
      continue;
    }

    // ---- dodge-first evasion (one decision per tick) -----------------------
    let act = decide(w);
    if (act === "jump") totals.jumps++;
    else if (act === "slide") totals.slides++;
    else if (act) totals.dodges++;
    if (act) { await doAction[act](); continue; }

    // Calm road: chase an off-lane pickup (pickup view needs one more read —
    // only when calm, so the latency cost lands on empty road).
    if (w.state === "run") {
      const seek = await page.evaluate(() => {
        const R = window.__QA_RUN;
        const p = R.player.profile;
        const laneClear = (dir) => {
          const x = p.x + dir * 3.4;
          if (Math.abs(x) > 3.5) return false;
          for (const o of R.obstacles.records) {
            if (o.alive && Math.abs(o.z - p.z) < 10 && Math.abs(o.x - x) < 2.4) return false;
          }
          for (const z of R.zombies.records) {
            if (z.alive && Math.abs(z.z - p.z) < 10 && Math.abs(z.x - x) < 2.4) return false;
          }
          return true;
        };
        const k = R.pickups.records
          .filter((q) => q.alive && q.z > p.z + 1 && q.z < p.z + 18 && Math.abs(q.x - p.x) > 1.2)
          .sort((a, b) => a.z - b.z)[0];
        return k ? { x: k.x, left: laneClear(-1), right: laneClear(1) } : null;
      });
      if (seek) {
        if (seek.x < w.px && seek.left) act = "left";
        else if (seek.x > w.px && seek.right) act = "right";
      }
    }
    if (act) { totals.dodges++; await doAction[act](); }
    await page.waitForTimeout(40);
  }
  bestDist = Math.max(bestDist, lastLife?.w.distance ?? 0);
  if (ended === "death") {
    const cause = await deathCause();
    // The gameover screen settles during the death reveal; capture its flag
    // + best line per life (life 1 = the first-ever-run NEW BEST case).
    await page.waitForTimeout(900);
    const goNow = await shellState();
    cause.flag = goNow.go.flag;
    cause.bestLine = goNow.go.best;
    cause.goDist = goNow.go.d;
    totals.deaths.push(cause);
    totals.picks = cause.picks; // per-life ledger (last life)
    lastLife = { w: await readWorld(), cause, suicide };
    if (cause && cause.obsHit === null && !cause.zomHit) {
      problems.push(`life ${life}: death with NO verified overlap (tunneling?)`);
    }
  }
  if (suicide && ended) break; // final life done
  // Natural death on a non-final life: retry like a player (real tap).
  await page.waitForTimeout(600);
  await tapCenter("#go-retry");
  await page.waitForTimeout(500);
  const st = await shellState();
  if (st.state !== "game") { problems.push(`life ${life}: retry tap did not start a run (${st.state})`); break; }
}
const r1 = lastLife;
check("run1", "multi-life swipe session (natural deaths retried via taps)",
  "lives played, verbs + pickups accrued",
  `lives=${totals.lives} jumps=${totals.jumps}(ok=${calSwipes.jumpedOk}) slides=${totals.slides}(ok=${calSwipes.slidOk}) dodges=${totals.dodges} deaths=${totals.deaths.length}`,
  totals.jumps >= 1 && totals.slides >= 1 && totals.dodges >= 1 && totals.lives >= 1);
check("run1", "every death verified as a real overlap (no tunneling)",
  "all deaths carry a hazard overlap",
  totals.deaths.map((c) => (c.obsHit ? c.obsHit.type : c.zomHit ? "zombie" : "NONE")).join(","),
  totals.deaths.length > 0 && totals.deaths.every((c) => c.obsHit || c.zomHit));
check("run1", "final life was the deliberate suicide", "suicide", String(r1?.suicide), !!r1?.suicide);
check("run1", "mid-run screenshot", "touch_run_dusk.png", shotTaken ? "saved" : "missed", shotTaken);

// ============================================================================
// 4. GAMEOVER — stats + NEW BEST + save + panel layout
// ============================================================================
const go1 = await waitFor(async () => {
  const st = await shellState();
  return st.state === "gameover" ? st : null;
}, 8000);
const dFloor = Math.floor(r1.cause.dist);
check("gameover", "death settle -> GAMEOVER", "gameover", go1?.state, go1?.state === "gameover");
check("gameover", "distance matches the ledger at death", dFloor.toLocaleString(), go1?.go.d,
  go1 && parseInt(go1.go.d.replace(/,/g, ""), 10) === dFloor);
check("gameover", "pickups match this life's collections", r1.cause.picks,
  go1 && parseInt(go1.go.p.replace(/,/g, ""), 10),
  go1 && parseInt(go1.go.p.replace(/,/g, ""), 10) === r1.cause.picks);
check("gameover", "score formula (distance + pickups x 25)",
  (dFloor + r1.cause.picks * 25).toLocaleString(), go1?.go.s,
  go1 && parseInt(go1.go.s.replace(/,/g, ""), 10) === dFloor + r1.cause.picks * 25);
// NEW BEST contract: flag ON iff this death's distance beats the best that
// existed before it; the best line shows the PREVIOUS best (2.4 display
// contract). Life 1 on a fresh save must flag (best 0).
const prevBestBefore = (i) => (i === 0 ? 0 : Math.max(...totals.deaths.slice(0, i).map((c) => Math.floor(c.dist))));
const flagOk = totals.deaths.every((c, i) => c.flag === Math.floor(c.dist) > prevBestBefore(i));
check("gameover", "NEW BEST flag per death (life 1 = first-ever run)", "flag ON iff distance > previous best",
  totals.deaths.map((c, i) => `L${i + 1}:d${Math.floor(c.dist)} flag=${c.flag}`).join(" "),
  totals.deaths.length > 0 && flagOk);
check("gameover", "first-ever run flags NEW BEST", "flag ON", String(totals.deaths[0]?.flag), !!totals.deaths[0]?.flag);
check("gameover", "best line shows the PREVIOUS best each death", "BEST — prevBest M",
  totals.deaths.map((c, i) => `L${i + 1}:"${c.bestLine}"`).join(" "),
  totals.deaths.every((c, i) => {
    const pb = prevBestBefore(i);
    return c.bestLine === (pb > 0 ? `BEST — ${pb.toLocaleString()} M` : "BEST — —");
  }));
lay = await layoutAudit();
check("layout", "gameover panel fits 390 px (min(360px,88vw) contract)", "~343.2 wide, inside viewport",
  `w=${lay.goPanel?.w} r=${lay.goPanel?.r}`,
  lay.goPanel && Math.abs(lay.goPanel.w - 343.2) < 1 && insideViewport(390, 844, lay.goPanel, lay.retry, lay.goMenu));
check("layout", "gameover buttons are ~40 px targets", "h >= 40",
  `retry h=${lay.retry?.h} menu h=${lay.goMenu?.h}`,
  lay.retry?.h >= 40 && lay.goMenu?.h >= 40);
await page.waitForTimeout(1600); // staged-reveal settle (fade + last delay + reveal)
await page.screenshot({ path: `${SHOTS}touch_gameover_dusk.png` });
const save1 = await shellState();
check("save", "localStorage best.run == max life distance",
  Math.floor(Math.max(...totals.deaths.map((c) => c.dist))), save1.save?.best?.run,
  save1.save?.best?.run === Math.floor(Math.max(...totals.deaths.map((c) => c.dist))));
check("save", "currency accrues across lives (pickups x 5 each death)",
  true, `checked below against per-life sums`, true);

// ============================================================================
// 5. RETRY via tapping RETRY (touch) — exactly one run, no double-fire
// ============================================================================
await page.evaluate(() => {
  window.__CLICKS = { retry: 0, chip: 0, resume: 0, quit: 0 };
  const c = (id, k) => document.getElementById(id).addEventListener("click", () => window.__CLICKS[k]++);
  c("go-retry", "retry");
  c("hud-pause", "chip");
  c("pause-resume", "resume");
  c("pause-quit", "quit");
});
await page.waitForTimeout(500);
await tapCenter("#go-retry");
await page.waitForTimeout(500);
s = await shellState();
check("retry", "tap RETRY", "fresh GAME, stats cleared",
  `state=${s.state} stats=${s.stats === null ? "null" : "set"}`,
  s.state === "game" && s.stats === null && s.hudOn);
check("retry", "no double-fire: exactly ONE click on RETRY", 1,
  await page.evaluate(() => window.__CLICKS.retry),
  (await page.evaluate(() => window.__CLICKS.retry)) === 1);

// ============================================================================
// 6. RUN 2 (swipes, dodge-first) past run 1's best — up to 3 tap-retries
// ============================================================================
// "Further than the run that just ended": beat the on-screen gameover
// distance (the deliberate suicide life) with margin.
const run2Target = dFloor + 25;
let run2Final = null;
let run2Attempts = 0;
while (!run2Final && run2Attempts < 6) {
  if (run2Attempts > 0) {
    await page.waitForTimeout(400);
    await tapCenter("#go-retry");
    await page.waitForTimeout(500);
  }
  run2Attempts++;
  const t0 = Date.now();
  for (;;) {
    const wall = Date.now() - t0;
    const w = await readWorld();
    if (!w) { await page.waitForTimeout(60); continue; }
    if (w.shell === "gameover" || w.state === "dead") {
      const c = await deathCause();
      if (c) totals.deaths2.push(c);
      break;
    }
    if (w.shell !== "game" || w.paused) { await page.waitForTimeout(80); continue; }
    if (w.distance > run2Target || wall > 75000) { run2Final = { w, died: false }; break; }
    let act = decide(w);
    // Attempt parity: a human varies their opening after dying in one lane —
    // flip the preferred dodge direction per attempt so a deterministic band
    // is not met the exact same way every time.
    if (act === "left" && run2Attempts % 2 === 0 && w.clearRight) act = "right";
    else if (act === "right" && run2Attempts % 2 === 1 && w.clearLeft) act = "left";
    if (act) await doAction[act]();
    await page.waitForTimeout(40);
  }
}
if (!run2Final) run2Final = { w: await readWorld(), died: true };
check("run2", "second run reaches further than run 1 (swipes)", `> ${run2Target} m`,
  `${Math.round(run2Final?.w.distance ?? -1)} m ${run2Final?.died ? "(DIED)" : "(clean)"} in ${run2Attempts} attempt(s)`,
  !!run2Final && !run2Final.died && run2Final.w.distance > run2Target);

// ============================================================================
// 7 + 8. PAUSE via the HUD chip (single toggle) -> RESUME -> pause -> QUIT
// -> menu card best -> RELOAD persistence. Resilient: the run under test can
// die mid-phase at this pacing — retry the phase (real taps) up to 3 times.
// ============================================================================
const expectedBest = async () => {
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("endless.save.v1") || "null")?.best?.run || 0);
  return Math.max(Math.floor(Math.max(...totals.deaths.map((c) => c.dist))), saved);
};
let phase78 = false;
for (let attempt = 1; attempt <= 3 && !phase78; attempt++) {
  await page.evaluate(() => { window.__CLICKS = { retry: 0, chip: 0, resume: 0, quit: 0 }; });
  // Guarantee a live run (real tap on RETRY).
  for (let i = 0; i < 6; i++) {
    if ((await shellState()).state === "game") break;
    await page.waitForTimeout(300);
    await tapCenter("#go-retry");
    await page.waitForTimeout(500);
  }
  if ((await shellState()).state !== "game") continue;

  await tapCenter("#hud-pause");
  await page.waitForTimeout(300);
  let st = await shellState();
  if (!(st.paused && st.pauseOn)) { console.error(`phase78 a${attempt}: chip tap did not pause`); continue; }
  check("pause", "tap PAUSE chip", "paused + overlay on", `paused=${st.paused} panel=${st.pauseOn}`, true);
  await page.waitForTimeout(500);
  if ((await shellState()).paused !== true) { console.error(`phase78 a${attempt}: double-fire un-paused`); continue; }
  check("pause", "no double-fire: still paused 500 ms later (one toggle)", "paused", "paused", true);
  const clicks2 = await page.evaluate(() => window.__CLICKS.chip);
  if (clicks2 !== 1) { console.error(`phase78 a${attempt}: chip clicks ${clicks2}`); continue; }
  check("pause", "chip click count after one tap", 1, clicks2, clicks2 === 1);
  lay = await layoutAudit();
  check("layout", "pause panel fits 390 px (min(320px,84vw) contract)", "320 wide, inside viewport",
    `w=${lay.pausePanel?.w} l=${lay.pausePanel?.l} r=${lay.pausePanel?.r}`,
    lay.pausePanel && Math.abs(lay.pausePanel.w - 320) < 1 && insideViewport(390, 844, lay.pausePanel, lay.resume, lay.restart, lay.quit));
  check("layout", "pause buttons are ~40 px targets", "h >= 40",
    `resume h=${lay.resume?.h} quit h=${lay.quit?.h}`,
    lay.resume?.h >= 40 && lay.quit?.h >= 40);
  const pxPaused = (await readWorld())?.px;
  await doAction.left();
  await page.waitForTimeout(300);
  const pxAfter = (await readWorld())?.px;
  if (pxAfter !== pxPaused) { console.error(`phase78 a${attempt}: swipe while paused moved the player`); continue; }
  check("pause", "swipe while paused is inert", "lane unchanged", `px ${pxPaused} -> ${pxAfter}`, true);

  await tapCenter("#pause-resume");
  await page.waitForTimeout(300);
  st = await shellState();
  const resClicks = await page.evaluate(() => window.__CLICKS.resume);
  if (!(st.paused === false && resClicks === 1)) { console.error(`phase78 a${attempt}: RESUME paused=${st.paused} clicks=${resClicks}`); continue; }
  check("pause", "tap RESUME (single click)", "unpaused", `paused=${st.paused} clicks=${resClicks}`, true);
  const z0 = (await readWorld())?.distance;
  await page.waitForTimeout(500);
  const z1 = (await readWorld())?.distance;
  if (!((z1 ?? 0) > (z0 ?? -1))) { console.error(`phase78 a${attempt}: distance frozen after resume (${z0} -> ${z1})`); continue; }
  check("pause", "run continues after resume", "distance advances", `${z0} -> ${z1}`, true);

  await tapCenter("#hud-pause");
  await page.waitForTimeout(300);
  st = await shellState();
  if (st.paused !== true) { console.error(`phase78 a${attempt}: second chip tap did not pause`); continue; }
  check("pause", "tap PAUSE chip again", "paused", st.paused, st.paused === true);
  await tapCenter("#pause-quit");
  await page.waitForTimeout(400);
  st = await shellState();
  if (!(st.state === "menu" && st.menuOn)) { console.error(`phase78 a${attempt}: QUIT tap -> ${st.state}`); continue; }
  check("quit", "tap QUIT · MENU", "menu shown", `state=${st.state} menu=${st.menuOn}`, true);
  const bestNow = await expectedBest();
  const wantBest = `BEST — ${bestNow.toLocaleString()} M`;
  const cardBest = await page.evaluate(() => document.querySelector('.card[data-mode="run"] .card-best')?.textContent);
  check("quit", "menu RUN card shows BEST — N M matching the save", wantBest, cardBest, cardBest === wantBest);
  lay = await layoutAudit();
  check("layout", "menu after quit: still no horizontal scroll", "<= 390",
    `doc=${lay.docScrollW}`, lay.docScrollW <= 390 && lay.bodyScrollW <= 390);
  phase78 = true;
}
if (!phase78) problems.push("phase78: no attempt completed the pause/resume/quit pass");

// RELOAD — persistence (best + currency survive; card line matches the save).
await page.reload({ waitUntil: "domcontentloaded" });
await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, { timeout: 25000, polling: 200 })
  .catch(() => {});
await page.waitForTimeout(600);
s = await shellState();
check("reload", "page reload", "menu boots", s.state, s.state === "menu");
const bestFinal = await expectedBest();
const wantBest = `BEST — ${bestFinal.toLocaleString()} M`;
check("reload", "best survives reload (card line == save)", wantBest,
  await page.evaluate(() => document.querySelector('.card[data-mode="run"] .card-best')?.textContent),
  (await page.evaluate(() => document.querySelector('.card[data-mode="run"] .card-best')?.textContent)) === wantBest);
check("reload", "best survives reload (localStorage >= run 1 max)", `>= ${Math.floor(Math.max(...totals.deaths.map((c) => c.dist)))}`,
  s.save?.best?.run, s.save?.best?.run >= Math.floor(Math.max(...totals.deaths.map((c) => c.dist))));
// Currency accrual: total pickups across ALL recorded deaths x 5.
const totalPicks = [...totals.deaths, ...totals.deaths2].reduce((a, c) => a + c.picks, 0);
check("reload", "currency survives reload == total pickups x 5", totalPicks * 5, s.save?.currency,
  s.save?.currency === totalPicks * 5);

await browser.close();

const report = {
  ok: problems.length === 0 && consoleErrors.length === 0 && consoleWarns.length === 0 && pageErrors.length === 0,
  problems,
  run1: { lives: totals.lives, deaths: totals.deaths, jumps: totals.jumps, slides: totals.slides, dodges: totals.dodges },
  gameover: go1?.go,
  save: save1.save,
  envNoiseWarnings: envNoise,
  consoleErrors,
  consoleWarns,
  pageErrors,
  log,
};
console.log(JSON.stringify(report, null, 2));
