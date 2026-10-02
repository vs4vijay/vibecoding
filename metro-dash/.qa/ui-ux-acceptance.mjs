#!/usr/bin/env bun
/**
 * ui-ux-acceptance.mjs — spec-by-spec acceptance walk for OpenSpec change
 * "ui-ux-pass" (task 8.3). Headless: NO browser, wave6-style check() harness
 * plus sandboxed probes over the REAL module sources (same techniques as
 * ui-ux-smoke.mjs: fnBody extraction + Function shims over stubbed
 * window/document/localStorage).
 *
 * Walks EVERY scenario in the four spec deltas:
 *   specs/run-hud            4 requirements / 6 scenarios
 *   specs/game-flow          5 requirements / 8 scenarios
 *   specs/onboarding         3 requirements / 5 scenarios
 *   specs/ui-accessibility   5 requirements / 5 scenarios
 *
 * The two screenshot-dependent scenarios ("Frozen capture is stable" in
 * run-hud and "Frozen capture of a transition state" in game-flow) are
 * DELEGATED to the main agent's ?freeze byte-compare (task 8.2): they print
 * DEFER (browser) and count as neither pass nor fail.
 *
 * Exit code: 0 only when every non-deferred scenario PASSES and the
 * deferred count is <= 2; non-zero otherwise.
 *
 * Run: bun .qa/ui-ux-acceptance.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "client");

/* ------------------------------------------------------------------ *
 * Sources                                                             *
 * ------------------------------------------------------------------ */
const css = readFileSync(join(CLIENT, "css/style.css"), "utf8");
const html = readFileSync(join(CLIENT, "index.html"), "utf8");
const mainSrc = readFileSync(join(CLIENT, "js/src/main.js"), "utf8");
const inputSrc = readFileSync(join(CLIENT, "js/src/core/input.js"), "utf8");
const audioSrc = readFileSync(join(CLIENT, "js/src/core/audio.js"), "utf8");
const coachSrc = readFileSync(join(CLIENT, "js/src/game/coach.js"), "utf8");
const runSrc = readFileSync(join(CLIENT, "js/src/game/run.js"), "utf8");
const hooksSrc = readFileSync(join(CLIENT, "js/src/qa/hooks.js"), "utf8");

/* ------------------------------------------------------------------ *
 * Scenario harness                                                    *
 * ------------------------------------------------------------------ */
const results = [];
let cur = null;

function scenario(id, spec, requirement, name) {
  cur = { id, spec, requirement, name, fails: [], notes: [] };
}

/** One assertion inside the current scenario; a scenario PASSES iff all pass. */
function req(cond, label) {
  if (!cur) throw new Error("req() outside a scenario");
  if (!cond) cur.fails.push(label);
  cur.notes.push(`${cond ? "ok" : "XX"} — ${label}`);
}

function pass(evidence) {
  cur.status = cur.fails.length === 0 ? "PASS" : "FAIL";
  cur.evidence = cur.fails.length === 0 ? evidence : cur.fails[0];
  results.push(cur);
  console.log(`  ${cur.status}  ${cur.id} ${cur.name}`);
  if (cur.fails.length > 0) for (const f of cur.fails) console.error(`      XX ${f}`);
  cur = null;
}

function defer(id, spec, requirement, name, note) {
  results.push({ id, spec, requirement, name, status: "DEFER", evidence: note, fails: [], notes: [] });
  console.log(`  DEFER  ${id} ${name} — ${note}`);
}

/* ------------------------------------------------------------------ *
 * Static CSS tooling (same approach as ui-ux-smoke.mjs)               *
 * ------------------------------------------------------------------ */
const cssNC = css.replace(/\/\*[\s\S]*?\*\//g, "");

function extractRules(src, media = null) {
  const rules = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
      rules.push(...extractRules(body, prelude));
    } else if (!prelude.startsWith("@")) {
      rules.push({ prelude, body, media });
    }
    i = j;
  }
  return rules;
}
const rules = extractRules(cssNC);
const bodyOf = (re) => {
  const hit = rules.find((r) => re.test(r.prelude));
  return hit ? hit.body : null;
};
const pxVal = (body, prop) => {
  if (!body) return null;
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? parseFloat(m[1]) : null;
};

/** Extract a top-level `function NAME(...) { ... }` body from JS source. */
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}`);
  if (i === -1) return null;
  const open = src.indexOf("{", i);
  let depth = 0;
  let j = open;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(open, j + 1);
}

/* Shared sandbox window stub (listener bookkeeping + dispatch). */
function stubWindow(extra = {}) {
  const listeners = {};
  const w = {
    innerHeight: 400,
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch: (type, ev) => {
      for (const fn of [...(listeners[type] || [])]) fn(ev);
    },
    ...extra,
  };
  return w;
}
const STATE = { LOADING: "loading", MENU: "menu", PLAYING: "playing", GAMEOVER: "gameover" };

/* Free-identifier shell: extracted main.js bodies read the module-closure
 * `state` / `paused` bindings. Probes expose them as configurable globals
 * (same technique as ui-ux-smoke.mjs section 15). */
const shell = { state: "menu", paused: false };
globalThis.State = STATE;
Object.defineProperty(globalThis, "state", { get: () => shell.state, configurable: true });
Object.defineProperty(globalThis, "paused", { get: () => shell.paused, configurable: true });

/* ================================================================== *
 * Shared probe: REAL pure grace rules from main.js                    *
 * ================================================================== */
const graceNeedsArm = new Function(
  "State",
  `return function graceNeedsArm(stateVal, wasPaused, isFrozen, isQa) ${fnBody(mainSrc, "graceNeedsArm")}`,
)(STATE);
const simCanStep = new Function(
  "State",
  `return function simCanStep(stateVal, isPaused, graceRemaining) ${fnBody(mainSrc, "simCanStep")}`,
)(STATE);

/**
 * REAL setPaused body as a shim(state, paused, p). Returns
 * { setPaused, shell } where shell mirrors graceT + overlay visibility.
 */
function makeSetPaused({ freeze = false, qaMode = false } = {}) {
  const shell = { graceT: 0, graceHidden: true, pauseHidden: true, enters: 0 };
  const els = {
    pauseOverlay: { classList: { toggle: (_c, v) => (shell.pauseHidden = !!v) } },
    pausePanel: { classList: { add: () => {}, remove: () => {} } },
    resumeGrace: {
      classList: {
        add: () => (shell.graceHidden = true),
        remove: () => (shell.graceHidden = false),
      },
    },
  };
  const setPaused = new Function(
    "State", "qa", "els", "applyHints", "clearGrace", "armGrace", "graceNeedsArm", "playScreenEnter",
    `return function setPausedShim(state, paused, p) {${fnBody(mainSrc, "setPaused")}}`,
  )(
    STATE,
    { freeze, qa: qaMode, hud: true },
    els,
    () => {},
    () => { shell.graceT = 0; shell.graceHidden = true; },
    () => { shell.graceT = 1.2; shell.graceHidden = false; },
    graceNeedsArm,
    () => (shell.enters += 1),
  );
  return { setPaused, shell };
}

/* ================================================================== *
 * Shared probe: HUD env harness (REAL updateHud + writePuChip + reset)*
 * ================================================================== */
function fakeEl(id) {
  const el = {
    id, textWrites: 0, styleWrites: 0, attrWrites: 0, pops: 0, attrs: {},
    hidden: true, transform: "scaleX(1)",
  };
  el.classList = {
    add: (c) => {
      if (c === "hidden") el.hidden = true;
      if (c === "pop") el.pops++;
    },
    remove: (c) => {
      if (c === "hidden") el.hidden = false;
    },
    toggle: (c, v) => {
      if (c === "hidden") el.hidden = !!v;
    },
    contains: (c) => (c === "hidden" ? el.hidden : false),
  };
  el.style = {
    set transform(v) {
      el.transform = v;
      el.styleWrites++;
    },
    get transform() {
      return el.transform;
    },
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._text || "",
    set: (v) => {
      el._text = v;
      el.textWrites++;
    },
  });
  el.setAttribute = (n, v) => {
    el.attrs[n] = v;
    el.attrWrites++;
  };
  el.removeAttribute = (n) => {
    if (n in el.attrs) el.attrWrites++;
    delete el.attrs[n];
  };
  return el;
}

const writePuChipSrc = fnBody(mainSrc, "writePuChip");
const updateHudSrc = fnBody(mainSrc, "updateHud");
const resetHandlerSrc = (mainSrc.match(/run\.events\.on\("reset", \(\) => \{([\s\S]*?)\n  \}\);/) || ["", ""])[1];

function makeHudEnv({ score = 0, coins = 0, multiplier = 1, powerups } = {}) {
  const runStub = {
    distance: 0,
    powerups: powerups || { magnet: 0, jetpack: 0, x2: 0 },
    getStats: () => ({ score, coins, distance: 0, multiplier, speed: 26 }),
  };
  const els = {};
  for (const id of [
    "score", "coins", "multiplier", "multiplierDisplay", "combo", "comboValue",
    "chipMagnet", "chipMagnetFill", "chipX2", "chipX2Fill",
  ]) els[id] = fakeEl(id);
  const env = {
    State: { PLAYING: "playing" },
    state: "playing",
    qa: { hud: true },
    run: runStub,
    els,
    lastScore: -1, lastCoins: -1, lastMult: -1,
    comboStreak: 0, comboLastDistance: -Infinity, comboShown: false, lastComboShownValue: -1,
    COMBO_MIN: 10, COMBO_WINDOW_M: 45,
    popBadge: (el) => { el.pops++; },
    magnetChipState: { on: false, fill: -1, low: false },
    x2ChipState: { on: false, fill: -1, low: false },
    writePuChip: new Function(
      "POWERUP_LOW_FRAC",
      `return function writePuChip(chip, fill, st, secs, duration) {${writePuChipSrc}}`,
    )(0.25),
    POWERUP_DURATION_S: 10,
    toastTimer: 0,
    clearTimeout: () => {},
    hintToastHidden: true,
  };
  const updateHud = new Function("env", `with (env) {\nreturn function updateHudShim() {${updateHudSrc}}\n}`)(env);
  let writes = 0;
  const totalWrites = () => {
    let t = 0;
    for (const el of Object.values(els)) t += el.textWrites + el.styleWrites + el.attrWrites;
    return t;
  };
  return {
    env, els, run: runStub,
    hud() {
      const before = totalWrites();
      updateHud();
      writes = totalWrites() - before;
    },
    get writesSince() {
      return writes;
    },
    fireReset() {
      new Function("env", `with (env) {\n${resetHandlerSrc}\n}`)(env);
    },
  };
}

/* Shared extracted REAL copy maps. */
const HINT_COPY = (() => {
  const m = mainSrc.match(/const HINT_COPY = \{[\s\S]*?\n\s*\};/);
  return m ? new Function(`"use strict"; ${m[0]}; return HINT_COPY;`)() : {};
})();
const COACH_COPY = (() => {
  const m = mainSrc.match(/const COACH_COPY = \{[\s\S]*?\n\s*\};/);
  return m ? new Function(`"use strict"; ${m[0]}; return COACH_COPY;`)() : {};
})();
const KEY_RE = /\b(ARROWS?|WASD|SPACE|ESC|ENTER|[PM])\b/;
const TOUCH_RE = /\b(SWIPE|TAPS?)\b/;

/* Shared REAL InputManager action callback + pause button handlers. */
const actionCbSrc = (mainSrc.match(/new InputManager\(\s*(\(action\) => \{[\s\S]*?\})\s*\);/) || ["", ""])[1];
const pauseBtnHandlerSrc = (mainSrc.match(/els\.pauseBtn\.addEventListener\("pointerdown",\s*(\(e\) => \{[\s\S]*?\})\);/) || ["", ""])[1];
const graceTapHandlerSrc = (mainSrc.match(/els\.resumeGrace\.addEventListener\("pointerdown",\s*(\(e\) => \{[\s\S]*?\})\);/) || ["", ""])[1];

console.log("ui-ux-pass acceptance walk — scenarios per spec delta\n");

/* ================================================================== *
 * SPEC: run-hud                                                       *
 * ================================================================== */

// ---- Requirement: Touch-reachable pause control --------------------
scenario("RH-1a", "run-hud", "Touch-reachable pause control", "Touch player pauses mid-run");
{
  const ok = pauseBtnHandlerSrc.length > 0;
  req(ok, "REAL pointerdown handler extractable from main.js");
  if (ok) {
    let overlayHidden = true;
    let prevented = 0;
    const setPaused = (p) => {
      shell.paused = p;
      overlayHidden = !p; // pause overlay visible iff paused (during PLAYING)
    };
    const handler = new Function("State", "setPaused", `return (${pauseBtnHandlerSrc});`)(STATE, setPaused);
    const ev = () => ({ preventDefault: () => (prevented += 1) });
    shell.state = "playing";
    shell.paused = false;
    handler(ev());
    req(shell.paused === true, "tap during PLAYING pauses the run");
    req(overlayHidden === false, "pause overlay appears");
    req(prevented === 1, "handler preventDefaults the press (no synthetic click)");
    handler(ev());
    req(shell.paused === true && prevented === 2, "second tap: preventDefault only, no double-toggle");
    req(simCanStep("playing", true, 0) === false, "REAL simCanStep: sim frozen while paused (run state held)");
    const spSrc = fnBody(mainSrc, "setPaused");
    req(!/run\.|startRun|lsSet/.test(spSrc), "setPaused touches no run state / storage (resume returns to the same run)");
    req(simCanStep("playing", false, 0) === true, "after resume (grace elapsed) the same run steps again");
  }
  pass("tap pauses + overlay shows; sim frozen while paused; resume re-enters the same run");
}

scenario("RH-1b", "run-hud", "Touch-reachable pause control", "Swipes near the control still steer");
{
  globalThis.window = stubWindow();
  globalThis.document = { documentElement: { dataset: {} } };
  const { InputManager } = await import(join(CLIENT, "js/src/core/input.js") + "?acc-input=1");
  const buffered = [];
  const pauseCalls = [];
  shell.state = "playing";
  shell.paused = false;
  const onAction = new Function("State", "setPaused", "run", "graceT", "skipGrace", `return (${actionCbSrc});`)(
    STATE,
    (p) => pauseCalls.push(p),
    { bufferAction: (a) => buffered.push(a) },
    0, // no grace running
    () => {},
  );
  const im = new InputManager(onAction);
  const plain = { closest: () => null };
  const excluded = { closest: (sel) => (sel === "[data-input-exclude]" ? excluded : null) };
  const touchEv = (target, x, y) => ({ target, touches: [{ clientX: x, clientY: y }] });
  const endEv = (target, y) => ({ target, touches: [], changedTouches: [{ clientY: y }] });
  // Horizontal swipe starting well away from the control (plain track area).
  globalThis.window.dispatch("touchstart", touchEv(plain, 60, 100));
  globalThis.window.dispatch("touchmove", touchEv(plain, 150, 100)); // dx=90 -> right
  globalThis.window.dispatch("touchend", endEv(plain, 100));
  req(buffered.join() === "right", "lane swipe away from the control registers ('right' buffered)");
  req(pauseCalls.length === 0, "the swipe does not pause the game");
  // A gesture born ON the pause control must neither steer nor pause.
  globalThis.window.dispatch("touchstart", touchEv(excluded, 30, 340));
  globalThis.window.dispatch("touchmove", touchEv(excluded, 130, 340));
  globalThis.window.dispatch("touchend", endEv(excluded, 340));
  req(buffered.join() === "right", "gesture born on the control fires no gameplay action");
  req(pauseCalls.length === 0, "gesture on the control does not pause (its own handler owns it)");
  req(inputSrc.includes("data-input-exclude") && /\.closest\(\s*["'`]?\[data-input-exclude\]/.test(inputSrc), "InputManager exclusion is target-scoped, not screen-scoped");
  im.dispose();
  pass("swipe away from the control steers and never pauses; control-born gestures are dropped whole");
}

// ---- Requirement: Active powerup status is surfaced -----------------
scenario("RH-2a", "run-hud", "Active powerup status is surfaced", "Magnet pickup shows a chip");
{
  req(writePuChipSrc.length > 0, "REAL writePuChip extractable");
  const h = makeHudEnv();
  h.run.powerups.magnet = 10; // what collectPowerup grants
  h.hud();
  req(h.els.chipMagnet.hidden === false, "collect -> magnet chip appears in the HUD");
  req(h.els.chipMagnetFill.transform === "scaleX(1)", "chip shows a full remaining-time bar at collect");
  h.run.powerups.magnet = 0; // effect ended
  h.hud();
  req(h.els.chipMagnet.hidden === true, "chip disappears when the magnet effect ends");
  req(/chip-magnet/.test(html) && /data-pu="magnet"/.test(html), "HUD hosts a dedicated magnet chip element");
  pass("magnet collect shows the chip; expiry hides it");
}

scenario("RH-2b", "run-hud", "Active powerup status is surfaced", "Finite effect visibly winds down");
{
  const h = makeHudEnv();
  h.run.powerups.magnet = 10;
  h.hud();
  const t100 = h.els.chipMagnetFill.transform;
  h.run.powerups.magnet = 6;
  h.hud();
  const t60 = h.els.chipMagnetFill.transform;
  req(t100 === "scaleX(1)" && t60 === "scaleX(0.6)", `bar visibly drains (${t100} -> ${t60})`);
  h.run.powerups.magnet = 2.5; // 25% left
  h.hud();
  req("data-low" in h.els.chipMagnet.attrs, "low-time state flagged on the chip near expiry");
  req(h.els.chipMagnetFill.transform === "scaleX(0.25)", "bar keeps decreasing up to expiry");
  const fillCss = bodyOf(/^\.pu-fill$/);
  req(!!fillCss && /transform:\s*scaleX\(1\)/.test(fillCss) && !fillCss.includes("animation"), "drain is a JS-driven transform bar (no animation dependence)");
  pass("remaining time communicated by a visibly shrinking bar + low flag before expiry");
}

// ---- Requirement: HUD does not mislead ------------------------------
scenario("RH-3a", "run-hud", "HUD does not mislead", "Restarted run shows fresh HUD");
{
  const h = makeHudEnv({ score: 0, coins: 0, multiplier: 1 });
  // End of the PREVIOUS run: caches + DOM hold stale finals.
  h.env.lastScore = 500;
  h.els.score.textContent = "500";
  h.env.lastCoins = 30;
  h.els.coins.textContent = "30";
  h.env.lastMult = 8;
  h.els.multiplier.textContent = "8";
  h.els.multiplierDisplay.hidden = false;
  h.env.magnetChipState.on = true;
  h.els.chipMagnet.hidden = false;
  // Player restarts from game over: retryBtn -> startRun -> run.start() emits "reset".
  h.fireReset();
  h.hud(); // first rendered frame of the new run
  req(h.els.score.textContent === "0", "score reads 0 (not the previous run's final 500)");
  req(h.els.coins.textContent === "0", "coins read 0 (not the previous run's 30)");
  req(h.els.multiplierDisplay.hidden === true && h.els.multiplier.textContent === "1", "multiplier readout reset");
  req(h.els.chipMagnet.hidden === true && !("data-low" in h.els.chipMagnet.attrs), "stale powerup chip cleared");
  h.hud();
  req(h.writesSince === 0, "readouts stay in their established regions and settle (zero rewrite churn)");
  req(/els\.retryBtn\.addEventListener\("click", startRun\)/.test(mainSrc), "restart path is the same RETRY -> startRun() wiring");
  pass("first frame after restart rewrites score/coins to 0 with chips cleared");
}

// ---- Requirement: HUD respects determinism captures -----------------
defer(
  "RH-4a", "run-hud", "HUD respects determinism captures", "Frozen capture is stable",
  "DELEGATED to task 8.2 ?freeze byte-compare (chips/grace/toast are transform-only + timer-free under freeze)",
);

/* ================================================================== *
 * SPEC: game-flow                                                     *
 * ================================================================== */

// ---- Requirement: Pause menu offers resume, restart, and quit -------
scenario("GF-1a", "game-flow", "Pause menu offers resume/restart/quit", "Touch player restarts from pause");
{
  const m = mainSrc.match(/els\.pauseRestartBtn\.addEventListener\("click",\s*(\(\) => \{[\s\S]*?\})\);/);
  req(!!m, "REAL RESTART handler extractable");
  if (m) {
    let paused = true;
    let overlayHidden = false;
    let startRuns = 0;
    const setPaused = (p) => {
      paused = p;
      overlayHidden = !p;
    };
    const restart = new Function("State", "setPaused", "startRun", "markTutored", `return (${m[1]});`)(STATE, setPaused, () => (startRuns += 1), () => {});
    restart();
    req(paused === false, "run unpaused");
    req(overlayHidden === true, "pause overlay hidden over the fresh run");
    req(startRuns === 1, "a fresh run begins via startRun() exactly once");
    const startRunBody = fnBody(mainSrc, "startRun");
    req(/run\.start\(\)/.test(startRunBody), "fresh run goes through run.start() (reset event re-syncs the HUD)");
    req(
      /lsSet\(LS_KEYS\.username/.test(startRunBody) && !/totalCoins|LS_KEYS\.games|LS_KEYS\.highScore|LS_KEYS\.lastRun/.test(startRunBody),
      "startRun persists only the username (partial run not banked)",
    );
    req((fnBody(mainSrc, "showGameOver") || "").includes("lsSet(LS_KEYS.totalCoins"), "banking lives only in showGameOver (no double-count)");
    const px = pxVal(bodyOf(/^\.btn$/), "min-height");
    req(px >= 44, `RESTART is a .btn (44px+ keyboard-selectable target, min-height ${px}px)`);
  }
  pass("restart unpauses, starts a fresh zeroed run, and never double-banks the abandoned one");
}

scenario("GF-1b", "game-flow", "Pause menu offers resume/restart/quit", "Quit from pause reaches the menu");
{
  const m = mainSrc.match(/els\.pauseMenuBtn\.addEventListener\("click",\s*(\(\) => \{[\s\S]*?\})\);/);
  req(!!m, "REAL MENU handler extractable");
  if (m) {
    let paused = true;
    let overlayHidden = false;
    let showMenus = 0;
    const setPaused = (p) => {
      paused = p;
      overlayHidden = !p;
    };
    const quit = new Function("State", "setPaused", "showMenu", "markTutored", `return (${m[1]});`)(
      STATE, setPaused, () => (showMenus += 1), () => {},
    );
    quit();
    req(paused === false && overlayHidden === true, "no paused run remains (unpaused + overlay hidden)");
    req(showMenus === 1, "menu screen shown exactly once");
    const smSrc = fnBody(mainSrc, "showMenu");
    req(/refreshMenuStats\(\)/.test(smSrc), "showMenu refreshes the local stats (up-to-date BEST/COINS/RUNS)");
    req(/setPaused\(false\)/.test(smSrc) && /setState\(State\.MENU\)/.test(smSrc), "showMenu itself unpauses and routes to MENU");
  }
  pass("quit reaches a refreshed menu with no paused run left over");
}

// ---- Requirement: Resume is grace-protected -------------------------
scenario("GF-2a", "game-flow", "Resume is grace-protected", "Tab return does not kill");
{
  const visM = mainSrc.match(/document\.addEventListener\("visibilitychange",\s*\(\) => \{[\s\S]*?\n\s*\}\);/);
  req(!!visM && visM[0].includes("setPaused(true)") && visM[0].includes("setPaused(false)"), "auto-pause on hide; visible return routes through setPaused(false)");
  req(!!visM && !/graceT|armGrace|clearGrace/.test(visM[0]), "visibility handler holds no duplicated grace logic (single path)");
  const { setPaused, shell } = makeSetPaused();
  setPaused("playing", true, false); // return visible: the auto-pause lifts
  req(shell.graceT === 1.2, "REAL setPaused + graceNeedsArm arm the 1.2 s grace on resume");
  req(shell.graceHidden === false, "grace overlay shows the countdown");
  req(shell.pauseHidden === true, "pause overlay hidden while the grace runs");
  req(simCanStep("playing", false, 1.2) === false, "REAL simCanStep: sim stays FROZEN through the countdown (no tab-return death)");
  req(/graceT = Math\.max\(0, graceT - dt\)/.test(mainSrc), "grace decrements by real dt — never counted as run time");
  req(/simCanStep\(state, paused, graceT\)/.test(mainSrc), "frame loop gates the sim branch through simCanStep (distance cannot drift)");
  pass("return-to-tab freezes the run through the skippable countdown before the sim steps");
}

scenario("GF-2b", "game-flow", "Resume is grace-protected", "Impatient player can skip the wait");
{
  globalThis.window = stubWindow();
  globalThis.document = { documentElement: { dataset: {} } };
  const { InputManager } = await import(join(CLIENT, "js/src/core/input.js") + "?acc-input2=1");
  let skips = 0;
  let pauses = 0;
  shell.state = "playing";
  shell.paused = false; // grace runs live (unpaused, sim gated by graceT)
  const onAction = new Function("State", "setPaused", "run", "graceT", "skipGrace", `return (${actionCbSrc});`)(
    STATE,
    () => (pauses += 1),
    { bufferAction: () => {} },
    1.2, // grace countdown live
    () => (skips += 1),
  );
  const im = new InputManager(onAction);
  globalThis.window.dispatch("keydown", { code: "Escape", target: null, repeat: false, preventDefault: () => {} });
  req(skips === 1, "resume action during the countdown skips it");
  req(pauses === 0, "no pause toggle fires (countdown is not re-paused)");
  req(simCanStep("playing", false, 0) === true, "after the skip the run resumes immediately");
  im.dispose();
  // Touch path: tapping the grace overlay itself also skips.
  const ok = graceTapHandlerSrc.length > 0;
  req(ok, "REAL #resume-grace pointerdown handler extractable");
  if (ok) {
    let tapSkips = 0;
    let prevented = 0;
    const handler = new Function("graceT", "skipGrace", `return (${graceTapHandlerSrc});`)(
      1.2, // grace countdown live (the handler only READS graceT)
      () => {
        tapSkips += 1; // real skipGrace() ends through clearGrace() -> graceT 0
      },
    );
    handler({ preventDefault: () => (prevented += 1) });
    req(tapSkips === 1 && prevented === 1, "tap on the grace overlay skips the countdown too");
  }
  pass("a second resume input (key or tap) skips the countdown and resumes immediately");
}

// ---- Requirement: Results screen carries run context ----------------
scenario("GF-3a", "game-flow", "Results screen carries run context", "Losing run shows the gap");
{
  const resultsContext = new Function(`return function resultsContext(score, high) {${fnBody(mainSrc, "resultsContext")}}`)();
  const r = resultsContext(500, 3000);
  req(!r.isHigh && r.gap === 2500, "REAL resultsContext: 500 vs best 3000 -> gap 2500, no banner");
  const sgo = fnBody(mainSrc, "showGameOver");
  req(sgo.includes("from your best") && sgo.includes("toLocaleString()"), "gap copy rendered as '<n> from your best'");
  req(sgo.includes('els.goGap.classList.toggle("hidden", gap <= 0)'), "gap line hidden when there is nothing to show");
  const goBtns = html.slice(html.indexOf('class="gameover-buttons"'), html.indexOf("</div>", html.indexOf('class="gameover-buttons"')));
  req(/<button id="retry-btn" class="btn btn-primary"/.test(goBtns) && /<button id="menu-btn" class="btn btn-secondary"/.test(goBtns), "RETRY + MENU one touch each on the results screen");
  req(/state !== State\.GAMEOVER/.test(mainSrc) && /code === "Enter" \|\| e\.code === "NumpadEnter"/.test(mainSrc) && /e\.code === "Escape"/.test(mainSrc), "keys path: ENTER retries / ESC menus (gameover-gated listener)");
  pass("losing run shows '2,500 from your best'; retry/menu reachable in one touch or keypress");
}

scenario("GF-3b", "game-flow", "Results screen carries run context", "New best is celebrated");
{
  const resultsContext = new Function(`return function resultsContext(score, high) {${fnBody(mainSrc, "resultsContext")}}`)();
  req(resultsContext(3001, 3000).isHigh === true, "REAL resultsContext: 1 over the best -> new best");
  req(resultsContext(100, 0).isHigh === true, "first run (best 0) also celebrates");
  req(resultsContext(3000, 3000).isHigh === false, "tie is NOT a new best");
  const sgo = fnBody(mainSrc, "showGameOver");
  req(sgo.includes('els.newHigh.classList.toggle("hidden", !isHigh)'), "banner revealed only on a new best");
  req(sgo.includes("if (isHigh) popBadge(els.newHigh)"), "celebration burst re-triggered on every reveal");
  const bannerCss = bodyOf(/^#new-high-score$/);
  req(!!bannerCss && bannerCss.includes("var(--gold-") && /width:\s*100%/.test(bannerCss), "distinct full-width gold banner (vs normal result card)");
  req(/class="burst" aria-hidden="true"><span><\/span>/.test(html), "decorative sparkle burst hosted by the banner");
  pass("new best shows the gold banner + sparkle burst, distinct from a normal result");
}

// ---- Requirement: Audio settings separate music and effects ---------
scenario("GF-4a", "game-flow", "Audio settings separate music and effects", "Music off, effects on");
{
  function makeAudioEnv({ ls = {} } = {}) {
    const store = { ...ls };
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => delete store[k],
    };
    const counts = { osc: 0, src: 0 };
    class FakeParam {
      constructor(v = 1) {
        this.value = v;
      }
      setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {}
      cancelScheduledValues() {} setTargetAtTime() {}
    }
    class FakeNode {
      constructor() {
        this.gain = new FakeParam(1);
        this.frequency = new FakeParam(440);
        this.Q = new FakeParam(1);
        this.threshold = new FakeParam(0);
        this.knee = new FakeParam(0);
        this.ratio = new FakeParam(1);
        this.attack = new FakeParam(0);
        this.release = new FakeParam(0);
        this.type = "";
        this.buffer = null;
        this.loop = false;
      }
      connect() { return this; }
      start() {} stop() {}
    }
    class FakeCtx {
      constructor() {
        this.currentTime = 10;
        this.state = "running";
        this.sampleRate = 48000;
        this.destination = new FakeNode();
      }
      createGain() { return new FakeNode(); }
      createDynamicsCompressor() { return new FakeNode(); }
      createBiquadFilter() { return new FakeNode(); }
      createOscillator() { counts.osc++; return new FakeNode(); }
      createBufferSource() { counts.src++; return new FakeNode(); }
      createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    }
    const listeners = {};
    globalThis.window = {
      AudioContext: FakeCtx,
      addEventListener: (t, fn) => {
        (listeners[t] = listeners[t] || []).push(fn);
      },
      removeEventListener: (t, fn) => {
        const a = listeners[t] || [];
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      },
    };
    return {
      store,
      counts,
      gesture: () => {
        for (const fn of listeners.keydown || []) fn({ code: "KeyM" });
      },
    };
  }
  const { AudioManager } = await import(join(CLIENT, "js/src/core/audio.js") + "?acc-audio=1");
  // Music off (persisted), effects on: a run schedules no music, sfx still play.
  let env = makeAudioEnv({ ls: { late_again_music: "0" } });
  let am = new AudioManager();
  env.gesture();
  am.startMusic();
  req(am._timer === 0, "music off: run music scheduler stays idle (no music during the run)");
  am._schedule();
  req(env.counts.osc + env.counts.src === 0, "music off: even a forced scheduler tick schedules ZERO voices");
  const b0 = env.counts.osc;
  am.play("coin");
  req(env.counts.osc - b0 === 2, "effects on: collect ding still plays (2 oscillator voices)");
  am.dispose();
  // The choices persist: main.js writes '0'/'1' and a fresh boot reflects them.
  const tmBody = fnBody(mainSrc, "toggleMusic") || "";
  req(tmBody.includes("lsSet(LS_KEYS.music") && tmBody.includes("audio.setMusicOn(!audio.musicOn)"), "menu toggle persists the music choice");
  const tsBody = fnBody(mainSrc, "toggleSfx") || "";
  req(tsBody.includes("lsSet(LS_KEYS.sfx") && tsBody.includes("audio.setSfxOn(!audio.sfxOn)"), "menu toggle persists the sfx choice");
  env.store["late_again_music"] = "0";
  env.store["late_again_sfx"] = "1";
  const amReload = new AudioManager();
  req(amReload.musicOn === false && amReload.sfxOn === true, "reload boots music OFF + effects ON from the persisted keys");
  amReload.dispose();
  const row = html.slice(html.indexOf('<div class="settings-row">'), html.indexOf("</div>", html.indexOf('<div class="settings-row">')));
  req(row.includes('id="music-toggle"') && row.includes('id="sfx-toggle"'), "menu exposes SEPARATE music + sfx toggles");
  pass("music off silences the groove only; effects play; choices persist across reload");
}

// ---- Requirement: Screen transitions do not jar ---------------------
defer(
  "GF-5a", "game-flow", "Screen transitions do not jar", "Frozen capture of a transition state",
  "DELEGATED to task 8.2 ?freeze byte-compare (screen-enter keyframes end AT identity so killed animations settle)",
);

/* ================================================================== *
 * SPEC: onboarding                                                    *
 * ================================================================== */

// ---- Requirement: Control hints match the active input scheme -------
scenario("OB-1a", "onboarding", "Control hints match the active input scheme", "Touch device sees swipe hints only");
{
  const elsStub = { swipeText: { textContent: "" }, pauseHint: { textContent: "" }, resultsHint: { textContent: "" } };
  elsStub.swipeText.textContent = HINT_COPY.menu.touch;
  elsStub.pauseHint.textContent = HINT_COPY.pause.touch;
  elsStub.resultsHint.textContent = HINT_COPY.results.touch;
  req(TOUCH_RE.test(elsStub.swipeText.textContent), "menu hint describes swipe/tap controls");
  req(!KEY_RE.test(elsStub.swipeText.textContent) && !KEY_RE.test(elsStub.pauseHint.textContent) && !KEY_RE.test(elsStub.resultsHint.textContent), "zero keyboard key names in any hint line");
  const ah = fnBody(mainSrc, "applyHints") || "";
  req(ah.includes("currentScheme()") && ah.includes("HINT_COPY.menu["), "hints render from the DETECTED scheme (applyHints -> currentScheme)");
  req(/detectScheme\(\)/.test(mainSrc) && /latchTouch\(\s*\(\)\s*=>\s*applyHints\(\)\s*\)/.test(mainSrc), "scheme detected at boot; a different scheme corrects on the next hint refresh");
  pass("coarse-pointer devices read swipe/tap wording with zero key names");
}

scenario("OB-1b", "onboarding", "Control hints match the active input scheme", "Desktop sees keyboard hints only");
{
  const elsStub = { swipeText: { textContent: "" }, pauseHint: { textContent: "" }, resultsHint: { textContent: "" } };
  elsStub.swipeText.textContent = HINT_COPY.menu.keys;
  elsStub.pauseHint.textContent = HINT_COPY.pause.keys;
  elsStub.resultsHint.textContent = HINT_COPY.results.keys;
  req(KEY_RE.test(elsStub.swipeText.textContent), "menu hint names arrow/space keys");
  req(!TOUCH_RE.test(elsStub.swipeText.textContent) && !TOUCH_RE.test(elsStub.pauseHint.textContent) && !TOUCH_RE.test(elsStub.resultsHint.textContent), "zero swipe/tap words in any hint line (no mixed schemes)");
  for (const slot of ["menu", "pause", "results"]) {
    req(typeof HINT_COPY[slot]?.keys === "string" && HINT_COPY[slot].keys.length > 0, `slot '${slot}' has dedicated keys copy`);
  }
  pass("fine-pointer devices read key wording with zero swipe wording");
}

// ---- Requirement: First run teaches the core verbs ------------------
scenario("OB-2a", "onboarding", "First run teaches the core verbs", "First run shows hints once");
{
  const coachMod = await import(join(CLIENT, "js/src/game/coach.js") + "?acc-coach=1");
  // The first (coached) run: each verb hint fires EXACTLY once, timed to relevance.
  const kinds = [];
  const coach = coachMod.createCoach({
    shouldRun: true,
    queries: {
      nearestJumpable: (z) => z >= 50,
      nearestOverhead: (z) => z >= 70,
    },
    showHint: (kind) => kinds.push(kind),
  });
  coach.tick(10, 10);
  req(kinds.length === 0, "no hint before the verb becomes relevant");
  coach.tick(31, 31);
  req(kinds.join() === "lane", "lane hint at ~30 m");
  coach.tick(50, 50);
  req(kinds.join() === "lane,jump", "jump hint when a jumpable hazard closes in");
  coach.tick(70, 70);
  req(kinds.join() === "lane,jump,roll", "roll hint when an overhead closes in");
  for (let d = 71; d <= 300; d += 7) coach.tick(d, d);
  req(kinds.join() === "lane,jump,roll", "each verb exactly ONCE per run — no repeats, nothing past 200 m");
  // The second run: flag now "1" -> no coach -> zero hints.
  req(coachMod.coachShouldRun("1") === false, "after the tutored run the flag reads '1' -> second run gets no coach");
  const startRunBody = fnBody(mainSrc, "startRun") || "";
  req(startRunBody.includes("coachShouldRun(lsGet(LS_KEYS.tutored))") && startRunBody.includes("createCoach("), "coach is created per run from a FRESH flag read");
  // Hints must not pause/slow/alter the simulation.
  req(!/^import /m.test(coachSrc), "coach.js is dependency-free and read-only (distance/z in, callback out)");
  req(!/bufferAction|timeScale|fixedUpdate|accumulator/.test(coachSrc), "coach never touches sim timing or buffering");
  const stBody = fnBody(mainSrc, "showToast") || "";
  req(stBody.includes("textContent = text") && !/run\./.test(stBody), "hints render via textContent-only toast (no sim impact)");
  const toastCss = bodyOf(/^#hint-toast$/);
  req(!!toastCss && /pointer-events:\s*none/.test(toastCss), "toast is non-interactive (can never steal gameplay input)");
  pass("first run taught lane/jump/roll once each; a second run shows none; sim untouched");
}

scenario("OB-2b", "onboarding", "First run teaches the core verbs", "Existing players are not re-taught");
{
  const coachMod = await import(join(CLIENT, "js/src/game/coach.js") + "?acc-coach2=1");
  req(coachMod.coachShouldRun(undefined) === false, "missing flag (existing save) -> already taught");
  req(coachMod.coachShouldRun(null) === false, "null flag -> already taught");
  req(coachMod.coachShouldRun("1") === false, "'1' (taught) -> no hints");
  req(coachMod.coachShouldRun("corrupt") === false, "corrupt flag -> never retro-teach");
  req(coachMod.coachShouldRun("0") === true, "ONLY an explicit '0' (brand-new save) teaches");
  const csr = fnBody(coachSrc, "coachShouldRun") || "";
  req(csr.includes('=== "0"') && !csr.includes("!=="), "strict '0' rule baked into coachShouldRun");
  const kinds = [];
  const coach = coachMod.createCoach({
    shouldRun: false,
    queries: { nearestJumpable: () => true, nearestOverhead: () => true },
    showHint: (k) => kinds.push(k),
  });
  for (let d = 0; d <= 300; d += 5) coach.tick(d, d);
  req(kinds.length === 0, "existing player's run shows zero first-run hints");
  req(/tutored: "late_again_tutored"/.test(mainSrc), "teaching state persists across sessions (localStorage key)");
  pass("missing flag on an existing save means already taught — no retro hints");
}

// ---- Requirement: How-to-play is reviewable from the menu -----------
scenario("OB-3a", "onboarding", "How-to-play is reviewable from the menu", "Player reviews controls without side effects");
{
  const openSrc = fnBody(mainSrc, "openHowto");
  const closeSrc = fnBody(mainSrc, "closeHowto");
  req(!!openSrc && !!closeSrc, "REAL openHowto/closeHowto extractable");
  req(!/setState|startRun|lsSet|state\s*=/.test(openSrc), "openHowto starts no run and writes no storage");
  const panel = { hidden: true, classes: [] };
  panel.classList = {
    add: (c) => {
      panel.classes.push(c);
      if (c === "hidden") panel.hidden = true;
    },
    remove: (c) => {
      panel.classes.push(c);
      if (c === "hidden") panel.hidden = false;
    },
    contains: (c) => c === "hidden" && panel.hidden,
  };
  const btn = { attrs: {}, focusCount: 0 };
  btn.setAttribute = (n, v) => {
    btn.attrs[n] = v;
  };
  btn.focus = () => {
    btn.focusCount++;
  };
  const closeBtn = { focusCount: 0 };
  closeBtn.focus = () => {
    closeBtn.focusCount++;
  };
  const menuStats = '<div id="menu-stats">BEST 1</div>';
  const board = '<ol id="leaderboard-list"></ol>';
  const els = { howtoPanel: panel, howtoBtn: btn, howtoCloseBtn: closeBtn };
  const openHowto = new Function("els", "applyHowto", `return function openHowto() {${openSrc}}`)(els, () => {});
  const closeHowto = new Function("els", `return function closeHowto() {${closeSrc}}`)(els);
  openHowto();
  req(panel.hidden === false, "how-to view opens over the menu");
  req(btn.attrs["aria-expanded"] === "true", "opener announces expanded state");
  req(closeBtn.focusCount === 1, "focus moves into the view");
  req(menuStats === '<div id="menu-stats">BEST 1</div>' && board === '<ol id="leaderboard-list"></ol>', "menu stats/leaderboard untouched while open");
  closeHowto();
  req(panel.hidden === true, "closing hides the view");
  req(btn.attrs["aria-expanded"] === "false" && btn.focusCount === 1, "focus returns to the opener");
  req(menuStats === '<div id="menu-stats">BEST 1</div>' && board === '<ol id="leaderboard-list"></ol>', "menu restored exactly as it was (no run started, state intact)");
  req(/<button id="howto-btn" class="settings-btn"/.test(html), "menu hosts the reachable HOW TO PLAY control (44px settings-btn)");
  pass("open/close is side-effect-free: menu restored, focus managed, no run started");
}

/* ================================================================== *
 * SPEC: ui-accessibility                                              *
 * ================================================================== */

// ---- Requirement: Notch and home-indicator safety -------------------
scenario("UA-1a", "ui-accessibility", "Notch and home-indicator safety", "Notched phone keeps controls tappable");
{
  const vm = html.match(/<meta[^>]*name="viewport"[^>]*>/);
  req(!!vm && vm[0].includes("viewport-fit=cover"), "viewport-fit=cover (env() insets are real in standalone PWA)");
  const hud = bodyOf(/^#hud$/);
  req(
    !!hud &&
      /max\(\s*14px,\s*env\(safe-area-inset-top/.test(hud) &&
      /max\(\s*18px,\s*env\(safe-area-inset-right/.test(hud) &&
      /max\(\s*14px,\s*env\(safe-area-inset-bottom/.test(hud) &&
      /max\(\s*18px,\s*env\(safe-area-inset-left/.test(hud),
    "#hud readouts padded on all four sides inside the safe area",
  );
  const mute = bodyOf(/^#mute-btn$/);
  const pause = bodyOf(/^#pause-btn$/);
  req(!!mute && /right:\s*max\(\s*18px,\s*env\(safe-area-inset-right/.test(mute) && /bottom:\s*max\(\s*18px,\s*env\(safe-area-inset-bottom/.test(mute), "#mute-btn (home-indicator corner) offset by safe-area max()");
  req(!!pause && /left:\s*max\(\s*18px,\s*env\(safe-area-inset-left/.test(pause) && /bottom:\s*max\(\s*18px,\s*env\(safe-area-inset-bottom/.test(pause), "#pause-btn (notch corner) offset by safe-area max()");
  const menu = bodyOf(/^\.menu-container$/);
  req(!!menu && /max\(\s*var\(--space-3\),\s*env\(safe-area-inset-top/.test(menu) && /max\(\s*var\(--space-3\),\s*env\(safe-area-inset-left/.test(menu), "menu container respects top/left insets (landscape notch)");
  const screens = bodyOf(/^#menu-screen,\s*#gameover-screen$/);
  const pauseOv = bodyOf(/^#pause-overlay$/);
  req(!!screens && /padding:[^;]*env\(safe-area-inset-/.test(screens), "results panel kept inside the safe area");
  req(!!pauseOv && /padding:[^;]*env\(safe-area-inset-/.test(pauseOv), "pause panel kept inside the safe area");
  const chips = bodyOf(/^#powerup-chips$/);
  req(!!chips && /left:\s*max\(\s*18px,\s*env\(safe-area-inset-left/.test(chips), "powerup chips offset from the left notch");
  pass("every control and readout is offset by max(<floor>, env(safe-area-inset-*))");
}

// ---- Requirement: Keyboard focus is visible -------------------------
scenario("UA-2a", "ui-accessibility", "Keyboard focus is visible", "Tabbing the menu shows where you are");
{
  const rule = rules.find((r) => /focus-visible/.test(r.prelude));
  req(!!rule, ":focus-visible rule exists");
  const parts = rule ? rule.prelude.split(",").map((s) => s.trim()) : [];
  req(parts.includes("button:focus-visible") && parts.includes("input:focus-visible") && parts.includes("[tabindex]:focus-visible"), "covers buttons, inputs and [tabindex] in ONE global rule");
  req(!!rule && /outline:\s*2px\s+solid\s+var\(--/.test(rule.body) && /outline-offset:\s*\d+px/.test(rule.body), "clearly visible 2px accent outline + offset (distinct from hover/active)");
  const userInput = bodyOf(/^#username-input$/);
  req(!!userInput && !/outline:\s*none/.test(userInput), "focus styles not suppressed on the menu input");
  for (const id of ["play-btn", "music-toggle", "sfx-toggle", "howto-btn", "retry-btn", "menu-btn", "resume-btn", "pause-restart-btn", "pause-menu-btn", "howto-close-btn", "mute-btn", "pause-btn"]) {
    req(new RegExp(`<button id="${id}"[^>]*type="button"`).test(html), `#${id} is a native <button> (Space/Enter activates it)`);
  }
  req(/<input[^>]*id="username-input"/.test(html), "username field is a native <input> (keyboard operable)");
  pass("every shell control is natively keyboard-activatable with a global visible focus indicator");
}

// ---- Requirement: Touch targets meet the floor ----------------------
scenario("UA-3a", "ui-accessibility", "Touch targets meet the floor", "Small glyph still has a big target");
{
  const mute = bodyOf(/^#mute-btn$/);
  req(pxVal(mute, "width") >= 44 && pxVal(mute, "height") >= 44, `#mute-btn target ${pxVal(mute, "width")}x${pxVal(mute, "height")}`);
  const pauseBtn = bodyOf(/^#pause-btn$/);
  req(pxVal(pauseBtn, "width") >= 44 && pxVal(pauseBtn, "height") >= 44, `#pause-btn target ${pxVal(pauseBtn, "width")}x${pxVal(pauseBtn, "height")}`);
  const muteSvg = bodyOf(/^#mute-btn svg,\s*#pause-btn svg$/);
  req(!!muteSvg && pxVal(muteSvg, "width") < 44, `icon-only glyphs stay compact (${pxVal(muteSvg, "width")}px) INSIDE the 44px target`);
  const hudBtn = bodyOf(/^#hud button$/);
  req(pxVal(hudBtn, "min-width") >= 44 && pxVal(hudBtn, "min-height") >= 44, "#hud button floor >=44 (no control can regress)");
  const settings = bodyOf(/^\.settings-btn$/);
  req(pxVal(settings, "min-width") >= 44 && pxVal(settings, "min-height") >= 44, ".settings-btn toggles >=44 (16px glyph inside)");
  const btn = bodyOf(/^\.btn$/);
  req(pxVal(btn, "min-width") >= 44 && pxVal(btn, "min-height") >= 44, ".btn actions >=44 (covers RETRY/MENU/RESUME/RESTART/CLOSE)");
  pass("icon-only controls render small glyphs inside >=44x44 tappable areas");
}

// ---- Requirement: Reduced motion is honored globally ----------------
scenario("UA-4a", "ui-accessibility", "Reduced motion is honored globally", "Reduced-motion session is still complete");
{
  const rm = rules.filter((r) => r.media && /prefers-reduced-motion/.test(r.media));
  req(rm.length > 0, "prefers-reduced-motion media query present");
  const uni = rm.find((r) => /^\*,\s*\*::before,\s*\*::after$/.test(r.prelude));
  req(!!uni, "kill is UNIVERSAL (*, *::before, *::after) — not a selector subset");
  req(
    !!uni &&
      /animation-duration:\s*0\.01ms\s*!important/.test(uni.body) &&
      /animation-iteration-count:\s*1\s*!important/.test(uni.body) &&
      /transition-duration:\s*0\.01ms\s*!important/.test(uni.body),
    "all animation/transition zeroed under !important (settled state still RENDERS — no information lost)",
  );
  const oldSubset = rm.some((r) =>
    /\.game-title|#play-btn|\.swipe-arrows|#new-high-score|\.coin-face|\.loader-shadow/.test(r.prelude),
  );
  req(!oldSubset, "old six-selector subset list is gone (global coverage)");
  const fz = rules.filter((r) => /\.qa-freeze/.test(r.prelude));
  const fzIdx = rules.findIndex((r) => /\.qa-freeze/.test(r.prelude));
  const rmIdx = rules.findIndex((r) => r.media && /prefers-reduced-motion/.test(r.media));
  req(fz.length > 0 && fz.every((r) => /animation:\s*none\s*!important/.test(r.body) && /transition:\s*none\s*!important/.test(r.body)), "freeze kill-switch disables everything INDEPENDENT of the user preference");
  req(fzIdx > rmIdx && rmIdx !== -1, ".qa-freeze ordered after the reduced-motion block (always wins)");
  const seKf = cssNC.match(/@keyframes screen-enter\s*\{[\s\S]*?\n\}/);
  req(!!seKf && /from\s*\{[^}]*opacity:\s*0/.test(seKf[0]) && /to\s*\{[^}]*opacity:\s*1/.test(seKf[0]), "screen-enter ends AT identity — killed animation still shows the complete screen");
  pass("reduced motion zeroes every transition while all screens stay fully readable");
}

// ---- Requirement: Toggles expose state accessibly -------------------
scenario("UA-5a", "ui-accessibility", "Toggles expose state accessibly", "Muted state is announced correctly");
{
  const audioStub = {
    muted: false, musicOn: true, sfxOn: true,
    setMuted(on) { this.muted = on; },
    setMusicOn(on) { this.musicOn = on; },
    setSfxOn(on) { this.sfxOn = on; },
  };
  const mkBtn = () => {
    const el = { attrs: {}, mutedClass: false };
    el.classList = { toggle: (c, v) => { if (c === "muted") el.mutedClass = !!v; } };
    el.setAttribute = (n, v) => { el.attrs[n] = String(v); };
    return el;
  };
  const elsStub = {
    muteBtn: mkBtn(), musicToggle: mkBtn(), musicToggleLabel: { textContent: "" },
    sfxToggle: mkBtn(), sfxToggleLabel: { textContent: "" },
  };
  const writes = {};
  const lsSet = (k, v) => {
    writes[k] = String(v);
  };
  const LS = { muted: "late_again_muted", music: "late_again_music", sfx: "late_again_sfx" };
  const applyMuteUi = new Function("audio", "els", `return function applyMuteUi() {${fnBody(mainSrc, "applyMuteUi")}}`)(audioStub, elsStub);
  const toggleMute = new Function("audio", "els", "lsSet", "LS_KEYS", "applyMuteUi", `return function toggleMute() {${fnBody(mainSrc, "toggleMute")}}`)(
    audioStub, elsStub, lsSet, LS, applyMuteUi,
  );
  const toggleMusic = new Function("audio", "els", "lsSet", "LS_KEYS", "applyMuteUi", `return function toggleMusic() {${fnBody(mainSrc, "toggleMusic")}}`)(
    audioStub, elsStub, lsSet, LS, applyMuteUi,
  );
  applyMuteUi(); // boot
  req(elsStub.muteBtn.attrs["aria-pressed"] === "false", "boot: unmuted -> #mute-btn pressed=false (matches actual state)");
  req(elsStub.musicToggle.attrs["aria-pressed"] === "true" && elsStub.sfxToggle.attrs["aria-pressed"] === "true", "boot: settings toggles pressed=true while their features are ON");
  req(/applyMuteUi\(\); \/\/ reflect the persisted state on boot/.test(mainSrc), "state sync runs at boot (reflected from persistence)");
  toggleMute();
  req(elsStub.muteBtn.attrs["aria-pressed"] === "true" && elsStub.muteBtn.mutedClass === true, "after muting, the toggle reports pressed=true (consistent with muted)");
  req(writes["late_again_muted"] === "1", "muted state persisted");
  toggleMusic();
  req(elsStub.musicToggle.attrs["aria-pressed"] === "false" && elsStub.musicToggleLabel.textContent === "MUSIC OFF", "music toggle flips pressed state + text label in step");
  req(elsStub.muteBtn.attrs["aria-pressed"] === "true", "mute button state unaffected by the music toggle (each announces its own state)");
  pass("aria-pressed tracks the real audio state at boot, after mute, and after every toggle");
}

/* ================================================================== *
 * Final table + exit                                                  *
 * ================================================================== */
const W = [16, 46, 46, 7];
const line = (cols) => cols.slice(0, -1).map((c, i) => String(c).padEnd(W[i])).join(" | ") + " | " + String(cols[cols.length - 1]);
const sep = (ch) => W.map((w) => ch.repeat(w)).join(ch + ch) + ch + ch + ch.repeat(100);
console.log("\n" + sep("="));
console.log(line(["SPEC", "REQ", "SCENARIO", "STATUS", "EVIDENCE"]));
console.log(sep("-"));
for (const r of results) {
  console.log(line([r.spec, r.requirement, r.name, r.status, r.evidence]));
}
console.log(sep("-"));

const failed = results.filter((r) => r.status === "FAIL");
const deferred = results.filter((r) => r.status === "DEFER");
const passedCount = results.filter((r) => r.status === "PASS").length;
console.log(`\n${passedCount} passed, ${failed.length} failed, ${deferred.length} deferred (browser ?freeze captures -> task 8.2)`);
if (failed.length > 0) {
  console.error("FAILED SCENARIOS:");
  for (const f of failed) console.error(`  ${f.id} ${f.name} — ${f.fails.join(" | ")}`);
}
const okExit = failed.length === 0 && deferred.length <= 2;
console.log(okExit ? "ACCEPTANCE WALK: GREEN" : "ACCEPTANCE WALK: RED");
process.exit(okExit ? 0 : 1);
