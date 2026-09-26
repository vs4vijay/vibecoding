#!/usr/bin/env node
/**
 * HUD harness (Midtown Blitz — task 5.3).
 *
 * Plain node (no browser, no jsdom): the modes-test DOM stub pattern (a
 * cssText-aware style proxy + element stubs) runs the real HUD, and the
 * pure modules (countdown, checkpoint projection, checkpoint sequence) run
 * as-is. The checkpoint world marker runs against the real three.js.
 *
 * Asserts, per the task's verification list:
 *   a. HUD updates  -> setSpeed/setTimer/showCountdown write DOM ONLY on
 *                      change (spy on textContent/style writes: repeated
 *                      same values produce zero additional writes), mode
 *                      show/hide, timer placeholder dimming, countdown
 *                      'GO' mapping + animation retrigger, guidance
 *                      diamond/arrow switching from a stub camera
 *   b. countdown    -> pure time-stepping: 3-2-1 at the exact boundaries,
 *                      onGo exactly once, controlsLocked until GO only,
 *                      pausing (not calling update) freezes it, cancel is
 *                      silent, one big dt crosses all boundaries in order
 *   c. edge arrow   -> pure projection helper: 8 compass bearings around a
 *                      pitched camera map to hand-derived screen angles
 *                      (tolerance 0.05 rad); on-screen -> clamped diamond
 *                      at the projected point; behind-camera -> turn-
 *                      direction arrow (left stays left, degenerate falls
 *                      to the bottom edge); bearing/dist side data
 *   d. order        -> test-route controller: passing the target advances,
 *                      passing any NON-target does NOTHING (cannot skip),
 *                      final checkpoint completes once, reset restarts
 *   e. reset prompt -> show/hide writes only on change (the prompt main.js
 *                      used to own; same styling/behavior via the HUD)
 *   f. world marker -> beam + ring with additive/fog:false materials,
 *                      set()/null moves+hides, near-camera fade, pulse
 *
 * Run: node scripts/hud-test.mjs   (plain node, no dependencies)
 */
import * as THREE from 'three';
import { createHud, formatRaceTime } from '../src/ui/hud.js';
import { computeCheckpointIndicator, EDGE_MARGIN, DIAMOND_MARGIN } from '../src/ui/checkpoint-arrow.js';
import { createCountdown } from '../src/game/countdown.js';
import {
  createCheckpointSequence,
  buildTestRouteCheckpoints,
} from '../src/game/test-route.js';
import { createCheckpointMarker } from '../src/game/checkpoint-marker.js';

let checks = 0;
let failed = 0;

/**
 * Record a single assertion.
 * @param {boolean} cond Condition to assert.
 * @param {string} label Human-readable assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function check(cond, label) {
  checks += 1;
  if (!cond) {
    failed += 1;
    console.log(`    FAIL ${label}`);
  }
  return cond;
}

/** Record a named section header. */
function section(name) {
  console.log(`  ${name}`);
}

/**
 * Smallest absolute difference between two angles (rad), wrap-aware.
 * @param {number} a First angle.
 * @param {number} b Second angle.
 * @returns {number} |a - b| folded into [0, PI].
 */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// --- environment stubs (installed before importing ui modules is enough; the
// modules read document lazily inside createHud, and window only in
// updateCheckpoint) ---------------------------------------------------------

globalThis.window = { innerWidth: 1280, innerHeight: 720 };

/**
 * cssText-aware inline-style stub with a write counter (modes-test pattern):
 * assignments through `style.cssText` parse into declarations, later
 * `style.prop = value` writes hit the same map, and every write increments
 * `_writeCount` so the harness can assert change-gated DOM updates.
 * @returns {object} A CSSStyleDeclaration-like stub.
 */
function makeStyle() {
  const decls = new Map();
  const writes = { n: 0 };
  const base = {
    get cssText() {
      return [...decls.entries()].map(([k, v]) => `${k}:${v}`).join(';');
    },
    set cssText(text) {
      writes.n += 1;
      decls.clear();
      for (const part of String(text).split(';')) {
        const i = part.indexOf(':');
        if (i > 0) decls.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
      }
    },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'cssText') return target.cssText;
      if (prop === '_writeCount') return writes.n;
      return typeof prop === 'string' ? decls.get(prop) ?? '' : undefined;
    },
    set(target, prop, value) {
      writes.n += 1;
      if (prop === 'cssText') {
        target.cssText = value;
      } else {
        decls.set(String(prop), String(value));
      }
      return true;
    },
  });
}

/**
 * Element stub good enough for the HUD (inline styles, child lists,
 * listeners, text) with a textContent WRITE spy: `_textContentWrites`
 * increments on every assignment (reads are free).
 * @param {string} tagName Tag name.
 * @returns {object} The element stub.
 */
function makeElement(tagName) {
  const listeners = new Map();
  const el = {
    tagName: String(tagName).toUpperCase(),
    style: makeStyle(),
    children: [],
    value: '',
    type: '',
    _textContentWrites: 0,
    setAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    append(...args) {
      for (const a of args) if (typeof a === 'object') el.children.push(a);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    fire(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get() {
      return text;
    },
    set(v) {
      el._textContentWrites += 1;
      text = v;
    },
  });
  return el;
}

const created = [];
globalThis.document = {
  head: makeElement('head'),
  body: makeElement('body'),
  createElement(tag) {
    const el = makeElement(tag);
    created.push(el);
    return el;
  },
  getElementById() {
    return null;
  },
};

// ===========================================================================
// a. HUD updates — change-gated DOM writes + mode visibility + guidance
// ===========================================================================
section('a. HUD DOM updates (writes only on change)');
const hud = createHud({ mount: document.body });
check(!!hud.root && !!hud.parts, 'createHud returns root + parts');
check(document.body.children.includes(hud.root), 'HUD root mounted on body');
check(hud.isOpen() === false, 'HUD starts hidden');
check(hud.root.style.display === 'none', 'HUD root display none initially');

hud.show('racing');
check(hud.isOpen() && hud.root.style.display === 'block', "show('racing') shows the HUD");
hud.show('menu');
check(!hud.isOpen() && hud.root.style.display === 'none', "show('menu') hides the HUD");
hud.show('paused');
check(!hud.isOpen(), "show('paused') hides the HUD");
hud.show('results');
check(!hud.isOpen(), "show('results') hides the HUD");
hud.hide();
check(!hud.isOpen(), 'hide() hides the HUD');
hud.show('racing');
check(hud.isOpen(), 'HUD back in racing for the update tests');

// speedometer
const speedEl = hud.parts.speedoValue;
speedEl._textContentWrites = 0;
hud.setSpeed(120.4);
check(speedEl.textContent === '120', 'setSpeed rounds to integer km/h');
check(speedEl._textContentWrites === 1, 'setSpeed wrote once for a new value');
hud.setSpeed(120.4);
hud.setSpeed(120.2);
check(speedEl._textContentWrites === 1, 'same rounded speed writes NOTHING');
hud.setSpeed(121);
check(speedEl.textContent === '121' && speedEl._textContentWrites === 2, 'speed change writes again');
hud.setSpeed(Number.NaN);
check(speedEl.textContent === '0', 'non-finite speed reads as 0');
hud.setSpeed(-30);
check(speedEl.textContent === '0', 'negative speed clamps to 0');

// timer
const timerEl = hud.parts.timer;
timerEl._textContentWrites = 0;
hud.setTimer(60000);
check(timerEl.textContent === '1:00.0', 'setTimer formats m:ss.t (60000 -> 1:00.0)');
check(timerEl.style.opacity === '1', 'real timer is full-brightness');
check(timerEl._textContentWrites === 1, 'timer wrote once for a new value');
hud.setTimer(60000);
check(timerEl._textContentWrites === 1, 'same timer value writes NOTHING');
hud.setTimer(null);
check(timerEl.textContent === '0:00.0', 'setTimer(null) shows the 0:00.0 placeholder');
check(timerEl.style.opacity === '0.35', 'placeholder timer is dimmed');
check(timerEl._textContentWrites === 2, 'placeholder switch wrote once');
hud.setTimer(null);
check(timerEl._textContentWrites === 2, 'repeated null timer writes NOTHING');
hud.setTimer(81234);
check(timerEl.textContent === '1:21.2', 'timer formats 81234 -> 1:21.2');
check(formatRaceTime(0) === '0:00.0', 'formatRaceTime 0');
check(formatRaceTime(59999) === '0:59.9', 'formatRaceTime 59.999 s');
check(formatRaceTime(60000) === '1:00.0', 'formatRaceTime 60 s');
check(formatRaceTime(-1) === '0:00.0' && formatRaceTime(Number.NaN) === '0:00.0',
  'formatRaceTime invalid -> placeholder');

// countdown
const cdWrap = hud.parts.countdownWrap;
const cdText = hud.parts.countdownText;
cdText._textContentWrites = 0;
hud.showCountdown(3);
check(cdWrap.style.display === 'block' && cdText.textContent === '3', 'showCountdown(3) shows 3');
check(String(cdText.style.animation).includes('hudCount'), 'countdown pop animation applied');
check(cdText._textContentWrites === 1, 'countdown wrote once');
const anim3 = String(cdText.style.animation);
hud.showCountdown(3);
check(cdText._textContentWrites === 1, 'repeated showCountdown(3) writes NOTHING');
hud.showCountdown(2);
check(cdText.textContent === '2' && cdText._textContentWrites === 2, 'showCountdown(2) writes 2');
check(String(cdText.style.animation) !== anim3, 'animation name flips to retrigger the pop');
hud.showCountdown('GO');
check(cdText.textContent === 'GO', "showCountdown('GO') shows GO");
hud.showCountdown(0);
check(cdText.textContent === 'GO' && cdText._textContentWrites === 3,
  "showCountdown(0) is GO with NO extra write");
hud.showCountdown(null);
check(cdWrap.style.display === 'none', 'showCountdown(null) hides the display');
hud.showCountdown(null);
check(cdText._textContentWrites === 3, 'repeated null countdown writes NOTHING');

// guidance from a stub camera (level, facing +Z: right=-X, up=+Y, back=-Z)
const stubCamera = {
  position: { x: 0, y: 0, z: 0 },
  matrixWorld: {
    elements: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
  },
  fov: 60,
  aspect: 1,
};
check(hud.updateCheckpoint(stubCamera) === null, 'updateCheckpoint with no target -> null');

hud.setCheckpoint({ x: 0, z: 10 });
const info = hud.updateCheckpoint(stubCamera);
check(!!info && info.onScreen === true, 'on-screen target reported on-screen');
check(hud.parts.diamond.style.display === 'block', 'diamond shown when on-screen');
check(hud.parts.edgeArrow.style.display === 'none', 'edge arrow hidden when on-screen');
check(hud.parts.diamond.style.transform.includes('translate(640px, 360px)'),
  'diamond positioned at the projected point (viewport center)');
check(Math.abs(info.distM - 10) < 1e-9 && Math.abs(info.bearingRad) < 1e-9,
  'info carries distM + bearingRad');
hud.updateCheckpoint(stubCamera);
check(hud.parts.diamond.style._writeCount >= 0, 'style stub counting active');

hud.setCheckpoint({ x: 0, z: -10 });
const info2 = hud.updateCheckpoint(stubCamera);
check(!!info2 && info2.onScreen === false, 'behind target reported off-screen');
check(hud.parts.edgeArrow.style.display === 'block', 'edge arrow shown when off-screen');
check(hud.parts.diamond.style.display === 'none', 'diamond hidden when off-screen');
check(hud.parts.edgeArrow.style.transform.includes('rotate('), 'edge arrow has a rotation');

hud.setCheckpoint(null);
check(hud.updateCheckpoint(stubCamera) === null && hud.getCheckpointInfo() === null,
  'setCheckpoint(null) clears guidance');
check(hud.parts.edgeArrow.style.display === 'none' && hud.parts.diamond.style.display === 'none',
  'both guidance elements hidden with no target');

hud.hide();
check(hud.setCheckpoint({ x: 0, z: 10 }) === undefined &&
  hud.updateCheckpoint(stubCamera) === null,
  'updateCheckpoint no-ops while the HUD is hidden');

// ===========================================================================
// b. countdown controller — pure time-stepping
// ===========================================================================
section('b. countdown controller (pure, tick-driven)');
{
  const ticks = [];
  let gos = 0;
  let ends = 0;
  const cd = createCountdown({
    onTick: (n) => ticks.push(n),
    onGo: () => {
      gos += 1;
    },
    onEnd: () => {
      ends += 1;
    },
  });
  check(cd.isActive() === false && cd.controlsLocked() === false, 'idle: inactive + unlocked');
  cd.start();
  check(JSON.stringify(ticks) === '[3]', 'start fires onTick(3) immediately');
  check(cd.isActive() && cd.controlsLocked(), 'locked from start');
  check(cd.number() === 3, 'number 3 during the first second');

  cd.update(0.25);
  cd.update(0.25);
  cd.update(0.25);
  check(JSON.stringify(ticks) === '[3]' && cd.number() === 3,
    '0.75 s in: still 3, no new callbacks');
  cd.update(0.25);
  check(JSON.stringify(ticks) === '[3,2]' && cd.number() === 2, 'exactly 1.0 s: flips to 2');
  cd.update(1.0);
  check(JSON.stringify(ticks) === '[3,2,1]' && cd.controlsLocked(), '2.0 s: 1, still locked');
  cd.update(0.999);
  check(gos === 0 && cd.controlsLocked(), '2.999 s: still locked, no GO');
  cd.update(0.001);
  check(gos === 1 && cd.controlsLocked() === false && cd.number() === 0,
    '3.0 s boundary: onGo exactly once, controls unlock');
  check(cd.isActive(), 'GO linger keeps the controller active');
  cd.update(0.79);
  check(ends === 0, 'GO linger holds for goSeconds');
  cd.update(0.02);
  check(ends === 1 && cd.isActive() === false, 'GO window closes with onEnd');
  cd.update(10);
  check(gos === 1 && ends === 1 && ticks.length === 3, 'idle updates fire nothing');

  // pause-freeze: skipping update calls (paused sim) must freeze the clock.
  const pTicks = [];
  const cd2 = createCountdown({ onTick: (n) => pTicks.push(n) });
  cd2.start();
  cd2.update(0.5);
  // ... paused (no update calls) ...
  cd2.update(0.4);
  check(cd2.number() === 3, 'pause mid-countdown freezes it (0.9 s still 3)');
  cd2.update(0.1);
  check(JSON.stringify(pTicks) === '[3,2]', 'resuming continues from the frozen point');

  // 60 accumulated 1/60 steps must cross the 1 s boundary (float slop).
  const cd3 = createCountdown({ onTick: () => {} });
  cd3.start();
  for (let i = 0; i < 60; i += 1) cd3.update(1 / 60);
  check(cd3.number() === 2, '60 sim ticks of 1/60 flip to 2 (no float lag)');

  // cancel: silent teardown.
  const cTicks = [];
  const cd4 = createCountdown({
    onTick: (n) => cTicks.push(n),
    onGo: () => {
      cTicks.push('GO');
    },
  });
  cd4.start();
  cd4.update(0.5);
  cd4.cancel();
  check(cd4.isActive() === false && cd4.controlsLocked() === false, 'cancel deactivates + unlocks');
  cd4.update(5);
  check(JSON.stringify(cTicks) === '[3]', 'cancel fires NO further callbacks');

  // one large dt crosses every boundary in order.
  const big = [];
  const cd5 = createCountdown({
    onTick: (n) => big.push(n),
    onGo: () => {
      big.push('GO');
    },
    onEnd: () => {
      big.push('END');
    },
  });
  cd5.start();
  cd5.update(10);
  check(JSON.stringify(big) === '[3,2,1,"GO","END"]', 'large dt crosses all boundaries in order');
}

// ===========================================================================
// c. edge-arrow math — pure projection helper
// ===========================================================================
section('c. edge-arrow projection (8 compass bearings, clamping, behind)');
{
  /**
   * Camera params for a camera at the origin facing +Z, pitched down by
   * `pitchRad`, screen-right = world -X (the game's +Z-facing convention).
   * @param {object} o Options.
   * @param {number} [o.pitchRad] Pitch down in rad.
   * @param {number} [o.fovDeg] Vertical fov in degrees.
   * @param {number} [o.aspect] Aspect ratio.
   * @returns {import('../src/ui/checkpoint-arrow.js').CheckpointIndicatorParams} Params.
   */
  function camParams({ pitchRad = 0, fovDeg = 60, aspect = 1 } = {}) {
    const cp = Math.cos(pitchRad);
    const sp = Math.sin(pitchRad);
    return {
      camX: 0,
      camY: 0,
      camZ: 0,
      rightX: -1,
      rightY: 0,
      rightZ: 0,
      upX: 0,
      upY: cp,
      upZ: sp,
      forwardX: 0,
      forwardY: -sp,
      forwardZ: cp,
      fovYRad: (fovDeg * Math.PI) / 180,
      aspect,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
    };
  }

  const out = { onScreen: false, x: 0, y: 0, angleRad: 0, distM: 0, bearingRad: 0 };

  // --- 8 compass bearings around a camera pitched 30 deg down --------------
  // Ground targets 10 m below the camera, 30 m out at bearing b (world dir
  // (sin b, 0, cos b); 0 = dead ahead). Expected values are hand-derived
  // (see the task notes): xr = dot(d, right) = -30 sin b, and the screen
  // direction is the perspective-corrected (ndc) one in front, linear
  // behind — checked against literal numbers so sign/convention regressions
  // (screen flips, CSS y, rotation direction) cannot sneak in.
  const pitch = (30 * Math.PI) / 180;
  const bearings = [
    { b: 0, onScreen: true, x: 0.5, y: 0.3228 },
    { b: 45, onScreen: false, angle: -3.0502 },
    { b: 90, onScreen: false, angle: 2.8608 },
    { b: 135, onScreen: false, angle: 2.4049 },
    { b: 180, onScreen: false, angle: Math.PI / 2 },
    { b: 225, onScreen: false, angle: 0.7367 },
    { b: 270, onScreen: false, angle: 0.2808 },
    { b: 315, onScreen: false, angle: -0.0914 },
  ];
  for (const { b, onScreen, angle, x, y } of bearings) {
    const p = camParams({ pitchRad: pitch });
    p.targetX = 30 * Math.sin((b * Math.PI) / 180);
    p.targetY = -10;
    p.targetZ = 30 * Math.cos((b * Math.PI) / 180);
    computeCheckpointIndicator(out, p);
    check(out.onScreen === onScreen, `bearing ${b}: on-screen=${onScreen}`);
    if (onScreen) {
      check(Math.abs(out.x - x) < 0.01 && Math.abs(out.y - y) < 0.01,
        `bearing ${b}: diamond at hand-derived viewport point (${x}, ${y})`);
    } else {
      check(angleDiff(out.angleRad, angle) < 0.05,
        `bearing ${b}: arrow angle ${out.angleRad.toFixed(4)} ~ ${angle}`);
    }
  }
  // b=180 is dead behind: the degenerate direction falls back to the bottom
  // edge, straight down.
  {
    const p = camParams({ pitchRad: pitch });
    p.targetX = 0;
    p.targetY = -10;
    p.targetZ = -30;
    computeCheckpointIndicator(out, p);
    check(Math.abs(out.x - 0.5) < 1e-9 && Math.abs(out.y - (1 - EDGE_MARGIN)) < 1e-9,
      'dead-behind target: arrow on the bottom edge center');
  }

  // --- on-screen clamping near the viewport edge ---------------------------
  {
    const p = camParams(); // level camera, fov 60, aspect 1
    // World -X is screen-right for a +Z-facing camera; 5.658 gives
    // ndcX = -5.658 / (10 * tan30) = -0.98 -> x01 = 0.01... mirrored: use
    // -5.658 so the target sits at screen-right x01 = 0.99.
    p.targetX = -5.658;
    p.targetZ = 10;
    computeCheckpointIndicator(out, p);
    check(out.onScreen, 'near-edge target still on-screen');
    check(Math.abs(out.x - (1 - DIAMOND_MARGIN)) < 1e-9,
      'on-screen diamond clamped into the margin box');
    check(Math.abs(out.y - 0.5) < 1e-9, 'clamped diamond keeps its unclamped y');
  }
  {
    const p = camParams();
    p.targetZ = 10;
    computeCheckpointIndicator(out, p);
    check(out.onScreen && Math.abs(out.x - 0.5) < 1e-9 && Math.abs(out.y - 0.5) < 1e-9 &&
      out.angleRad === 0, 'centered target: diamond dead center');
    check(Math.abs(out.distM - 10) < 1e-9 && Math.abs(out.bearingRad) < 1e-9,
      'dist/bearing side data for the centered target');
  }

  // --- behind-camera turn-direction contract -------------------------------
  {
    const p = camParams();
    p.targetX = 10; // world +X = screen LEFT for a +Z-facing camera
    p.targetZ = -1; // behind
    computeCheckpointIndicator(out, p);
    check(!out.onScreen && Math.abs(angleDiff(out.angleRad, Math.PI)) < 1e-9,
      'behind-LEFT target: arrow points LEFT (turn direction, unflipped)');
  }
  {
    const p = camParams();
    p.targetX = -10; // world -X = screen RIGHT
    p.targetZ = -1;
    computeCheckpointIndicator(out, p);
    check(!out.onScreen && angleDiff(out.angleRad, 0) < 1e-9,
      'behind-RIGHT target: arrow points RIGHT');
  }
  {
    // Side target exactly on the camera plane: bearing is +/-90 deg.
    const p = camParams();
    p.targetX = 30;
    computeCheckpointIndicator(out, p);
    check(Math.abs(Math.abs(out.bearingRad) - Math.PI / 2) < 1e-9,
      'side target: bearing +/- 90 deg from forward');
  }

  // --- off-screen arrow sits on the EDGE_MARGIN rectangle -------------------
  {
    const p = camParams();
    p.targetX = -300; // world -X = screen RIGHT for a +Z-facing camera
    p.targetZ = 2; // far off to the screen right
    computeCheckpointIndicator(out, p);
    check(!out.onScreen && Math.abs(out.x - (1 - EDGE_MARGIN)) < 1e-6,
      'off-screen arrow rides the EDGE_MARGIN rect edge');
  }
}

// ===========================================================================
// d. checkpoint order — test-route controller
// ===========================================================================
section('d. checkpoint order (cannot be taken out of order)');
{
  // buildTestRouteCheckpoints derives from the layout's centerlines (the
  // real grid: line i sits at (i - 5) * 78 m).
  const lines = Array.from({ length: 11 }, (_, i) => (i - 5) * 78);
  const fakeLayout = { grid: { linesX: lines, linesZ: lines } };
  const route = buildTestRouteCheckpoints(fakeLayout);
  check(route.length === 3, 'test route has 3 checkpoints');
  check(route[0].x === 0 && route[0].z === -78, 'checkpoint 1 at grid (0, -78)');
  check(route[1].x === 78 && route[1].z === -78, 'checkpoint 2 at grid (78, -78)');
  check(route[2].x === 78 && route[2].z === 0, 'checkpoint 3 at grid (78, 0)');

  const cps = [
    { x: 0, z: 0, label: 'A' },
    { x: 50, z: 0, label: 'B' },
    { x: 100, z: 0, label: 'C' },
  ];
  const events = [];
  const seq = createCheckpointSequence({
    checkpoints: cps,
    passRadiusM: 12,
    onAdvance: (index, next) => events.push(['advance', index, next.label]),
    onComplete: () => events.push(['complete']),
  });
  check(seq.total() === 3 && seq.currentIndex() === 0 && seq.currentTarget() === cps[0],
    'sequence starts on the first checkpoint');

  seq.update(1 / 60, { x: 50, z: 2 }); // INSIDE checkpoint B's radius
  check(seq.currentIndex() === 0 && events.length === 0,
    'passing a NON-target checkpoint does NOTHING (cannot skip)');
  seq.update(1 / 60, { x: 100, z: 0 }); // inside the FINAL checkpoint
  check(seq.currentIndex() === 0 && events.length === 0,
    'passing the final checkpoint first does NOTHING');

  seq.update(1 / 60, { x: 5, z: 0 }); // inside checkpoint A
  check(seq.currentIndex() === 1 && JSON.stringify(events) === '[["advance",1,"B"]]',
    'passing the target advances to the next checkpoint');
  seq.update(1 / 60, { x: 5, z: 0 }); // still inside A (now passed)
  check(seq.currentIndex() === 1 && events.length === 1,
    're-passing an already-taken checkpoint does NOTHING');

  seq.update(1 / 60, { x: 150, z: 0 });
  check(seq.currentIndex() === 1 && events.length === 1,
    'cannot jump to the final checkpoint out of order');

  seq.update(1 / 60, { x: 55, z: 0 });
  check(seq.currentIndex() === 2 && events.length === 2, 'second pass advances to the final');
  seq.update(1 / 60, { x: 95, z: 0 });
  check(seq.isDone() && seq.currentIndex() === 3 && seq.currentTarget() === null,
    'final checkpoint completes the route');
  check(JSON.stringify(events) === '[["advance",1,"B"],["advance",2,"C"],["complete"]]',
    'event order: advance, advance, complete');
  seq.update(1 / 60, { x: 95, z: 0 });
  check(events.length === 3, 'updates after completion fire nothing');

  seq.reset();
  check(seq.currentIndex() === 0 && seq.currentTarget() === cps[0] && !seq.isDone(),
    'reset restarts from the first checkpoint (no callbacks)');

  // exactly at the pass radius counts as passed (inclusive).
  const edge = createCheckpointSequence({ checkpoints: [{ x: 0, z: 0 }], passRadiusM: 12 });
  edge.update(1 / 60, { x: 12, z: 0 });
  check(edge.isDone(), 'a pass exactly at the radius counts (inclusive)');

  let threw = false;
  try {
    createCheckpointSequence({ checkpoints: [] });
  } catch {
    threw = true;
  }
  check(threw, 'empty checkpoint list is rejected');
}

// ===========================================================================
// e. reset prompt — show/hide only on change (absorbed into the HUD)
// ===========================================================================
section('e. reset prompt (HUD-owned, change-gated)');
{
  const prompt = hud.parts.resetPrompt;
  check(prompt.textContent === 'STUCK — PRESS R TO RESET',
    'prompt carries the task-3.3 wording (absorbed from main.js)');
  check(prompt.style.display === 'none', 'prompt hidden initially');
  const before = prompt.style._writeCount;
  hud.showResetPrompt(true);
  check(prompt.style.display === 'block', 'showResetPrompt(true) shows it');
  const afterShow = prompt.style._writeCount;
  check(afterShow > before, 'show wrote the style once');
  hud.showResetPrompt(true);
  check(prompt.style._writeCount === afterShow, 'repeated show writes NOTHING');
  hud.showResetPrompt(false);
  check(prompt.style.display === 'none', 'showResetPrompt(false) hides it');
  hud.showResetPrompt(false);
  check(prompt.style._writeCount === afterShow + 1, 'repeated hide writes NOTHING');
}

// ===========================================================================
// f. checkpoint world marker — beam + ring, fog-immune, pulse + near fade
// ===========================================================================
section('f. checkpoint world marker');
{
  const scene = new THREE.Scene();
  const marker = createCheckpointMarker(scene);
  check(scene.children.includes(marker.group), 'marker group added to the scene');
  check(marker.isVisible() === false, 'marker starts hidden (0 draws at boot)');
  check(marker.group.children.length === 2, 'marker is beam + ring');

  const [beam, ring] = marker.group.children;
  for (const mesh of [beam, ring]) {
    check(mesh.material.blending === THREE.AdditiveBlending, 'additive blending (glow)');
    check(mesh.material.fog === false, 'fog:false — visible at any distance');
    check(mesh.material.depthWrite === false, 'depthWrite false — never occludes');
    check(mesh.material.transparent === true, 'transparent');
  }
  check(beam.geometry.type === 'CylinderGeometry', 'beam is a cylinder');
  check(ring.geometry.type === 'TorusGeometry', 'ring is a torus (gate)');

  marker.set({ x: 5, z: -3 });
  check(marker.isVisible() && marker.group.position.x === 5 && marker.group.position.z === -3,
    'set(position) moves the marker onto the target');
  marker.update(0.016, { position: new THREE.Vector3(5, 2, -3) });
  check(beam.material.opacity < 0.02 && ring.material.opacity < 0.02,
    'camera 2 m away: marker fully faded (no white-out driving through)');
  marker.update(0.016, { position: new THREE.Vector3(60, 3, 80) });
  check(beam.material.opacity > 0.1 && ring.material.opacity > 0.5,
    'camera far away: marker at full pulse opacity');
  const ringScale = ring.scale.x;
  marker.update(0.05, { position: new THREE.Vector3(60, 3, 80) });
  check(ring.scale.x !== ringScale, 'ring pulses (scale breathes)');
  marker.set(null);
  check(marker.isVisible() === false, 'set(null) hides the marker');
}

// ---------------------------------------------------------------------------
const failedTotal = failed;
console.log(
  failedTotal === 0
    ? `  PASS hud-test (${checks} checks)`
    : `  hud-test: ${failedTotal}/${checks} checks FAILED`
);
process.exitCode = failedTotal === 0 ? 0 : 1;
