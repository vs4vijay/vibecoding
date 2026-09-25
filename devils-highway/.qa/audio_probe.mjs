#!/usr/bin/env bun
/**
 * QA audio probe (task 5.2): lazy-unlock safety + event -> sound mapping.
 *
 * A context-level addInitScript installs node-construction spies BEFORE any
 * app script (AudioContext subclass constructor + createOscillator/
 * createBufferSource/createBiquadFilter/createGain/createBuffer counters),
 * independent of the app's own window.__QA_SFX play mirror (qa/hooks.js +
 * audio.js _count). Phases:
 *   A  cold menu, NO gesture: zero AudioContext, zero nodes, zero plays.
 *   B  first CDP keydown: exactly one context, state "running", master
 *      gain 0.8 live, select confirm fired (ui=1).
 *   C  RUN mapping: a/d -> whoosh, w -> jump, s -> swish (accepted
 *      transitions; edge/latched no-ops would stay silent), Esc-pause is
 *      silent and paused keys are inert, Esc-resume -> ui confirm.
 *   D  mode events: probe-spawned pickup -> collect blip exactly once;
 *      probe-spawned block -> death sting exactly once (not repeated
 *      through the settle); shell endRun() does NOT sting.
 *   E  shell confirms: retry / quit(Esc) / menu select / start; a gameplay
 *      key on the DRIVE stub plays nothing (mode-scoped gameplay voices).
 *   F  heap round-trip: 2 x 240 direct voice calls on the unlocked ctx with
 *      forced gc — transient nodes absorbed, no unbounded growth.
 *   G  non-QA plain load: zero contexts, zero console noise.
 *
 * Usage: bun .qa/audio_probe.mjs [base-url]  (default http://127.0.0.1:8123)
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
    "--js-flags=--expose-gc",
  ],
});
const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
// Spy BEFORE any app script, every page of this context (incl. the non-QA
// phase-G load): counts context constructions + node creations at the
// WebAudio API boundary — proof that does not trust the app's own mirror.
await context.addInitScript(() => {
  const spy = { ctx: 0, ctxRef: null, nodes: 0, byMethod: {}, gains: [] };
  window.__SPY = spy;
  const Orig = window.AudioContext;
  if (!Orig) return;
  window.AudioContext = class extends Orig {
    constructor(...a) {
      spy.ctx++;
      super(...a);
      spy.ctxRef = this;
    }
  };
  for (const m of [
    "createOscillator",
    "createBufferSource",
    "createBiquadFilter",
    "createGain",
    "createBuffer",
  ]) {
    const fn = Orig.prototype[m];
    Orig.prototype[m] = function (...a) {
      spy.nodes++;
      spy.byMethod[m] = (spy.byMethod[m] || 0) + 1;
      const n = fn.apply(this, a);
      if (m === "createGain") spy.gains.push(n);
      return n;
    };
  }
});

async function openPage(url, { ready = true } = {}) {
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
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (ready) {
    const ok = await page
      .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
        timeout: 30000,
        polling: 200,
      })
      .then(() => true)
      .catch(() => false);
    if (!ok) problems.push(`screenshotReady timeout: ${url}`);
  }
  return page;
}

const check = (label, got, want) => {
  if (got !== want) problems.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const spyOf = (page) =>
  page.evaluate(() => ({
    ctx: window.__SPY.ctx,
    nodes: window.__SPY.nodes,
    by: { ...window.__SPY.byMethod },
    state: window.__SPY.ctxRef ? window.__SPY.ctxRef.state : null,
    master: window.__SPY.gains.some((g) => Math.abs(g.gain.value - 0.8) < 1e-6),
  }));
const sfxOf = (page) => page.evaluate(() => ({ ...window.__QA_SFX }));
const diff = (a, b) => {
  const d = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = (b[k] || 0) - (a[k] || 0);
    if (v !== 0) d[k] = v; // zero deltas stay out: "nothing else" must diff to {}
  }
  return d;
};

// ---- phase A: cold menu, no gesture ----------------------------------------
let p = await openPage(`${base}/?qa=1&scene=menu&seed=11`);
let sp = await spyOf(p);
check("A: zero AudioContext before any gesture", sp.ctx, 0);
check("A: zero audio nodes before any gesture", sp.nodes, 0);
let sfx = await sfxOf(p);
check("A: zero plays before any gesture", Object.keys(sfx).length, 0);
check("A: __QA_SFX mirror exists (?qa=1)", await p.evaluate(() => !!window.__QA_SFX), true);

// ---- phase B: first gesture -> unlock ---------------------------------------
await p.keyboard.press("2"); // menu select (the very first gesture)
await p.waitForTimeout(150);
sp = await spyOf(p);
check("B: exactly one AudioContext after first keydown", sp.ctx, 1);
if (sp.state === "suspended") {
  // browser-dependent: an explicitly resumed context also satisfies the contract
  await p.evaluate(() => window.__SPY.ctxRef.resume().catch(() => {}));
  await p.waitForTimeout(250);
  sp = await spyOf(p);
}
check("B: ctx state running", sp.state, "running");
check("B: master gain 0.8 live", sp.master, true);
sfx = await sfxOf(p);
check("B: select played ui exactly once", sfx.ui, 1);
check("B: select played nothing else", Object.keys(sfx).join(","), "ui");
const nodesAtUnlock = sp.nodes; // unlock overhead: master gain + noise buffer
if (nodesAtUnlock < 2) problems.push(`B: unlock built < 2 nodes (${nodesAtUnlock})`);

// ---- phase C: RUN gameplay mapping ------------------------------------------
await p.keyboard.press("1"); // select run (ui 2)
await p.keyboard.press("Enter"); // start -> enterGame confirm (ui 3)
await p.waitForTimeout(700);
sfx = await sfxOf(p);
check("C: run select + start confirms", sfx.ui, 3);
check("C: state game", await p.evaluate(() => window.__QA_SHELL.state()), "game");

const snapC = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.keyboard.press("a"); // lane left (accepted, lane 0 -> -1)
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: 'a' -> exactly one whoosh", diff(snapC.sfx, sfx).whoosh, 1);
check("C: 'a' -> nothing else", JSON.stringify(diff(snapC.sfx, sfx)), JSON.stringify({ whoosh: 1 }));
let sp2 = await spyOf(p);
check("C: whoosh = source+filter+gain nodes", sp2.nodes - snapC.spy.nodes, 3);

const snapD = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.keyboard.press("d"); // lane right (accepted, -1 -> 0)
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: 'd' -> exactly one whoosh", diff(snapD.sfx, sfx).whoosh, 1);

const snapE = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.keyboard.press("w"); // jump (accepted from run)
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: 'w' -> exactly one jump tick", diff(snapE.sfx, sfx).jump, 1);
check("C: 'w' -> nothing else", JSON.stringify(diff(snapE.sfx, sfx)), JSON.stringify({ jump: 1 }));
sp2 = await spyOf(p);
check("C: jump = osc+gain nodes", sp2.nodes - snapE.spy.nodes, 2);

// let the jump land (air 0.723 s sim; SwiftShader runs sim slower than wall)
await p.waitForTimeout(1600);
const snapF = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.keyboard.press("s"); // slide (accepted from run, post-landing)
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: 's' -> exactly one swish", diff(snapF.sfx, sfx).swish, 1);
check("C: 's' -> nothing else", JSON.stringify(diff(snapF.sfx, sfx)), JSON.stringify({ swish: 1 }));

// pause: silent; gameplay keys inert while paused (gated upstream)
const routedBefore = await p.evaluate(() => window.__QA_SHELL.routed.length);
const snapG = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.keyboard.press("Escape"); // pause
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: Esc-pause is silent", JSON.stringify(diff(snapG.sfx, sfx)), JSON.stringify({}));
check("C: paused flag", await p.evaluate(() => window.__QA_SHELL.paused()), true);
await p.keyboard.press("a");
await p.keyboard.press("w");
await p.keyboard.press("s");
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: paused gameplay keys play nothing", JSON.stringify(diff(snapG.sfx, sfx)), JSON.stringify({}));
check(
  "C: paused gameplay keys route nothing",
  await p.evaluate((n) => window.__QA_SHELL.routed.length - n, routedBefore),
  0,
);
await p.keyboard.press("Escape"); // resume
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("C: resume -> exactly one ui confirm", diff(snapG.sfx, sfx).ui, 1);
check("C: resumed", await p.evaluate(() => !window.__QA_SHELL.paused()), true);

// ---- phase D: mode events — pickup collect + death ---------------------------
const pickOk = await p.evaluate(() => {
  const run = window.__QA_RUN;
  return !!run.pickups.spawn({ x: run.player.group.position.x, z: run.focus() + 3 });
});
check("D: pickup spawned ahead", pickOk, true);
await p.waitForTimeout(2500);
sfx = await sfxOf(p);
check("D: collect played pickup exactly once", sfx.pickup, 1);

const deathOk = await p.evaluate(() => {
  const run = window.__QA_RUN;
  return !!run.obstacles.spawn({ type: "block", x: run.player.group.position.x, z: run.focus() + 0.6 });
});
check("D: block spawned into the lane", deathOk, true);
await p.waitForTimeout(3000); // impact + 0.35 s death settle -> endRun
sfx = await sfxOf(p);
check("D: death sting exactly once", sfx.death, 1);
check("D: state gameover", await p.evaluate(() => window.__QA_SHELL.state()), "gameover");
await p.waitForTimeout(1500); // the settle must not repeat the sting
sfx = await sfxOf(p);
check("D: sting not repeated", sfx.death, 1);

// shell-level endRun (QA injection) must NOT play the mode's sting
const snapH = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.evaluate(() => window.__QA_SHELL.endRun({ distance: 100 }));
await p.waitForTimeout(300);
sfx = await sfxOf(p);
check("D: shell endRun is silent (no sting)", JSON.stringify(diff(snapH.sfx, sfx)), JSON.stringify({}));

// ---- phase E: shell confirms + stub-mode silence ------------------------------
await p.keyboard.press("Enter"); // retry -> enterGame confirm
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("E: retry -> exactly one ui confirm", diff(snapH.sfx, sfx).ui, 1);
check("E: retried into game", await p.evaluate(() => window.__QA_SHELL.state()), "game");

await p.evaluate(() => window.__QA_SHELL.endRun()); // dead again (silent, per phase D)
await p.keyboard.press("Escape"); // GAMEOVER Esc -> quit to menu
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("E: quit -> exactly one ui confirm", diff(snapH.sfx, sfx).ui, 2);
check("E: state menu", await p.evaluate(() => window.__QA_SHELL.state()), "menu");

await p.keyboard.press("3"); // select ride (ui)
await p.keyboard.press("Enter"); // start drive... ride stub
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("E: select + start -> two more ui confirms", diff(snapH.sfx, sfx).ui, 4);
const snapI = { spy: await spyOf(p), sfx: await sfxOf(p) };
await p.keyboard.press("a"); // gameplay key on the stub mode: no gameplay voice
await p.waitForTimeout(450);
sfx = await sfxOf(p);
check("E: stub-mode gameplay key plays nothing", JSON.stringify(diff(snapI.sfx, sfx)), JSON.stringify({}));

// ---- phase F: heap round-trip (transient nodes, no unbounded growth) ---------
const heap = await p.evaluate(async () => {
  const a = window.__QA_AUDIT && window.__QA_AUDIT.audio;
  if (!a || !a.ctx) return { err: "no audio instance/ctx" };
  if (a.ctx.state === "suspended") await a.ctx.resume().catch(() => {});
  const gc = window.gc;
  if (!gc || !performance.memory) return { err: "gc/memory unavailable" };
  const sample = () => performance.memory.usedJSHeapSize;
  const round = (n) => {
    for (let i = 0; i < n; i++) {
      a.ui();
      a.whoosh();
      a.jump();
      a.swish();
      a.pickup();
      a.death();
    }
  };
  gc();
  const before = sample();
  round(40); // 240 voices
  gc();
  const afterLoop = sample();
  await new Promise((r) => setTimeout(r, 1500)); // let every voice pass its stop time
  gc();
  const afterSettle = sample();
  round(40); // second round: growth must not compound
  gc();
  await new Promise((r) => setTimeout(r, 1500));
  gc();
  const afterRound2 = sample();
  return {
    state: a.ctx.state,
    before,
    afterLoop,
    afterSettle,
    afterRound2,
    dLoop: afterLoop - before,
    dSettle: afterSettle - before,
    dRound2: afterRound2 - before,
  };
});
if (heap.err) problems.push(`F: ${heap.err}`);
else {
  check("F: ctx still running", heap.state, "running");
  check("F: 240-voice loop bounded (< 2 MB)", heap.dLoop < 2 * 1024 * 1024, true);
  check("F: settled heap back near baseline (< 512 KB)", Math.abs(heap.dSettle) < 512 * 1024, true);
  check("F: second round does not compound (< 512 KB)", Math.abs(heap.dRound2) < 512 * 1024, true);
}
await p.close();

// ---- phase G: non-QA plain load — silent-safe, zero console noise ------------
p = await openPage(`${base}/`, { ready: false });
await p.waitForTimeout(3500);
sp = await spyOf(p);
check("G: plain load creates zero AudioContexts", sp.ctx, 0);
check("G: plain load creates zero nodes", sp.nodes, 0);
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
      heap,
      envNoiseWarnings: envNoise,
      consoleErrors,
      consoleWarns,
      pageErrors,
    },
    null,
    2,
  ),
);
