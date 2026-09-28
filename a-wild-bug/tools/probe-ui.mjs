#!/usr/bin/env node
/**
 * Flow-assertion harness for "A Wild Bug" (UI/UX pass).
 *
 * Usage:
 *   node tools/probe-ui.mjs [--url URL] [--only <section>] [--shots]
 *
 * Each section loads a FRESH page (fixed ?seed=), drives the game through
 * `window.__wbGame` (the debug Game handle) and asserts one behavior line of
 * the mode machine / sim gating / DOM shell. Sections are named so a failing
 * one can be re-run in isolation:
 *
 *   boot-held          title boots with sun + hopper held; start advances time
 *   input-gate         WASD/Space do nothing while paused; move while playing
 *   day-elapsed        loop.dayElapsed tracks the fixed-step clock (vs windTime)
 *   grace              resume enters a frozen countdown; second resume skips it
 *   restart-quit       restart resets the day (quota/grains/hopper); quit holds title
 *   visibility         hiding the page auto-pauses; resume after it is graced
 *   shell-a11y         #shell stacks above the canvases, tab order, 44px targets, safe areas
 *   title-flow         title holds the sim; DOM START begins a fresh day (HUD + state)
 *   pause-results      pause menu routing; forced win/lose stats + one-activation controls
 *   howto-return       how-to from title and pause restores exactly (frozen sun/day)
 *   touch-joystick     emulated phone: stick tilt walks then sprints along camera yaw
 *   touch-action       ACTION follows PICK→THROW through a real pickup/throw; JUMP jumps
 *   touch-camera       scene drag orbits without moving the ant; pinch zooms in wheel steps
 *   touch-pause        on-screen pause tap → menu; drag never pauses; Esc/P keyboard pause
 *   keyboard-regression fine-pointer desktop: every legacy key's observable effect holds
 *   hints-scheme       key copy on a fine boot / touch copy on a coarse boot, never mixed
 *   hints-prompt       staged pickup prompt: keycap + controls line on desktop, PICK chip on phone
 *   hints-correction   a touch pointerdown on a fine boot corrects the next hint screen (and back)
 *   teach-persist      wb.taught written only at day start; reload → second day hint-free
 *   teach-first-day    fresh save: each hint fires once near its moment, dismisses; restart inert
 *   teach-scheme       teach pill copy follows the scheme (key wording / touch wording) at both viewports
 *   teach-howto        how-to goal + scheme listing on both viewports; viewing consumes nothing
 *   hud-compact        phone-portrait compact layout: floored text, pairwise-clear boxes; desktop classic untouched
 *   hud-safearea       viewport-fit=cover + env() rules; stubbed insets keep every HUD box in the safe rect
 *   hud-reduced        reduced motion flattens pulses while the threat cue tracks; pinned captures unaffected
 *   touch-scene        shot("touch") resolves dom:true with settled widgets, byte-stable
 *   shell-capture      pinned page captures of shell states are byte-identical pairs
 *   harness-scenes     shot() shell scenes: dom flag, settled .pinned, HUD per scene,
 *                      unpin restore; run-after-title byte-identical to baseline
 *   audio-boot         no AudioContext before a gesture; START builds a live graph
 *   audio-sfx          every gameplay/UI event schedules exactly its patch; step cost ≤ bounds
 *   audio-music        generative bed spans title→day continuously (30 s wall run)
 *   audio-toggles      title MUSIC/SFX persist + apply on boot; in-run mute is session-only
 *   audio-isolation    pinned run capture byte-identical with audio enabled/disabled/unsupported
 *   regression-captures pinned world captures stay byte-identical to shots/baseline
 *   spec-walk         task 9.4 acceptance gate: every scenario in the five delta
 *                     specs (game-flow / input-schemes / onboarding /
 *                     hud-presentation / audio), PASS/FAIL + evidence per id
 *
 * Touch sections (touch: true) run in an emulated phone context (390×844,
 * hasTouch + isMobile ⇒ `(pointer: coarse)`), driving gestures through CDP
 * Input.dispatchTouchEvent so the page sees real trusted touch pointers.
 *
 * `--shots` skips the assertions and instead captures eyes-on PNGs of every
 * shell state (title/howto/paused/results-win/results-lose) at 1600x900 and
 * 390x844 into shots/b2-shell/.
 *
 * The script starts nothing itself: point --url at a running dev server
 * (default http://127.0.0.1:41189/). Exits non-zero if any section fails.
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function argValues(flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[++i]);
  return out;
}

const url = argValue("--url", "http://127.0.0.1:41189/");
const only = argValue("--only", null);
const doShots = args.includes("--shots");
const SEED = "1337";
const STEP = 1 / 60;

/** SwiftShader flags shared by the section runner and --shots captures. */
const BROWSER_ARGS = [
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--no-sandbox",
];

/**
 * A fresh page per section: clean mode machine, fixed seed, zero leakage.
 * By default the page boots with `wb.taught` pre-seeded (tasks 7.1/7.2): the
 * pre-existing sections start days with fresh storage, and without the seed
 * the first-day teaching hints would fire mid-assertion and (worse) drift
 * those sections' pixel/beat baselines. Teaching sections pass {taught:false}
 * for a genuinely fresh save.
 */
async function freshPage(browser, { taught = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  if (taught) await seedTaught(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });
  return { page, errors };
}

/**
 * Pre-seeds `wb.taught` before any page script runs (every navigation, so a
 * reload keeps it). Only ever applied to pages that must behave like an
 * already-taught player; teach-* sections skip this to test the fresh path.
 */
async function seedTaught(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("wb.taught", '{"day":true}');
    } catch {}
  });
}

const waitFrames = (page, n) =>
  page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= frames ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

const g = (page, fn, arg) => page.evaluate(fn, arg);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// --- emulated phone context (touch sections) ---------------------------------

/**
 * A fresh emulated phone page: coarse pointer, touch events, 390×844. Touch
 * gestures are synthesized through a CDP session so the page receives trusted
 * touch pointers (derived PointerEvents included) — exactly what a real
 * device delivers.
 */
async function freshTouchPage(browser, { taught = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  if (taught) await seedTaught(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });
  const cdp = await context.newCDPSession(page);
  return { page, context, errors, cdp };
}

/** A tap: one touch point down and up at (x, y). */
async function cdpTap(cdp, x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A one-finger drag in `steps` moves from (x0, y0) to (x1, y1). */
async function cdpDrag(cdp, x0, y0, x1, y1, steps = 8) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A two-finger pinch (or spread when r1 > r0) centered at (cx, cy). */
async function cdpPinch(cdp, cx, cy, r0, r1, steps = 10) {
  const at = (r, a) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [at(r0, 0), at(r0, Math.PI)],
  });
  for (let i = 1; i <= steps; i++) {
    const r = r0 + ((r1 - r0) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [at(r, 0), at(r, Math.PI)],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * A fresh emulated-phone page spawned INSIDE a section (dual-context
 * sections assert key and touch copy side by side). Same emulation as
 * freshTouchPage, minus the CDP session — DOM interactions go through
 * element.click() in evaluate so no pointer events move the scheme latch.
 */
async function spawnCoarsePage(browser, { taught = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  if (taught) await seedTaught(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });
  return { page, context, errors };
}

// --- shared evaluation helpers ------------------------------------------------

/**
 * A fresh page at an explicit viewport (hud-compact's desktop leg, the
 * hud-safearea orientation pages). `touch` adds the coarse-pointer emulation
 * used by the phone contexts.
 */
async function openViewport(browser, width, height, touch = false, { taught = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  if (taught) await seedTaught(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });
  return { page, context, errors };
}

/**
 * HUD debug snapshot: layout meta (compact/scales/safe insets), element
 * bounding boxes (hud.hudBoxes, CSS px) and — when the widget layer is up —
 * the DOM touch-widget rects.
 */
const hudSnapshot = (page) =>
  g(page, () => {
    const w = window.__wbGame;
    const bx = w.hud.hudBoxes;
    const boxes = {};
    for (const k of ["plaque", "dayTrack", "toast", "prompt", "controls", "banner", "threat", "teach"]) {
      boxes[k] = bx[k] ? { ...bx[k] } : null;
    }
    const widgets = {};
    if (!document.getElementById("touch").hidden) {
      for (const [k, r] of Object.entries(w.touchControls.debugRects())) widgets[k] = { ...r };
    }
    return {
      viewport: { ...bx.viewport },
      safe: { ...bx.safe },
      compact: bx.compact,
      s: bx.s,
      sEff: bx.sEff,
      fonts: { ...bx.fonts },
      boxes,
      widgets,
    };
  });

const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Pairwise non-intersection over the readable HUD boxes + visible widgets.
 * The threat cue is recorded but it is an ambient edge glow that intentionally
 * washes over whatever is near the screen edge — excluded unless asked for.
 */
function assertNoOverlap(label, snap, { includeThreat = false } = {}) {
  const items = [];
  for (const [k, b] of Object.entries(snap.boxes)) {
    if (b && (includeThreat || k !== "threat")) items.push([k, b]);
  }
  for (const [k, r] of Object.entries(snap.widgets)) items.push([`widget:${k}`, r]);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      assert(
        !rectsOverlap(items[i][1], items[j][1]),
        `${label}: ${items[i][0]} overlaps ${items[j][0]} (${JSON.stringify(items[i][1])} vs ${JSON.stringify(items[j][1])})`,
      );
    }
  }
  return items.length;
}

/** Every box (and widget) fully inside the viewport. */
function assertInsideViewport(label, snap) {
  const all = [
    ...Object.entries(snap.boxes),
    ...Object.entries(snap.widgets).map(([k, v]) => [`widget:${k}`, v]),
  ];
  for (const [k, b] of all) {
    if (!b) continue;
    assert(
      b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= snap.viewport.w + 0.5 && b.y + b.h <= snap.viewport.h + 0.5,
      `${label}: ${k} box ${JSON.stringify(b)} escapes the ${snap.viewport.w}x${snap.viewport.h} viewport`,
    );
  }
}

/** Stages a mid-day beat with toast + pickup prompt + parked hopper. */
const stageHudBeat = (page) =>
  g(page, () => {
    const w = window.__wbGame;
    w.startDayFromTitle();
    w.hopper.stageDefault();
    w.loop.stage({ toast: "Grain stored!" });
    const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
    w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
  });

/** Controller pose snapshot (planar position + grounded state). */
const pose = (page) =>
  g(page, () => {
    const c = window.__wbGame.controller;
    return { x: c.position.x, y: c.position.y, z: c.position.z, grounded: c.grounded };
  });

/** Camera-to-ant distance (the observable stand-in for the private arm length). */
const camDist = (page) =>
  g(page, () => window.__wbGame.followCam.camera.position.distanceTo(window.__wbGame.controller.position));

/** Center + size of a touch widget by element id. */
const widgetCenter = (page, id) =>
  g(page, (sel) => {
    const r = document.getElementById(sel).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, id);

/** Max planarSpeed over a short sampling window (accel settles between beats). */
async function sampleMaxSpeed(page, samples) {
  let max = 0;
  for (let i = 0; i < samples; i++) {
    const s = await g(page, () => window.__wbGame.controller.planarSpeed);
    if (s > max) max = s;
    await waitFrames(page, 3);
  }
  return max;
}

/**
 * Slope-aware target speed for an intent pushing along camera forward — the
 * controller's own formula (PLAYER_TUNING walk/run rates × slope clamp).
 */
const targetSpeed = (page, sprint) =>
  g(page, (sprint) => {
    const w = window.__wbGame;
    const yaw = w.followCam.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const slope = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
    w.meadow.slopeAt(w.controller.position.x, w.controller.position.z, slope);
    const along = fx * slope.x + fz * slope.y;
    const f = Math.min(1.3, Math.max(0.55, 1 - along * 0.55));
    return (sprint ? 3.4 : 1.55) * f;
  }, sprint);

/** Opaque-pixel count in the quota-plaque region of the HUD canvas. */
const hudPlaquePixels = (page) =>
  g(page, () => {
    const c = document.getElementById("ui");
    const ctx = c.getContext("2d");
    const img = ctx.getImageData(0, 0, Math.round(c.width * 0.16), Math.round(c.height * 0.12));
    let n = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 40) n++;
    return n;
  });

/**
 * Opaque-pixel count in the controls-line corner of the HUD canvas
 * (bottom-left). The prompt strip and quota plaque sit outside it, the
 * joystick is DOM (not canvas), and dawn urgency keeps the vignette off —
 * so at dawn this is >0 exactly when the persistent controls line drew.
 */
const hudControlsPixels = (page) =>
  g(page, () => {
    const c = document.getElementById("ui");
    const ctx = c.getContext("2d");
    const img = ctx.getImageData(
      0,
      Math.round(c.height * 0.9),
      Math.round(c.width * 0.22),
      Math.round(c.height * 0.1),
    );
    let n = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 40) n++;
    return n;
  });

// --- shell state driving (shell-capture section + --shots) -------------------

const SHELL_STATES = ["title", "howto", "paused", "results-win", "results-lose"];

/** A clean reload: the state machine resets, the shell lands on the title. */
async function reloadFresh(page) {
  await page.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });
}

/** Drives the game into one shell state (reload first: states are independent). */
async function driveShellState(page, name) {
  await reloadFresh(page);
  switch (name) {
    case "title":
      break;
    case "howto":
      // DOM click in evaluate: no pointer events, so the scheme latch is
      // untouched (a real mouse tap on the emulated phone would flip it).
      await g(page, () => document.getElementById("btn-howto-title").click());
      break;
    case "paused":
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 24);
      await g(page, () => window.__wbGame.pause());
      break;
    case "results-win":
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 12);
      await g(page, () => {
        const w = window.__wbGame;
        w.loop.stage({ phase: "win", phaseT: 1.2, deposited: 6, dayElapsed: 95 });
        w.mode = "results";
      });
      break;
    case "results-lose":
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 12);
      await g(page, () => {
        const w = window.__wbGame;
        w.loop.stage({ phase: "lose", phaseT: 2.4, deposited: 3, dayElapsed: 360, duskDim: 1 });
        w.mode = "results";
      });
      break;
    default:
      throw new Error(`unknown shell state "${name}"`);
  }
  await waitFrames(page, 4);
}

/**
 * Pins the game (capture kill-switch) and takes TWO consecutive full-page
 * screenshots — they must be byte-identical. Also asserts the shell applied
 * its `.pinned` class and that transitions collapsed to 0s. SwiftShader can
 * race a frame present (torn/black bands), so the pair is retried a few times
 * before failing. Saves the stable pair when `savePath` is given.
 */
async function pinAndPair(page, name, savePath) {
  await g(page, () => {
    window.__wbGame.pinned = true;
  });
  await waitFrames(page, 8); // .pinned class flip + renderer settle
  const checks = await g(page, () => {
    const shell = document.getElementById("shell");
    const on = document.querySelector("#shell .screen.on");
    return {
      pinnedClass: shell.classList.contains("pinned"),
      transition: on ? getComputedStyle(on).transitionDuration : null,
    };
  });
  assert(checks.pinnedClass, `${name}: #shell root is missing the .pinned class`);
  if (checks.transition !== null) {
    assert(checks.transition === "0s", `${name}: pinned transition-duration is ${checks.transition}, expected 0s`);
  }
  let stable = null;
  for (let attempt = 0; attempt < 3 && !stable; attempt++) {
    const a = await page.screenshot();
    const b = await page.screenshot();
    if (a.equals(b)) stable = a;
  }
  await g(page, () => {
    window.__wbGame.pinned = false;
  });
  assert(stable, `${name}: pinned page screenshots never settled byte-identical`);
  if (savePath) writeFileSync(savePath, stable);
  return stable;
}

/** --shots: eyes-on captures of every shell state at two viewports. */
async function captureShellShots() {
  const outDir = path.join(root, "shots", "b2-shell");
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch(BROWSER_ARGS);
  for (const vp of [
    { w: 1600, h: 900 },
    // Coarse emulation so the phone shots show the touch hint copy.
    { w: 390, h: 844, touch: true },
  ]) {
    const page = await browser.newPage({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: !!vp.touch,
      isMobile: !!vp.touch,
    });
    // Shell captures start days (paused/results states): keep teaching inert.
    await seedTaught(page);
    for (const name of SHELL_STATES) {
      await driveShellState(page, name);
      await pinAndPair(page, name, path.join(outDir, `${name}-${vp.w}x${vp.h}.png`));
      console.log(`shot ${name} @${vp.w}x${vp.h} -> ${outDir}`);
    }
    await page.close();
  }
  await browser.close();
}

const sections = [
  {
    name: "boot-held",
    run: async (page) => {
      const held0 = await g(page, () => {
        const w = window.__wbGame;
        return {
          mode: w.mode,
          t: w.dayCycle.getTime(),
          elapsed: w.loop.dayElapsed,
          wind: w.windTime,
          hop: [w.hopper.position.x, w.hopper.position.z],
        };
      });
      assert(held0.mode === "title", `boot mode is ${held0.mode}, expected "title"`);
      assert(held0.elapsed === 0, `dayElapsed is ${held0.elapsed} on title, expected 0`);

      await waitFrames(page, 60); // ~1s of frames
      const held1 = await g(page, () => {
        const w = window.__wbGame;
        return {
          t: w.dayCycle.getTime(),
          elapsed: w.loop.dayElapsed,
          wind: w.windTime,
          hop: [w.hopper.position.x, w.hopper.position.z],
        };
      });
      assert(held1.t === held0.t, `sun moved on title: ${held0.t} -> ${held1.t}`);
      assert(held1.elapsed === 0, `dayElapsed advanced on title: ${held1.elapsed}`);
      assert(held1.wind === held0.wind, `windTime advanced on title: ${held0.wind} -> ${held1.wind}`);
      assert(
        held1.hop[0] === held0.hop[0] && held1.hop[1] === held0.hop[1],
        `hopper moved on title: ${held0.hop} -> ${held1.hop}`,
      );

      await g(page, () => window.__wbGame.startDayFromTitle());
      const live = await g(page, () => window.__wbGame.mode);
      assert(live === "playing", `mode after start is ${live}, expected "playing"`);
      await waitFrames(page, 30);
      const live1 = await g(page, () => {
        const w = window.__wbGame;
        return { t: w.dayCycle.getTime(), elapsed: w.loop.dayElapsed };
      });
      assert(live1.t > held0.t, `sun did not advance after start (${held0.t} -> ${live1.t})`);
      assert(live1.elapsed > 0, `dayElapsed did not advance after start (${live1.elapsed})`);
      return `title holds sun ${held0.t} + hopper; start advances (t=${live1.t.toFixed(4)}, ${live1.elapsed.toFixed(2)}s)`;
    },
  },

  {
    name: "input-gate",
    run: async (page) => {
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 15);
      await g(page, () => window.__wbGame.pause());

      const pose = () =>
        g(page, () => {
          const c = window.__wbGame.controller;
          return { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.yaw };
        });
      const p0 = await pose();

      // WASD + Space while paused: the fixed-step gate must neutralize them.
      await page.keyboard.down("KeyW");
      await waitFrames(page, 10);
      await page.keyboard.down("Space");
      await waitFrames(page, 5);
      await page.keyboard.up("Space");
      await page.keyboard.up("KeyW");
      const p1 = await pose();
      assert(
        p1.x === p0.x && p1.y === p0.y && p1.z === p0.z && p1.yaw === p0.yaw,
        `ant moved while paused: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`,
      );

      // Back to live play (second resume skips the grace countdown).
      await g(page, () => {
        window.__wbGame.resume();
        window.__wbGame.resume();
      });
      const mode = await g(page, () => window.__wbGame.mode);
      assert(mode === "playing", `mode after resume-skip is ${mode}, expected "playing"`);
      await page.keyboard.down("KeyW");
      await waitFrames(page, 20);
      await page.keyboard.up("KeyW");
      const p2 = await pose();
      const moved = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      assert(moved > 0.05, `ant did not move while playing (d=${moved.toFixed(4)})`);
      return `paused WASD/Space inert (exact hold); live W moved ant ${moved.toFixed(3)}u`;
    },
  },

  {
    name: "day-elapsed",
    run: async (page) => {
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 10);
      // Seam: while playing, windTime += frameDt is summed on exactly the same
      // frames as the accumulator, so ΔwindTime is the exact sim-time window —
      // dayElapsed must match it within one fixed step regardless of frame rate.
      const s0 = await g(page, () => {
        const w = window.__wbGame;
        return { w: w.windTime, e: w.loop.dayElapsed };
      });
      await waitFrames(page, 90); // ~1.5s of frames
      const s1 = await g(page, () => {
        const w = window.__wbGame;
        return { w: w.windTime, e: w.loop.dayElapsed };
      });
      const dW = s1.w - s0.w;
      const dE = s1.e - s0.e;
      assert(dW > 0.5, `sim time barely advanced (Δwind=${dW.toFixed(4)})`);
      assert(
        Math.abs(dE - dW) <= STEP + 1e-9,
        `dayElapsed Δ${dE.toFixed(5)} off sim-time Δ${dW.toFixed(5)} by more than one step`,
      );
      return `ΔdayElapsed ${dE.toFixed(4)}s == ΔwindTime ${dW.toFixed(4)}s within one step`;
    },
  },

  {
    name: "grace",
    run: async (page) => {
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 10);
      await g(page, () => window.__wbGame.pause());
      const e0 = await g(page, () => window.__wbGame.loop.dayElapsed);

      // Resume enters the grace; the shell's per-frame sync shows the skip
      // chip. sync() is invoked here explicitly so the chip check burns zero
      // frames — slow SwiftShader frames would eat the 1.2s countdown.
      const s0 = await g(page, () => {
        const w = window.__wbGame;
        w.resume();
        w.shell.sync();
        const el = document.getElementById("grace-chip");
        return {
          m: w.mode,
          gr: w.graceRemaining,
          e: w.loop.dayElapsed,
          num: document.getElementById("grace-num").textContent,
          sized: el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44,
          hidden: el.hidden,
        };
      });
      assert(s0.m === "paused", `mode in grace is ${s0.m}, expected "paused"`);
      assert(s0.gr > 0, `no grace countdown after resume (${s0.gr})`);
      assert(s0.e === e0, `dayElapsed moved on resume: ${e0} -> ${s0.e}`);

      // The shell shows the non-blocking skip chip while the counter runs.
      assert(!s0.hidden, "grace chip not shown during the countdown");
      assert(
        s0.num === String(Math.ceil(s0.gr)),
        `chip shows ${s0.num}, expected ${Math.ceil(s0.gr)}`,
      );
      assert(s0.sized, "grace chip is not a ≥44px skip control");
      // It must not block the view: the world canvas still owns hits below it.
      const chipNonBlock = await g(page, () => {
        const el = document.elementFromPoint(innerWidth / 2, innerHeight * 0.8);
        return el === document.querySelector("canvas:not(#ui)");
      });
      assert(chipNonBlock, "grace chip layer blocks the world (elementFromPoint below the chip)");

      // The chip itself is the skip control: activating it mid-count (still
      // inside the grace, zero frames burned) resumes live play immediately.
      await page.click("#grace-chip");
      const skip = await g(page, () => {
        const w = window.__wbGame;
        return { m: w.mode, gr: w.graceRemaining };
      });
      assert(skip.m === "playing", `chip skip left mode ${skip.m}, expected "playing"`);
      assert(skip.gr === 0, `grace counter after chip skip is ${skip.gr}, expected 0`);
      await waitFrames(page, 3);
      const e1 = await g(page, () => window.__wbGame.loop.dayElapsed);
      assert(e1 > e0, `dayElapsed did not advance after chip skip (${e0} -> ${e1})`);

      // Re-enter the grace for the countdown mechanics: the first frames must
      // make no sim progress while the counter runs on the fixed-step clock.
      await g(page, () => {
        window.__wbGame.pause();
        window.__wbGame.resume();
      });
      let prev = await g(page, () => window.__wbGame.graceRemaining);
      assert(prev > 0, `no grace on re-entry (${prev})`);
      for (let i = 0; i < 3; i++) {
        await waitFrames(page, 1);
        const s = await g(page, () => {
          const w = window.__wbGame;
          return { m: w.mode, gr: w.graceRemaining, e: w.loop.dayElapsed };
        });
        assert(s.m === "paused", `grace expired early (frame ${i + 1}), mode ${s.m}`);
        assert(s.e === e1, `dayElapsed advanced during grace: ${e1} -> ${s.e}`);
        assert(s.gr > 0 && s.gr < prev, `grace counter not counting down: ${prev} -> ${s.gr}`);
        prev = s.gr;
      }

      // Second resume activation mid-count: live play immediately.
      await g(page, () => window.__wbGame.resume());
      const s1 = await g(page, () => {
        const w = window.__wbGame;
        return { m: w.mode, gr: w.graceRemaining };
      });
      assert(s1.m === "playing", `mode after skip is ${s1.m}, expected "playing"`);
      assert(s1.gr === 0, `grace counter after skip is ${s1.gr}, expected 0`);
      await waitFrames(page, 3);
      const e2 = await g(page, () => window.__wbGame.loop.dayElapsed);
      assert(e2 > e1, `dayElapsed did not advance after skip (${e1} -> ${e2})`);
      return `chip visible @${Math.ceil(s0.gr)} + skip routes resume; grace frozen ${e0.toFixed(3)}s, counter ${prev.toFixed(2)}, live after skip (${e2.toFixed(3)}s)`;
    },
  },

  {
    name: "restart-quit",
    run: async (page) => {
      const base = await g(page, () => {
        const w = window.__wbGame;
        return {
          idle: w.meadow.grains.idleCount,
          hx: w.hopper.position.x,
          hz: w.hopper.position.z,
          hs: w.hopper.state,
          t: w.dayCycle.getTime(),
        };
      });

      await g(page, () => window.__wbGame.startDayFromTitle());
      // Run until the hopper has provably left its day-start perch (first
      // patrol hop lands within 9 day-seconds) so "reset" is falsifiable.
      let moved = false;
      for (let i = 0; i < 40 && !moved; i++) {
        await waitFrames(page, 30);
        moved = await g(
          page,
          (b) => {
            const h = window.__wbGame.hopper;
            return Math.hypot(h.position.x - b.hx, h.position.z - b.hz) > 0.01 || h.state !== b.hs;
          },
          base,
        );
      }
      assert(moved, "hopper never left its start perch (no reset signal to test)");

      // One evaluate per beat: no sim frames can interleave inside it.
      const staged = await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x, node.pos.z, 0);
        w.loop.tryPickup();
        // Settle the 0.26s collect beat in place (no sim frames needed).
        w.carried.update(0.3, w.loop.buildCarryCtx());
        const picked = { idle: w.meadow.grains.idleCount, carried: w.carried.mode };
        w.pause();
        w.loop.stage({ deposited: 3, dayElapsed: 60 });
        return picked;
      });
      assert(staged.carried === "held", `pickup failed (carried=${staged.carried})`);
      assert(staged.idle === base.idle - 1, `idle grains ${base.idle} -> ${staged.idle}, expected -1`);
      const mid = await g(page, () => {
        const w = window.__wbGame;
        return { dep: w.loop.deposited, e: w.loop.dayElapsed, m: w.mode };
      });
      assert(mid.m === "paused" && mid.dep === 3, `staging broken: dep=${mid.dep} mode=${mid.m}`);

      await g(page, () => window.__wbGame.restartDay());
      const post = await g(page, () => {
        const w = window.__wbGame;
        return {
          m: w.mode,
          dep: w.loop.deposited,
          e: w.loop.dayElapsed,
          idle: w.meadow.grains.idleCount,
          hx: w.hopper.position.x,
          hz: w.hopper.position.z,
          hs: w.hopper.state,
          t: w.dayCycle.getTime(),
          cx: w.controller.position.x,
          cz: w.controller.position.z,
        };
      });
      assert(post.m === "playing", `mode after restart is ${post.m}, expected "playing"`);
      assert(post.dep === 0, `quota after restart is ${post.dep}, expected 0`);
      assert(post.e === 0, `dayElapsed after restart is ${post.e}, expected 0`);
      assert(post.idle === base.idle, `grains not respawned: idle ${post.idle}, expected ${base.idle}`);
      assert(post.hs === base.hs, `hopper state ${post.hs}, expected ${base.hs}`);
      assert(
        Math.hypot(post.hx - base.hx, post.hz - base.hz) < 1e-6,
        `hopper not reset to perch: (${post.hx.toFixed(3)}, ${post.hz.toFixed(3)}) vs (${base.hx.toFixed(3)}, ${base.hz.toFixed(3)})`,
      );
      assert(Math.abs(post.t - base.t) < 1e-9, `sun not back at dawn: ${post.t} vs ${base.t}`);
      assert(
        Math.hypot(post.cx - 0, post.cz - 2.4) < 1e-6,
        `ant not at spawn: (${post.cx.toFixed(3)}, ${post.cz.toFixed(3)})`,
      );

      // Quit lives on the pause menu, so take the same path: pause, then quit.
      await g(page, () => {
        window.__wbGame.pause();
        window.__wbGame.quitToTitle();
      });
      const q0 = await g(page, () => {
        const w = window.__wbGame;
        return { m: w.mode, t: w.dayCycle.getTime(), wind: w.windTime };
      });
      assert(q0.m === "title", `mode after quit is ${q0.m}, expected "title"`);
      await waitFrames(page, 40);
      const q1 = await g(page, () => {
        const w = window.__wbGame;
        return { t: w.dayCycle.getTime(), wind: w.windTime };
      });
      assert(q1.t === q0.t, `sun advanced on title after quit: ${q0.t} -> ${q1.t}`);
      assert(q1.wind === q0.wind, `wind advanced on title after quit`);

      await g(page, () => window.__wbGame.startDayFromTitle());
      const fresh = await g(page, () => window.__wbGame.mode);
      assert(fresh === "playing", `mode after fresh start is ${fresh}, expected "playing"`);
      await waitFrames(page, 5);
      const fresh1 = await g(page, () => {
        const w = window.__wbGame;
        return { wind: w.windTime, e: w.loop.dayElapsed };
      });
      assert(fresh1.wind > q0.wind || fresh1.e > 0, "fresh day is not running after title start");
      return `restart: dep 3→0, dayElapsed 60→0, grains ${base.idle}, hopper reset; quit holds title; fresh day runs`;
    },
  },

  {
    name: "visibility",
    run: async (page) => {
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 10);
      const e0 = await g(page, () => window.__wbGame.loop.dayElapsed);

      // Stub document.hidden (read by the listener at event time), then fire.
      await g(page, () => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const v0 = await g(page, () => {
        const w = window.__wbGame;
        return { m: w.mode, e: w.loop.dayElapsed };
      });
      assert(v0.m === "paused", `mode after hide is ${v0.m}, expected "paused"`);
      assert(v0.e === e0, `dayElapsed advanced across hide: ${e0} -> ${v0.e}`);

      // Un-hiding must not resume by itself; resume is graced.
      await g(page, () => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const v1 = await g(page, () => window.__wbGame.mode);
      assert(v1 === "paused", `mode after unhide is ${v1}, expected "paused"`);

      await g(page, () => window.__wbGame.resume());
      const gr = await g(page, () => {
        const w = window.__wbGame;
        return { m: w.mode, gr: w.graceRemaining };
      });
      assert(gr.m === "paused" && gr.gr > 0, `no grace after visibility resume: ${JSON.stringify(gr)}`);
      await g(page, () => window.__wbGame.resume());
      const live = await g(page, () => window.__wbGame.mode);
      assert(live === "playing", `mode after skip is ${live}, expected "playing"`);
      return `hide → paused (day frozen at ${e0.toFixed(3)}s); unhide stays paused; resume graced`;
    },
  },

  {
    name: "shell-a11y",
    run: async (page) => {
      // #shell exists and stacks above both canvases (z-order + pointer target).
      const stack = await g(page, () => {
        const shell = document.getElementById("shell");
        const ui = document.getElementById("ui");
        const webgl = document.querySelector("canvas:not(#ui)");
        return {
          exists: !!shell,
          z: shell ? getComputedStyle(shell).zIndex : null,
          uiPointerEvents: ui ? getComputedStyle(ui).pointerEvents : null,
          hasWebgl: !!webgl,
        };
      });
      assert(stack.exists, "#shell element missing");
      assert(stack.hasWebgl, "WebGL canvas missing");
      assert(stack.uiPointerEvents === "none", "#ui canvas must keep pointer-events: none");
      assert(
        stack.z !== null && stack.z !== "auto" && Number(stack.z) > 0,
        `#shell z-index is ${stack.z}, expected a layer above both canvases`,
      );

      // With a screen active, a control's center resolves inside the shell.
      const hit = await g(page, () => {
        const btn = document.getElementById("btn-start");
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { inside: !!(el && el.closest("#shell")), tag: el ? el.id || el.tagName : "none" };
      });
      assert(hit.inside, `elementFromPoint at the START button hit ${hit.tag}, expected a #shell element`);

      // Safe-area padding: env() can't be computed on a desktop viewport, so
      // assert the rule exists in the shell stylesheet text.
      const safeArea = await g(page, () => {
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (rule.cssText && rule.cssText.includes("safe-area-inset")) return true;
          }
        }
        return false;
      });
      assert(safeArea, "no env(safe-area-inset-*) rule found in the shell stylesheet");

      // Tab walk reaches every visible title control, in DOM order, and the
      // keyboard focus ring (focus-visible outline) is present.
      const expected = await g(page, () =>
        [...document.querySelectorAll("#screen-title button")].map((b) => b.id),
      );
      await g(page, () => {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      const walked = [];
      for (let i = 0; i < expected.length; i++) {
        await page.keyboard.press("Tab");
        walked.push(await g(page, () => (document.activeElement ? document.activeElement.id : "(none)")));
      }
      assert(
        JSON.stringify(walked) === JSON.stringify(expected),
        `tab walk reached [${walked}], expected [${expected}]`,
      );
      const outline = await g(page, () => {
        const s = getComputedStyle(document.activeElement);
        return { style: s.outlineStyle, width: s.outlineWidth };
      });
      assert(
        outline.style === "solid" && parseFloat(outline.width) >= 3,
        `focus-visible outline missing (${outline.style} ${outline.width})`,
      );

      const buttonSizes = (sel) =>
        g(page, (s) =>
          [...document.querySelectorAll(`${s}.on button`)].map((b) => {
            const r = b.getBoundingClientRect();
            return { id: b.id, w: r.width, h: r.height };
          }),
        );
      const checkSizes = (label, btns) => {
        for (const b of btns) {
          assert(b.w >= 44 && b.h >= 44, `${label}: ${b.id} is ${Math.round(b.w)}x${Math.round(b.h)}, needs ≥44x44`);
        }
      };
      checkSizes("title", await buttonSizes("#screen-title"));

      // Pause screen: 4 controls, all keyboard targets ≥44px, tab-reachable.
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 8);
      await g(page, () => window.__wbGame.pause());
      await waitFrames(page, 4);
      const pauseIds = await g(page, () =>
        [...document.querySelectorAll("#screen-pause.on button")].map((b) => b.id),
      );
      assert(pauseIds.length === 4, `pause menu shows ${pauseIds.length} buttons, expected 4`);
      checkSizes("pause", await buttonSizes("#screen-pause"));

      // Audio toggles (audio batch): the pressed state mirrors the REAL bus
      // state — fresh storage defaults to both buses on, so a fresh boot reads
      // pressed; a click flips both the state and aria-pressed (write-through).
      const pressed = await g(page, () => {
        const m = document.getElementById("tgl-music");
        const s = document.getElementById("tgl-sfx");
        const audio = window.__wbGame.audio;
        const before = [m.getAttribute("aria-pressed"), s.getAttribute("aria-pressed")];
        const state = [String(audio.musicEnabled), String(audio.sfxEnabled)];
        m.click();
        s.click();
        const after = [m.getAttribute("aria-pressed"), s.getAttribute("aria-pressed")];
        // Restore the boot choices so the section leaves no storage residue.
        audio.setMusic(true);
        audio.setSfx(true);
        return { before, state, after };
      });
      assert(
        JSON.stringify(pressed.before) === JSON.stringify(pressed.state),
        `audio toggles boot state ${JSON.stringify(pressed.before)} does not mirror the persisted choices ${JSON.stringify(pressed.state)}`,
      );
      assert(pressed.before.every((v) => v === "true"), "fresh boot should have both audio buses on");
      assert(pressed.after.every((v) => v === "false"), "toggle click must flip aria-pressed (and the bus)");

      // Zero interaction overlap: with NO screen active, the viewport center
      // resolves to the WebGL canvas — the shell never blocks drag/wheel.
      await g(page, () => {
        window.__wbGame.resume();
        window.__wbGame.resume();
      });
      await waitFrames(page, 4);
      const center = await g(page, () => {
        const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        const webgl = document.querySelector("canvas:not(#ui)");
        return { tag: el ? el.id || el.tagName : "none", isWebgl: el === webgl };
      });
      assert(center.isWebgl, `viewport center with no screen active hit ${center.tag}, expected the WebGL canvas`);
      return `shell above canvases; tab walk + focus ring ok; title/pause buttons ≥44px; aria-pressed toggles; center hit ${center.tag} while playing`;
    },
  },

  {
    name: "title-flow",
    run: async (page) => {
      const t0 = await g(page, () => {
        const w = window.__wbGame;
        return {
          mode: w.mode,
          on: document.getElementById("screen-title").classList.contains("on"),
          t: w.dayCycle.getTime(),
        };
      });
      assert(t0.mode === "title" && t0.on, "fresh boot did not land on the title screen");
      const hud0 = await hudPlaquePixels(page);

      await waitFrames(page, 60); // ~1s on title
      const t1 = await g(page, () => {
        const w = window.__wbGame;
        return {
          t: w.dayCycle.getTime(),
          on: document.getElementById("screen-title").classList.contains("on"),
        };
      });
      assert(t1.on, "title screen disappeared on its own");
      assert(t1.t === t0.t, `sun advanced while on title: ${t0.t} -> ${t1.t}`);

      // The DOM START control begins a fresh day at dawn.
      await page.click("#btn-start");
      await waitFrames(page, 10);
      const s1 = await g(page, () => {
        const w = window.__wbGame;
        return {
          mode: w.mode,
          on: document.getElementById("screen-title").classList.contains("on"),
          t: w.dayCycle.getTime(),
          elapsed: w.loop.dayElapsed,
          dep: w.loop.deposited,
        };
      });
      assert(s1.mode === "playing", `mode after START is ${s1.mode}, expected "playing"`);
      assert(!s1.on, "title screen still visible after START");
      assert(s1.t > t0.t, `sun did not advance after START (${t0.t} -> ${s1.t})`);
      assert(s1.elapsed > 0, `day timer not running after START (${s1.elapsed})`);
      assert(s1.dep === 0, `fresh day did not start at zero quota (${s1.dep})`);

      // Quota HUD active, proven BOTH ways: pixels in the plaque region and
      // game state (mode playing + dayElapsed advancing).
      const hud1 = await hudPlaquePixels(page);
      assert(hud0 <= 10, `HUD canvas not cleared while on title (${hud0} opaque px in plaque region)`);
      assert(hud1 > 400, `quota plaque not drawn after START (${hud1} opaque px in plaque region)`);
      return `title holds the sim; START → fresh dawn day (elapsed ${s1.elapsed.toFixed(2)}s; plaque px ${hud0}→${hud1})`;
    },
  },

  {
    name: "pause-results",
    run: async (page) => {
      await page.click("#btn-start");
      await waitFrames(page, 15);
      await g(page, () => window.__wbGame.pause());
      await waitFrames(page, 4);
      const pauseIds = await g(page, () =>
        [...document.querySelectorAll("#screen-pause.on button")].map((b) => b.id).sort(),
      );
      assert(
        JSON.stringify(pauseIds) === JSON.stringify(["btn-howto-pause", "btn-quit", "btn-restart", "btn-resume"]),
        `pause menu buttons are [${pauseIds}]`,
      );

      // RESTART DAY routes to a fresh day in ONE activation.
      await g(page, () => window.__wbGame.loop.stage({ deposited: 2, dayElapsed: 40 }));
      await page.click("#btn-restart");
      await waitFrames(page, 2);
      const fresh = await g(page, () => {
        const w = window.__wbGame;
        return { mode: w.mode, dep: w.loop.deposited, e: w.loop.dayElapsed };
      });
      assert(fresh.mode === "playing", `RESTART DAY left mode ${fresh.mode}, expected "playing"`);
      assert(fresh.dep === 0 && fresh.e < 0.5, `RESTART DAY not fresh: dep=${fresh.dep} elapsed=${fresh.e}`);

      // QUIT TO TITLE → title; start again.
      await g(page, () => window.__wbGame.pause());
      await page.click("#btn-quit");
      await waitFrames(page, 2);
      const quit = await g(page, () => ({
        mode: window.__wbGame.mode,
        on: document.getElementById("screen-title").classList.contains("on"),
      }));
      assert(quit.mode === "title" && quit.on, "QUIT TO TITLE did not restore the title screen");
      await page.click("#btn-start");
      await waitFrames(page, 8);

      // Force a win: results-win shows 6/6, the elapsed clock, both controls,
      // and the Day-2 tease.
      await g(page, () => {
        const w = window.__wbGame;
        w.loop.stage({ phase: "win", phaseT: 1.2, deposited: 6, dayElapsed: 95 });
        w.mode = "results";
      });
      await waitFrames(page, 4);
      const win = await g(page, () => ({
        on: document.getElementById("screen-win").classList.contains("on"),
        loseOn: document.getElementById("screen-lose").classList.contains("on"),
        head: document.getElementById("win-heading").textContent,
        grains: document.getElementById("win-grains").textContent,
        time: document.getElementById("win-time").textContent,
        tease: document.querySelector("#screen-win .tease").textContent,
        again: !!document.getElementById("btn-again-win"),
        title: !!document.getElementById("btn-title-win"),
      }));
      assert(win.on && !win.loseOn, "forced win did not show the results-win screen");
      assert(win.head === "Quota met!", `win heading is "${win.head}"`);
      assert(win.grains === "6 / 6", `win grains stat is "${win.grains}", expected "6 / 6"`);
      assert(win.time === "1:35", `win time stat is "${win.time}", expected "1:35"`);
      assert(win.tease.includes("Day 2"), `win tease missing: "${win.tease}"`);
      assert(win.again && win.title, "win screen is missing FORAGE AGAIN / TITLE controls");

      // FORAGE AGAIN → fresh day in one activation.
      await page.click("#btn-again-win");
      await waitFrames(page, 2);
      const again = await g(page, () => {
        const w = window.__wbGame;
        return { mode: w.mode, dep: w.loop.deposited, e: w.loop.dayElapsed };
      });
      assert(
        again.mode === "playing" && again.dep === 0 && again.e < 0.5,
        `FORAGE AGAIN not a fresh day: ${JSON.stringify(again)}`,
      );

      // Force a lose: the dusky results-lose with the shortfall, clearly a
      // different presentation (own screen, own heading).
      await g(page, () => {
        const w = window.__wbGame;
        w.loop.stage({ phase: "lose", phaseT: 2.4, deposited: 3, dayElapsed: 360, duskDim: 1 });
        w.mode = "results";
      });
      await waitFrames(page, 4);
      const lose = await g(page, () => ({
        on: document.getElementById("screen-lose").classList.contains("on"),
        winOn: document.getElementById("screen-win").classList.contains("on"),
        head: document.getElementById("lose-heading").textContent,
        grains: document.getElementById("lose-grains").textContent,
        time: document.getElementById("lose-time").textContent,
        cls: document.getElementById("screen-lose").className,
      }));
      assert(lose.on && !lose.winOn, "forced lose did not show the results-lose screen");
      assert(lose.head === "Hopper's shadow falls…", `lose heading is "${lose.head}"`);
      assert(lose.grains === "3 / 6", `lose grains stat is "${lose.grains}", expected "3 / 6"`);
      assert(lose.time === "6:00", `lose time stat is "${lose.time}", expected "6:00"`);
      assert(!lose.cls.includes("s-win") && lose.cls.includes("s-lose"), "lose shares the win presentation");
      assert(lose.head !== win.head, "win and lose headings are identical");

      // TITLE → title.
      await page.click("#btn-title-lose");
      await waitFrames(page, 2);
      const home = await g(page, () => ({
        mode: window.__wbGame.mode,
        on: document.getElementById("screen-title").classList.contains("on"),
      }));
      assert(home.mode === "title" && home.on, "TITLE did not return to the title screen");
      return "pause menu 4 buttons; restart/quit/again/title one-activation; win 6/6 @1:35 + Day-2 tease; lose 3/6 @6:00, distinct";
    },
  },

  {
    name: "howto-return",
    run: async (page) => {
      // --- from title: no day may start behind the how-to ---
      const t0 = await g(page, () => {
        const w = window.__wbGame;
        return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, mode: w.mode };
      });
      await page.click("#btn-howto-title");
      await waitFrames(page, 4);
      const open = await g(page, () => ({
        howto: document.getElementById("screen-howto").classList.contains("on"),
        title: document.getElementById("screen-title").classList.contains("on"),
        goal: document.querySelector("#screen-howto .goal").textContent,
        keys: document.querySelectorAll("#howto-controls .key").length,
      }));
      assert(open.howto && !open.title, "how-to did not open over the title");
      assert(/six grains/i.test(open.goal) && /grasshopper/i.test(open.goal), "day-goal copy missing");
      assert(open.keys >= 8, `control listing has only ${open.keys} entries`);
      await waitFrames(page, 20); // linger: the world must stay held
      const t1 = await g(page, () => window.__wbGame.dayCycle.getTime());
      assert(t1 === t0.t, `sun moved while how-to open over title: ${t0.t} -> ${t1}`);

      await page.click("#btn-howto-back");
      await waitFrames(page, 4);
      const back = await g(page, () => {
        const w = window.__wbGame;
        return {
          mode: w.mode,
          title: document.getElementById("screen-title").classList.contains("on"),
          howto: document.getElementById("screen-howto").classList.contains("on"),
          t: w.dayCycle.getTime(),
          e: w.loop.dayElapsed,
        };
      });
      assert(back.mode === "title" && back.title && !back.howto, "BACK did not restore the title");
      assert(back.t === t0.t && back.e === 0, `title how-to leaked day progress: t ${t0.t}->${back.t}, e=${back.e}`);

      // Esc closes too.
      await page.click("#btn-howto-title");
      await waitFrames(page, 2);
      await page.keyboard.press("Escape");
      await waitFrames(page, 2);
      const esc = await g(page, () => document.getElementById("screen-title").classList.contains("on"));
      assert(esc, "Esc did not close the how-to back to the title");

      // --- from pause: the frozen day must survive the round trip ---
      await page.click("#btn-start");
      await waitFrames(page, 30);
      await g(page, () => window.__wbGame.pause());
      const p0 = await g(page, () => {
        const w = window.__wbGame;
        return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, wind: w.windTime };
      });
      await page.click("#btn-howto-pause");
      await waitFrames(page, 4);
      const pOpen = await g(page, () => ({
        howto: document.getElementById("screen-howto").classList.contains("on"),
        pause: document.getElementById("screen-pause").classList.contains("on"),
      }));
      assert(pOpen.howto && !pOpen.pause, "how-to did not open over pause");
      await waitFrames(page, 20); // linger frozen
      await page.click("#btn-howto-back");
      await waitFrames(page, 4);
      const p1 = await g(page, () => {
        const w = window.__wbGame;
        return {
          mode: w.mode,
          pause: document.getElementById("screen-pause").classList.contains("on"),
          howto: document.getElementById("screen-howto").classList.contains("on"),
          t: w.dayCycle.getTime(),
          e: w.loop.dayElapsed,
          wind: w.windTime,
        };
      });
      assert(p1.mode === "paused" && p1.pause && !p1.howto, "how-to round trip did not restore pause");
      assert(p1.t === p0.t, `sun moved during pause how-to: ${p0.t} -> ${p1.t}`);
      assert(p1.e === p0.e, `day advanced during pause how-to: ${p0.e} -> ${p1.e}`);
      assert(p1.wind === p0.wind, "windTime moved during pause how-to");
      return "how-to opens from title + pause; BACK/Esc restore exactly (frozen sun + day, no day started from title)";
    },
  },

  {
    name: "touch-joystick",
    touch: true,
    run: async (page, cdp) => {
      // The emulated viewport must read as coarse so the layer self-reveals.
      assert(
        await g(page, () => matchMedia("(pointer: coarse)").matches),
        "emulated phone viewport does not match (pointer: coarse)",
      );
      assert(
        await g(page, () => document.getElementById("touch").hidden),
        "touch widgets visible on the title",
      );
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        // Park the hopper far out of play: a stun knockback mid-hold would
        // corrupt the speed/direction samples this section asserts on.
        window.__wbGame.hopper.stageDefault();
      });
      await waitFrames(page, 6);
      const w = await widgetCenter(page, "tc-stick");
      const pause = await widgetCenter(page, "tc-pause");
      assert(pause.w >= 44 && pause.h >= 44, `pause control is ${pause.w}x${pause.h}, needs ≥44x44`);

      // Partial tilt: 20% of the rect height ≈ 0.41 deflection → dead-zone
      // remap (0.41 − 0.12) / 0.88 = 0.332 forward intent. Walk, no sprint.
      const EXACT_INTENT = 0.332;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: w.x, y: w.y }] });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: w.x, y: w.y - w.h * 0.2 }],
      });
      await waitFrames(page, 5);
      const intent = await g(page, () => {
        const i = window.__wbGame.input;
        return { x: i.move.x, y: i.move.y, sprint: i.sprint };
      });
      assert(
        Math.abs(intent.y - EXACT_INTENT) < 0.015 && Math.abs(intent.x) < 0.015,
        `partial tilt intent (${intent.x.toFixed(3)}, ${intent.y.toFixed(3)}), expected ≈ (0, ${EXACT_INTENT})`,
      );
      assert(!intent.sprint, "partial tilt set sprint");
      await waitFrames(page, 30);
      const walk = await sampleMaxSpeed(page, 5);
      const walkTarget = await targetSpeed(page, false);
      const sprintTarget = await targetSpeed(page, true);
      assert(
        walk > 0.18 && walk < walkTarget + 0.45,
        `partial tilt speed ${walk.toFixed(3)} outside the walk band (target ${walkTarget.toFixed(2)})`,
      );

      // Just under the sprint threshold: still walking.
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: w.x, y: w.y - 52 }],
      });
      await waitFrames(page, 30);
      const mid = await sampleMaxSpeed(page, 4);
      assert(
        mid < sprintTarget - 0.7 && !(await g(page, () => window.__wbGame.input.sprint)),
        `0.79 deflection speed ${mid.toFixed(2)} reads as sprint (target ${sprintTarget.toFixed(2)})`,
      );

      // Full tilt: sprint, moving along the camera's forward.
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: w.x, y: w.y - w.h * 0.55 }],
      });
      await waitFrames(page, 40);
      const sprint = await sampleMaxSpeed(page, 5);
      assert(
        sprint > sprintTarget - 0.6 && sprint < sprintTarget + 0.35,
        `full tilt speed ${sprint.toFixed(3)} outside the sprint band (target ${sprintTarget.toFixed(2)})`,
      );
      assert(await g(page, () => window.__wbGame.input.sprint), "full tilt did not set sprint");
      const p0 = await pose(page);
      const yawAt = await g(page, () => window.__wbGame.followCam.yaw);
      await waitFrames(page, 12);
      const p1 = await pose(page);
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const dot = (dx * Math.sin(yawAt) + dz * Math.cos(yawAt)) / Math.max(1e-6, Math.hypot(dx, dz));
      assert(dot > 0.85, `stick-up movement direction off camera forward (dot ${dot.toFixed(3)})`);

      // Release: intent zeroed, sprint off, nub back to center.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await waitFrames(page, 40);
      const rest = await g(page, () => {
        const w2 = window.__wbGame;
        return {
          moveLen: w2.input.move.length(),
          sprint: w2.input.sprint,
          speed: w2.controller.planarSpeed,
          nub: document.getElementById("tc-nub").style.transform,
        };
      });
      assert(rest.moveLen === 0 && !rest.sprint, "release did not zero the move intent");
      assert(rest.speed < 0.35, `ant still moving ${rest.speed.toFixed(3)} after release`);
      assert(rest.nub === "", `nub did not return to center ("${rest.nub}")`);
      return `coarse viewport; stick 0.41→intent 0.332 walks (${walk.toFixed(2)}u/s), 0.79 no sprint, full sprints (${sprint.toFixed(2)}u/s, dot ${dot.toFixed(2)}); release zeroes`;
    },
  },

  {
    name: "touch-action",
    touch: true,
    run: async (page, cdp) => {
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        // Park the hopper: it snatches carried grain, which would race the
        // PICK→THROW beats this section steps through.
        window.__wbGame.hopper.stageDefault();
      });
      await waitFrames(page, 6);
      const idle0 = await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
        return w.meadow.grains.idleCount;
      });
      await waitFrames(page, 3);
      const act = await widgetCenter(page, "tc-act");
      const label0 = await g(page, () => ({
        text: document.getElementById("tc-act-label").textContent,
        ready: document.getElementById("tc-act").classList.contains("ready"),
      }));
      assert(
        label0.text === "PICK" && label0.ready,
        `ACTION in reach reads "${label0.text}" (ready ${label0.ready}), expected PICK`,
      );

      // Press PICK: the ant ends up carrying the node grain.
      await cdpTap(cdp, act.x, act.y);
      await waitFrames(page, 40);
      const held = await g(page, () => ({
        mode: window.__wbGame.carried.mode,
        idle: window.__wbGame.meadow.grains.idleCount,
        text: document.getElementById("tc-act-label").textContent,
      }));
      assert(held.mode === "held", `carrying after the PICK press is ${held.mode}, expected "held"`);
      assert(held.idle === idle0 - 1, `idle grains ${idle0} → ${held.idle}, expected −1`);
      assert(held.text === "THROW", `ACTION while carrying reads "${held.text}", expected THROW`);

      // Press THROW: the grain flies, then settles as a loose seed. One frame
      // of wait is enough for the queue to fire (a frame runs up to 0.25s of
      // sim) and far short of the ≥0.5s flight — the read cannot miss it.
      await cdpTap(cdp, act.x, act.y);
      await waitFrames(page, 1);
      const flight = await g(page, () => window.__wbGame.carried.mode);
      assert(flight === "flight", `carried mode after the THROW press is ${flight}, expected "flight"`);
      await waitFrames(page, 200);
      const settled = await g(page, () => ({
        mode: window.__wbGame.carried.mode,
        loose: window.__wbGame.meadow.grains.looseCount,
        text: document.getElementById("tc-act-label").textContent,
      }));
      assert(settled.mode === "hidden", `carried after the throw settles is ${settled.mode}, expected "hidden"`);
      assert(settled.loose === 1, `loose seeds after the throw: ${settled.loose}, expected 1`);

      // Inert state: stand somewhere provably free of pickables (another
      // tutorial-ring grain may legitimately sit near the thrown one).
      const clear = await g(page, () => {
        const w = window.__wbGame;
        for (const [x, z] of [[0, 2.4], [0, 0.5], [-2.5, 0.5], [2.5, 0.5], [0, -2.2]]) {
          w.controller.teleport(x, z, 0);
          if (!w.meadow.grains.pickableAt(w.controller.position, 0.55)) return { x, z };
        }
        return null;
      });
      assert(clear, "no grain-free spot found for the inert ACTION check");
      await waitFrames(page, 3);
      const inert = await g(page, () => ({
        text: document.getElementById("tc-act-label").textContent,
        ready: document.getElementById("tc-act").classList.contains("ready"),
      }));
      assert(
        inert.text === "ACT" && !inert.ready,
        `ACTION out of reach reads "${inert.text}" (ready ${inert.ready}), expected the inert ACT state`,
      );

      // JUMP presses jump like Space: hold it (touchStart without end, mirroring
      // a thumb) so the full-height airtime is observable, then land.
      const jump = await widgetCenter(page, "tc-jump");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: jump.x, y: jump.y }] });
      let airborne = false;
      for (let i = 0; i < 14 && !airborne; i++) {
        await waitFrames(page, 1);
        airborne = await g(page, () => {
          const c = window.__wbGame.controller;
          return !c.grounded || c.position.y - c.groundY > 0.02;
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert(airborne, "JUMP press never left the ground");
      await waitFrames(page, 70);
      assert(await g(page, () => window.__wbGame.controller.grounded), "ant did not land after JUMP");
      return `PICK→carried (idle ${idle0 - 1}), label THROW→grain flies→1 loose seed, inert ACT; JUMP jumps + lands`;
    },
  },

  {
    name: "touch-camera",
    touch: true,
    run: async (page, cdp) => {
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        // Park the hopper: a stun knockback would move the "frozen" ant.
        window.__wbGame.hopper.stageDefault();
      });
      await waitFrames(page, 8);

      // One-finger scene drag orbits; the ant's intent stays zero.
      const yaw0 = await g(page, () => window.__wbGame.followCam.yaw);
      const pos0 = await pose(page);
      await cdpDrag(cdp, 195, 300, 315, 300, 8);
      await waitFrames(page, 4);
      const d = await g(page, () => {
        const w = window.__wbGame;
        return { yaw: w.followCam.yaw, moveLen: w.input.move.length(), dragging: w.input.dragging };
      });
      assert(Math.abs(d.yaw - yaw0) > 0.3, `scene drag changed yaw by ${(d.yaw - yaw0).toFixed(3)}, expected a real orbit`);
      assert(d.moveLen === 0, "scene drag wrote a move intent");
      assert(!d.dragging, "dragging flag stuck after the scene drag");
      const pos1 = await pose(page);
      assert(
        Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) < 0.05,
        "the ant moved during a pure camera drag",
      );

      // Pinch out: zoom in by wheel steps (4 steps × 0.55, clamped at minDist).
      const dist0 = await camDist(page);
      await cdpPinch(cdp, 195, 420, 60, 150, 10);
      await waitFrames(page, 60);
      const dist1 = await camDist(page);
      const zoom = dist0 - dist1;
      assert(zoom > 0.8 && zoom < 1.6, `pinch-out zoomed the camera by ${zoom.toFixed(3)}, expected ≈1.2 (wheel steps)`);

      // A quick scene tap must NOT queue a confirm: stage a win right after —
      // a stale confirm would restart instead of showing the results screen.
      await cdpTap(cdp, 195, 300);
      await g(page, () => {
        const w = window.__wbGame;
        w.loop.stage({ phase: "win", phaseT: 1.2, deposited: 6, dayElapsed: 95 });
        w.mode = "results";
      });
      await waitFrames(page, 8);
      const win = await g(page, () => document.getElementById("screen-win").classList.contains("on"));
      assert(win, "a stale confirm from a scene tap skipped the results screen");
      return `drag orbits (Δyaw ${(d.yaw - yaw0).toFixed(2)}, ant frozen, intent 0); pinch zoom ${zoom.toFixed(2)} (wheel-step band); tap never confirms`;
    },
  },

  {
    name: "touch-pause",
    touch: true,
    run: async (page, cdp) => {
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        window.__wbGame.hopper.stageDefault(); // no thief racing this section
      });
      await waitFrames(page, 8);
      const p = await widgetCenter(page, "tc-pause");
      await cdpTap(cdp, p.x, p.y);
      await waitFrames(page, 4);
      const s1 = await g(page, () => ({
        mode: window.__wbGame.mode,
        menu: document.getElementById("screen-pause").classList.contains("on"),
        widgetsHidden: document.getElementById("touch").hidden,
      }));
      assert(s1.mode === "paused" && s1.menu, `pause tap left mode ${s1.mode} (menu on: ${s1.menu})`);
      assert(s1.widgetsHidden, "touch widgets stayed visible while paused");

      // Resume through the menu (grace), skip it, then drag the scene: live
      // play must steer the camera WITHOUT pausing.
      await page.tap("#btn-resume");
      const gr = await g(page, () => ({ mode: window.__wbGame.mode, grace: window.__wbGame.graceRemaining }));
      assert(gr.mode === "paused" && gr.grace > 0, "menu resume did not enter the grace");
      await g(page, () => window.__wbGame.resume());
      await waitFrames(page, 4);
      const yaw0 = await g(page, () => window.__wbGame.followCam.yaw);
      await cdpDrag(cdp, 195, 300, 275, 300, 6);
      await waitFrames(page, 4);
      const s2 = await g(page, () => ({ mode: window.__wbGame.mode, yaw: window.__wbGame.followCam.yaw }));
      assert(s2.mode === "playing", `scene drag while playing flipped mode to ${s2.mode}`);
      assert(Math.abs(s2.yaw - yaw0) > 0.2, "scene drag while playing did not orbit");

      // Keyboard pause works on the same emulated page: Escape and KeyP both
      // pause from live play (Input's seam; pause() guards keep it single-shot).
      await g(page, () => {
        window.__wbGame.resume(); // clear any leftover paused state
        window.__wbGame.resume();
      });
      await page.keyboard.press("Escape");
      await waitFrames(page, 3);
      assert(await g(page, () => window.__wbGame.mode === "paused"), "Escape did not pause");
      await g(page, () => {
        window.__wbGame.resume();
        window.__wbGame.resume();
      });
      await page.keyboard.press("KeyP");
      await waitFrames(page, 3);
      assert(await g(page, () => window.__wbGame.mode === "paused"), "KeyP did not pause");
      return "pause tap → paused + menu (widgets hidden); resume grace; live drag steers without pausing; Esc + P both pause";
    },
  },

  {
    name: "keyboard-regression",
    run: async (page) => {
      // The desktop regression gate: every legacy binding's observable effect,
      // on a fine-pointer viewport with the touch layer absent.
      assert(
        await g(page, () => matchMedia("(pointer: fine)").matches),
        "default context is not a fine-pointer viewport",
      );
      assert(
        await g(page, () => document.getElementById("touch").hidden),
        "touch widgets visible on a fine-pointer desktop",
      );
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        window.__wbGame.hopper.stageDefault(); // no stun knockback racing the pose deltas
      });
      await waitFrames(page, 10);

      // W walks +Z (camera yaw 0 at spawn), staying on the lane.
      let p0 = await pose(page);
      await page.keyboard.down("KeyW");
      await waitFrames(page, 30);
      const pW = await pose(page);
      await page.keyboard.up("KeyW");
      await waitFrames(page, 25);
      assert(
        pW.z - p0.z > 0.3 && Math.abs(pW.x - p0.x) < 0.25,
        `W moved (${(pW.x - p0.x).toFixed(3)}, ${(pW.z - p0.z).toFixed(3)}), expected ≈ +Z`,
      );

      // ArrowUp moves like W (camera yaw still 0: the ant ran straight).
      p0 = await pose(page);
      await page.keyboard.down("ArrowUp");
      await waitFrames(page, 20);
      const pA = await pose(page);
      await page.keyboard.up("ArrowUp");
      await waitFrames(page, 20);
      assert(
        pA.z - p0.z > 0.15 && Math.abs(pA.x - p0.x) < 0.25,
        `ArrowUp moved (${(pA.x - p0.x).toFixed(3)}, ${(pA.z - p0.z).toFixed(3)}), expected ≈ +Z`,
      );

      // D strafes screen-right — world −X at spawn yaw 0 (A mirrors); the ant
      // turns into it, so only the x-leg is asserted — world direction after a
      // turn is camera-relative, not fixed.
      p0 = await pose(page);
      await page.keyboard.down("KeyD");
      await waitFrames(page, 25);
      const pD = await pose(page);
      await page.keyboard.up("KeyD");
      await waitFrames(page, 25);
      assert(pD.x - p0.x < -0.2, `D strafe moved dx=${(pD.x - p0.x).toFixed(3)}`);

      // Shift sprints: speed climbs from the walk band to the run band.
      const walkTarget = await targetSpeed(page, false);
      const runTarget = await targetSpeed(page, true);
      await page.keyboard.down("KeyW");
      await waitFrames(page, 40);
      const walkSpeed = await sampleMaxSpeed(page, 5);
      await page.keyboard.down("ShiftLeft");
      await waitFrames(page, 45);
      const runSpeed = await sampleMaxSpeed(page, 5);
      await page.keyboard.up("ShiftLeft");
      await page.keyboard.up("KeyW");
      await waitFrames(page, 25);
      assert(
        Math.abs(walkSpeed - walkTarget) < 0.55,
        `walk speed ${walkSpeed.toFixed(2)} off target ${walkTarget.toFixed(2)}`,
      );
      assert(
        runSpeed > runTarget - 0.6 && runSpeed > walkSpeed + 1.0,
        `sprint speed ${runSpeed.toFixed(2)} off target ${runTarget.toFixed(2)} (walk ${walkSpeed.toFixed(2)})`,
      );

      // Space jumps: hold the key (no jump-cut) so the airtime is observable,
      // then a clean landing.
      await page.keyboard.down("Space");
      let airborne = false;
      for (let i = 0; i < 14 && !airborne; i++) {
        await waitFrames(page, 1);
        airborne = await g(page, () => {
          const c = window.__wbGame.controller;
          return !c.grounded || c.position.y - c.groundY > 0.02;
        });
      }
      await page.keyboard.up("Space");
      assert(airborne, "Space press never left the ground");
      await waitFrames(page, 70);
      assert(await g(page, () => window.__wbGame.controller.grounded), "ant did not land after Space");

      // E picks up near a grain node (carried held, one fewer idle grain).
      const idle0 = await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
        return w.meadow.grains.idleCount;
      });
      await page.keyboard.press("KeyE");
      await waitFrames(page, 40);
      const pick = await g(page, () => ({
        mode: window.__wbGame.carried.mode,
        idle: window.__wbGame.meadow.grains.idleCount,
      }));
      assert(
        pick.mode === "held" && pick.idle === idle0 - 1,
        `E pickup: carried=${pick.mode}, idle ${idle0} → ${pick.idle}`,
      );

      // F throws: flight (read one frame in — see touch-action), then the
      // grain settles as a loose seed.
      await page.keyboard.press("KeyF");
      await waitFrames(page, 1);
      assert(await g(page, () => window.__wbGame.carried.mode) === "flight", "F press did not throw");
      await waitFrames(page, 200);
      const thrown = await g(page, () => ({
        mode: window.__wbGame.carried.mode,
        loose: window.__wbGame.meadow.grains.looseCount,
      }));
      assert(
        thrown.mode === "hidden" && thrown.loose === 1,
        `F throw did not settle to one loose seed: ${JSON.stringify(thrown)}`,
      );

      // Q orbits the camera left (manual yaw rate), E's orbit twin. Left = the
      // view swings toward screen-left = world +X at yaw 0 = yaw INCREASES.
      const yaw0 = await g(page, () => window.__wbGame.followCam.yaw);
      await page.keyboard.down("KeyQ");
      await waitFrames(page, 30);
      await page.keyboard.up("KeyQ");
      const yawQ = await g(page, () => window.__wbGame.followCam.yaw);
      assert(yawQ - yaw0 > 0.4, `Q orbit changed yaw by ${(yawQ - yaw0).toFixed(3)}, expected a left orbit`);

      // Wheel zooms out (one event → one wheel step → +0.55 arm target).
      const dist0 = await camDist(page);
      await page.mouse.wheel(0, 240);
      await waitFrames(page, 45);
      const dist1 = await camDist(page);
      assert(dist1 - dist0 > 0.35, `wheel zoom changed camera distance by ${(dist1 - dist0).toFixed(3)}`);

      // Enter on a staged win restarts the day in one press (confirm routing).
      await g(page, () => {
        const w = window.__wbGame;
        w.loop.stage({ phase: "win", phaseT: 1.2, deposited: 6, dayElapsed: 95 });
        w.mode = "results";
      });
      await waitFrames(page, 6);
      assert(
        await g(page, () => document.getElementById("screen-win").classList.contains("on")),
        "staged win did not show the results screen",
      );
      await page.keyboard.press("Enter");
      await waitFrames(page, 6);
      const after = await g(page, () => ({
        mode: window.__wbGame.mode,
        dep: window.__wbGame.loop.deposited,
      }));
      assert(after.mode === "playing" && after.dep === 0, `Enter on results left ${JSON.stringify(after)}`);
      return `W/D/arrows pose deltas; Shift walk ${walkSpeed.toFixed(2)}→sprint ${runSpeed.toFixed(2)}; Space airtime; E pickup; F throw→1 loose; Q orbit; wheel zoom; Enter confirm restart`;
    },
  },

  {
    name: "hints-scheme",
    run: async (page, _cdp, browser) => {
      // --- fine-pointer boot: key copy, zero touch wording -------------------
      const fine = await g(page, () => {
        const w = window.__wbGame;
        return {
          boot: w.scheme.get(),
          hint: document.querySelector("#screen-title .hint").textContent,
          want: w.hints.titleHint.key,
        };
      });
      assert(fine.boot === "key", `fine-pointer boot latched "${fine.boot}", expected "key"`);
      assert(fine.hint === fine.want, `title hint "${fine.hint}" is not the table's key variant`);
      assert(/Enter/.test(fine.hint), "fine title hint lost its key names");
      assert(!/tap|swipe|stick|pinch/i.test(fine.hint), "fine title hint mixes in touch wording");

      await page.click("#btn-howto-title");
      await waitFrames(page, 4);
      const howFine = await g(page, () => ({
        text: document.getElementById("howto-controls").textContent,
        keys: document.querySelectorAll("#howto-controls .key").length,
        chips: document.querySelectorAll("#howto-controls .key.chip").length,
      }));
      assert(howFine.keys >= 8, `fine how-to listing has ${howFine.keys} rows, expected ≥8`);
      assert(howFine.chips === 0, "fine how-to listing shows touch button chips");
      assert(
        /WASD/.test(howFine.text) && /Shift/.test(howFine.text) && /Space/.test(howFine.text),
        "fine how-to listing lost keyboard rows",
      );
      assert(!/stick|pinch|tap|swipe/i.test(howFine.text), "fine how-to listing mixes in touch wording");
      await page.click("#btn-howto-back");

      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 6);
      await g(page, () => window.__wbGame.pause());
      await waitFrames(page, 4);
      const pauseFine = await g(page, () => ({
        got: document.getElementById("pause-hint").textContent,
        want: window.__wbGame.hints.pauseHint.key,
      }));
      assert(
        pauseFine.got === pauseFine.want && /Esc/.test(pauseFine.got),
        `fine pause hint is "${pauseFine.got}", expected "${pauseFine.want}"`,
      );
      assert(!/tap/i.test(pauseFine.got), "fine pause hint mixes in touch wording");

      const graceFine = await g(page, () => {
        const w = window.__wbGame;
        w.resume();
        w.shell.sync(); // show the chip without burning countdown frames
        return {
          got: document.getElementById("grace-label").textContent,
          want: w.hints.graceChip.key,
        };
      });
      assert(
        graceFine.got === graceFine.want && !/tap/i.test(graceFine.got),
        `fine grace label is "${graceFine.got}", expected "${graceFine.want}"`,
      );
      await g(page, () => window.__wbGame.resume()); // skip the countdown
      await waitFrames(page, 3);
      assert(await g(page, () => window.__wbGame.hud.lastControlsDrawn), "controls line absent on desktop");

      // --- coarse-pointer boot: touch copy, zero key names -------------------
      // Close the fine page first: two live SwiftShader game contexts in one
      // browser stall the second boot past the load timeout.
      await page.close().catch(() => undefined);
      const phone = await spawnCoarsePage(browser);
      try {
        const coarse = await g(phone.page, () => {
          const w = window.__wbGame;
          return {
            boot: w.scheme.get(),
            hint: document.querySelector("#screen-title .hint").textContent,
            want: w.hints.titleHint.touch,
          };
        });
        assert(coarse.boot === "touch", `coarse boot latched "${coarse.boot}", expected "touch"`);
        assert(coarse.hint === coarse.want, `coarse title hint "${coarse.hint}" is not the table's touch variant`);
        assert(/tap/i.test(coarse.hint), "coarse title hint has no tap wording");
        assert(!/enter|esc\b|wasd|shift|space|wheel/i.test(coarse.hint), "coarse title hint names keys");

        // DOM clicks in evaluate: no pointer events, so the latch is untouched.
        await g(phone.page, () => document.getElementById("btn-howto-title").click());
        await waitFrames(phone.page, 4);
        const howCoarse = await g(phone.page, () => ({
          text: document.getElementById("howto-controls").textContent,
          rows: document.querySelectorAll("#howto-controls li").length,
          chips: document.querySelectorAll("#howto-controls .key.chip").length,
        }));
        assert(howCoarse.rows >= 6, `coarse how-to listing has ${howCoarse.rows} rows, expected ≥6`);
        assert(howCoarse.chips === howCoarse.rows, "coarse how-to rows are not all button chips");
        for (const word of ["stick", "drag", "pinch", "ACTION", "JUMP"]) {
          assert(new RegExp(word, "i").test(howCoarse.text), `coarse how-to listing lacks "${word}"`);
        }
        assert(!/wasd|shift|space|wheel|esc\b|enter/i.test(howCoarse.text), "coarse how-to listing names keys");
        await g(phone.page, () => document.getElementById("btn-howto-back").click());

        await g(phone.page, () => window.__wbGame.startDayFromTitle());
        await waitFrames(phone.page, 6);
        const inRun = await g(phone.page, () => ({
          controls: window.__wbGame.hud.lastControlsDrawn,
          widgets: document.getElementById("touch").hidden,
        }));
        assert(inRun.controls === false, "controls line drawn on a touch device");
        assert(inRun.widgets === false, "touch widgets not visible on a coarse viewport");

        await g(phone.page, () => window.__wbGame.pause());
        await waitFrames(phone.page, 4);
        const pauseCoarse = await g(phone.page, () => ({
          got: document.getElementById("pause-hint").textContent,
          want: window.__wbGame.hints.pauseHint.touch,
        }));
        assert(
          pauseCoarse.got === pauseCoarse.want && /tap/i.test(pauseCoarse.got),
          `coarse pause hint is "${pauseCoarse.got}", expected "${pauseCoarse.want}"`,
        );
        assert(!/esc|wasd/i.test(pauseCoarse.got), "coarse pause hint names keys");

        const graceCoarse = await g(phone.page, () => {
          const w = window.__wbGame;
          w.resume();
          w.shell.sync();
          return {
            got: document.getElementById("grace-label").textContent,
            want: w.hints.graceChip.touch,
          };
        });
        assert(
          graceCoarse.got === graceCoarse.want && /tap/i.test(graceCoarse.got),
          `coarse grace label is "${graceCoarse.got}", expected "${graceCoarse.want}"`,
        );
        if (phone.errors.length) throw new Error(`phone page errors: ${phone.errors.join(" | ")}`);
        return `key boot: Enter hint, WASD how-to (0 chips), Esc pause hint, Resuming chip, controls line drawn; touch boot: Tap hint, stick/drag/pinch chip rows, Tap-to-resume chip, line hidden, widgets up`;
      } finally {
        await phone.page.close().catch(() => undefined);
        await phone.context.close().catch(() => undefined);
      }
    },
  },

  {
    name: "hints-prompt",
    run: async (page, _cdp, browser) => {
      // Desktop: the staged pickup prompt draws a keycap sourced from
      // prompt.key, and the persistent controls line stays up.
      await g(page, () => window.__wbGame.startDayFromTitle());
      await g(page, () => {
        const w = window.__wbGame;
        w.hopper.stageDefault(); // no thief racing the prompt beats
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
      });
      await waitFrames(page, 6); // prompt alpha ramps in over 0.28s
      const fine = await g(page, () => {
        const w = window.__wbGame;
        return {
          afford: w.hud.lastPromptAffordance,
          label: w.hud.lastPromptLabel,
          key: w.loop.prompt.key,
          text: w.loop.prompt.text,
          controls: w.hud.lastControlsDrawn,
        };
      });
      assert(fine.afford === "keycap", `fine prompt affordance is ${fine.afford}, expected "keycap"`);
      assert(
        fine.key === "E" && fine.label === "E",
        `keycap label is ${fine.label}, expected "E" (from loop prompt.key)`,
      );
      assert(fine.text === "pick up grain", `prompt text source is "${fine.text}"`);
      assert(fine.controls === true, "controls line not drawn on desktop");
      const pxKey = await hudControlsPixels(page);
      assert(pxKey > 40, `controls-line corner shows ${pxKey} opaque px on desktop, expected the line`);
      await page.screenshot({ path: path.join(root, "shots", "b2-shell", "hints-keycap-1280x720.png") });

      // Phone: the same staged prompt draws a PICK chip sourced from the
      // HINTS table (styled like the ACTION button, which reads PICK too),
      // and the controls line stays hidden. Close the fine page first — two
      // live SwiftShader game contexts stall the second boot.
      await page.close().catch(() => undefined);
      const phone = await spawnCoarsePage(browser);
      try {
        await g(phone.page, () => window.__wbGame.startDayFromTitle());
        await g(phone.page, () => {
          const w = window.__wbGame;
          w.hopper.stageDefault();
          const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
          w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
        });
        await waitFrames(phone.page, 6);
        const coarse = await g(phone.page, () => {
          const w = window.__wbGame;
          return {
            afford: w.hud.lastPromptAffordance,
            label: w.hud.lastPromptLabel,
            wantLabel: w.hints.promptAffordance.E.touch,
            key: w.loop.prompt.key,
            text: w.loop.prompt.text,
            act: document.getElementById("tc-act-label").textContent,
            controls: w.hud.lastControlsDrawn,
          };
        });
        assert(coarse.afford === "chip", `coarse prompt affordance is ${coarse.afford}, expected "chip"`);
        assert(
          coarse.key === "E" && coarse.label === "PICK" && coarse.label === coarse.wantLabel,
          `chip label is ${coarse.label}, expected "PICK" (from the HINTS table, not the key)`,
        );
        assert(coarse.text === "pick up grain", `chip prompt text source is "${coarse.text}"`);
        assert(coarse.act === "PICK", `ACTION button reads "${coarse.act}" — the chip must mirror it`);
        assert(coarse.controls === false, "controls line drawn on touch");
        const pxTouch = await hudControlsPixels(phone.page);
        assert(pxTouch === 0, `controls-line corner shows ${pxTouch} opaque px on touch, expected none`);

        // THROW mapping through a real pickup: the loop prompt flips to F.
        await g(phone.page, () => {
          const w = window.__wbGame;
          w.loop.tryPickup();
          w.carried.update(0.3, w.loop.buildCarryCtx());
        });
        await waitFrames(phone.page, 20);
        const thrown = await g(phone.page, () => ({
          afford: window.__wbGame.hud.lastPromptAffordance,
          label: window.__wbGame.hud.lastPromptLabel,
          key: window.__wbGame.loop.prompt.key,
        }));
        assert(
          thrown.key === "F" && thrown.afford === "chip" && thrown.label === "THROW",
          `throw affordance is ${thrown.afford}/${thrown.label}, expected chip/THROW`,
        );
        await phone.page.screenshot({ path: path.join(root, "shots", "b2-shell", "hints-chip-390x844.png") });
        if (phone.errors.length) throw new Error(`phone page errors: ${phone.errors.join(" | ")}`);
        return `staged pickup prompt: desktop keycap("E" from prompt.key) + controls line (${pxKey} px); phone chip("PICK" from HINTS, mirrors ACTION) → THROW after pickup, line hidden (0 px)`;
      } finally {
        await phone.page.close().catch(() => undefined);
        await phone.context.close().catch(() => undefined);
      }
    },
  },

  {
    name: "hints-correction",
    run: async (page) => {
      assert(await g(page, () => window.__wbGame.scheme.get()) === "key", "fine boot should latch key");
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 4);

      // A touch interaction on a fine-pointer boot: the latch corrects.
      await g(page, () => {
        const c = document.querySelector("canvas:not(#ui)");
        const r = c.getBoundingClientRect();
        const init = {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
          bubbles: true,
        };
        c.dispatchEvent(new PointerEvent("pointerdown", init));
        c.dispatchEvent(new PointerEvent("pointerup", init));
      });
      assert(
        await g(page, () => window.__wbGame.scheme.get()) === "touch",
        "a touch pointerdown did not latch the scheme to touch",
      );
      await waitFrames(page, 2);
      assert(
        await g(page, () => !document.getElementById("touch").hidden),
        "touch widgets did not follow the touch latch",
      );

      // The next screen showing hints speaks touch: pause menu + how-to.
      await g(page, () => window.__wbGame.pause());
      await waitFrames(page, 4);
      const touchPause = await g(page, () => ({
        got: document.getElementById("pause-hint").textContent,
        want: window.__wbGame.hints.pauseHint.touch,
      }));
      assert(
        touchPause.got === touchPause.want && /tap/i.test(touchPause.got),
        `pause hint after the touch latch is "${touchPause.got}", expected "${touchPause.want}"`,
      );
      await g(page, () => document.getElementById("btn-howto-pause").click());
      await waitFrames(page, 3);
      const howTouch = await g(page, () => document.getElementById("howto-controls").textContent);
      assert(/stick/i.test(howTouch) && /pinch/i.test(howTouch), "how-to listing did not follow the touch latch");
      await g(page, () => document.getElementById("btn-howto-back").click());

      // Leave and reopen the pause menu: touch wording survives.
      await g(page, () => {
        window.__wbGame.resume();
        window.__wbGame.resume();
        window.__wbGame.pause();
      });
      await waitFrames(page, 3);
      assert(
        await g(page, () => /tap/i.test(document.getElementById("pause-hint").textContent)),
        "the reopened pause menu lost the touch wording",
      );

      // A mouse interaction corrects back; the open menu re-renders key copy.
      await page.mouse.click(8, 8);
      await waitFrames(page, 3);
      const back = await g(page, () => ({
        scheme: window.__wbGame.scheme.get(),
        got: document.getElementById("pause-hint").textContent,
        want: window.__wbGame.hints.pauseHint.key,
      }));
      assert(back.scheme === "key", `a mouse pointerdown left the latch "${back.scheme}"`);
      assert(
        back.got === back.want && /Esc/.test(back.got),
        `pause hint after the mouse correction is "${back.got}", expected "${back.want}"`,
      );

      // Back in play, the HUD follows the correction: widgets hide, the
      // controls line returns.
      await g(page, () => {
        window.__wbGame.resume();
        window.__wbGame.resume();
      });
      await waitFrames(page, 3);
      assert(
        await g(page, () => document.getElementById("touch").hidden),
        "touch widgets stayed visible after the key correction",
      );
      assert(
        await g(page, () => window.__wbGame.hud.lastControlsDrawn),
        "controls line not restored after the key correction",
      );
      return `fine boot: touch pointerdown latches touch (widgets up; pause hint + how-to go touch; reopen holds); mouse click latches key (Esc hint back, widgets down, controls line restored)`;
    },
  },

  {
    name: "teach-persist",
    taught: false, // genuinely fresh save: no wb.taught pre-seed
    run: async (page) => {
      // Boot lands on the title with NO wb.taught (task 7.1): a title visit
      // alone must never mark teaching done.
      const boot = await g(page, () => ({
        key: localStorage.getItem("wb.taught"),
        mode: window.__wbGame.mode,
        armed: window.__wbGame.teach.debug().armed,
      }));
      assert(boot.key === null, `wb.taught exists at boot: "${boot.key}"`);
      assert(boot.mode === "title" && boot.armed, "fresh save did not boot armed on the title");

      // Linger on the title and visit how-to: still no write.
      await waitFrames(page, 40);
      await g(page, () => document.getElementById("btn-howto-title").click());
      await waitFrames(page, 6);
      await g(page, () => document.getElementById("btn-howto-back").click());
      await waitFrames(page, 6);
      assert(
        await g(page, () => localStorage.getItem("wb.taught")) === null,
        "a title/how-to visit wrote wb.taught",
      );

      // Starting the day writes the tiny self-describing flag.
      await g(page, () => window.__wbGame.startDayFromTitle());
      const written = await g(page, () => ({
        key: localStorage.getItem("wb.taught"),
        armed: window.__wbGame.teach.debug().armed,
      }));
      assert(written.key !== null, "wb.taught not written when the day started");
      let parsed = null;
      try {
        parsed = JSON.parse(written.key);
      } catch {}
      assert(parsed && parsed.day === true, `wb.taught value "${written.key}" is not self-describing`);

      // Reload: the next day runs with NO teaching hints at all.
      await reloadFresh(page);
      const again = await g(page, () => ({
        key: localStorage.getItem("wb.taught"),
        armed: window.__wbGame.teach.debug().armed,
      }));
      assert(again.key !== null, "wb.taught lost across reload");
      assert(again.armed === false, "teaching re-armed after reload despite wb.taught");
      await g(page, () => window.__wbGame.startDayFromTitle());
      await waitFrames(page, 150); // well past the ~1.2s move-hint trigger
      const day2 = await g(page, () => {
        const w = window.__wbGame;
        return { d: w.teach.debug(), e: w.loop.dayElapsed };
      });
      assert(day2.e > 1.2, `reloaded day did not reach the hint window (${day2.e}s)`);
      assert(
        day2.d.shown === null && day2.d.hints.move === "idle" && day2.d.hints.pickup === "idle",
        `second day after reload fired teaching hints: ${JSON.stringify(day2.d)}`,
      );
      // Drive the pickup moment explicitly: still nothing.
      await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
      });
      await waitFrames(page, 30);
      const pick = await g(page, () => window.__wbGame.teach.debug());
      assert(
        pick.shown === null && pick.hints.pickup === "idle",
        `reloaded day fired the pickup hint at a grain: ${JSON.stringify(pick)}`,
      );
      return "title visit writes nothing; day start writes wb.taught {day:true}; reload → second day fires no hints (move + pickup moments)";
    },
  },

  {
    name: "teach-first-day",
    taught: false,
    run: async (page) => {
      const teachState = () => g(page, () => window.__wbGame.teach.debug());
      /**
       * Polls (every 2 frames) until a teach predicate holds, guarded by SIM
       * time — SwiftShader frames can carry up to 0.25s of sim each, so frame
       * counts are meaningless here; loop.dayElapsed is the honest clock.
       */
      const waitTeachUntil = async (pred, simBudget, label) => {
        const e0 = await g(page, () => window.__wbGame.loop.dayElapsed);
        for (let i = 0; i < 600; i++) {
          const s = await g(page, () => ({
            d: window.__wbGame.teach.debug(),
            e: window.__wbGame.loop.dayElapsed,
          }));
          if (pred(s.d)) return s.d;
          if (s.e > e0 + simBudget) break;
          await waitFrames(page, 2);
        }
        throw new Error(`${label} never happened within ${simBudget}s of sim time (last: ${JSON.stringify(await teachState())})`);
      };

      // Day start persists the flag and consumes the one teaching run.
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        window.__wbGame.hopper.stageDefault(); // a scripted day: no thief racing the beats
      });
      assert(
        await g(page, () => localStorage.getItem("wb.taught")) !== null,
        "day start did not persist wb.taught",
      );

      // MOVE: fires shortly after the dawn beat, dismisses on sustained movement.
      let d = await waitTeachUntil((s) => s.shown === "move", 4, "move hint");
      assert(/WASD/.test(d.text) && !/tap|stick/i.test(d.text), `move copy "${d.text}" mixes schemes`);
      await page.keyboard.down("KeyW");
      d = await waitTeachUntil((s) => s.hints.move === "done" && s.shown === null, 5, "move dismissal by movement");
      await page.keyboard.up("KeyW");
      await waitFrames(page, 12); // linger: it must not re-fire
      d = await teachState();
      assert(d.hints.move === "done" && d.shown !== "move", `move hint re-fired: ${JSON.stringify(d)}`);

      // PICKUP: fires once near a grain node, times out with no input, and
      // never comes back — E still works afterwards (use ≠ resurrection).
      await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2); // clear of the seed anchors
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
      });
      d = await waitTeachUntil((s) => s.shown === "pickup", 3, "pickup hint");
      await waitFrames(page, 20);
      // The pill coexists pairwise-clear with the rest of the HUD (prompt up).
      const snap = await hudSnapshot(page);
      assert(snap.boxes.teach, "teach pill box missing while the pickup hint shows");
      assertNoOverlap("teach pickup beat", snap);
      assertInsideViewport("teach pickup beat", snap);
      await page.screenshot({ path: path.join(root, "shots", "b2-shell", "teach-pickup-1280x720.png") });
      await waitTeachUntil((s) => s.hints.pickup === "done" && s.shown === null, 11, "pickup timeout");
      d = await teachState();
      assert(d.hints.pickup === "done" && d.shown === null, `pickup hint re-fired after timeout: ${JSON.stringify(d)}`);
      // Re-approach cleanly: sim minutes passed during the timeout wait, and
      // the live hopper AI uses them to wander toward midfield.
      await g(page, () => {
        const w = window.__wbGame;
        w.hopper.stageDefault();
        const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
      });
      await page.keyboard.press("KeyE");
      d = await waitTeachUntil((s) => s.shown === "throw", 4, "throw hint (after E)");
      const carried = await g(page, () => window.__wbGame.carried.mode);
      assert(carried === "held", `E after the timed-out hint did not pick up (carried=${carried})`);
      d = await teachState();
      assert(d.hints.pickup === "done", "pickup hint resurrected after use");

      // THROW: fires while carrying; the first throw dismisses it.
      await page.keyboard.press("KeyF");
      d = await waitTeachUntil((s) => s.hints.throw === "done" && s.shown === null, 4, "throw dismissal by use");
      assert(
        await g(page, () => window.__wbGame.carried.mode) !== "held",
        "throw hint dismissed while still carrying",
      );

      // JUMP: near a spring seed; Space dismisses it via use.
      await g(page, () => {
        const w = window.__wbGame;
        w.hopper.stageDefault();
        w.controller.teleport(2.35 - 1.5, 4.35, 0);
      });
      d = await waitTeachUntil((s) => s.shown === "jump", 3, "jump hint");
      await page.keyboard.down("Space");
      d = await waitTeachUntil((s) => s.hints.jump === "done" && s.shown === null, 4, "jump dismissal by use");
      await page.keyboard.up("Space");

      // Each hint fired EXACTLY once: all four are done and nothing is up.
      d = await teachState();
      assert(
        d.shown === null &&
          d.hints.move === "done" &&
          d.hints.pickup === "done" &&
          d.hints.throw === "done" &&
          d.hints.jump === "done",
        `first day did not end with all hints done-once: ${JSON.stringify(d)}`,
      );

      // Restart day (same session): taught was written at day start → inert.
      await g(page, () => {
        const w = window.__wbGame;
        w.pause();
        w.restartDay();
        w.hopper.stageDefault();
      });
      d = await teachState();
      assert(d.armed === false && d.active === false, `restart re-armed teaching: ${JSON.stringify(d)}`);
      await waitFrames(page, 150); // past the move-hint trigger window
      d = await teachState();
      assert(d.shown === null && d.hints.move === "idle", `restarted day showed the move hint: ${JSON.stringify(d)}`);
      await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
      });
      await waitFrames(page, 40);
      d = await teachState();
      assert(d.shown === null && d.hints.pickup === "idle", `restarted day showed the pickup hint: ${JSON.stringify(d)}`);
      return "first day: move→movement, pickup→timeout (E still works), throw→F, jump→Space — each once, HUD-clear pill; restart day fires none";
    },
  },

  {
    name: "teach-scheme",
    taught: false,
    run: async (page, _cdp, browser) => {
      /** Waits until the given hint is the one on screen. */
      const waitShown = async (pg, id, capIters) => {
        for (let i = 0; i < capIters; i++) {
          const s = await g(pg, () => window.__wbGame.teach.debug());
          if (s.shown === id) return s;
          await waitFrames(pg, 4);
        }
        throw new Error(`${id} hint never showed`);
      };

      // Fine-pointer boot: the pill names keys.
      await g(page, () => {
        window.__wbGame.startDayFromTitle();
        window.__wbGame.hopper.stageDefault();
      });
      await waitShown(page, "move", 150);
      await waitFrames(page, 20);
      const fine = await g(page, () => ({
        text: window.__wbGame.teach.debug().text,
        want: window.__wbGame.hints.teach.move.key,
      }));
      assert(fine.text === fine.want, `fine move hint "${fine.text}" is not the table's key variant`);
      assert(/WASD/.test(fine.text) && !/tap|stick|drag/i.test(fine.text), "fine move hint mixes in touch wording");
      await page.screenshot({ path: path.join(root, "shots", "b2-shell", "teach-move-1280x720.png") });

      // Coarse boot: the pill names the widgets. Close the fine page first —
      // two live SwiftShader game contexts stall the second boot.
      await page.close().catch(() => undefined);
      const phone = await spawnCoarsePage(browser, { taught: false });
      try {
        await g(phone.page, () => {
          window.__wbGame.startDayFromTitle();
          window.__wbGame.hopper.stageDefault();
        });
        await waitShown(phone.page, "move", 150);
        await waitFrames(phone.page, 20);
        const coarse = await g(phone.page, () => ({
          text: window.__wbGame.teach.debug().text,
          want: window.__wbGame.hints.teach.move.touch,
        }));
        assert(coarse.text === coarse.want, `coarse move hint "${coarse.text}" is not the table's touch variant`);
        assert(/stick/i.test(coarse.text) && !/wasd|space|esc\b|enter/i.test(coarse.text), "coarse move hint names keys");

        // Phone layout: the pill clears the widgets + toast, stays inside the
        // viewport, off the ant, and at the batch-6 readable floor.
        const snap = await hudSnapshot(phone.page);
        assert(snap.boxes.teach, "phone teach pill box missing");
        assert(snap.fonts.teach >= 12, `teach font ${snap.fonts.teach.toFixed(1)} < 12 CSS px on phone`);
        assertNoOverlap("phone teach", snap);
        assertInsideViewport("phone teach", snap);
        const b = snap.boxes.teach;
        const cx = snap.viewport.w / 2;
        const cy = snap.viewport.h / 2;
        assert(
          !(cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h),
          "phone teach pill covers the viewport center (the ant)",
        );
        await phone.page.screenshot({ path: path.join(root, "shots", "b2-shell", "teach-move-390x844.png") });

        // Staged force-show for the eyes-on pickup capture (the capture seam
        // retires the move hint): pill + PICK chip + widgets in one frame.
        await g(phone.page, () => {
          const w = window.__wbGame;
          const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
          w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
          w.teach.forceShow("pickup");
        });
        await waitFrames(phone.page, 20);
        const forced = await g(phone.page, () => window.__wbGame.teach.debug());
        assert(forced.shown === "pickup" && /PICK/.test(forced.text), `forceShow staged ${forced.shown}`);
        await phone.page.screenshot({ path: path.join(root, "shots", "b2-shell", "teach-pickup-390x844.png") });
        if (phone.errors.length) throw new Error(`phone page errors: ${phone.errors.join(" | ")}`);
        return `fine pill "WASD / arrows to move" (desktop capture); coarse pill "Drag the left stick to move", ≥12 CSS px, clear of widgets/toast/ant (phone captures + staged pickup pill)`;
      } finally {
        await phone.page.close().catch(() => undefined);
        await phone.context.close().catch(() => undefined);
      }
    },
  },

  {
    name: "teach-howto",
    taught: false,
    run: async (page, _cdp, browser) => {
      // Fine viewport: goal + key listing render; viewing consumes nothing.
      const boot = await g(page, () => ({
        mode: window.__wbGame.mode,
        key: localStorage.getItem("wb.taught"),
        d: window.__wbGame.teach.debug(),
      }));
      assert(boot.mode === "title" && boot.key === null, "teach-howto did not boot fresh on the title");
      assert(boot.d.armed === true, "teaching not armed on a fresh save");
      await page.click("#btn-howto-title");
      await waitFrames(page, 6);
      const how = await g(page, () => ({
        on: document.getElementById("screen-howto").classList.contains("on"),
        goal: document.querySelector("#screen-howto .goal").textContent,
        tip: document.querySelector("#screen-howto .tip")?.textContent ?? "",
        rows: document.querySelectorAll("#howto-controls li").length,
        chips: document.querySelectorAll("#howto-controls .key.chip").length,
        text: document.getElementById("howto-controls").textContent,
      }));
      assert(how.on, "how-to did not open from the title");
      assert(
        /six grains/i.test(how.goal) && /sun sets/i.test(how.goal) && /grasshopper/i.test(how.goal),
        `day-goal copy incomplete: "${how.goal}"`,
      );
      assert(/spring seed/i.test(how.tip), `tip line missing: "${how.tip}"`);
      assert(how.rows >= 8 && how.chips === 0, `fine how-to listing ${how.rows} rows / ${how.chips} chips`);
      assert(
        /WASD/.test(how.text) && /Space/.test(how.text) && !/stick|pinch/i.test(how.text),
        "fine how-to listing is not the key variant",
      );
      await page.click("#btn-howto-back");
      await waitFrames(page, 4);
      const after = await g(page, () => ({
        mode: window.__wbGame.mode,
        e: window.__wbGame.loop.dayElapsed,
        key: localStorage.getItem("wb.taught"),
        d: window.__wbGame.teach.debug(),
      }));
      assert(after.mode === "title" && after.e === 0, "how-to round trip started or advanced a day");
      assert(after.key === null, "viewing how-to wrote wb.taught");
      assert(
        after.d.armed === true &&
          after.d.shown === null &&
          after.d.hints.move === "idle" &&
          after.d.hints.pickup === "idle" &&
          after.d.hints.throw === "idle" &&
          after.d.hints.jump === "idle",
        `viewing how-to consumed teaching state: ${JSON.stringify(after.d)}`,
      );

      // Coarse viewport: same panel renders the touch variant.
      await page.close().catch(() => undefined);
      const phone = await spawnCoarsePage(browser, { taught: false });
      try {
        await g(phone.page, () => document.getElementById("btn-howto-title").click());
        await waitFrames(phone.page, 6);
        const howTouch = await g(phone.page, () => ({
          goal: document.querySelector("#screen-howto .goal").textContent,
          rows: document.querySelectorAll("#howto-controls li").length,
          chips: document.querySelectorAll("#howto-controls .key.chip").length,
          text: document.getElementById("howto-controls").textContent,
        }));
        assert(howTouch.rows >= 6 && howTouch.chips === howTouch.rows, "coarse how-to rows are not all button chips");
        assert(/six grains/i.test(howTouch.goal), "coarse how-to lost the day-goal copy");
        for (const word of ["stick", "drag", "ACTION", "JUMP"]) {
          assert(new RegExp(word, "i").test(howTouch.text), `coarse how-to listing lacks "${word}"`);
        }
        assert(!/wasd|shift|space|wheel|esc\b|enter/i.test(howTouch.text), "coarse how-to listing names keys");
        await g(phone.page, () => document.getElementById("btn-howto-back").click());
        await waitFrames(phone.page, 4);
        const phoneAfter = await g(phone.page, () => ({
          mode: window.__wbGame.mode,
          key: localStorage.getItem("wb.taught"),
          d: window.__wbGame.teach.debug(),
        }));
        assert(
          phoneAfter.mode === "title" && phoneAfter.key === null && phoneAfter.d.armed === true,
          `coarse how-to round trip left ${JSON.stringify(phoneAfter)}`,
        );
        if (phone.errors.length) throw new Error(`phone page errors: ${phone.errors.join(" | ")}`);
        return "both viewports: goal + matching scheme listing + tip; no wb.taught write, teaching state untouched, day never started";
      } finally {
        await phone.page.close().catch(() => undefined);
        await phone.context.close().catch(() => undefined);
      }
    },
  },

  {
    name: "hud-compact",
    touch: true,
    run: async (page, _cdp, browser) => {
      // --- phone portrait 390x844 (coarse): the compact layout holds together
      await stageHudBeat(page);
      await g(page, (ins) => window.__wbGame.hud.setSafeArea(ins), { top: 0, right: 0, bottom: 0, left: 0 });
      await waitFrames(page, 8);
      const phone = await hudSnapshot(page);
      assert(phone.compact === true, `phone 390x844 read compact=${phone.compact}`);
      assert(
        phone.sEff > phone.s + 0.1,
        `phone floored scale not applied: s=${phone.s.toFixed(3)} sEff=${phone.sEff.toFixed(3)}`,
      );
      // Text floors (CSS px): count ≥ 14, sub-label ≥ 9, prompt/toast ≥ 12.
      assert(phone.fonts.count >= 14, `count font ${phone.fonts.count.toFixed(1)} < 14`);
      assert(phone.fonts.sub >= 9, `sub-label font ${phone.fonts.sub.toFixed(1)} < 9`);
      assert(phone.fonts.prompt >= 12, `prompt font ${phone.fonts.prompt.toFixed(1)} < 12`);
      assert(phone.fonts.toast >= 12, `toast font ${phone.fonts.toast.toFixed(1)} < 12`);
      assertInsideViewport("phone", phone);
      const phoneBoxes = assertNoOverlap("phone", phone);
      // Nothing readable permanently covers the ant's screen-center haunt.
      const pcx = phone.viewport.w / 2;
      const pcy = phone.viewport.h / 2;
      for (const [k, b] of Object.entries(phone.boxes)) {
        if (!b) continue;
        assert(
          !(pcx > b.x && pcx < b.x + b.w && pcy > b.y && pcy < b.y + b.h),
          `phone: ${k} box covers the viewport center`,
        );
      }
      assert(phone.widgets.stick && phone.widgets.pause, "touch widgets missing from the phone snapshot");

      // --- desktop 1600x900: the classic layout is untouched ---------------
      // (close the phone page first: two live SwiftShader contexts stall boot)
      await page.close().catch(() => undefined);
      const d = await openViewport(browser, 1600, 900);
      try {
        await stageHudBeat(d.page);
        await waitFrames(d.page, 8);
        const desk = await hudSnapshot(d.page);
        assert(desk.compact === false, `desktop 1600x900 read compact=${desk.compact}`);
        assert(Math.abs(desk.sEff - desk.s) < 1e-9, `desktop sEff ${desk.sEff} != s ${desk.s}`);
        assert(desk.fonts.count > 30, `desktop count font ${desk.fonts.count.toFixed(1)}`);
        assert(desk.boxes.plaque && desk.boxes.dayTrack, "desktop missing plaque/dayTrack boxes");
        assertNoOverlap("desktop", desk);
        assertInsideViewport("desktop", desk);
        if (d.errors.length) throw new Error(`desktop page errors: ${d.errors.join(" | ")}`);
        return `phone 390x844 compact: sEff ${phone.sEff.toFixed(2)} (raw s ${phone.s.toFixed(2)}), fonts ${phone.fonts.count.toFixed(1)}/${phone.fonts.sub.toFixed(1)}/${phone.fonts.prompt.toFixed(1)}/${phone.fonts.toast.toFixed(1)}, ${phoneBoxes} boxes pairwise clear + in-viewport; desktop 1600x900 classic (sEff==s), boxes clear`;
      } finally {
        await d.context.close().catch(() => undefined);
      }
    },
  },

  {
    name: "hud-safearea",
    run: async (page, _cdp, browser) => {
      // viewport-fit=cover is what exposes env(safe-area-inset-*) at all.
      const meta = await g(page, () => document.querySelector('meta[name="viewport"]')?.content ?? "");
      assert(meta.includes("viewport-fit=cover"), `meta viewport is "${meta}", expected viewport-fit=cover`);

      // #shell and #touch must keep positioning themselves inside env()
      // insets (env() cannot be emulated on a plain viewport, so assert the
      // stylesheet mechanism, as shell-a11y does for the shell alone).
      const envRules = await g(page, () => {
        const hits = { shell: false, touch: false };
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            const t = rule.cssText || "";
            if (!t.includes("safe-area-inset")) continue;
            if (t.includes("#shell")) hits.shell = true;
            if (t.includes("#touch")) hits.touch = true;
          }
        }
        return hits;
      });
      assert(
        envRules.shell && envRules.touch,
        `env(safe-area-inset) rules missing (shell=${envRules.shell} touch=${envRules.touch})`,
      );

      // Close the runner page before spawning the orientation pages — two
      // live SwiftShader game contexts stall the second boot (hints-prompt
      // learned this the hard way).
      await page.close().catch(() => undefined);

      // Mechanism: stub the insets via hud.setSafeArea (the same seam the
      // harness can use) and assert every HUD box lands inside the safe rect
      // in BOTH phone orientations, widgets included in the overlap sweep.
      // Insets are physically-real notched-iPhone geometry (Apple HIG): the
      // notch is a SIDE in landscape (47px) but TOP-ONLY in portrait (sides 0)
      // — stubbing 47px sides in portrait would demand a plaque+sun+controls
      // row wider than the screen itself.
      const LANDSCAPE_INSETS = { top: 47, right: 47, bottom: 34, left: 47 };
      const PORTRAIT_INSETS = { top: 47, right: 0, bottom: 34, left: 0 };
      for (const vp of [
        { w: 844, h: 390, ins: LANDSCAPE_INSETS },
        { w: 390, h: 844, ins: PORTRAIT_INSETS },
      ]) {
        const INSETS = vp.ins;
        const ctxPage = await openViewport(browser, vp.w, vp.h, true);
        try {
          await stageHudBeat(ctxPage.page);
          await g(ctxPage.page, (ins) => window.__wbGame.hud.setSafeArea(ins), INSETS);
          await waitFrames(ctxPage.page, 8);
          const snap = await hudSnapshot(ctxPage.page);
          assert(
            snap.safe.top === INSETS.top &&
              snap.safe.right === INSETS.right &&
              snap.safe.bottom === INSETS.bottom &&
              snap.safe.left === INSETS.left,
            `${vp.w}x${vp.h}: hudBoxes.safe ${JSON.stringify(snap.safe)} != the stub`,
          );
          const rect = {
            x: INSETS.left,
            y: INSETS.top,
            w: vp.w - INSETS.left - INSETS.right,
            h: vp.h - INSETS.top - INSETS.bottom,
          };
          for (const [k, b] of Object.entries(snap.boxes)) {
            if (!b) continue;
            assert(
              b.x >= rect.x - 0.5 &&
                b.y >= rect.y - 0.5 &&
                b.x + b.w <= rect.x + rect.w + 0.5 &&
                b.y + b.h <= rect.y + rect.h + 0.5,
              `${vp.w}x${vp.h}: ${k} box ${JSON.stringify(b)} escapes the safe rect ${JSON.stringify(rect)}`,
            );
          }
          assertNoOverlap(`${vp.w}x${vp.h}`, snap);
          if (ctxPage.errors.length) throw new Error(`page errors: ${ctxPage.errors.join(" | ")}`);
        } finally {
          await ctxPage.context.close().catch(() => undefined);
        }
      }
      return `viewport-fit=cover present; env() rules for #shell + #touch; stub insets (HIG-real: landscape {47,47,34,47}, portrait {47,0,34,0}): every HUD box inside the safe rect + pairwise clear at 844x390 and 390x844`;
    },
  },

  {
    name: "hud-reduced",
    run: async (page) => {
      await g(page, () => window.__wbGame.startDayFromTitle());
      await g(page, () => {
        const w = window.__wbGame;
        w.startDayFromTitle();
        w.hopper.stageDefault(); // parked; stageChase() brings the thief in
        // One-time late-day pin: remaining ≈ 24s keeps the DERIVED urgency
        // ≈ 0.9 stable across steps (update recomputes it from remaining).
        w.loop.stage({ dayElapsed: 336, urgency: 0.9, carryHeld: true });
      });

      const sampleMotion = async (n) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          // Re-stage every few samples: a live chase ends fast (steal → eat →
          // patrol drops threatLevel to 0 and the cue legitimately switches
          // off), and each re-approach keeps the bearing sweeping too.
          if (i % 5 === 0) await stageChase();
          out.push(
            await g(page, () => {
              const w = window.__wbGame;
              const m = w.hud.debugMotion;
              // urgency rides along: it drifts up slowly as the day clock
              // advances, so pulse amplitude is asserted on alpha/urgency and
              // on the sun radius' deviation from its static urgency curve.
              return {
                v: m.vignetteAlpha,
                u: w.loop.urgency,
                se: w.hud.hudBoxes.sEff,
                ray: m.sunRayAngle,
                sr: m.sunRadius,
                ta: m.threatAngle,
                tr: m.threatRadius,
              };
            }),
          );
          await waitFrames(page, 2);
        }
        return out;
      };
      const amp = (vals) => Math.max(...vals) - Math.min(...vals);
      const ratio = (samples) => samples.filter((x) => x.u > 0.05).map((x) => x.v / x.u);
      /** Sun radius minus its static urgency curve (pulse term isolated). */
      const srDev = (samples) => samples.map((x) => x.sr - (9.5 + x.u * 2.25) * x.se);

      /** A real chase 3.2u off the ant's bearing 0.8 — the cue must track it.
       *  Re-applies the hauled-grain bait only (a live chase ends fast:
       *  steal → eat → patrol drops threatLevel to 0 and the cue switches
       *  off) and leaves the day clock alone, so urgency drifts monotonically
       *  instead of being re-pinned between a frame and its sample. */
      const stageChase = () =>
        g(page, () => {
          const w = window.__wbGame;
          w.loop.stage({ carryHeld: true });
          const a = w.controller.position;
          const bx = a.x + Math.sin(0.8) * 3.2;
          const bz = a.z + Math.cos(0.8) * 3.2;
          w.hopper.stage({
            x: bx,
            z: bz,
            yaw: Math.atan2(a.x - bx, a.z - bz),
            state: "chase",
            stateT: 0.1,
            speed: 3.9,
            suspicion: 1,
          });
        });

      // --- reduced motion: decorative pulses collapse to constants ---------
      await page.emulateMedia({ reducedMotion: "reduce" });
      await waitFrames(page, 6);
      assert(
        await g(page, () => window.__wbGame.hud.debugReduced) === true,
        "debugReduced is false under emulateMedia(reduce)",
      );
      await stageChase();
      await waitFrames(page, 6); // threatLevel is staged to 1; chase closes in
      const rm = await sampleMotion(10);
      const rmRatio = ratio(rm);
      assert(
        amp(rmRatio) <= 1e-6,
        `reduced vignette still breathes (alpha/urgency amp ${amp(rmRatio).toFixed(5)})`,
      );
      assert(rm[0].v > 0.15, `reduced vignette lost urgency encoding (${rm[0].v.toFixed(3)})`);
      assert(amp(rm.map((x) => x.ray)) <= 1e-9, `reduced sun rays still rotate (amp ${amp(rm.map((x) => x.ray)).toFixed(4)})`);
      assert(
        amp(srDev(rm)) <= 1e-9,
        `reduced sun radius still pulses (amp ${amp(srDev(rm)).toFixed(4)})`,
      );
      assert(amp(rm.map((x) => x.tr)) <= 1e-9, `reduced threat eye still pulses (amp ${amp(rm.map((x) => x.tr)).toFixed(4)})`);
      const taAmp = amp(rm.map((x) => x.ta));
      assert(taAmp > 0.05, `threat cue stopped tracking the chase under reduce (angle amp ${taAmp.toFixed(3)})`);

      // Urgency still encodes through the static vignette: 0 → nothing, 0.9 → strong.
      await g(page, () => window.__wbGame.loop.stage({ dayElapsed: 0, urgency: 0 }));
      await waitFrames(page, 4);
      const vLow = await g(page, () => window.__wbGame.hud.debugMotion.vignetteAlpha);
      assert(vLow === 0, `calm day shows vignette alpha ${vLow}`);
      await g(page, () => window.__wbGame.loop.stage({ dayElapsed: 336, urgency: 0.9 }));
      await waitFrames(page, 4);
      const vHigh = await g(page, () => window.__wbGame.hud.debugMotion.vignetteAlpha);
      assert(vHigh > 0.15, `urgent day vignette alpha only ${vHigh.toFixed(3)}`);

      // --- no preference: the same decorations breathe again ---------------
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await waitFrames(page, 6);
      assert(
        await g(page, () => window.__wbGame.hud.debugReduced) === false,
        "debugReduced is true under no-preference",
      );
      await stageChase();
      await waitFrames(page, 6);
      const live = await sampleMotion(10);
      const liveRatio = ratio(live);
      assert(
        amp(liveRatio) > 0.02,
        `vignette alpha/urgency amplitude ${amp(liveRatio).toFixed(4)} without reduce`,
      );
      assert(amp(live.map((x) => x.ray)) > 0.001, "sun rays static without reduce");
      assert(amp(srDev(live)) > 0.05, "sun radius static without reduce");
      assert(amp(live.map((x) => x.tr)) > 0.001, "threat eye radius static without reduce");

      // --- pinned independence: the kill-switch overrides the media query --
      const grabRun = () =>
        g(page, async () => {
          await window.__wb.shot("run");
          return window.__wb.grab();
        });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const pngReduce = Buffer.from((await grabRun()).replace(/^data:image\/png;base64,/, ""), "base64");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const pngNormal = Buffer.from((await grabRun()).replace(/^data:image\/png;base64,/, ""), "base64");
      assert(pngReduce.equals(pngNormal), "pinned run capture differs between reduce and no-preference");
      return `reduce: vignette/ray/sun/threat amplitudes 0 while cue tracked chase (amp ${taAmp.toFixed(2)}), urgency 0→0.9 encodes 0→${vHigh.toFixed(3)}; no-preference: amplitudes return; pinned run byte-identical across both`;
    },
  },

  {
    name: "touch-scene",
    touch: true,
    run: async (page) => {
      const info = await g(page, () => window.__wb.shot("touch"));
      assert(
        info && typeof info === "object" && info.dom === true,
        `shot("touch") must resolve {dom:true}, got ${JSON.stringify(info)}`,
      );
      const st = await g(page, () => {
        const rootEl = document.getElementById("touch");
        return {
          hidden: rootEl.hidden,
          pinned: rootEl.classList.contains("pinned"),
          shellPinned: document.getElementById("shell").classList.contains("pinned"),
          nub: document.getElementById("tc-nub").style.transform,
          verb: document.getElementById("tc-act-label").textContent,
          ready: document.getElementById("tc-act").classList.contains("ready"),
        };
      });
      assert(!st.hidden, "touch scene captured with the widget layer hidden");
      assert(st.pinned && st.shellPinned, "touch scene: .pinned kill-switch missing on #touch/#shell");
      assert(st.nub === "", `joystick not at rest for capture (nub transform "${st.nub}")`);
      assert(st.verb === "THROW" && st.ready, `touch scene ACTION reads "${st.verb}" (ready ${st.ready}), expected THROW`);

      // Two consecutive pinned page captures must be byte-identical, and the
      // eyes-on capture lands beside the shell shots.
      const outDir = path.join(root, "shots", "b2-shell");
      mkdirSync(outDir, { recursive: true });
      await g(page, () => {
        window.__wbGame.pinned = true;
      });
      await waitFrames(page, 6);
      const a = await page.screenshot();
      const b = await page.screenshot();
      assert(a.equals(b), "touch scene page captures never settled byte-identical");
      await page.screenshot({ path: path.join(outDir, "touch-390x844.png") });

      // Full unpin: the scene's forceVisible override clears, live day resumes.
      await g(page, () => {
        window.__wbGame.shotDirector.unpin();
        window.__wbGame.touchControls.sync();
      });
      const post = await g(page, () => ({
        force: window.__wbGame.touchControls.forceVisible,
        mode: window.__wbGame.mode,
      }));
      assert(post.force === false, "unpin did not clear the touch scene's forceVisible");
      assert(post.mode === "playing", `unpin left mode ${post.mode}`);
      return `shot("touch") dom:true; widgets visible + pinned, nub at rest, THROW ready; byte-identical pair → shots/b2-shell/touch-390x844.png; unpin resets`;
    },
  },

  {
    name: "shell-capture",
    run: async (page) => {
      // The pinned capture contract: at every shell state the root carries
      // .pinned (transitions none, fades at end state) BEFORE the shot, and
      // two consecutive page.screenshot() captures are byte-identical.
      const outDir = path.join(root, "shots", "b2-shell");
      mkdirSync(outDir, { recursive: true });
      for (const name of SHELL_STATES) {
        await driveShellState(page, name);
        await pinAndPair(page, name, path.join(outDir, `${name}-1280x720.png`));
      }
      return "5 shell states pinned: .pinned class + transition 0s + byte-identical pairs (shots/b2-shell)";
    },
  },

  {
    name: "harness-scenes",
    run: async (page) => {
      // The shot-harness contract for the DOM-shell scenes (design D1/D6):
      // shot() resolves with the dom-capture flag (grab() composites only the
      // canvases), the shell is pinned + settled BEFORE the resolve, the HUD
      // is dark only where the live screen owns the display, results stats
      // re-cache per scene within one harness session, and unpin restores a
      // clean live day. Baseline-compare needs the capture viewport.
      await page.setViewportSize({ width: 1600, height: 900 });
      await waitFrames(page, 4);

      const harnessState = () =>
        g(page, () => {
          const w = window.__wbGame;
          const on = document.querySelector("#shell .screen.on");
          return {
            mode: w.mode,
            pinnedClass: document.getElementById("shell").classList.contains("pinned"),
            hud: w.hud.enabled,
            screen: on ? on.id : null,
          };
        });

      const titleInfo = await g(page, () => window.__wb.shot("title"));
      assert(
        titleInfo && typeof titleInfo === "object" && titleInfo.dom === true,
        `shot("title") must resolve {dom:true}, got ${JSON.stringify(titleInfo)}`,
      );
      const t = await harnessState();
      assert(t.pinnedClass, "title: .pinned class not applied at resolve time");
      assert(t.screen === "screen-title" && t.mode === "title", `title: ${JSON.stringify(t)}`);
      assert(!t.hud, "title: HUD must be hidden (the live title clears it)");

      // The regression seam from the batch task: a world shot staged AFTER a
      // shell scene in the SAME session must land byte-identical to baseline.
      await g(page, () => window.__wb.shot("run"));
      const dataUrl = await g(page, () => window.__wb.grab());
      const got = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
      const base = readFileSync(path.join(root, "shots", "baseline", "run.png"));
      assert(got.equals(base), "run after title differs from shots/baseline/run.png (byte compare)");

      await g(page, () => window.__wb.shot("howto"));
      const h = await harnessState();
      assert(
        h.screen === "screen-howto" && h.mode === "title" && !h.hud,
        `howto: ${JSON.stringify(h)}`,
      );

      await g(page, () => window.__wb.shot("paused"));
      const p = await harnessState();
      assert(
        p.screen === "screen-pause" && p.mode === "paused" && p.hud,
        `paused: ${JSON.stringify(p)}`,
      );

      // Two results scenes in ONE session: the shell caches stats on the
      // transition into results, so the second scene must re-cache (3/6).
      await g(page, () => window.__wb.shot("results-win"));
      const win = await harnessState();
      const winStats = await g(page, () => document.getElementById("win-grains").textContent);
      assert(win.screen === "screen-win" && win.hud, `results-win: ${JSON.stringify(win)}`);
      assert(winStats === "6 / 6", `results-win stats show ${winStats}`);
      await g(page, () => window.__wb.shot("results-lose"));
      const lose = await harnessState();
      const loseStats = await g(page, () => document.getElementById("lose-grains").textContent);
      assert(lose.screen === "screen-lose", `results-lose: ${JSON.stringify(lose)}`);
      assert(loseStats === "3 / 6", `results-lose stats did not re-cache: ${loseStats}`);

      // unpin restores the clean live day (mode, HUD, no pin, no screen);
      // sync() runs in-task so the assertion needs no frame.
      await g(page, () => {
        window.__wbGame.shotDirector.unpin();
        window.__wbGame.shell.sync();
      });
      const u = await harnessState();
      assert(
        u.mode === "playing" && u.hud && !u.pinnedClass && u.screen === null,
        `unpin: ${JSON.stringify(u)}`,
      );
      return "dom flag + screens settled pre-resolve; HUD dark title/howto only; lose re-cache 3/6; unpin clean; run-after-title byte-identical";
    },
  },

  // --- audio batch (tasks 8.1–8.5) --------------------------------------------

  {
    name: "audio-boot",
    run: async (page, _cdp, browser) => {
      // This section needs its OWN init script (an AudioContext construction
      // counter) and its own console collector attached BEFORE the first
      // navigation — close the runner page and build a bespoke one.
      await page.close().catch(() => undefined);
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const p = await context.newPage();
      await seedTaught(p);
      await p.addInitScript(() => {
        window.__audioCtors = 0;
        const Real = window.AudioContext;
        if (Real) {
          window.AudioContext = class extends Real {
            constructor(...args) {
              window.__audioCtors++;
              super(...args);
            }
          };
        }
      });
      const problems = [];
      p.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      p.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
      });
      await p.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
      await p.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });

      // Silent boot (autoplay policy): NO AudioContext construction at all,
      // the audio system sits "idle", and the console stays clean.
      const boot = await g(p, () => {
        const d = window.__wbGame.audio.debug();
        return { state: d.state, created: d.contextCreated, ctors: window.__audioCtors, gains: d.gains };
      });
      assert(boot.state === "idle", `boot audio state is ${boot.state}, expected "idle"`);
      assert(boot.created === false, "contextCreated true before any gesture");
      assert(boot.ctors === 0, `AudioContext constructed ${boot.ctors}× before any gesture`);
      assert(boot.gains === null, "graph gains exist before any gesture");
      assert(problems.length === 0, `silent boot produced errors: ${problems.join(" | ")}`);
      await waitFrames(p, 60);
      assert(
        await g(p, () => window.__audioCtors) === 0,
        "AudioContext appeared while idling on the title",
      );

      // START is a real user gesture: the graph must come up live.
      await p.click("#btn-start");
      for (let i = 0; i < 30; i++) {
        if (await g(p, () => window.__wbGame.audio.debug().state === "running")) break;
        await waitFrames(p, 1);
      }
      try {
        const live = await g(p, () => {
        const d = window.__wbGame.audio.debug();
        return {
          state: d.state,
          created: d.contextCreated,
          ctors: window.__audioCtors,
          connected: d.connected,
          gains: d.gains,
          nodes: d.nodes,
          bed: d.bed,
        };
      });
      assert(live.state === "running", `audio state after START is ${live.state}, expected "running"`);
      assert(live.ctors === 1, `AudioContext constructed ${live.ctors}× after START, expected exactly 1`);
      assert(live.created && live.connected, "graph not connected after START");
      assert(!!live.gains, "gains null after START");
      assert(
        Math.abs(live.gains.master - 0.9) < 0.02 &&
          Math.abs(live.gains.music - 0.16) < 0.02 &&
          Math.abs(live.gains.sfx - 1) < 0.02,
        `boot gains ${JSON.stringify(live.gains)} off the bus levels`,
      );
      assert(live.nodes.master === 1 && live.nodes.music >= 7 && live.nodes.sfx >= 1,
        `graph nodes ${JSON.stringify(live.nodes)} (master + music bus + 3 drone voices + sfx bus)`);
      assert(live.bed.scheduler && live.bed.drone && live.bed.generation === 1,
        `music bed not alive after START: ${JSON.stringify(live.bed)}`);
      await waitFrames(p, 90); // ~1.5 s of lookahead scheduling
      const bed = await g(p, () => window.__wbGame.audio.debug().bed);
      assert(bed.notes >= 2, `music bed scheduled ${bed.notes} notes in ~1.5 s, expected ≥2`);
      assert(problems.length === 0, `post-START errors: ${problems.join(" | ")}`);
      return `silent boot: 0 constructions, state idle, console clean; START → 1 context, running, gains 0.9/0.16/1, bed alive (${bed.notes} notes)`;
      } finally {
        // A live SwiftShader game context left open stalls the NEXT section's
        // boot past its load timeout (hints-scheme learned this first).
        await p.close().catch(() => undefined);
        await context.close().catch(() => undefined);
      }
    },
  },

  {
    name: "audio-sfx",
    run: async (page) => {
      /** Polls until `pred` holds, bounded by SIM time (SwiftShader-proof). */
      const waitSimUntil = async (pred, simBudget, label) => {
        const e0 = await g(page, () => window.__wbGame.loop.dayElapsed);
        for (let i = 0; i < 900; i++) {
          const s = await g(page, () => {
            const w = window.__wbGame;
            return { e: w.loop.dayElapsed, d: w.audio.debug() };
          });
          if (pred(s)) return s.d;
          if (s.e > e0 + simBudget) break;
          await waitFrames(page, 1);
        }
        throw new Error(`${label} never fired within ${simBudget}s of sim time`);
      };
      const count = (d, name) => d.counts[name] ?? 0;

      // The FIRST real click is the gesture: unlock + ui tick (how-to open).
      await page.click("#btn-howto-title");
      await page.click("#btn-howto-back");
      let d = await g(page, () => window.__wbGame.audio.debug());
      assert(d.state === "running", `audio state after the first click is ${d.state}`);
      assert(count(d, "ui") === 2, `ui tick count ${count(d, "ui")}, expected 2 (how-to open + back)`);

      await g(page, () => {
        const w = window.__wbGame;
        w.startDayFromTitle();
        w.hopper.stageDefault(); // a scripted day: no thief racing the beats
      });
      await waitFrames(page, 6);

      // pickup: the live tryPickup path near a node.
      await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
        w.loop.tryPickup();
        w.carried.update(0.3, w.loop.buildCarryCtx());
      });
      d = await g(page, () => window.__wbGame.audio.debug());
      assert(count(d, "pickup") === 1, `pickup count ${count(d, "pickup")}, expected 1`);

      // throw: the live tryThrow path while carrying; then let the grain settle.
      await g(page, () => window.__wbGame.loop.tryThrow());
      d = await g(page, () => window.__wbGame.audio.debug());
      assert(count(d, "throw") === 1, `throw count ${count(d, "throw")}, expected 1`);
      for (let i = 0; i < 300; i++) {
        if (await g(page, () => window.__wbGame.carried.mode) === "hidden") break;
        await waitFrames(page, 1);
      }

      // deposit: pick again, then deliver at the hole through loop.update.
      await g(page, () => {
        const w = window.__wbGame;
        const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
        w.loop.tryPickup();
        w.carried.update(0.3, w.loop.buildCarryCtx());
        w.controller.teleport(w.meadow.anthill.holePos.x, w.meadow.anthill.holePos.z, 0);
      });
      d = await waitSimUntil((s) => s.d.counts.deposit >= 1, 3, "deposit");
      assert(await g(page, () => window.__wbGame.loop.deposited) === 1, "deposit finalize did not count the grain");

      // launch: stand on a live spring-seed pad; the sprout launches for real.
      await g(page, () => {
        const w = window.__wbGame;
        const s = w.springSeeds.seeds[0];
        w.controller.teleport(s.pos.x, s.pos.z, 0);
      });
      d = await waitSimUntil((s) => s.d.counts.launch >= 1, 4, "launch");

      // sting: the live snatch site — bait the ant, stage a chase at 0.4 u.
      await g(page, () => {
        const w = window.__wbGame;
        w.controller.teleport(0, 2.4, 0);
        w.hopper.stageDefault();
      });
      for (let i = 0; i < 120; i++) {
        if (await g(page, () => window.__wbGame.controller.grounded)) break;
        await waitFrames(page, 1);
      }
      await g(page, () => {
        const w = window.__wbGame;
        // Staging the bait must NOT schedule sound — only the LIVE steal may.
        w.loop.stage({ carryHeld: true });
        const a = w.controller.position;
        const bx = a.x + Math.sin(0.8) * 0.4;
        const bz = a.z + Math.cos(0.8) * 0.4;
        w.hopper.stage({
          x: bx,
          z: bz,
          yaw: Math.atan2(a.x - bx, a.z - bz),
          state: "chase",
          stateT: 0.1,
          speed: 3.9,
          suspicion: 1,
        });
      });
      d = await g(page, () => window.__wbGame.audio.debug());
      assert(count(d, "sting") === 0, `staging scheduled a sting (count ${count(d, "sting")})`);
      d = await waitSimUntil((s) => s.d.counts.sting >= 1, 4, "sting");

      // win: the LIVE quota finish — 5 staged + the 6th grain carried home.
      await g(page, () => {
        const w = window.__wbGame;
        w.hopper.stageDefault();
        w.loop.stage({ deposited: 5, carryHeld: true });
        w.controller.teleport(w.meadow.anthill.holePos.x, w.meadow.anthill.holePos.z, 0);
      });
      d = await waitSimUntil((s) => s.d.counts.win >= 1, 4, "win stinger");
      assert(await g(page, () => window.__wbGame.loop.deposited) === 6, "win fired before the 6th grain landed");
      for (let i = 0; i < 400; i++) {
        if (await g(page, () => window.__wbGame.mode) === "results") break;
        await waitFrames(page, 1);
      }

      // lose: let the day clock run out live.
      await g(page, () => {
        const w = window.__wbGame;
        w.restartDay();
        w.hopper.stageDefault();
        w.loop.stage({ dayElapsed: 359.6 });
      });
      d = await waitSimUntil((s) => s.d.counts.lose >= 1, 3, "lose stinger");

      // Timing: rolling step cost with the graph LIVE and firing vs audio
      // disabled — the delta must sit far inside one fixed step (16.67 ms).
      const stepOn = await g(page, () => window.__wbGame.stepMs);
      await g(page, () => {
        const w = window.__wbGame;
        w.restartDay();
        w.hopper.stageDefault();
        w.audio.setEnabled(false);
      });
      await waitFrames(page, 150); // the EMA converges over ~2.5 s of steps
      const stepOff = await g(page, () => window.__wbGame.stepMs);
      const dOff = await g(page, () => {
        const dd = window.__wbGame.audio.debug();
        return { state: dd.state, sfxTotal: dd.sfxTotal };
      });
      assert(dOff.state === "disabled", `state after setEnabled(false) is ${dOff.state}`);
      assert(dOff.sfxTotal === d.sfxTotal, "setEnabled(false) did not freeze scheduling immediately");
      assert(Math.abs(stepOn - stepOff) <= 1.0,
        `step cost moved ${Math.abs(stepOn - stepOff).toFixed(3)} ms with audio live (${stepOn.toFixed(3)} → ${stepOff.toFixed(3)})`);
      assert(stepOn <= 16.0 && stepOff <= 16.0,
        `sim step itself too slow: on ${stepOn.toFixed(2)} ms / off ${stepOff.toFixed(2)} ms`);
      return `all 8 events schedule exactly once (ui 2×); staging silent; step ${stepOn.toFixed(3)} ms live vs ${stepOff.toFixed(3)} ms disabled (Δ ≤ 1 ms « one step)`;
    },
  },

  {
    name: "audio-music",
    run: async (page) => {
      // Unlock ON the title with a click that is not START, so the 30 s run
      // below spans the title→day transition with the bed already alive.
      await page.click("#btn-howto-title");
      await page.click("#btn-howto-back");
      const started = await g(page, () => {
        const d = window.__wbGame.audio.debug();
        return { state: d.state, gen: d.bed.generation };
      });
      assert(started.state === "running" && started.gen === 1, `bed not alive on title (${started.state}, gen ${started.gen})`);

      // ~30 s wall run: sample the bed between frames (SwiftShader frames are
      // slow — the wall clock, not frame counts, is the honest ruler here);
      // START lands ~8 s in.
      const samples = [];
      const t0 = Date.now();
      let dayStarted = false;
      while (Date.now() - t0 < 30000) {
        if (!dayStarted && Date.now() - t0 >= 8000) {
          await page.click("#btn-start");
          dayStarted = true;
        }
        samples.push(
          await g(page, () => {
            const w = window.__wbGame;
            const d = w.audio.debug();
            return {
              wall: Date.now(),
              mode: w.mode,
              notes: d.bed.notes,
              nextIn: d.bed.nextIn,
              gen: d.bed.generation,
              drone: d.bed.drone,
              scheduler: d.bed.scheduler,
              gains: d.gains,
            };
          }),
        );
        await waitFrames(page, 3);
      }
      assert(samples.length >= 12, `only ${samples.length} bed samples in 30 s`);
      assert(dayStarted, "the title→day transition never happened");
      assert(
        samples.some((s) => s.mode === "title") && samples.some((s) => s.mode === "playing"),
        `run did not span both sides of the transition (${samples.map((s) => s.mode).join(",")})`,
      );
      // Continuity: the scheduler never stops filling; the drone stays up;
      // generation NEVER increments (no rebuild at the day start).
      for (const s of samples) {
        assert(s.scheduler, `scheduler died at ${((s.wall - t0) / 1000).toFixed(1)} s`);
        assert(s.drone, `drone died at ${((s.wall - t0) / 1000).toFixed(1)} s`);
        assert(s.gen === 1, `bed generation moved to ${s.gen} (music restarted)`);
        assert(s.nextIn <= 1.25, `scheduling gap ${s.nextIn.toFixed(2)} s beyond the lookahead at ${((s.wall - t0) / 1000).toFixed(1)} s`);
      }
      // Notes keep flowing across the transition: every ≥2.5 s window gains
      // notes, and the run total is well past sparse.
      const first = samples[0];
      const last = samples[samples.length - 1];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].wall - samples[i - 1].wall >= 2500) {
          assert(
            samples[i].notes > samples[i - 1].notes,
            `no notes scheduled between ${((samples[i - 1].wall - t0) / 1000).toFixed(1)} s and ${((samples[i].wall - t0) / 1000).toFixed(1)} s`,
          );
        }
      }
      const total = last.notes - first.notes;
      assert(total >= 25, `bed scheduled only ${total} notes over 30 s`);
      // Bus continuity across the transition (music on by default).
      for (const s of samples) {
        if (s.gains) {
          assert(Math.abs(s.gains.music - 0.16) < 0.02, `music bus gain ${s.gains.music} mid-run`);
          assert(Math.abs(s.gains.master - 0.9) < 0.02, `master gain ${s.gains.master} mid-run`);
        }
      }
      return `30 s across title→day: ${total} notes, generation pinned at 1, scheduler/drone continuous (worst gap ${Math.max(...samples.map((s) => s.nextIn)).toFixed(2)} s), buses steady`;
    },
  },

  {
    name: "audio-toggles",
    touch: true,
    run: async (page, cdp) => {
      // Fresh storage boots BOTH buses on; the title toggles mirror that.
      const boot = await g(page, () => {
        const audio = window.__wbGame.audio;
        return {
          music: audio.musicEnabled,
          sfx: audio.sfxEnabled,
          m: document.getElementById("tgl-music").getAttribute("aria-pressed"),
          s: document.getElementById("tgl-sfx").getAttribute("aria-pressed"),
        };
      });
      assert(boot.music === true && boot.sfx === true, `fresh boot choices ${JSON.stringify(boot)}`);
      assert(boot.m === "true" && boot.s === "true", `fresh boot aria-pressed ${boot.m}/${boot.s}`);

      // MUSIC off, SFX on (real clicks = gestures): keys write through.
      await page.click("#tgl-music");
      await page.click("#tgl-sfx");
      await page.click("#tgl-sfx");
      const toggled = await g(page, () => {
        const audio = window.__wbGame.audio;
        return {
          music: audio.musicEnabled,
          sfx: audio.sfxEnabled,
          m: document.getElementById("tgl-music").getAttribute("aria-pressed"),
          s: document.getElementById("tgl-sfx").getAttribute("aria-pressed"),
          kM: localStorage.getItem("wb.audio.music"),
          kS: localStorage.getItem("wb.audio.sfx"),
        };
      });
      assert(toggled.music === false && toggled.sfx === true, `toggled choices ${JSON.stringify(toggled)}`);
      assert(toggled.m === "false" && toggled.s === "true", `toggled aria-pressed ${toggled.m}/${toggled.s}`);
      assert(toggled.kM === "false" && toggled.kS === "true", `stored keys ${toggled.kM}/${toggled.kS}`);

      // Start the day: the persisted choices apply to the BUS GAINS.
      await page.click("#btn-start");
      await waitFrames(page, 14); // the 50 ms gain ramp settles
      const gains = await g(page, () => {
        const d = window.__wbGame.audio.debug();
        return { state: d.state, gains: d.gains };
      });
      assert(gains.state === "running", `state after start is ${gains.state}`);
      assert(
        gains.gains.music === 0 && Math.abs(gains.gains.sfx - 1) < 0.02 && Math.abs(gains.gains.master - 0.9) < 0.02,
        `bus gains with music off / sfx on: ${JSON.stringify(gains.gains)}`,
      );

      // Music stays SILENT (no plucks) while sfx still schedules.
      const notes0 = await g(page, () => window.__wbGame.audio.debug().bed.notes);
      await waitFrames(page, 90);
      const silent = await g(page, () => {
        const d = window.__wbGame.audio.debug();
        return { notes: d.bed.notes, nextIn: d.bed.nextIn };
      });
      assert(silent.notes === notes0, `muted music still scheduled notes (${notes0} → ${silent.notes})`);
      assert(silent.nextIn <= 1.25, "muted music froze the pattern clock (nextIn stuck)");
      await g(page, () => {
        const w = window.__wbGame;
        w.hopper.stageDefault();
        const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
        w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
        w.loop.tryPickup();
      });
      await waitFrames(page, 3);
      const pick = await g(page, () => {
        const d = window.__wbGame.audio.debug();
        return { pickup: d.counts.pickup ?? 0, sfx: d.gains.sfx, music: d.gains.music };
      });
      assert(pick.pickup === 1, `pickup did not schedule on the sfx bus (${pick.pickup})`);
      assert(pick.music === 0 && Math.abs(pick.sfx - 1) < 0.02, "bus gains drifted during the pickup");

      // In-run session mute (the speaker control next to pause): master → 0,
      // stored keys untouched.
      const mute = await widgetCenter(page, "tc-mute");
      assert(mute.w >= 44 && mute.h >= 44, `mute control is ${mute.w}x${mute.h}, needs ≥44x44`);
      await cdpTap(cdp, mute.x, mute.y);
      await waitFrames(page, 10);
      const muted = await g(page, () => {
        const d = window.__wbGame.audio.debug();
        const b = document.getElementById("tc-mute");
        return {
          master: d.gains.master,
          muted: d.muted,
          pressed: b.getAttribute("aria-pressed"),
          cls: b.classList.contains("muted"),
          kM: localStorage.getItem("wb.audio.music"),
          kS: localStorage.getItem("wb.audio.sfx"),
        };
      });
      assert(muted.muted && muted.pressed === "true" && muted.cls, `mute control state ${JSON.stringify(muted)}`);
      assert(muted.master === 0, `master gain after session mute is ${muted.master}`);
      assert(muted.kM === "false" && muted.kS === "true", `session mute rewrote stored keys: ${muted.kM}/${muted.kS}`);

      // Reload: boot state comes from the PERSISTED toggles; the mute is gone.
      await reloadFresh(page);
      const after = await g(page, () => {
        const audio = window.__wbGame.audio;
        const d = audio.debug();
        return {
          music: audio.musicEnabled,
          sfx: audio.sfxEnabled,
          muted: d.muted,
          state: d.state,
          kM: localStorage.getItem("wb.audio.music"),
          kS: localStorage.getItem("wb.audio.sfx"),
          m: document.getElementById("tgl-music").getAttribute("aria-pressed"),
          s: document.getElementById("tgl-sfx").getAttribute("aria-pressed"),
        };
      });
      assert(after.music === false && after.sfx === true, `post-reload choices ${JSON.stringify(after)}`);
      assert(after.muted === false, "session mute survived a reload (it must not)");
      assert(after.state === "idle", `post-reload state ${after.state} (no gesture yet)`);
      assert(after.m === "false" && after.s === "true", `post-reload aria-pressed ${after.m}/${after.s}`);
      assert(after.kM === "false" && after.kS === "true", `post-reload keys ${after.kM}/${after.kS}`);
      return `music off + sfx on persist (keys false/true), boot applies gains 0/1; pickup schedules while bed silent; session mute → master 0, keys untouched, gone after reload`;
    },
  },

  {
    name: "audio-isolation",
    run: async (page, _cdp, browser) => {
      await page.close().catch(() => undefined);
      /**
       * One capture recipe, three audio conditions: boot at the baseline
       * viewport, START the day with a REAL click (the only difference sits
       * in the audio system), let transient puffs die, then pin + grab `run`.
       */
      const captureRun = async ({ stubAudio = false, disable = false, withProblems = false } = {}) => {
        const context = await browser.newContext({
          viewport: { width: 1600, height: 900 },
          deviceScaleFactor: 1,
        });
        const p = await context.newPage();
        await seedTaught(p);
        const problems = [];
        if (withProblems) {
          p.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
          p.on("console", (msg) => {
            if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
          });
        }
        if (stubAudio) {
          await p.addInitScript(() => {
            const Boom = class {
              constructor() {
                throw new Error("stubbed: audio unsupported");
              }
            };
            window.AudioContext = Boom;
            window.webkitAudioContext = Boom;
          });
        }
        await p.goto(`${url}?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
        await p.waitForFunction(() => window.__wb?.ready === true, null, { timeout: 60000 });
        if (disable) await g(p, () => window.__wbGame.audio.setEnabled(false));
        await p.click("#btn-start"); // the gesture — identical recipe all runs
        await waitFrames(p, 30); // let any live-day puff die before the pin
        const audioState = await g(p, () => {
          const d = window.__wbGame.audio.debug();
          return { state: d.state, created: d.contextCreated, connected: d.connected, notes: d.bed.notes };
        });
        await g(p, () => window.__wb.shot("run"));
        const dataUrl = await g(p, () => window.__wb.grab());
        await p.close();
        await context.close();
        return {
          png: Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"),
          audioState,
          problems,
        };
      };

      // Enabled: the graph is LIVE (context up, bed scheduling) during capture.
      const enabled = await captureRun({ withProblems: true });
      assert(enabled.audioState.state === "running" && enabled.audioState.connected,
        `enabled run did not capture with a live graph: ${JSON.stringify(enabled.audioState)}`);
      assert(enabled.audioState.notes >= 1, "enabled run captured with an empty bed");

      // Disabled: setEnabled(false) BEFORE any gesture — the context never exists.
      const disabled = await captureRun({ disable: true });
      assert(disabled.audioState.state === "disabled" && disabled.audioState.created === false,
        `disabled run state ${JSON.stringify(disabled.audioState)}`);

      // Unsupported: constructing an AudioContext throws from the very boot.
      const unsupported = await captureRun({ stubAudio: true, withProblems: true });
      assert(unsupported.audioState.state === "unsupported" && unsupported.audioState.created === false,
        `unsupported run state ${JSON.stringify(unsupported.audioState)}`);
      assert(unsupported.problems.length === 0,
        `unsupported browser produced console errors: ${unsupported.problems.join(" | ")}`);

      // Pairwise byte equality — rendering is audio-blind.
      assert(enabled.png.equals(disabled.png), "run capture differs between audio enabled and disabled");
      assert(enabled.png.equals(unsupported.png), "run capture differs between audio enabled and unsupported");
      assert(disabled.png.equals(unsupported.png), "run capture differs between audio disabled and unsupported");
      // And the enabled capture still matches the pinned baseline.
      const base = readFileSync(path.join(root, "shots", "baseline", "run.png"));
      assert(enabled.png.equals(base), "audio-enabled run capture differs from shots/baseline/run.png");
      return `run capture byte-identical across enabled (live graph, ${enabled.audioState.notes} bed notes) / disabled / unsupported; zero console errors under unsupported; matches baseline`;
    },
  },

  {
    name: "spec-walk",
    run: async (page, _cdp, browser) => {
      /**
       * Task 9.4 — the acceptance gate. Executes EVERY scenario in the five
       * delta specs end-to-end (game-flow 6 req / input-schemes 5 / onboarding
       * 3 / hud-presentation 4 / audio 5) and records PASS/FAIL + evidence per
       * scenario id. Fails the section (after running everything) if any
       * scenario failed. Where an existing probe section proves a scenario,
       * the driving logic is re-executed here fresh — this is not a re-run of
       * those sections, it is a spec-ordered walk over the same seams.
       */
      const rows = [];
      const scen = async (req, id, title, fn) => {
        process.stdout.write(`walk ${req}.${id} ${title} … `);
        let pass = true;
        let ev = "ok";
        try {
          ev = (await fn()) ?? "ok";
        } catch (err) {
          pass = false;
          ev = err.message.split("\n")[0];
        }
        console.log(pass ? "PASS" : "FAIL");
        rows.push({ req, id, title, pass, ev: String(ev) });
      };

      // --- Phase A: the runner's fresh desktop page (taught save) -----------

      // AU4a silent boot: BEFORE any gesture, the audio system is inert and
      // the console is clean (autoplay policy respected from the first frame).
      await scen("audio", "AU4a", "Silent boot is clean", async () => {
        const boot = await g(page, () => {
          const d = window.__wbGame.audio.debug();
          return { state: d.state, created: d.contextCreated, gains: d.gains };
        });
        assert(boot.state === "idle", `audio state at boot is ${boot.state}, expected "idle"`);
        assert(boot.created === false, "AudioContext created before any gesture");
        assert(boot.gains === null, "graph gains exist before any gesture");
        return "state idle, no context, no gains, page error log empty";
      });

      // GF1a fresh boot shows title, not a live day.
      let bootT = 0;
      await scen("game-flow", "GF1a", "Fresh boot shows title, not a live day", async () => {
        const s0 = await g(page, () => {
          const w = window.__wbGame;
          return {
            mode: w.mode,
            on: document.getElementById("screen-title").classList.contains("on"),
            t: w.dayCycle.getTime(),
            e: w.loop.dayElapsed,
            hopState: w.hopper.state,
            threat: w.hopper.threatLevel,
            hop: [w.hopper.position.x, w.hopper.position.z],
          };
        });
        assert(s0.mode === "title" && s0.on, `boot mode/screen: ${s0.mode}/${s0.on}`);
        assert(s0.e === 0, `dayElapsed on title is ${s0.e}`);
        assert(s0.hopState !== "chase" && s0.hopState !== "snatch", `enemy state ${s0.hopState} on title`);
        assert(s0.threat === 0, `threatLevel ${s0.threat} on title`);
        bootT = s0.t;
        await waitFrames(page, 60);
        const s1 = await g(page, () => {
          const w = window.__wbGame;
          return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, hop: [w.hopper.position.x, w.hopper.position.z] };
        });
        assert(s1.t === s0.t, `sun advanced on title: ${s0.t} -> ${s1.t}`);
        assert(s1.e === 0, `day timer advanced on title`);
        assert(s1.hop[0] === s0.hop[0] && s1.hop[1] === s0.hop[1], "enemy moved on title");
        const plaque = await hudPlaquePixels(page);
        assert(plaque <= 10, `quota HUD active on title (${plaque} opaque px in plaque region)`);
        return `sun held at ${s0.t.toFixed(4)}, timer 0, hopper parked, quota HUD dark (${plaque} px)`;
      });

      // GF1b starting begins day one at dawn.
      await scen("game-flow", "GF1b", "Starting begins day one at dawn", async () => {
        await page.click("#btn-start");
        await waitFrames(page, 10);
        const s = await g(page, () => {
          const w = window.__wbGame;
          return { mode: w.mode, t: w.dayCycle.getTime(), dep: w.loop.deposited, e: w.loop.dayElapsed };
        });
        assert(s.mode === "playing", `mode after START is ${s.mode}`);
        assert(s.dep === 0, `quota after START is ${s.dep}`);
        assert(s.t >= bootT && s.t < bootT + 0.05, `sun not at dawn after START: ${s.t} vs ${bootT}`);
        assert(s.e > 0, `day timer not running (${s.e})`);
        // The ant answers the player: W moves it.
        const p0 = await pose(page);
        await page.keyboard.down("KeyW");
        await waitFrames(page, 15);
        await page.keyboard.up("KeyW");
        const p1 = await pose(page);
        const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        assert(d > 0.05, `ant did not respond to W after START (d=${d.toFixed(4)})`);
        return `fresh day: quota 0, sun at dawn (${s.t.toFixed(4)}), timer ${s.e.toFixed(2)}s, ant moved ${d.toFixed(2)}u`;
      });

      // GF2b keyboard pause keys work.
      await scen("game-flow", "GF2b", "Keyboard pause keys work", async () => {
        for (const key of ["Escape", "KeyP"]) {
          await page.keyboard.press(key);
          await waitFrames(page, 3);
          const s = await g(page, () => ({
            mode: window.__wbGame.mode,
            menu: document.getElementById("screen-pause").classList.contains("on"),
            btns: [...document.querySelectorAll("#screen-pause.on button")].length,
          }));
          assert(s.mode === "paused" && s.menu, `${key} did not pause (mode ${s.mode}, menu ${s.menu})`);
          assert(s.btns === 4, `pause menu shows ${s.btns} actions`);
          await g(page, () => {
            window.__wbGame.resume();
            window.__wbGame.resume();
          });
          await waitFrames(page, 2);
        }
        return "Esc and KeyP each freeze the day and open the 4-action menu";
      });

      // GF3a the sun holds while paused.
      await scen("game-flow", "GF3a", "The sun holds while paused", async () => {
        await g(page, () => window.__wbGame.pause());
        const s0 = await g(page, () => {
          const w = window.__wbGame;
          return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, r: w.loop.remaining };
        });
        await waitFrames(page, 40);
        const s1 = await g(page, () => {
          const w = window.__wbGame;
          return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, r: w.loop.remaining };
        });
        assert(s1.t === s0.t, `sun moved while paused: ${s0.t} -> ${s1.t}`);
        assert(s1.e === s0.e && s1.r === s0.r, `daylight moved while paused: ${s0.e}/${s0.r} -> ${s1.e}/${s1.r}`);
        await g(page, () => {
          window.__wbGame.resume();
          window.__wbGame.resume();
        });
        return `sun + daylight identical across the pause (t ${s0.t.toFixed(5)}, remaining ${s0.r.toFixed(2)}s)`;
      });

      // GF3b restart from pause resets the day.
      await scen("game-flow", "GF3b", "Restart from pause resets the day", async () => {
        const base = await g(page, () => {
          const w = window.__wbGame;
          return { idle: w.meadow.grains.idleCount, hx: w.hopper.position.x, hz: w.hopper.position.z, hs: w.hopper.state };
        });
        // Prove the reset is real: let the hopper leave its perch first.
        let moved = false;
        for (let i = 0; i < 20 && !moved; i++) {
          await waitFrames(page, 20);
          moved = await g(page, (b) => {
            const h = window.__wbGame.hopper;
            return Math.hypot(h.position.x - b.hx, h.position.z - b.hz) > 0.01 || h.state !== b.hs;
          }, base);
        }
        // Stage mid-day state: carry a grain, 3 deposited, then pause.
        await g(page, () => {
          const w = window.__wbGame;
          const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
          w.controller.teleport(node.pos.x, node.pos.z, 0);
          w.loop.tryPickup();
          w.carried.update(0.3, w.loop.buildCarryCtx());
          w.pause();
          w.loop.stage({ deposited: 3, dayElapsed: 60 });
        });
        await page.click("#btn-restart");
        // Read immediately: restartDay parks the hopper at route[0] in the
        // same task, and the FIRST patrol hop can launch within a couple of
        // SwiftShader frames — a delayed read would catch it mid-hop (the
        // restart-quit section reads the same way).
        const post = await g(page, () => {
          const w = window.__wbGame;
          return {
            mode: w.mode, dep: w.loop.deposited, e: w.loop.dayElapsed, idle: w.meadow.grains.idleCount,
            hx: w.hopper.position.x, hz: w.hopper.position.z, hs: w.hopper.state, carried: w.carried.mode,
          };
        });
        assert(post.mode === "playing", `mode after restart is ${post.mode}`);
        assert(post.dep === 0 && post.e < 1.0, `not a fresh day: dep ${post.dep}, elapsed ${post.e}`);
        assert(post.idle === base.idle, `grains not respawned: ${base.idle} -> ${post.idle}`);
        assert(post.carried === "hidden", `carried grain survived restart: ${post.carried}`);
        // "Enemy reset" = a fresh day-start state: parked at seeded waypoint
        // 0 of a freshly built route, patrolling, no threat. (The boot-frame
        // perch drifts slightly in the first unheld frames, so the honest
        // reference is the hopper's own day-start waypoint, not the boot
        // snapshot.)
        const hop = await g(page, () => {
          const h = window.__wbGame.hopper;
          return {
            x: h.position.x, z: h.position.z, s: h.state, threat: h.threatLevel,
            idx: h.routeIdx, w0: { x: h.route[0].x, z: h.route[0].z },
          };
        });
        assert(hop.s === "patrol" && hop.threat === 0, `enemy not calm after restart: ${hop.s}/${hop.threat}`);
        assert(
          hop.idx === 0 && Math.hypot(hop.x - hop.w0.x, hop.z - hop.w0.z) < 1e-6,
          `enemy not reset to day-start waypoint 0: (${hop.x.toFixed(2)}, ${hop.z.toFixed(2)}) vs (${hop.w0.x.toFixed(2)}, ${hop.w0.z.toFixed(2)})`,
        );
        return `3/6 → 0/6, grains ${post.idle}, hopper reset${moved ? " (was away from perch)" : ""}, carried cleared`;
      });

      // GF3c quit to title ends the day.
      await scen("game-flow", "GF3c", "Quit to title ends the day", async () => {
        await g(page, () => window.__wbGame.pause());
        await page.click("#btn-quit");
        await waitFrames(page, 2);
        const q0 = await g(page, () => {
          const w = window.__wbGame;
          return { mode: w.mode, on: document.getElementById("screen-title").classList.contains("on"), t: w.dayCycle.getTime() };
        });
        assert(q0.mode === "title" && q0.on, `quit left mode ${q0.mode} (title on: ${q0.on})`);
        await waitFrames(page, 40);
        const q1 = await g(page, () => window.__wbGame.dayCycle.getTime());
        assert(q1 === q0.t, `sun advanced on title after quit: ${q0.t} -> ${q1}`);
        await page.click("#btn-start");
        await waitFrames(page, 5);
        const fresh = await g(page, () => {
          const w = window.__wbGame;
          return { mode: w.mode, dep: w.loop.deposited, e: w.loop.dayElapsed };
        });
        assert(fresh.mode === "playing" && fresh.dep === 0, `restart from title not fresh: ${JSON.stringify(fresh)}`);
        return "title restored, day dead (sun held), next start is a fresh day";
      });

      // GF4a tab return does not kill.
      await scen("game-flow", "GF4a", "Tab return does not kill", async () => {
        await waitFrames(page, 10);
        const e0 = await g(page, () => window.__wbGame.loop.dayElapsed);
        await g(page, () => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        const v0 = await g(page, () => ({ m: window.__wbGame.mode, e: window.__wbGame.loop.dayElapsed }));
        assert(v0.m === "paused", `hide left mode ${v0.m}`);
        assert(v0.e === e0, `day advanced across hide: ${e0} -> ${v0.e}`);
        await g(page, () => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        assert(await g(page, () => window.__wbGame.mode) === "paused", "unhide auto-resumed");
        // Resume enters the grace; the day stays frozen through the countdown.
        const gr = await g(page, () => {
          const w = window.__wbGame;
          w.resume();
          return { m: w.mode, gr: w.graceRemaining, e: w.loop.dayElapsed };
        });
        assert(gr.m === "paused" && gr.gr > 0, `no grace after return: ${JSON.stringify(gr)}`);
        for (let i = 0; i < 3; i++) {
          await waitFrames(page, 1);
          const s = await g(page, () => ({ m: window.__wbGame.mode, e: window.__wbGame.loop.dayElapsed }));
          assert(s.m === "paused" && s.e === e0, `sim stepped during grace (frame ${i + 1}): ${s.m}/${s.e}`);
        }
        return `hide → paused at ${e0.toFixed(2)}s, frozen through the grace countdown`;
      });

      // GF4b impatient player can skip the wait.
      await scen("game-flow", "GF4b", "Impatient player can skip the wait", async () => {
        await g(page, () => window.__wbGame.resume());
        const s = await g(page, () => ({ m: window.__wbGame.mode, gr: window.__wbGame.graceRemaining }));
        assert(s.m === "playing" && s.gr === 0, `mid-grace resume left ${s.m}/${s.gr}`);
        await waitFrames(page, 3);
        const e1 = await g(page, () => window.__wbGame.loop.dayElapsed);
        assert(e1 > 0, "day not live after skip");
        // Prove it again from a deliberate pause.
        await g(page, () => window.__wbGame.pause());
        await g(page, () => window.__wbGame.resume());
        const mid = await g(page, () => window.__wbGame.graceRemaining);
        assert(mid > 0, `no grace on re-entry (${mid})`);
        await g(page, () => window.__wbGame.resume());
        assert(await g(page, () => window.__wbGame.mode) === "playing", "second skip did not resume");
        return `resume mid-count skips straight to live play (was ${mid.toFixed(2)}s from done)`;
      });

      // GF5a winning day shows the celebration with stats.
      await scen("game-flow", "GF5a", "Winning day shows the celebration with stats", async () => {
        await g(page, () => {
          const w = window.__wbGame;
          w.loop.stage({ phase: "win", phaseT: 1.2, deposited: 6, dayElapsed: 95 });
          w.mode = "results";
        });
        await waitFrames(page, 4);
        const win = await g(page, () => ({
          on: document.getElementById("screen-win").classList.contains("on"),
          lose: document.getElementById("screen-lose").classList.contains("on"),
          grains: document.getElementById("win-grains").textContent,
          time: document.getElementById("win-time").textContent,
          tease: document.querySelector("#screen-win .tease").textContent,
          again: !!document.getElementById("btn-again-win"),
          title: !!document.getElementById("btn-title-win"),
        }));
        assert(win.on && !win.lose, "win did not show the results screen");
        assert(win.grains === "6 / 6", `win stats: "${win.grains}"`);
        assert(win.time === "1:35", `win elapsed: "${win.time}"`);
        assert(/Day 2/.test(win.tease), `next-day tease missing: "${win.tease}"`);
        assert(win.again && win.title, "win controls missing");
        await page.click("#btn-again-win");
        await waitFrames(page, 2);
        const again = await g(page, () => {
          const w = window.__wbGame;
          return { mode: w.mode, dep: w.loop.deposited };
        });
        assert(again.mode === "playing" && again.dep === 0, `FORAGE AGAIN not fresh: ${JSON.stringify(again)}`);
        return `victory: 6/6 + 1:35 + "${win.tease.trim()}", one-touch again/title`;
      });

      // GF5b losing day shows the shortfall.
      await scen("game-flow", "GF5b", "Losing day shows the shortfall", async () => {
        await g(page, () => {
          const w = window.__wbGame;
          w.loop.stage({ phase: "lose", phaseT: 2.4, deposited: 3, dayElapsed: 360, duskDim: 1 });
          w.mode = "results";
        });
        await waitFrames(page, 4);
        const lose = await g(page, () => ({
          on: document.getElementById("screen-lose").classList.contains("on"),
          win: document.getElementById("screen-win").classList.contains("on"),
          grains: document.getElementById("lose-grains").textContent,
          time: document.getElementById("lose-time").textContent,
          cls: document.getElementById("screen-lose").className,
        }));
        assert(lose.on && !lose.win, "lose did not show the results screen");
        assert(lose.grains === "3 / 6", `shortfall stat: "${lose.grains}"`);
        assert(lose.time === "6:00", `lose elapsed: "${lose.time}"`);
        assert(lose.cls.includes("s-lose") && !lose.cls.includes("s-win"), "lose shares the win presentation");
        await page.click("#btn-title-lose");
        await waitFrames(page, 2);
        assert(await g(page, () => window.__wbGame.mode) === "title", "TITLE did not return to title");
        return `defeat: 3 / 6 shortfall + 6:00, own presentation, one-touch again/title`;
      });

      // GF6a pinned capture of a shell state is byte-stable.
      await scen("game-flow", "GF6a", "Pinned capture of a shell state", async () => {
        for (const name of ["title", "paused", "results-win"]) {
          await driveShellState(page, name);
          await pinAndPair(page, name);
        }
        return "title + paused + results-win pinned pairs byte-identical (2 consecutive captures each)";
      });

      // IS4a desktop controls regression.
      await scen("input-schemes", "IS4a", "Desktop controls regression", async () => {
        await reloadFresh(page);
        await page.click("#btn-start");
        await g(page, () => window.__wbGame.hopper.stageDefault());
        await waitFrames(page, 8);
        // Move keys.
        let p0 = await pose(page);
        await page.keyboard.down("KeyW");
        await waitFrames(page, 25);
        const pW = await pose(page);
        await page.keyboard.up("KeyW");
        await waitFrames(page, 20);
        assert(pW.z - p0.z > 0.3 && Math.abs(pW.x - p0.x) < 0.25, `W moved ${JSON.stringify(pW)} vs ${JSON.stringify(p0)}`);
        // Sprint.
        const walkTarget = await targetSpeed(page, false);
        const runTarget = await targetSpeed(page, true);
        await page.keyboard.down("KeyW");
        await waitFrames(page, 35);
        const walkSpeed = await sampleMaxSpeed(page, 5);
        await page.keyboard.down("ShiftLeft");
        await waitFrames(page, 40);
        const runSpeed = await sampleMaxSpeed(page, 5);
        await page.keyboard.up("ShiftLeft");
        await page.keyboard.up("KeyW");
        await waitFrames(page, 20);
        assert(Math.abs(walkSpeed - walkTarget) < 0.55, `walk ${walkSpeed.toFixed(2)} vs ${walkTarget.toFixed(2)}`);
        assert(runSpeed > runTarget - 0.6 && runSpeed > walkSpeed + 1.0, `sprint ${runSpeed.toFixed(2)} vs ${runTarget.toFixed(2)}`);
        // Jump.
        await page.keyboard.down("Space");
        let airborne = false;
        for (let i = 0; i < 14 && !airborne; i++) {
          await waitFrames(page, 1);
          airborne = await g(page, () => {
            const c = window.__wbGame.controller;
            return !c.grounded || c.position.y - c.groundY > 0.02;
          });
        }
        await page.keyboard.up("Space");
        assert(airborne, "Space never left the ground");
        await waitFrames(page, 70);
        assert(await g(page, () => window.__wbGame.controller.grounded), "no landing after Space");
        // Pickup + throw. The hopper re-parks before each beat: it keeps
        // patrolling during the long keyboard sequence above and a live thief
        // can cross the field and snatch mid-collect (walk-only flake —
        // keyboard-regression's shorter beats never see it).
        const idle0 = await g(page, () => {
          const w = window.__wbGame;
          w.hopper.stageDefault();
          const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
          w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
          return w.meadow.grains.idleCount;
        });
        await page.keyboard.press("KeyE");
        await waitFrames(page, 25);
        const pick = await g(page, () => ({ mode: window.__wbGame.carried.mode, idle: window.__wbGame.meadow.grains.idleCount }));
        assert(pick.mode === "held" && pick.idle === idle0 - 1, `E pickup: ${JSON.stringify(pick)}`);
        await g(page, () => window.__wbGame.hopper.stageDefault());
        await page.keyboard.press("KeyF");
        await waitFrames(page, 1);
        assert(await g(page, () => window.__wbGame.carried.mode) === "flight", "F did not throw");
        await waitFrames(page, 200);
        const thrown = await g(page, () => ({ mode: window.__wbGame.carried.mode, loose: window.__wbGame.meadow.grains.looseCount }));
        assert(thrown.mode === "hidden" && thrown.loose === 1, `F settle: ${JSON.stringify(thrown)}`);
        // Camera keys / drag / wheel.
        const yaw0 = await g(page, () => window.__wbGame.followCam.yaw);
        await page.keyboard.down("KeyQ");
        await waitFrames(page, 30);
        await page.keyboard.up("KeyQ");
        const yawQ = await g(page, () => window.__wbGame.followCam.yaw);
        assert(yawQ - yaw0 > 0.4, `Q orbit ${(yawQ - yaw0).toFixed(3)}`);
        await page.mouse.move(640, 360);
        await page.mouse.down();
        await page.mouse.move(740, 360, { steps: 8 });
        await page.mouse.up();
        await waitFrames(page, 4);
        const yawD = await g(page, () => ({ y: window.__wbGame.followCam.yaw, mv: window.__wbGame.input.move.length() }));
        assert(Math.abs(yawD.y - yawQ) > 0.3, `mouse drag orbit ${(yawD.y - yawQ).toFixed(3)}`);
        assert(yawD.mv === 0, "mouse drag wrote move intent");
        const d0 = await camDist(page);
        await page.mouse.wheel(0, 240);
        await waitFrames(page, 45);
        const d1 = await camDist(page);
        assert(d1 - d0 > 0.35, `wheel zoom ${(d1 - d0).toFixed(3)}`);
        // Confirm routing.
        await g(page, () => {
          const w = window.__wbGame;
          w.loop.stage({ phase: "win", phaseT: 1.2, deposited: 6, dayElapsed: 95 });
          w.mode = "results";
        });
        await waitFrames(page, 6);
        await page.keyboard.press("Enter");
        await waitFrames(page, 6);
        const after = await g(page, () => ({ mode: window.__wbGame.mode, dep: window.__wbGame.loop.deposited }));
        assert(after.mode === "playing" && after.dep === 0, `Enter confirm: ${JSON.stringify(after)}`);
        return `W/Shift/Space/E/F/Q/wheel/drag/Enter all behave; walk ${walkSpeed.toFixed(2)} → sprint ${runSpeed.toFixed(2)} u/s`;
      });

      // IS5b desktop shows key wording only.
      await scen("input-schemes", "IS5b", "Desktop shows key wording only", async () => {
        await reloadFresh(page);
        const fine = await g(page, () => {
          const w = window.__wbGame;
          return {
            boot: w.scheme.get(),
            hint: document.querySelector("#screen-title .hint").textContent,
            want: w.hints.titleHint.key,
            howtoRows: null,
          };
        });
        assert(fine.boot === "key", `boot latched ${fine.boot}`);
        assert(fine.hint === fine.want, `title hint "${fine.hint}" != key variant`);
        assert(/Enter/.test(fine.hint), "key hint lost key names");
        assert(!/tap|swipe|stick|pinch|drag/i.test(fine.hint), "key hint mixes touch wording");
        return `fine boot: "${fine.hint.trim()}"`;
      });

      // HUD4b threat direction stays readable.
      await scen("hud-presentation", "HUD4b", "Threat direction stays readable", async () => {
        await g(page, () => {
          const w = window.__wbGame;
          w.startDayFromTitle();
          w.hopper.stageDefault();
          w.loop.stage({ carryHeld: true });
        });
        await waitFrames(page, 4);
        const stageChaseAt = (bearing) =>
          g(page, (b) => {
            const w = window.__wbGame;
            w.loop.stage({ carryHeld: true });
            const a = w.controller.position;
            const bx = a.x + Math.sin(b) * 3.2;
            const bz = a.z + Math.cos(b) * 3.2;
            w.hopper.stage({
              x: bx, z: bz, yaw: Math.atan2(a.x - bx, a.z - bz),
              state: "chase", stateT: 0.1, speed: 3.9, suspicion: 1,
            });
          }, bearing);
        await stageChaseAt(0.8);
        await waitFrames(page, 5);
        const c1 = await g(page, () => {
          const w = window.__wbGame;
          return { ta: w.hud.debugMotion.threatAngle, tr: w.hud.debugMotion.threatRadius, lvl: w.hopper.threatLevel, box: w.hud.hudBoxes.threat };
        });
        assert(c1.tr > 0 && c1.lvl > 0.03, `no cue during chase: ${JSON.stringify(c1)}`);
        await stageChaseAt(0.8 + Math.PI / 2);
        await waitFrames(page, 5);
        const c2 = await g(page, () => ({
          ta: window.__wbGame.hud.debugMotion.threatAngle, tr: window.__wbGame.hud.debugMotion.threatRadius,
        }));
        assert(c2.tr > 0, "cue died on the second bearing");
        const dTa = Math.abs(c2.ta - c1.ta);
        assert(dTa > 0.05, `cue angle did not track the new bearing (Δ${dTa.toFixed(4)})`);
        await g(page, () => window.__wbGame.hopper.stageDefault());
        await waitFrames(page, 4);
        const off = await g(page, () => window.__wbGame.hud.debugMotion.threatRadius);
        assert(off === 0, `cue still up after the threat disengaged (radius ${off})`);
        return `cue radius ${c1.tr.toFixed(1)}→${c2.tr.toFixed(1)} px tracking bearings (Δangle ${dTa.toFixed(2)} rad), off when disengaged`;
      });

      // HUD3a reduced-motion day loses no information.
      await scen("hud-presentation", "HUD3a", "Reduced-motion day loses no information", async () => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await waitFrames(page, 6);
        assert(await g(page, () => window.__wbGame.hud.debugReduced) === true, "reduce not applied");
        const amp = (vals) => Math.max(...vals) - Math.min(...vals);
        const sample = async () =>
          g(page, () => {
            const w = window.__wbGame;
            const m = w.hud.debugMotion;
            return { v: m.vignetteAlpha, u: w.loop.urgency, se: w.hud.hudBoxes.sEff, ray: m.sunRayAngle, sr: m.sunRadius, ta: m.threatAngle, tr: m.threatRadius };
          });
        await g(page, () => {
          const w = window.__wbGame;
          w.loop.stage({ dayElapsed: 336, urgency: 0.9, carryHeld: true });
          const a = w.controller.position;
          const bx = a.x + Math.sin(0.8) * 3.2;
          const bz = a.z + Math.cos(0.8) * 3.2;
          w.hopper.stage({ x: bx, z: bz, yaw: Math.atan2(a.x - bx, a.z - bz), state: "chase", stateT: 0.1, speed: 3.9, suspicion: 1 });
        });
        await waitFrames(page, 5);
        /** Re-applies the chase bait (a live chase ends fast: steal → eat →
         *  the cue legitimately drops) so pulse amplitude is asserted on a
         *  STABLE chase, exactly like the hud-reduced section does. */
        const reStage = () =>
          g(page, () => {
            const w = window.__wbGame;
            w.loop.stage({ carryHeld: true });
            const a = w.controller.position;
            const bx = a.x + Math.sin(0.8) * 3.2;
            const bz = a.z + Math.cos(0.8) * 3.2;
            w.hopper.stage({ x: bx, z: bz, yaw: Math.atan2(a.x - bx, a.z - bz), state: "chase", stateT: 0.1, speed: 3.9, suspicion: 1 });
          });
        const rm = [await sample()];
        for (let i = 0; i < 9; i++) {
          if (i % 4 === 3) await reStage();
          await waitFrames(page, 2);
          rm.push(await sample());
        }
        const ratio = rm.filter((x) => x.u > 0.05).map((x) => x.v / x.u);
        const srDev = rm.map((x) => x.sr - (9.5 + x.u * 2.25) * x.se);
        assert(amp(ratio) <= 1e-6, `vignette still breathes (amp ${amp(ratio).toFixed(5)})`);
        assert(rm[0].v > 0.15, `urgency encoding lost (${rm[0].v.toFixed(3)})`);
        assert(amp(rm.map((x) => x.ray)) <= 1e-9 && amp(srDev) <= 1e-9, "sun decoration still animates");
        assert(amp(rm.map((x) => x.tr)) <= 1e-9, "threat eye still pulses");
        const taAmp = amp(rm.map((x) => x.ta));
        assert(taAmp > 0.05, `threat cue stopped tracking (angle amp ${taAmp.toFixed(3)})`);
        // Urgency still encodes 0 → strong through the static vignette.
        await g(page, () => window.__wbGame.loop.stage({ dayElapsed: 0, urgency: 0 }));
        await waitFrames(page, 4);
        const vLow = await g(page, () => window.__wbGame.hud.debugMotion.vignetteAlpha);
        await g(page, () => window.__wbGame.loop.stage({ dayElapsed: 336, urgency: 0.9 }));
        await waitFrames(page, 4);
        const vHigh = await g(page, () => window.__wbGame.hud.debugMotion.vignetteAlpha);
        assert(vLow === 0 && vHigh > 0.15, `urgency readback ${vLow} → ${vHigh}`);
        // The kill-switch overrides the preference: pinned run is byte-stable.
        const grabRun = () =>
          g(page, async () => {
            await window.__wb.shot("run");
            return window.__wb.grab();
          });
        const pngReduce = Buffer.from((await grabRun()).replace(/^data:image\/png;base64,/, ""), "base64");
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await waitFrames(page, 4);
        const pngNormal = Buffer.from((await grabRun()).replace(/^data:image\/png;base64,/, ""), "base64");
        assert(pngReduce.equals(pngNormal), "pinned run differs across the media query");
        return `pulses flat (vignette/ray/sun/eye amp 0), urgency 0→${vHigh.toFixed(2)}, cue tracked (Δ${taAmp.toFixed(2)}), pinned capture immune`;
      });

      // AU1a deposit is audible (and does not stall the sim).
      await scen("audio", "AU1a", "Deposit is audible", async () => {
        // Fresh live session: the HUD beats above left the game PINNED by the
        // capture seam, and a pinned sim never steps. Reload, then unlock
        // audio with real clicks (the gesture).
        await reloadFresh(page);
        await page.click("#btn-howto-title");
        await page.click("#btn-howto-back");
        const st = await g(page, () => window.__wbGame.audio.debug().state);
        assert(st === "running", `audio state after click is ${st}`);
        await g(page, () => {
          const w = window.__wbGame;
          w.startDayFromTitle();
          w.hopper.stageDefault();
          const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
          w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
          w.loop.tryPickup();
          w.carried.update(0.3, w.loop.buildCarryCtx());
          w.controller.teleport(w.meadow.anthill.holePos.x, w.meadow.anthill.holePos.z, 0);
        });
        let d = null;
        for (let i = 0; i < 900; i++) {
          d = await g(page, () => ({ e: window.__wbGame.loop.dayElapsed, a: window.__wbGame.audio.debug() }));
          if ((d.a.counts.deposit ?? 0) >= 1) break;
          await waitFrames(page, 1);
        }
        assert((d?.a.counts.deposit ?? 0) >= 1, "deposit never scheduled");
        assert(await g(page, () => window.__wbGame.loop.deposited) === 1, "deposit did not count the grain");
        const stepMs = await g(page, () => window.__wbGame.stepMs);
        assert(stepMs <= 16.0, `sim step ${stepMs.toFixed(2)} ms with audio live`);
        return `deposit scheduled (count ${(d.a.counts.deposit ?? 0)}), grain banked, step ${stepMs.toFixed(2)} ms « one step`;
      });

      // AU1b victory and defeat are audible.
      await scen("audio", "AU1b", "Victory and defeat are audible", async () => {
        await g(page, () => {
          const w = window.__wbGame;
          w.hopper.stageDefault();
          w.loop.stage({ deposited: 5, carryHeld: true });
          w.controller.teleport(w.meadow.anthill.holePos.x, w.meadow.anthill.holePos.z, 0);
        });
        let winD = null;
        for (let i = 0; i < 900; i++) {
          winD = await g(page, () => ({ e: window.__wbGame.loop.dayElapsed, a: window.__wbGame.audio.debug(), m: window.__wbGame.mode }));
          if ((winD.a.counts.win ?? 0) >= 1) break;
          await waitFrames(page, 1);
        }
        assert((winD?.a.counts.win ?? 0) >= 1, "win stinger never scheduled");
        // The stinger schedules at quota finalize; `results` lands after the
        // win beat — wait for the screen transition (as audio-sfx does).
        for (let i = 0; i < 400; i++) {
          if (await g(page, () => window.__wbGame.mode) === "results") break;
          await waitFrames(page, 1);
        }
        assert(await g(page, () => window.__wbGame.mode) === "results", "win stinger fired but results never appeared");
        await g(page, () => {
          const w = window.__wbGame;
          w.restartDay();
          w.hopper.stageDefault();
          w.loop.stage({ dayElapsed: 359.6 });
        });
        let loseD = null;
        for (let i = 0; i < 900; i++) {
          loseD = await g(page, () => ({ e: window.__wbGame.loop.dayElapsed, a: window.__wbGame.audio.debug() }));
          if ((loseD.a.counts.lose ?? 0) >= 1) break;
          await waitFrames(page, 1);
        }
        assert((loseD?.a.counts.lose ?? 0) >= 1, "lose stinger never scheduled");
        return `win stinger as results appeared; lose stinger at sunset (counts ${winD.a.counts.win}/${loseD.a.counts.lose})`;
      });

      // AU2a music spans title and day.
      await scen("audio", "AU2a", "Music spans title and day", async () => {
        await reloadFresh(page);
        await page.click("#btn-howto-title"); // unlock ON the title, not START
        await page.click("#btn-howto-back");
        const started = await g(page, () => {
          const d = window.__wbGame.audio.debug();
          return { state: d.state, gen: d.bed.generation };
        });
        assert(started.state === "running" && started.gen === 1, `bed not alive on title: ${JSON.stringify(started)}`);
        const samples = [];
        const t0 = Date.now();
        let dayStarted = false;
        while (Date.now() - t0 < 14000) {
          if (!dayStarted && Date.now() - t0 >= 6000) {
            await page.click("#btn-start");
            dayStarted = true;
          }
          samples.push(
            await g(page, () => {
              const d = window.__wbGame.audio.debug();
              return { wall: Date.now(), mode: window.__wbGame.mode, notes: d.bed.notes, gen: d.bed.generation, drone: d.bed.drone, scheduler: d.bed.scheduler };
            }),
          );
          await waitFrames(page, 3);
        }
        assert(dayStarted, "the title→day transition never happened");
        assert(samples.some((s) => s.mode === "title") && samples.some((s) => s.mode === "playing"), "run did not span the transition");
        for (const s of samples) {
          assert(s.gen === 1, `bed restarted (generation ${s.gen})`);
          assert(s.scheduler && s.drone, `bed died at ${((s.wall - t0) / 1000).toFixed(1)} s`);
        }
        for (let i = 1; i < samples.length; i++) {
          if (samples[i].wall - samples[i - 1].wall >= 2500) {
            assert(samples[i].notes > samples[i - 1].notes, `no notes between ${i - 1} and ${i}`);
          }
        }
        const total = samples[samples.length - 1].notes - samples[0].notes;
        assert(total >= 10, `only ${total} notes over 14 s`);
        return `14 s across title→day: +${total} notes, generation pinned 1, scheduler/drone continuous`;
      });

      // AU3a music off leaves effects audible + persists.
      await scen("audio", "AU3a", "Music off leaves effects audible", async () => {
        await reloadFresh(page);
        await page.click("#tgl-music"); // MUSIC off (SFX stays on)
        await page.click("#btn-start");
        await waitFrames(page, 14);
        const gains = await g(page, () => {
          const d = window.__wbGame.audio.debug();
          return { state: d.state, gains: d.gains };
        });
        assert(gains.state === "running", `state ${gains.state}`);
        assert(gains.gains.music === 0 && Math.abs(gains.gains.sfx - 1) < 0.02, `gains ${JSON.stringify(gains.gains)}`);
        const notes0 = await g(page, () => window.__wbGame.audio.debug().bed.notes);
        await waitFrames(page, 90);
        const silent = await g(page, () => ({ notes: window.__wbGame.audio.debug().bed.notes, nextIn: window.__wbGame.audio.debug().bed.nextIn }));
        assert(silent.notes === notes0, `muted music scheduled notes (${notes0} → ${silent.notes})`);
        await g(page, () => {
          const w = window.__wbGame;
          w.hopper.stageDefault();
          const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
          w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
          w.loop.tryPickup();
        });
        await waitFrames(page, 3);
        const pick = await g(page, () => ({
          pickup: window.__wbGame.audio.debug().counts.pickup ?? 0,
          gains: window.__wbGame.audio.debug().gains,
        }));
        assert(pick.pickup === 1, "pickup did not schedule with music muted");
        await reloadFresh(page);
        const after = await g(page, () => ({
          music: window.__wbGame.audio.musicEnabled,
          sfx: window.__wbGame.audio.sfxEnabled,
          m: document.getElementById("tgl-music").getAttribute("aria-pressed"),
        }));
        assert(after.music === false && after.sfx === true && after.m === "false", `persisted choices ${JSON.stringify(after)}`);
        await g(page, () => {
          window.__wbGame.audio.setMusic(true);
          window.__wbGame.audio.setSfx(true);
        });
        return `music gain 0 / sfx live (pickup scheduled), bed silent, choice persisted across reload`;
      });

      // AU4b captures ignore audio state.
      await scen("audio", "AU4b", "Captures ignore audio state", async () => {
        await reloadFresh(page);
        await page.click("#btn-start"); // gesture → live graph
        await waitFrames(page, 30);
        const live = await g(page, () => {
          const d = window.__wbGame.audio.debug();
          return { state: d.state, notes: d.bed.notes };
        });
        assert(live.state === "running" && live.notes >= 1, `audio not live: ${JSON.stringify(live)}`);
        const grabRun = () =>
          g(page, async () => {
            await window.__wb.shot("run");
            return window.__wb.grab();
          });
        const pngEnabled = Buffer.from((await grabRun()).replace(/^data:image\/png;base64,/, ""), "base64");
        await g(page, () => window.__wbGame.audio.setEnabled(false));
        const pngDisabled = Buffer.from((await grabRun()).replace(/^data:image\/png;base64,/, ""), "base64");
        assert(pngEnabled.equals(pngDisabled), "pinned run capture differs between audio enabled and disabled");
        await g(page, () => window.__wbGame.shotDirector.unpin());
        return `run capture byte-identical with the graph live (${live.notes} bed notes) vs disabled`;
      });

      // (Main-page error collection is owned by the section runner; phases B
      // and C below check their own spawned pages' error arrays explicitly.)
      await page.close().catch(() => undefined);

      // --- Phase B: fresh desktop pages (genuinely fresh saves) --------------

      {
        const b1 = await openViewport(browser, 1280, 720, false, { taught: false });
        try {
          const teachState = () => g(b1.page, () => window.__wbGame.teach.debug());
          const waitTeachUntil = async (pred, simBudget, label) => {
            const e0 = await g(b1.page, () => window.__wbGame.loop.dayElapsed);
            for (let i = 0; i < 600; i++) {
              const s = await g(b1.page, () => ({ d: window.__wbGame.teach.debug(), e: window.__wbGame.loop.dayElapsed }));
              if (pred(s.d)) return s.d;
              if (s.e > e0 + simBudget) break;
              await waitFrames(b1.page, 2);
            }
            throw new Error(`${label} never happened within ${simBudget}s of sim time (last ${JSON.stringify(await teachState())})`);
          };

          // OB1a first day shows each hint once.
          await scen("onboarding", "OB1a", "First day shows each hint once", async () => {
            await g(b1.page, () => {
              window.__wbGame.startDayFromTitle();
              window.__wbGame.hopper.stageDefault();
            });
            assert(await g(b1.page, () => localStorage.getItem("wb.taught")) !== null, "day start did not persist wb.taught");
            let d = await waitTeachUntil((s) => s.shown === "move", 4, "move hint");
            assert(/WASD/.test(d.text) && !/tap|stick/i.test(d.text), `move copy mixes schemes: "${d.text}"`);
            await b1.page.keyboard.down("KeyW");
            d = await waitTeachUntil((s) => s.hints.move === "done" && s.shown === null, 5, "move dismissal");
            await b1.page.keyboard.up("KeyW");
            await g(b1.page, () => {
              const w = window.__wbGame;
              const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            d = await waitTeachUntil((s) => s.shown === "pickup", 3, "pickup hint");
            await waitFrames(b1.page, 20);
            await waitTeachUntil((s) => s.hints.pickup === "done" && s.shown === null, 11, "pickup self-dismiss");
            await g(b1.page, () => {
              const w = window.__wbGame;
              w.hopper.stageDefault();
              const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await b1.page.keyboard.press("KeyE");
            d = await waitTeachUntil((s) => s.shown === "throw", 4, "throw hint");
            assert(await g(b1.page, () => window.__wbGame.carried.mode) === "held", "E after timed-out hint did not pick up");
            assert(d.hints.pickup === "done", "pickup hint resurrected");
            await b1.page.keyboard.press("KeyF");
            d = await waitTeachUntil((s) => s.hints.throw === "done" && s.shown === null, 4, "throw dismissal");
            await g(b1.page, () => {
              const w = window.__wbGame;
              w.hopper.stageDefault();
              w.controller.teleport(2.35 - 1.5, 4.35, 0);
            });
            d = await waitTeachUntil((s) => s.shown === "jump", 3, "jump hint");
            await b1.page.keyboard.down("Space");
            d = await waitTeachUntil((s) => s.hints.jump === "done" && s.shown === null, 4, "jump dismissal");
            await b1.page.keyboard.up("Space");
            d = await teachState();
            assert(
              d.shown === null && ["move", "pickup", "throw", "jump"].every((k) => d.hints[k] === "done"),
              `first day did not end all-done-once: ${JSON.stringify(d)}`,
            );
            return "move→movement, pickup→self-dismiss (E still works), throw→F, jump→Space — each exactly once";
          });

          // OB1b second day is hint-free.
          await scen("onboarding", "OB1b", "Second day is hint-free", async () => {
            await g(b1.page, () => {
              const w = window.__wbGame;
              w.pause();
              w.restartDay();
              w.hopper.stageDefault();
            });
            const d0 = await teachState();
            assert(d0.armed === false && d0.active === false, `restart re-armed teaching: ${JSON.stringify(d0)}`);
            await waitFrames(b1.page, 150);
            await g(b1.page, () => {
              const w = window.__wbGame;
              const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await waitFrames(b1.page, 40);
            const d = await teachState();
            assert(d.shown === null && d.hints.move === "idle" && d.hints.pickup === "idle", `second day fired hints: ${JSON.stringify(d)}`);
            return "restarted day: teaching disarmed, move/pickup moments stay silent";
          });

          // OB2a reload after a played day shows no hints.
          await scen("onboarding", "OB2a", "Reload after a played day shows no hints", async () => {
            await reloadFresh(b1.page);
            const s = await g(b1.page, () => ({
              key: localStorage.getItem("wb.taught"),
              armed: window.__wbGame.teach.debug().armed,
            }));
            assert(s.key !== null, "wb.taught lost across reload");
            assert(s.armed === false, "teaching re-armed after reload");
            await g(b1.page, () => {
              window.__wbGame.startDayFromTitle();
              window.__wbGame.hopper.stageDefault();
            });
            await waitFrames(b1.page, 150);
            await g(b1.page, () => {
              const w = window.__wbGame;
              const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await waitFrames(b1.page, 30);
            const d = await g(b1.page, () => window.__wbGame.teach.debug());
            assert(d.shown === null && d.hints.move === "idle" && d.hints.pickup === "idle", `reloaded day fired hints: ${JSON.stringify(d)}`);
            return "reload → wb.taught kept, next day fires no hints at the move/pickup moments";
          });
          if (b1.errors.length) rows.push({ req: "harness", id: "B1", title: "fresh page errors", pass: false, ev: b1.errors.join(" | ") });
        } finally {
          await b1.context.close().catch(() => undefined);
        }
      }

      {
        const b2 = await openViewport(browser, 1280, 720, false, { taught: false });
        try {
          // OB2b boot alone does not consume the teaching run.
          await scen("onboarding", "OB2b", "Boot alone does not consume the teaching run", async () => {
            const boot = await g(b2.page, () => ({
              key: localStorage.getItem("wb.taught"),
              armed: window.__wbGame.teach.debug().armed,
              mode: window.__wbGame.mode,
            }));
            assert(boot.key === null && boot.armed === true && boot.mode === "title", `boot state ${JSON.stringify(boot)}`);
            await waitFrames(b2.page, 40);
            await g(b2.page, () => document.getElementById("btn-howto-title").click());
            await waitFrames(b2.page, 6);
            await g(b2.page, () => document.getElementById("btn-howto-back").click());
            await waitFrames(b2.page, 6);
            assert(await g(b2.page, () => localStorage.getItem("wb.taught")) === null, "title/how-to visit wrote wb.taught");
            await reloadFresh(b2.page);
            await g(b2.page, () => {
              window.__wbGame.startDayFromTitle();
              window.__wbGame.hopper.stageDefault();
            });
            const e0 = await g(b2.page, () => window.__wbGame.loop.dayElapsed);
            let fired = false;
            for (let i = 0; i < 600; i++) {
              const s = await g(b2.page, () => ({ d: window.__wbGame.teach.debug(), e: window.__wbGame.loop.dayElapsed }));
              if (s.d.shown === "move") {
                fired = true;
                break;
              }
              if (s.e > e0 + 4) break;
              await waitFrames(b2.page, 2);
            }
            assert(fired, `the first real day never showed the move hint (boot visit had consumed it?)`);
            return "title + how-to visit wrote nothing; next session's first day still teaches";
          });

          // OB3a review from title stays on title.
          await scen("onboarding", "OB3a", "Review from title stays on title", async () => {
            await reloadFresh(b2.page);
            const t0 = await g(b2.page, () => {
              const w = window.__wbGame;
              return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, mode: w.mode };
            });
            await b2.page.click("#btn-howto-title");
            await waitFrames(b2.page, 4);
            const open = await g(b2.page, () => ({
              howto: document.getElementById("screen-howto").classList.contains("on"),
              goal: document.querySelector("#screen-howto .goal").textContent,
              keys: document.querySelectorAll("#howto-controls .key").length,
            }));
            assert(open.howto, "how-to did not open");
            assert(/six grains/i.test(open.goal), "day-goal copy missing");
            assert(open.keys >= 8, `control listing only ${open.keys} rows`);
            await waitFrames(b2.page, 20);
            await b2.page.click("#btn-howto-back");
            await waitFrames(b2.page, 4);
            const back = await g(b2.page, () => {
              const w = window.__wbGame;
              return {
                mode: w.mode,
                title: document.getElementById("screen-title").classList.contains("on"),
                howto: document.getElementById("screen-howto").classList.contains("on"),
                t: w.dayCycle.getTime(),
                e: w.loop.dayElapsed,
              };
            });
            assert(back.mode === "title" && back.title && !back.howto, "BACK did not restore the title");
            assert(back.t === t0.t && back.e === 0, `how-to leaked day progress: t ${t0.t}→${back.t}, e ${back.e}`);
            return `goal + ${open.keys}-row listing; title restored exactly (sun ${t0.t.toFixed(4)} held, no day)`;
          });

          // OB3b review from pause keeps the day frozen.
          await scen("onboarding", "OB3b", "Review from pause keeps the day frozen", async () => {
            await b2.page.click("#btn-start");
            await waitFrames(b2.page, 30);
            await g(b2.page, () => window.__wbGame.pause());
            const p0 = await g(b2.page, () => {
              const w = window.__wbGame;
              return { t: w.dayCycle.getTime(), e: w.loop.dayElapsed, wind: w.windTime };
            });
            await b2.page.click("#btn-howto-pause");
            await waitFrames(b2.page, 4);
            const open = await g(b2.page, () => ({
              howto: document.getElementById("screen-howto").classList.contains("on"),
              pause: document.getElementById("screen-pause").classList.contains("on"),
            }));
            assert(open.howto && !open.pause, "how-to did not open over pause");
            await waitFrames(b2.page, 20);
            await b2.page.click("#btn-howto-back");
            await waitFrames(b2.page, 4);
            const p1 = await g(b2.page, () => {
              const w = window.__wbGame;
              return {
                mode: w.mode,
                pause: document.getElementById("screen-pause").classList.contains("on"),
                t: w.dayCycle.getTime(),
                e: w.loop.dayElapsed,
                wind: w.windTime,
              };
            });
            assert(p1.mode === "paused" && p1.pause, "round trip did not restore pause");
            assert(p1.t === p0.t && p1.e === p0.e && p1.wind === p0.wind, `frozen day moved: ${JSON.stringify({ p0, p1 })}`);
            return "same paused day restored: sun, timer, wind all identical";
          });
          if (b2.errors.length) rows.push({ req: "harness", id: "B2", title: "fresh page errors", pass: false, ev: b2.errors.join(" | ") });
        } finally {
          await b2.context.close().catch(() => undefined);
        }
      }

      // --- Phase C: emulated phone contexts ----------------------------------

      {
        const t = await freshTouchPage(browser);
        const { page: tp, cdp } = t;
        try {
          const stick = () => widgetCenter(tp, "tc-stick");
          const tilt = async (frac) => {
            const w = await stick();
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: w.x, y: w.y }] });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: w.x, y: w.y - w.h * frac }],
            });
          };
          const release = async () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

          // GF2a touch player pauses mid-run.
          await scen("game-flow", "GF2a", "Touch player pauses mid-run", async () => {
            await g(tp, () => {
              window.__wbGame.startDayFromTitle();
              window.__wbGame.hopper.stageDefault();
            });
            await waitFrames(tp, 8);
            const stickPos = await stick(); // captured live: the layer hides on pause
            const p = await widgetCenter(tp, "tc-pause");
            assert(p.w >= 44 && p.h >= 44, `pause control ${p.w}x${p.h} < 44`);
            await cdpTap(cdp, p.x, p.y);
            await waitFrames(tp, 4);
            const s = await g(tp, () => ({
              mode: window.__wbGame.mode,
              menu: document.getElementById("screen-pause").classList.contains("on"),
              btns: [...document.querySelectorAll("#screen-pause.on button")].map((b) => b.id).sort(),
              widgets: document.getElementById("touch").hidden,
            }));
            assert(s.mode === "paused" && s.menu, `tap left ${s.mode}/${s.menu}`);
            assert(
              JSON.stringify(s.btns) === JSON.stringify(["btn-howto-pause", "btn-quit", "btn-restart", "btn-resume"]),
              `menu actions ${s.btns}`,
            );
            assert(s.widgets, "widgets stayed up while paused");
            // Frozen: a touch at the (pre-pause) stick position cannot move
            // the ant (the layer is gone, so the event lands on the scene →
            // camera drag at most).
            const pose0 = await pose(tp);
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [{ x: stickPos.x, y: stickPos.y }],
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: stickPos.x, y: stickPos.y - stickPos.h * 0.4 }],
            });
            await waitFrames(tp, 6);
            await release();
            const s1 = await g(tp, () => ({ mv: window.__wbGame.input.move.length(), mode: window.__wbGame.mode }));
            const pose1 = await pose(tp);
            assert(s1.mode === "paused", `stick touch un-paused the game (${s1.mode})`);
            assert(s1.mv === 0, "stick touch wrote move intent while paused");
            assert(Math.hypot(pose1.x - pose0.x, pose1.z - pose0.z) < 0.02, "ant moved while paused via stick touch");
            return `44px tap → paused + 4 actions, widgets hidden, stick touch inert (ant frozen)`;
          });

          // GF2c gestures near the pause control still steer.
          await scen("game-flow", "GF2c", "Gestures near the pause control still steer", async () => {
            await g(tp, () => {
              window.__wbGame.resume();
              window.__wbGame.resume();
            });
            await waitFrames(tp, 4);
            assert(await g(tp, () => window.__wbGame.mode) === "playing", "did not return to play");
            // Camera drag across the middle of the scene (nowhere near the
            // top-right pause control): orbits, never pauses.
            const yaw0 = await g(tp, () => window.__wbGame.followCam.yaw);
            await cdpDrag(cdp, 195, 420, 285, 420, 6);
            await waitFrames(tp, 4);
            const d = await g(tp, () => ({ mode: window.__wbGame.mode, yaw: window.__wbGame.followCam.yaw }));
            assert(d.mode === "playing", `drag paused the game (${d.mode})`);
            assert(Math.abs(d.yaw - yaw0) > 0.2, `drag did not orbit (${d.yaw - yaw0})`);
            // Joystick tilt steers, never pauses.
            await tilt(0.45);
            await waitFrames(tp, 5);
            const s = await g(tp, () => ({ mode: window.__wbGame.mode, mv: window.__wbGame.input.move.length() }));
            assert(s.mode === "playing", `tilt paused the game (${s.mode})`);
            assert(s.mv > 0.1, `tilt wrote no intent (${s.mv})`);
            await release();
            return `drag orbits (Δyaw ${(d.yaw - yaw0).toFixed(2)}) + tilt steers (${s.mv.toFixed(2)}) with zero pauses`;
          });

          // IS1a partial tilt walks, full tilt sprints.
          await scen("input-schemes", "IS1a", "Partial tilt walks, full tilt sprints", async () => {
            await g(tp, () => window.__wbGame.hopper.stageDefault());
            await tilt(0.2); // 0.41 deflection → dead-zone remap ≈ 0.332 intent
            await waitFrames(tp, 5);
            const intent = await g(tp, () => ({ x: window.__wbGame.input.move.x, y: window.__wbGame.input.move.y, sprint: window.__wbGame.input.sprint }));
            assert(Math.abs(intent.y - 0.332) < 0.015 && Math.abs(intent.x) < 0.015, `partial intent ${JSON.stringify(intent)}`);
            assert(!intent.sprint, "partial tilt set sprint");
            await waitFrames(tp, 30);
            const walk = await sampleMaxSpeed(tp, 5);
            const walkTarget = await targetSpeed(tp, false);
            assert(walk > 0.18 && walk < walkTarget + 0.45, `walk speed ${walk.toFixed(2)} outside band`);
            const yawAt = await g(tp, () => window.__wbGame.followCam.yaw);
            const p0 = await pose(tp);
            await tilt(0.55); // full tilt → sprint
            await waitFrames(tp, 40);
            const sprint = await sampleMaxSpeed(tp, 5);
            const sprintTarget = await targetSpeed(tp, true);
            assert(await g(tp, () => window.__wbGame.input.sprint), "full tilt did not set sprint");
            assert(sprint > sprintTarget - 0.6 && sprint < sprintTarget + 0.35, `sprint speed ${sprint.toFixed(2)} outside band`);
            const p1 = await pose(tp);
            const dx = p1.x - p0.x;
            const dz = p1.z - p0.z;
            const dot = (dx * Math.sin(yawAt) + dz * Math.cos(yawAt)) / Math.max(1e-6, Math.hypot(dx, dz));
            assert(dot > 0.85, `movement not camera-relative (dot ${dot.toFixed(3)})`);
            await release();
            await waitFrames(tp, 30);
            const rest = await g(tp, () => ({ mv: window.__wbGame.input.move.length(), sprint: window.__wbGame.input.sprint }));
            assert(rest.mv === 0 && !rest.sprint, `release did not zero intent: ${JSON.stringify(rest)}`);
            return `0.41 tilt → intent ${intent.y.toFixed(3)} walks ${walk.toFixed(2)} u/s; full tilt sprints ${sprint.toFixed(2)} u/s (dot ${dot.toFixed(2)}); release zeroes`;
          });

          // IS2a drag orbits without moving the ant.
          await scen("input-schemes", "IS2a", "Drag orbits without moving the ant", async () => {
            await g(tp, () => window.__wbGame.hopper.stageDefault());
            await waitFrames(tp, 8);
            const yaw0 = await g(tp, () => window.__wbGame.followCam.yaw);
            const p0 = await pose(tp);
            await cdpDrag(cdp, 195, 300, 315, 300, 8);
            await waitFrames(tp, 4);
            const d = await g(tp, () => ({
              yaw: window.__wbGame.followCam.yaw,
              mv: window.__wbGame.input.move.length(),
              dragging: window.__wbGame.input.dragging,
            }));
            assert(Math.abs(d.yaw - yaw0) > 0.3, `orbit Δ${(d.yaw - yaw0).toFixed(3)}`);
            assert(d.mv === 0 && !d.dragging, `drag leaked into movement: ${JSON.stringify(d)}`);
            const p1 = await pose(tp);
            assert(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05, "the ant moved during a pure camera drag");
            return `Δyaw ${(d.yaw - yaw0).toFixed(2)}, intent 0, ant frozen`;
          });

          // IS2b pinch zooms the camera.
          await scen("input-schemes", "IS2b", "Pinch zooms the camera", async () => {
            const dist0 = await camDist(tp);
            await cdpPinch(cdp, 195, 420, 60, 150, 10);
            await waitFrames(tp, 60);
            const dist1 = await camDist(tp);
            const zoom = dist0 - dist1;
            assert(zoom > 0.8 && zoom < 1.6, `pinch zoom ${zoom.toFixed(3)} outside the wheel-step band`);
            return `pinch-out zoomed ${zoom.toFixed(2)} u (≈ wheel steps)`;
          });

          // IS3a action control follows the verb.
          await scen("input-schemes", "IS3a", "Action control follows the verb", async () => {
            await g(tp, () => {
              const w = window.__wbGame;
              w.hopper.stageDefault();
              const node = w.meadow.grains.ensureNodeNear(0.4, 4.4);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await waitFrames(tp, 3);
            const act = await widgetCenter(tp, "tc-act");
            const r = await g(tp, () => ({
              r: document.getElementById("tc-act").getBoundingClientRect().width,
              text: document.getElementById("tc-act-label").textContent,
              ready: document.getElementById("tc-act").classList.contains("ready"),
            }));
            assert(r.r >= 44, `action control ${r.r}px < 44`);
            assert(r.text === "PICK" && r.ready, `in-reach verb is "${r.text}" (ready ${r.ready})`);
            await cdpTap(cdp, act.x, act.y);
            await waitFrames(tp, 40);
            const held = await g(tp, () => ({
              mode: window.__wbGame.carried.mode,
              text: document.getElementById("tc-act-label").textContent,
            }));
            assert(held.mode === "held", `PICK press left carried=${held.mode}`);
            assert(held.text === "THROW", `carrying verb is "${held.text}"`);
            await cdpTap(cdp, act.x, act.y);
            await waitFrames(tp, 1);
            assert(await g(tp, () => window.__wbGame.carried.mode) === "flight", "THROW press did not throw");
            return `PICK (in reach, ≥44px) → THROW (carrying) → grain flies`;
          });

          // IS3b jump button jumps.
          await scen("input-schemes", "IS3b", "Jump button jumps", async () => {
            const j = await widgetCenter(tp, "tc-jump");
            assert(j.w >= 44 && j.h >= 44, `jump control ${j.w}x${j.h} < 44`);
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: j.x, y: j.y }] });
            let airborne = false;
            for (let i = 0; i < 14 && !airborne; i++) {
              await waitFrames(tp, 1);
              airborne = await g(tp, () => {
                const c = window.__wbGame.controller;
                return !c.grounded || c.position.y - c.groundY > 0.02;
              });
            }
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            assert(airborne, "JUMP never left the ground");
            await waitFrames(tp, 70);
            assert(await g(tp, () => window.__wbGame.controller.grounded), "no landing after JUMP");
            return `JUMP (≥44px) lifts the ant like Space, clean landing`;
          });

          // IS5c in-run prompt matches the scheme.
          await scen("input-schemes", "IS5c", "In-run prompt matches the scheme", async () => {
            await g(tp, () => {
              const w = window.__wbGame;
              w.hopper.stageDefault();
              const node = w.meadow.grains.ensureNodeNear(-2.5, 4.2);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await waitFrames(tp, 6);
            const p = await g(tp, () => {
              const w = window.__wbGame;
              return {
                afford: w.hud.lastPromptAffordance,
                label: w.hud.lastPromptLabel,
                want: w.hints.promptAffordance.E.touch,
                text: w.loop.prompt.text,
                controls: w.hud.lastControlsDrawn,
              };
            });
            assert(p.afford === "chip", `affordance ${p.afford}, expected chip`);
            assert(p.label === "PICK" && p.label === p.want, `chip label ${p.label} != HINTS ${p.want}`);
            assert(/pick up grain/.test(p.text), `prompt text "${p.text}"`);
            assert(p.controls === false, "controls line drawn on touch");
            // And after a pickup it flips to the throw chip.
            await g(tp, () => {
              const w = window.__wbGame;
              w.loop.tryPickup();
              w.carried.update(0.3, w.loop.buildCarryCtx());
            });
            await waitFrames(tp, 20);
            const t2 = await g(tp, () => ({
              afford: window.__wbGame.hud.lastPromptAffordance,
              label: window.__wbGame.hud.lastPromptLabel,
              key: window.__wbGame.loop.prompt.key,
            }));
            assert(t2.key === "F" && t2.afford === "chip" && t2.label === "THROW", `throw chip ${JSON.stringify(t2)}`);
            return `pickup prompt = chip "PICK" (HINTS, no keycap), flips to chip "THROW", controls line hidden`;
          });

          // HUD4a carry state is confirmable peripherally.
          await scen("hud-presentation", "HUD4a", "Carry state is confirmable peripherally", async () => {
            await g(tp, () => {
              const w = window.__wbGame;
              // A previous touch scenario can leave a grain in hand (IS5c
              // stages a pickup to read the THROW chip); land it first so
              // this beat starts from a known not-carrying state.
              if (w.carried.mode === "held") {
                w.loop.tryThrow();
              }
              w.hopper.stageDefault();
              const node = w.meadow.grains.ensureNodeNear(2.5, 2.0);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await waitFrames(tp, 30); // any thrown grain clears the flight
            await g(tp, () => {
              const w = window.__wbGame;
              w.hopper.stageDefault();
              const node = w.meadow.grains.ensureNodeNear(2.5, 2.0);
              w.controller.teleport(node.pos.x + 0.35, node.pos.z, 0);
            });
            await waitFrames(tp, 6);
            const before = await g(tp, () => ({
              afford: window.__wbGame.hud.lastPromptAffordance,
              label: window.__wbGame.hud.lastPromptLabel,
              verb: document.getElementById("tc-act-label").textContent,
              carried: window.__wbGame.carried.mode,
            }));
            assert(before.label === "PICK" && before.verb === "PICK", `pre-pickup HUD ${JSON.stringify(before)}`);
            await g(tp, () => {
              const w = window.__wbGame;
              w.loop.tryPickup();
              w.carried.update(0.3, w.loop.buildCarryCtx());
            });
            await waitFrames(tp, 20);
            const held = await g(tp, () => ({
              afford: window.__wbGame.hud.lastPromptAffordance,
              label: window.__wbGame.hud.lastPromptLabel,
              verb: document.getElementById("tc-act-label").textContent,
              carried: window.__wbGame.carried.mode,
            }));
            assert(held.carried === "held", "pickup did not take");
            assert(held.label === "THROW" && held.verb === "THROW", `carried state not on the HUD: ${JSON.stringify(held)}`);
            await g(tp, () => window.__wbGame.loop.tryThrow());
            await waitFrames(tp, 2);
            const after = await g(tp, () => ({
              carried: window.__wbGame.carried.mode,
              verb: document.getElementById("tc-act-label").textContent,
            }));
            assert(after.carried === "flight" && after.verb !== "THROW", `throw not reflected: ${JSON.stringify(after)}`);
            return `prompt chip PICK→THROW→clears mirrors carried state each beat (no need to find the ant)`;
          });

          // AU3b in-run mute is session-scoped.
          await scen("audio", "AU3b", "In-run mute is session-scoped", async () => {
            // Audio must be live first: a real tap on a title control.
            await g(tp, () => document.getElementById("btn-howto-title").click());
            await waitFrames(tp, 2);
            await g(tp, () => document.getElementById("btn-howto-back").click());
            await waitFrames(tp, 2);
            assert(await g(tp, () => window.__wbGame.audio.debug().state) === "running", "audio not live before the mute");
            // Write the persisted choices (fresh storage has no keys yet —
            // they materialize on the first toggle, exactly as audio-toggles
            // does) so the mute's "keys untouched" check has a baseline.
            // setMusic/setSfx early-return on an UNCHANGED value, so flip
            // through false: the round trip leaves both buses on AND keys
            // "true"/"true" on storage.
            await g(tp, () => {
              const audio = window.__wbGame.audio;
              audio.setMusic(false);
              audio.setMusic(true);
              audio.setSfx(false);
              audio.setSfx(true);
            });
            const m = await widgetCenter(tp, "tc-mute");
            assert(m.w >= 44 && m.h >= 44, `mute control ${m.w}x${m.h} < 44`);
            await cdpTap(cdp, m.x, m.y);
            await waitFrames(tp, 10);
            const muted = await g(tp, () => {
              const d = window.__wbGame.audio.debug();
              const b = document.getElementById("tc-mute");
              return {
                master: d.gains.master, muted: d.muted, pressed: b.getAttribute("aria-pressed"),
                kM: localStorage.getItem("wb.audio.music"), kS: localStorage.getItem("wb.audio.sfx"),
              };
            });
            assert(muted.muted && muted.pressed === "true", `mute state ${JSON.stringify(muted)}`);
            assert(muted.master === 0, `master after mute is ${muted.master}`);
            assert(muted.kM === "true" && muted.kS === "true", `mute rewrote stored keys ${muted.kM}/${muted.kS}`);
            await reloadFresh(tp);
            const after = await g(tp, () => {
              const audio = window.__wbGame.audio;
              return {
                music: audio.musicEnabled, sfx: audio.sfxEnabled,
                muted: audio.debug().muted, state: audio.debug().state,
              };
            });
            assert(after.music === true && after.sfx === true, `post-reload choices ${JSON.stringify(after)}`);
            assert(after.muted === false, "session mute survived reload");
            assert(after.state === "idle", "post-reload audio self-started");
            return `mute → master 0 + pressed state, stored keys true/true untouched; reload → mute gone, toggles back`;
          });

          if (t.errors.length) rows.push({ req: "harness", id: "C1", title: "touch page errors", pass: false, ev: t.errors.join(" | ") });
        } finally {
          await tp.close().catch(() => undefined);
          await t.context.close().catch(() => undefined);
        }
      }

      // HUD1a phone-portrait layout holds together.
      {
        const c2 = await spawnCoarsePage(browser);
        try {
          await scen("hud-presentation", "HUD1a", "Phone-portrait layout holds together", async () => {
            await stageHudBeat(c2.page);
            await g(c2.page, (ins) => window.__wbGame.hud.setSafeArea(ins), { top: 0, right: 0, bottom: 0, left: 0 });
            await waitFrames(c2.page, 8);
            const snap = await hudSnapshot(c2.page);
            assert(snap.compact === true, `compact=${snap.compact}`);
            assert(snap.fonts.count >= 14 && snap.fonts.sub >= 9 && snap.fonts.prompt >= 12 && snap.fonts.toast >= 12,
              `fonts ${JSON.stringify(snap.fonts)} below the floors`);
            assertInsideViewport("HUD1a", snap);
            const n = assertNoOverlap("HUD1a", snap);
            const cx = snap.viewport.w / 2;
            const cy = snap.viewport.h / 2;
            for (const [k, b] of Object.entries(snap.boxes)) {
              if (!b) continue;
              assert(!(cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h), `${k} covers the ant at center`);
            }
            assert(snap.widgets.stick && snap.widgets.pause, "touch widgets missing");
            return `compact layout: fonts ${snap.fonts.count.toFixed(0)}/${snap.fonts.sub.toFixed(0)}/${snap.fonts.prompt.toFixed(0)}/${snap.fonts.toast.toFixed(0)} px, ${n} boxes pairwise clear, center clear`;
          });
          if (c2.errors.length) rows.push({ req: "harness", id: "C2", title: "coarse page errors", pass: false, ev: c2.errors.join(" | ") });
        } finally {
          await c2.page.close().catch(() => undefined);
          await c2.context.close().catch(() => undefined);
        }
      }

      // HUD2a notched landscape keeps controls clear.
      {
        const c3 = await openViewport(browser, 844, 390, true);
        try {
          await scen("hud-presentation", "HUD2a", "Notched landscape keeps controls clear", async () => {
            const meta = await g(c3.page, () => document.querySelector('meta[name="viewport"]')?.content ?? "");
            assert(meta.includes("viewport-fit=cover"), `meta viewport "${meta}"`);
            const INSETS = { top: 47, right: 47, bottom: 34, left: 47 };
            await stageHudBeat(c3.page);
            await g(c3.page, (ins) => window.__wbGame.hud.setSafeArea(ins), INSETS);
            await waitFrames(c3.page, 8);
            const snap = await hudSnapshot(c3.page);
            assert(
              snap.safe.top === 47 && snap.safe.right === 47 && snap.safe.bottom === 34 && snap.safe.left === 47,
              `safe insets ${JSON.stringify(snap.safe)} != stub`,
            );
            const rect = { x: 47, y: 47, w: 844 - 94, h: 390 - 81 };
            for (const [k, b] of Object.entries(snap.boxes)) {
              if (!b) continue;
              assert(
                b.x >= rect.x - 0.5 && b.y >= rect.y - 0.5 && b.x + b.w <= rect.x + rect.w + 0.5 && b.y + b.h <= rect.y + rect.h + 0.5,
                `${k} box ${JSON.stringify(b)} escapes the safe rect`,
              );
            }
            assertNoOverlap("HUD2a", snap);
            return `viewport-fit=cover + 47/47/34/47 stubs: every HUD box inside the safe rect, pairwise clear`;
          });
          if (c3.errors.length) rows.push({ req: "harness", id: "C3", title: "landscape page errors", pass: false, ev: c3.errors.join(" | ") });
        } finally {
          await c3.context.close().catch(() => undefined);
        }
      }

      // --- verdict -----------------------------------------------------------

      const REQ_TITLES = {
        "game-flow": "game-flow",
        "input-schemes": "input-schemes",
        onboarding: "onboarding",
        "hud-presentation": "hud-presentation",
        audio: "audio",
        harness: "harness",
      };
      console.log("\n=== SPEC-BY-SPEC ACCEPTANCE WALK (task 9.4) ===");
      let lastReq = null;
      for (const r of rows) {
        if (r.req !== lastReq) {
          console.log(`--- ${REQ_TITLES[r.req] ?? r.req} ---`);
          lastReq = r.req;
        }
        console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(6)} ${r.title} — ${r.ev}`);
      }
      const failed = rows.filter((r) => !r.pass);
      console.log(`\n${rows.length - failed.length}/${rows.length} scenarios pass`);
      if (failed.length) {
        throw new Error(
          `spec-walk: ${failed.length}/${rows.length} FAILED\n` +
            failed.map((f) => `  ${f.req}.${f.id} ${f.title}: ${f.ev}`).join("\n"),
        );
      }
      return `all ${rows.length} scenarios across the five delta specs PASS (see console table)`;
    },
  },

  {
    name: "regression-captures",
    run: async () => {
      // World captures must stay byte-identical: run + orbit pin live days,
      // and the shell renders nothing during them (ShotDirector pins the mode
      // to "playing" so the boot title never covers a world shot).
      const outDir = path.join(root, "shots", "b2-check");
      const res = spawnSync(
        process.execPath,
        [
          "tools/shoot.mjs",
          "--url",
          url,
          "--out",
          outDir,
          "--spec",
          "run",
          "--spec",
          "win",
          "--spec",
          "orbit",
        ],
        { cwd: root, encoding: "utf8", timeout: 420000 },
      );
      assert(res.status === 0, `shoot.mjs failed (exit ${res.status}):\n${(res.stderr || res.stdout || "").slice(-1500)}`);
      for (const name of ["run", "orbit"]) {
        const got = path.join(outDir, `${name}.png`);
        const base = path.join(root, "shots", "baseline", `${name}.png`);
        assert(existsSync(base), `missing baseline ${base}`);
        assert(existsSync(got), `capture missing: ${got}`);
        const same = readFileSync(got).equals(readFileSync(base));
        assert(same, `pinned capture ${name}.png differs from baseline (byte compare)`);
      }
      // win.png is intentionally NO LONGER compared to its baseline: the
      // win/lose banners moved off the HUD canvas into the DOM results
      // screens (task 2.3 — "results screens replace thin banners"), which
      // legitimately changes the staged win frame. It must still capture
      // cleanly (spawn above) AND be self-stable: an independent second
      // capture run must land byte-identical.
      const outDir2 = path.join(root, "shots", "b2-check2");
      const res2 = spawnSync(
        process.execPath,
        ["tools/shoot.mjs", "--url", url, "--out", outDir2, "--spec", "win"],
        { cwd: root, encoding: "utf8", timeout: 420000 },
      );
      assert(res2.status === 0, `second win capture failed (exit ${res2.status}):\n${(res2.stderr || res2.stdout || "").slice(-1500)}`);
      const winA = readFileSync(path.join(outDir, "win.png"));
      const winB = readFileSync(path.join(outDir2, "win.png"));
      assert(winA.equals(winB), "win.png not self-stable across capture runs (byte compare)");
      return `run.png + orbit.png byte-identical to baseline; win.png clean + self-stable (banner removal is the intended spec change)`;
    },
  },
];

const onlyList = argValues("--only");
const chosen = onlyList.length ? sections.filter((s) => onlyList.includes(s.name)) : sections;
if (chosen.length === 0) {
  console.error(`no section named "${onlyList.join(", ")}" (known: ${sections.map((s) => s.name).join(", ")})`);
  process.exit(2);
}

if (doShots) {
  await captureShellShots();
  console.log("shell shots captured");
  process.exit(0);
}

const browser = await chromium.launch({ args: BROWSER_ARGS });

const results = [];
for (const section of chosen) {
  process.stdout.write(`probe ${section.name} … `);
  let ok = true;
  let message = "ok";
  let page = null;
  let context = null;
  try {
    let errors;
    let detail;
    if (section.touch) {
      // Emulated phone page + a CDP session for trusted touch gestures.
      const t = await freshTouchPage(browser, { taught: section.taught !== false });
      page = t.page;
      context = t.context;
      errors = t.errors;
      detail = await section.run(page, t.cdp, browser);
    } else {
      const ctx = await freshPage(browser, { taught: section.taught !== false });
      page = ctx.page;
      errors = ctx.errors;
      detail = await section.run(page, undefined, browser);
    }
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
    message = detail ?? "ok";
  } catch (err) {
    ok = false;
    message = err.message;
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (context) await context.close().catch(() => undefined);
  }
  console.log(ok ? "PASS" : "FAIL");
  if (!ok || chosen.length > 1) console.log(`  ${message}`);
  results.push({ name: section.name, ok, message });
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} sections passed`);
if (failed.length) {
  console.error("FAILED:");
  for (const r of failed) console.error(`  - ${r.name}: ${r.message}`);
  process.exit(1);
}
console.log("all probe sections passed");
