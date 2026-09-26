#!/usr/bin/env node
/**
 * Boot integration harness (Midtown Blitz — 3.2 integration regression guard).
 *
 * Boots the REAL application entry (src/main.js) headlessly: document/window
 * stubs plus a proxy WebGL2 context let the real THREE.WebGLRenderer, real
 * city, real car, real rig, and real ?debug panels all run under plain node.
 * The rAF driver is scripted, so the sim advances deterministically.
 *
 * Asserts, after boot + ~700 standstill frames (>= 600 fixed ticks):
 *   1. the ?debug handle window.__game exposes car/rig/camera/scene/renderer/layout
 *   2. every numeric car.state field is finite (no NaN from step/carView/rig)
 *   3. the car group's position/rotation are finite and parked at the spawn
 *   4. camera.position is finite and ~5-15 m behind the car group
 *   5. scene.fog.near/far finite with near < far, and camera.far > fog.far
 *   6. per-frame renderer counters match the exact submitted scene:
 *      chase 30 draws / 86626 tris (spire+band culled; task 4.2 added the
 *      3 instanced traffic parts = 24x3 boxes; task 4.3 added the 2
 *      instanced parked-car parts = 48x2 boxes), overhead 32 / 86650
 *   7. V (overhead) applies the high vantage exactly: camera (0,620,340),
 *      fog 1100-2400, far 3000 — and leaving restores tier fog + the chase
 *   8. the ?debug quality panel's LIVE line reflects the real fog/far state
 *   9. gfx.applyTierFog writes sane, strictly-ordered values for every tier
 *  10. (task 5.2) the mode flow: boot ends in MENU with the sim frozen
 *      (zero ticks across pumped frames, car static, menu DOM attached),
 *      cruise card click -> racing with a controllable car, Esc -> paused
 *      with the state preserved exactly, resume continues (not restarts),
 *      mid-run restart respawns fresh, quit-to-menu tears the paused mode
 *      down completely (no leftover overlays, only the menu's own cleanup
 *      registered, car back at the menu idle), and the placeholder results
 *      screen renders through racing -> results -> retry/menu.
 *  11. (task 5.3) the HUD: hidden in menu/paused/results, visible in
 *      racing, dimmed timer placeholder in Cruise (no timer to run), the
 *      fresh-entry countdown shows 3-2-1-GO and LOCKS the throttle (held W
 *      does not move the car until GO, then it does), and the ?debug T test
 *      route: world marker at the target, straight-line drive chimes
 *      (placeholder blip) + advances in order, the edge arrow tracks the
 *      off-screen next target, no out-of-order passes, and quitting tears
 *      route + marker + guidance down completely.
 *  12. (task 5.4) the real races: a Blitz card click respawns the car at
 *      the ROUTE's start pose (not the app spawn), shows the full time
 *      limit undimmed, locks the controls through the countdown, then runs
 *      the timer DOWN while racing; pausing freezes the timer text exactly
 *      and resume continues it; quitting to menu tears the whole session
 *      down (no live session, dead countdown, dimmed timer, hidden marker);
 *      real result payloads render the results screen (win variant and the
 *      TIME UP failure variant) and RETRY re-enters the same event fresh;
 *      and Cruise runs a minute-plus of simulated driving with no timer,
 *      no results, and no end (the pure harness covers the full 10 min).
 *  13. (task 5.5) records end-to-end: a scripted WIN (the car teleported
 *      through the route's checkpoints) writes a real record — the debounced
 *      blob writer persists bestTimeMs + bestMedal, the results screen shows
 *      the NEW RECORD badge on the record run and hides it on a slower
 *      follow-up while the stored best stays put, and the menu shows the
 *      saved best + medal after quitting (records re-read per menu entry).
 *  14. (task 6.2) the loading bar phases: the #loadbar width writes fired
 *      during boot are the exact cost-weighted phase sequence
 *      [15, 35, 60, 75, 92, 100]% (renderer -> city generation -> city view
 *      build -> collision world -> car + parked + traffic -> ready),
 *      strictly increasing, and every consecutive pair is separated by a
 *      requestAnimationFrame yield (each phase paints before the next runs);
 *      the artificial stretch stays modest (every boot wait <= 400 ms, the
 *      deliberate lingers sum to 1470 ms < 2 s).
 *
 * Run: node scripts/boot-integration-test.mjs   (plain node, no dependencies)
 */
import fs from 'node:fs';
import * as THREE from 'three';
import { QUALITY_TIERS, applyTierFog } from '../src/engine/renderer.js';
import { RACE_EVENT_BY_ID } from '../src/game/races.js';
import { formatRaceTime } from '../src/ui/hud.js';
import { formatRecordTime } from '../src/ui/main-menu.js';

/** Synchronous stdout write: output survives process.exit and crashes. */
function log(line) {
  fs.writeSync(1, line + '\n');
}

// ---------------------------------------------------------------------------
// Environment stubs (must be installed before importing src/main.js).
// ---------------------------------------------------------------------------

const _winListeners = new Map();
function winOn(type, fn) {
  if (!_winListeners.has(type)) _winListeners.set(type, []);
  _winListeners.get(type).push(fn);
}
function winFire(type, event) {
  for (const fn of _winListeners.get(type) ?? []) fn(event);
}

/** Oscillator creations (chime counter for the task 5.3 pass-blip). */
const oscLog = [];

/** DOM element stub good enough for main.js's debug panels + three's canvas. */
function makeElement(tagName) {
  const listeners = new Map();
  // cssText-aware inline-style stub (modes-test pattern): `style.cssText`
  // parses into declarations and direct `style.prop` writes/reads hit the
  // same map — so the harness can assert HUD styling set via cssText.
  const decls = new Map();
  // Task 6.2: chronological log of direct style writes (prop/value pairs),
  // so the boot section can assert the loading bar's width phase sequence.
  const styleLog = [];
  // Task 6.2: set true for the #loadbar stub (see getElementById) so its
  // width writes journal into the ordered boot log (bootLog/booting are
  // declared later at module top level; the trap only runs during boot).
  const bootTags = { loadbar: false };
  const style = new Proxy(
    {
      get cssText() {
        return [...decls.entries()].map(([k, v]) => `${k}:${v}`).join(';');
      },
      set cssText(text) {
        decls.clear();
        for (const part of String(text).split(';')) {
          const i = part.indexOf(':');
          if (i > 0) decls.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
        }
      },
    },
    {
      get(target, prop) {
        if (prop === 'cssText') return target.cssText;
        return typeof prop === 'string' ? decls.get(prop) ?? '' : undefined;
      },
      set(target, prop, value) {
        if (prop === 'cssText') {
          target.cssText = value;
        } else {
          decls.set(String(prop), String(value));
          styleLog.push([String(prop), String(value)]);
          if (bootTags.loadbar && booting && String(prop) === 'width') {
            bootLog.push({ t: 'width', value: String(value) });
          }
        }
        return true;
      },
    }
  );
  const el = {
    tagName: String(tagName).toUpperCase(),
    style,
    _styleLog: styleLog,
    _bootTags: bootTags,
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      },
    },
    children: [],
    textContent: '',
    value: '',
    type: '',
    min: '',
    max: '',
    step: '',
    width: 0,
    height: 0,
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
    remove() {},
    fire(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  return el;
}

// --- the fake WebGL2 context: a proxy that answers every three.js probe ----
const glReverseConst = new Map(); // synthetic constant number -> GL name
let glId = 1;
// Spin trap: a stubbed GL method called millions of times means some three
// loop never terminates against the proxy; dump the culprits + a stack.
const glCalls = new Map();
let glCallsTotal = 0;
/**
 * Generic stand-in for any GL method three calls at boot/render.
 * @param {string} name Method name.
 * @param {unknown[]} args Call arguments.
 * @returns {unknown} A plausible stub result.
 */
function glHandler(name, args) {
  switch (name) {
    case 'getParameter': {
      const nameOf = glReverseConst.get(args[0]);
      if (nameOf === 'VERSION' || nameOf === 'RENDERER' || nameOf === 'VENDOR') {
        return `midtown-stub-${nameOf}`;
      }
      if (typeof nameOf === 'string' && nameOf.startsWith('SHADING_LANGUAGE_VERSION')) {
        return 'WebGL GLSL ES 3.00 (stub)';
      }
      return 16384;
    }
    case 'getShaderParameter':
    case 'getProgramParameter':
      return true; // COMPILE/LINK status AND the (count=1) ACTIVE_* queries
    case 'getShaderPrecisionFormat':
      return { rangeMin: 127, rangeMax: 127, precision: 23 };
    case 'getActiveUniform':
      return { name: 'u_stub', type: 0x8b50, size: 1 };
    case 'getActiveAttrib':
      return { name: 'a_stub', type: 0x8b50, size: 1 };
    case 'getError':
      return 0; // NO_ERROR
    case 'checkFramebufferStatus':
      return 0x8cd5; // FRAMEBUFFER_COMPLETE
    case 'isContextLost':
      return false;
    case 'getSupportedExtensions':
      return [];
    case 'getShaderInfoLog':
    case 'getProgramInfoLog':
    case 'getShaderSource':
      return '';
    case 'getContextAttributes':
      return { alpha: true, antialias: true, depth: true, stencil: true };
    case 'getClientWaitSync':
      return 0x911d; // WAIT_FAILED; sync objects are never used at boot
    default:
      return undefined;
  }
}
const gl = new Proxy(
  {},
  {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) {
        const value = 0x1000 + glId++;
        glReverseConst.set(value, prop);
        target[prop] = value;
        return value;
      }
      if (prop === 'drawingBufferWidth' || prop === 'drawingBufferHeight') {
        target[prop] = 1280;
        return 1280;
      }
      target[prop] = (...args) => {
        glCalls.set(prop, (glCalls.get(prop) ?? 0) + 1);
        if (++glCallsTotal > 20000000) {
          const top = [...glCalls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
          log(`    GL SPIN TRAP after ${glCallsTotal} calls; top: ${JSON.stringify(top)}`);
          log(`    at ${new Error().stack.split('\n').slice(1, 6).join(' | ')}`);
          process.exit(9);
        }
        return glHandler(prop, args);
      };
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }
);

function makeCanvas() {
  const el = makeElement('canvas');
  el.getContext = () => gl; // three asks for 'webgl2'; always answer with the stub
  return el;
}

const _created = [];
const documentStub = {
  activeElement: null,
  getElementById(id) {
    if (id === 'app' || id === 'loading' || id === 'loadbar') {
      // One stable stub per id so state (e.g. #loading classes) persists.
      documentStub._ids ??= {};
      documentStub._ids[id] ??= makeElement('div');
      if (id === 'loadbar') documentStub._ids[id]._bootTags.loadbar = true;
      return documentStub._ids[id];
    }
    return null;
  },
  createElement(tag) {
    const el = makeElement(tag);
    _created.push(el);
    return el;
  },
  createElementNS(_ns, tag) {
    if (tag === 'canvas') {
      const el = makeCanvas();
      _created.push(el);
      return el;
    }
    const el = makeElement(tag);
    _created.push(el);
    return el;
  },
  body: makeElement('body'),
};

// --- scripted requestAnimationFrame driver ---------------------------------
let rafQueue = [];
let scriptedNowMs = 0;
// Task 6.2: while `booting`, every rAF REQUEST and every setTimeout is
// journaled in order, so the boot section can assert that the loading
// phases (loadbar width writes) are separated by frame yields and that the
// artificial waits stay modest. After boot the journaling stops (the
// scripted-frame pump would otherwise flood it).
const bootLog = [];
let booting = true;
globalThis.requestAnimationFrame = (fn) => {
  if (booting) bootLog.push({ t: 'raf' });
  rafQueue.push(fn);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};

// Task 6.2: transparent wrapper — records wait lengths during boot only.
const _setTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (booting) bootLog.push({ t: 'wait', ms: ms ?? 0 });
  return _setTimeout(fn, ms, ...rest);
};

function pumpFrame(stepMs = 1000 / 60) {
  scriptedNowMs += stepMs;
  const queued = rafQueue;
  rafQueue = [];
  for (const fn of queued) fn(scriptedNowMs);
  return queued.length;
}

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 2,
  location: { search: '?debug', hash: '' },
  addEventListener: winOn,
  removeEventListener() {},
  // Minimal WebAudio stub: the audio manager builds its graph lazily on the
  // first gesture (the harness's synthetic keydowns count as gestures).
  // Every oscillator creation is logged so the harness can count chimes.
  // Task 6.1: the game audio content layer (src/game/game-audio.js) builds
  // engine/skid/music nodes into the same graph, so the stub also covers
  // biquad filters and (noise) buffer sources additively.
  AudioContext: class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.destination = { stub: true };
      this.currentTime = 0;
      this.sampleRate = 44100;
    }
    async resume() {
      this.state = 'running';
      return true;
    }
    async suspend() {
      this.state = 'suspended';
    }
    async close() {
      this.state = 'closed';
    }
    createGain() {
      return {
        connect() {},
        disconnect() {},
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
          setTargetAtTime() {},
          cancelScheduledValues() {},
        },
      };
    }
    createOscillator() {
      oscLog.push(1);
      const param = () => ({
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
        setTargetAtTime() {},
        cancelScheduledValues() {},
      });
      return {
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        frequency: param(),
        detune: param(),
        type: 'sine',
      };
    }
    createBiquadFilter() {
      const param = () => ({
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
        setTargetAtTime() {},
        cancelScheduledValues() {},
      });
      return {
        connect() {},
        disconnect() {},
        type: 'lowpass',
        frequency: param(),
        Q: param(),
        detune: param(),
      };
    }
    createBufferSource() {
      return {
        connect() {},
        disconnect() {},
        buffer: null,
        loop: false,
        start() {},
        stop() {},
      };
    }
    createBuffer(channels, length, sampleRate) {
      const chans = [];
      for (let i = 0; i < channels; i += 1) chans.push(new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData(i) {
          return chans[i];
        },
      };
    }
  },
};
globalThis.document = documentStub;

// ---------------------------------------------------------------------------
// Boot the real app and drive it.
// ---------------------------------------------------------------------------

const checkResults = [];
function check(cond, label) {
  checkResults.push([!!cond, label]);
  if (!cond) log(`    FAIL ${label}`);
}

// Task 6.1: the music loop's look-ahead pump runs on a 25 ms setInterval.
// This harness ends with `process.exitCode` (no hard exit) while the app
// sits in the menu with music playing, so the real interval would keep the
// process alive forever. Nothing in src uses setInterval otherwise, so a
// no-op stub is safe here: the fake context's time never advances, so the
// scheduler has nothing further to schedule anyway.
globalThis.setInterval = () => 0;
const mainPromise = import('../src/main.js');
await mainPromise;

// Real-time boot pump until the ?debug handle appears (loading phases use
// real setTimeout waits of ~1.1 s total), then switch to scripted frames.
const bootDeadline = Date.now() + 15000;
while (!window.__game && Date.now() < bootDeadline) {
  await new Promise((r) => setTimeout(r, 5));
  // One rAF round per poll: onRaf re-queues itself, so draining "until empty"
  // here would render tens of thousands of unthrottled frames during boot.
  const queued = rafQueue;
  rafQueue = [];
  scriptedNowMs = performance.now();
  for (const fn of queued) fn(scriptedNowMs);
}
check(!!window.__game, 'window.__game exposed after boot (?debug)');

// ===========================================================================
// Task 6.2: the loading bar phases, journaled during boot above. The
// sequence below IS the app's documented boot contract (src/main.js
// loadPhase calls): renderer -> city generation -> city view build ->
// collision world -> car + parked + traffic -> ready, as cost-weighted
// percentage stops painted one frame apart.
// ===========================================================================
booting = false; // stop journaling: the scripted-frame pump owns rAF from here
{
  const loadbarEl = documentStub._ids && documentStub._ids['loadbar'];
  const widths = loadbarEl
    ? loadbarEl._styleLog.filter(([prop]) => prop === 'width').map(([, v]) => v)
    : [];
  const pct = widths.map((w) => Number.parseInt(String(w).replace('%', ''), 10));
  check(pct.length > 0, 'loadbar width writes journaled during boot');
  // The exact cost-weighted phase sequence (documented in main.js).
  check(
    JSON.stringify(pct) === JSON.stringify([15, 35, 60, 75, 92, 100]),
    `loading phases fire as [15, 35, 60, 75, 92, 100]% (got ${JSON.stringify(pct)})`
  );
  // Monotonic progress (spec: the bar "advances toward completion").
  let monotonic = true;
  for (let i = 1; i < pct.length; i += 1) if (!(pct[i] > pct[i - 1])) monotonic = false;
  check(monotonic, 'loading progress is strictly monotonic');
  // Every step is a visible jump (>= 8% of the track).
  let visibleSteps = true;
  for (let i = 1; i < pct.length; i += 1) if (pct[i] - pct[i - 1] < 8) visibleSteps = false;
  check(visibleSteps && pct.length >= 6, 'loading bar advances in >= 6 visible steps');
  // Frame-yield separation: between consecutive width writes there is at
  // least one rAF request (each phase paints its step before the next runs).
  // Widths AND rafs share the ordered bootLog here, so this is a true
  // interleaving check; setTimeout journal entries are ignored.
  let yieldSeparated = true;
  let widthSeen = 0;
  let rafSinceWidth = false;
  for (const ev of bootLog) {
    if (ev.t === 'wait') continue;
    if (ev.t === 'raf') {
      rafSinceWidth = true;
      continue;
    }
    if (widthSeen > 0 && !rafSinceWidth) yieldSeparated = false;
    widthSeen += 1;
    rafSinceWidth = false;
  }
  check(
    yieldSeparated && widthSeen === pct.length,
    `every loading phase is separated by a frame yield (${widthSeen} journaled widths vs ${pct.length} on the bar)`
  );
  // Modest artificial stretch: every boot wait <= 400 ms, and the sum of
  // the deliberate phase lingers (>= 100 ms) stays under 2 s.
  const waits = bootLog.filter((ev) => ev.t === 'wait').map((ev) => ev.ms);
  check(waits.length > 0, 'boot waits journaled');
  check(
    waits.every((ms) => ms <= 400),
    `every boot wait is <= 400 ms (max ${Math.max(...waits)})`
  );
  const lingerSum = waits.filter((ms) => ms >= 100).reduce((a, b) => a + b, 0);
  check(
    lingerSum > 0 && lingerSum < 2000,
    `deliberate loading stretch < 2 s (got ${lingerSum} ms)`
  );
}

const game = window.__game;
if (game) {
  check(
    !!game.car && !!game.rig && !!game.camera && !!game.scene && !!game.renderer && !!game.layout,
    '__game carries car/rig/camera/scene/renderer/layout'
  );
}

// --- 700 standstill frames (>= 600 fixed ticks + >= 60 rendered frames) ----
if (game) {
  for (let i = 0; i < 700; i += 1) {
    try {
      pumpFrame();
    } catch (error) {
      log(`    pumpFrame ${i} threw: ${error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`);
      break;
    }
  }
  const { car, rig, camera, scene, renderer } = game;

  let nanField = null;
  for (const [k, v] of Object.entries(car.state)) {
    if (typeof v === 'number' && !Number.isFinite(v)) nanField = `state.${k}=${v}`;
  }
  check(nanField === null, `car.state has no NaN/Inf after 700 standstill ticks ${nanField ?? ''}`);

  const group = rig.getTarget();
  check(!!group, 'rig target is the car group');
  const gp = group.position;
  const gr = group.rotation;
  check(
    Number.isFinite(gp.x) && Number.isFinite(gp.y) && Number.isFinite(gp.z),
    'car group position finite'
  );
  check(Number.isFinite(gr.y), 'car group rotation finite');
  check(Math.abs(gp.x - -3.5) < 0.01 && Math.abs(gp.z - -117) < 0.01, 'car parked at spawn x/z');
  check(Math.abs(gp.y) < 0.2, `car group y eased to road level (got ${gp.y})`);

  const cp = camera.position;
  check(
    Number.isFinite(cp.x) && Number.isFinite(cp.y) && Number.isFinite(cp.z),
    'camera.position finite'
  );
  const dist = Math.hypot(cp.x - gp.x, cp.y - gp.y, cp.z - gp.z);
  check(dist >= 5 && dist <= 15, `camera ~5-15 m from the car group (got ${dist.toFixed(2)})`);

  const fog = scene.fog;
  check(!!fog, 'scene.fog exists');
  if (fog) {
    check(Number.isFinite(fog.near) && Number.isFinite(fog.far), 'fog.near/far finite');
    check(fog.near < fog.far, `fog.near < fog.far (got ${fog.near} < ${fog.far})`);
  }
  check(Number.isFinite(camera.far) && camera.far > (fog?.far ?? 0), 'camera.far > fog.far');
  check(camera.near > 0 && camera.near < camera.far, '0 < camera.near < camera.far');

  const info = renderer.info.render;
  // Task 4.2: the 3 instanced traffic parts (body/cabin/skirt) joined the
  // scene, so the pinned counts gained exactly +3 draws and 24*3*12 tris.
  // Task 4.3: the 2 instanced parked-car parts (body/cabin) joined too:
  // another +2 draws and 48*2*12 tris.
  check(info.calls === 30, `chase draw calls == 30 (got ${info.calls})`);
  check(info.triangles === 86626, `chase triangles == 86626 (got ${info.triangles})`);

  // --- V: overhead view, exactly as the ?debug handler applies it ---------
  winFire('keydown', {
    code: 'KeyV',
    repeat: false,
    target: { tagName: 'BODY' },
    preventDefault() {},
  });
  pumpFrame();
  const oInfo = renderer.info.render;
  check(Math.abs(cp.x - 0) < 0.01 && Math.abs(cp.y - 620) < 0.01 && Math.abs(cp.z - 340) < 0.01,
    'overhead camera at (0, 620, 340)');
  check(fog.near === 1100 && fog.far === 2400, 'overhead fog 1100-2400');
  check(camera.far === 3000, 'overhead camera.far 3000');
  check(oInfo.calls === 32, `overhead draw calls == 32 (got ${oInfo.calls})`);
  check(oInfo.triangles === 86650, `overhead triangles == 86650 (got ${oInfo.triangles})`);

  // The quality panel's live line must reflect the real (overhead) state.
  const panelLine = _created.map((e) => String(e.textContent)).find((t) => t.includes('cam overhead'));
  check(!!panelLine, 'quality panel shows cam overhead');
  check(!!panelLine && panelLine.includes('live fog 1100–2400'), 'panel live fog line shows 1100–2400');
  check(!!panelLine && panelLine.includes('far 3000'), 'panel live far line shows 3000');

  // --- V again: back to the tier chase view -------------------------------
  winFire('keydown', {
    code: 'KeyV',
    repeat: false,
    target: { tagName: 'BODY' },
    preventDefault() {},
  });
  pumpFrame();
  check(fog.near === 60 && fog.far === 260, 'leaving overhead restores tier fog 60-260');
  check(camera.far === 340, 'leaving overhead restores camera.far 340');
  const distBack = Math.hypot(cp.x - gp.x, cp.y - gp.y, cp.z - gp.z);
  check(distBack >= 5 && distBack <= 15, `rig re-frames the car after overhead (got ${distBack.toFixed(2)})`);
}

// ===========================================================================
// Task 5.2: mode-flow integration. The boot above already ran its 700-frame
// standstill INSIDE menu mode (the sim is frozen until a race starts), so
// every earlier assertion doubles as "the menu renders the frozen scene
// normally". This section clicks through the whole navigation graph: menu
// freeze -> cruise start -> drive -> pause/resume -> mid-run restart ->
// quit-to-menu cleanliness -> placeholder results (retry/menu).
// ===========================================================================
if (game) {
  const { modes, menu, pauseMenu, resultsScreen, settings, car } = game;
  const KE = (code) => ({
    code,
    repeat: false,
    target: { tagName: 'BODY' },
    preventDefault() {},
  });
  const keyDown = (code) => winFire('keydown', KE(code));
  const keyUp = (code) => winFire('keyup', KE(code));
  const atSpawn = () =>
    Math.abs(car.state.x - -3.5) < 0.01 && Math.abs(car.state.z - -117) < 0.01;

  check(!!modes && !!menu && !!pauseMenu && !!resultsScreen,
    '__game exposes modes + menu + pauseMenu + resultsScreen');

  // --- boot state: MENU, frozen, menu DOM up, nothing else -----------------
  check(modes.current === 'menu', 'boot ends in MENU mode');
  check(menu.isOpen(), 'main menu overlay open');
  check(documentStub.body.children.includes(menu.root), 'menu root attached to body');
  check(menu.root.style.display === 'flex', 'menu root visible');
  check(!pauseMenu.isOpen() && !resultsScreen.isOpen() && !settings.isOpen(),
    'no other overlays open after boot');
  // Task 5.3: the HUD is racing-only.
  check(!!game.hud, '__game exposes hud');
  check(!game.hud.isOpen() && game.hud.root.style.display === 'none', 'HUD hidden in menu');
  check(!!game.countdown && !!game.checkpointMarker && typeof game.getTestRoute === 'function',
    '__game exposes countdown + checkpointMarker + getTestRoute');
  check(!game.checkpointMarker.isVisible() && game.getTestRoute() === null,
    'no checkpoint marker/route outside racing');
  check(game.getTickCount() === 0, 'zero sim ticks through boot + 700 menu frames');

  const x0 = car.state.x;
  const z0 = car.state.z;
  const t0 = game.getTickCount();
  for (let i = 0; i < 120; i += 1) pumpFrame();
  check(game.getTickCount() === t0, 'menu pumps 120 frames with ZERO sim ticks');
  check(car.state.x === x0 && car.state.z === z0, 'car static across menu frames');
  check(modes.enterMode('paused') === false, 'guard: cannot pause from the menu');

  // --- start cruise from the menu card -> RACING ----------------------------
  menu.cardButtons['cruise'].fire('click', {});
  check(modes.current === 'racing', 'cruise card click -> RACING');
  check(!!modes.data && modes.data.event === 'cruise', 'racing entry data carries the event id');
  check(!menu.isOpen() && menu.root.style.display === 'none', 'menu hidden in racing');
  // Task 5.3: HUD visible in racing; a fresh entry starts the 3-2-1-GO
  // countdown with the controls locked.
  check(game.hud.isOpen() && game.hud.root.style.display === 'block', 'HUD visible in racing');
  check(game.hud.parts.timer.textContent === '0:00.0' && game.hud.parts.timer.style.opacity === '0.35',
    'timer shows the dimmed 0:00.0 placeholder (5.4 owns real timing)');
  check(game.countdown.isActive() && game.countdown.controlsLocked(),
    'fresh racing entry starts the countdown with locked controls');
  check(game.hud.parts.countdownWrap.style.display === 'block' &&
    game.hud.parts.countdownText.textContent === '3',
    'countdown display shows 3 immediately');
  const t1 = game.getTickCount();
  for (let i = 0; i < 90; i += 1) pumpFrame();
  check(game.getTickCount() > t1 + 60, 'sim ticks advance in racing');
  check(game.countdown.number() === 2, 'countdown stepped to 2 (sim-time driven)');

  // Task 5.3: throttle held during the countdown must NOT move the car.
  keyDown('KeyW');
  for (let i = 0; i < 30; i += 1) pumpFrame();
  check(car.state.speed === 0 && atSpawn(),
    'throttle held during the countdown does not move the car');

  // Pump through 2-1-GO + the GO linger: control begins at GO.
  for (let i = 0; i < 260; i += 1) pumpFrame();
  check(!game.countdown.isActive() && !game.countdown.controlsLocked(),
    'countdown finished (GO fired, linger closed)');
  check(game.hud.parts.countdownWrap.style.display === 'none',
    'countdown display cleared after the GO window');
  check(car.state.speed > 1,
    `car accelerates under throttle once GO unlocks the controls (speed ${car.state.speed.toFixed(2)})`);
  const driveX = car.state.x;
  const driveZ = car.state.z;
  const driveSpeed = car.state.speed;

  // --- Esc -> PAUSED: sim frozen, exact prior state -------------------------
  keyDown('Escape');
  check(modes.current === 'paused', 'Esc pauses from racing');
  check(pauseMenu.isOpen(), 'pause menu open');
  check(!game.hud.isOpen() && game.hud.root.style.display === 'none', 'HUD hidden while paused');
  keyUp('Escape');
  keyUp('KeyW');
  const tPause = game.getTickCount();
  for (let i = 0; i < 60; i += 1) pumpFrame();
  check(game.getTickCount() === tPause, 'sim frozen while paused');
  check(car.state.x === driveX && car.state.z === driveZ && car.state.speed === driveSpeed,
    'car pose + velocity preserved EXACTLY while paused');

  // --- RESUME: exact prior state continues (not a restart) ------------------
  pauseMenu.buttons.resume.fire('click', {});
  check(modes.current === 'racing', 'RESUME -> racing');
  check(!pauseMenu.isOpen(), 'pause menu hidden after resume');
  check(game.hud.isOpen(), 'HUD visible again after resume');
  check(!game.countdown.isActive(), 'resume does NOT restart the countdown');
  pumpFrame();
  check(Math.abs(car.state.speed - driveSpeed) < 1.0,
    `car continues with the pre-pause velocity (${car.state.speed.toFixed(2)} vs ${driveSpeed.toFixed(2)})`);
  const t2 = game.getTickCount();
  for (let i = 0; i < 5; i += 1) pumpFrame();
  check(game.getTickCount() > t2, 'sim continues ticking after resume');

  // --- mid-run RESTART: fresh racing entry ----------------------------------
  keyDown('Escape');
  keyUp('Escape');
  check(modes.current === 'paused', 'paused again mid-run');
  pauseMenu.buttons.restart.fire('click', {});
  check(modes.current === 'racing', 'RESTART -> racing');
  check(!pauseMenu.isOpen(), 'pause menu hidden after restart');
  for (let i = 0; i < 5; i += 1) pumpFrame();
  check(atSpawn(), 'restart respawned the car at the spawn (fresh run)');
  check(car.state.speed === 0, 'restart zeroed the velocity');
  check(game.countdown.isActive() && game.countdown.controlsLocked(),
    'restart (fresh entry) runs the countdown again');

  // --- QUIT TO MENU: full teardown, clean menu -------------------------------
  // Clear the restart countdown first (sim-time driven; 235 frames > 3.8 s),
  // then drive away from the spawn.
  for (let i = 0; i < 235; i += 1) pumpFrame();
  check(!game.countdown.isActive(), 'restart countdown finished before driving');
  keyDown('KeyW');
  for (let i = 0; i < 60; i += 1) pumpFrame();
  keyUp('KeyW');
  check(!atSpawn(), 'car drove away from the spawn before quitting');
  keyDown('Escape');
  keyUp('Escape');
  check(modes.current === 'paused', 'paused for the quit');
  const t3 = game.getTickCount();
  pauseMenu.buttons.quit.fire('click', {});
  check(modes.current === 'menu', 'QUIT -> menu');
  check(menu.isOpen() && menu.root.style.display === 'flex', 'menu open + visible after quit');
  check(!pauseMenu.isOpen() && pauseMenu.root.style.display === 'none',
    'no leftover pause overlay (closed + display none)');
  check(!resultsScreen.isOpen() && resultsScreen.root.style.display === 'none',
    'no leftover results overlay');
  check(modes.lastFlushed === 1 && modes.pendingCleanups === 1,
    `quit flushed the paused mode's teardown; only the menu's own hide remains (flushed ${modes.lastFlushed}, pending ${modes.pendingCleanups})`);
  // Task 5.3: racing HUD state fully torn down with the mode.
  check(!game.hud.isOpen() && game.hud.root.style.display === 'none',
    'HUD hidden after quit-to-menu');
  check(!game.countdown.isActive() && !game.countdown.controlsLocked(),
    'no countdown survives the mode exit');
  check(game.hud.parts.countdownWrap.style.display === 'none' &&
    game.hud.parts.resetPrompt.style.display === 'none' &&
    game.hud.parts.edgeArrow.style.display === 'none' &&
    game.hud.parts.diamond.style.display === 'none',
    'no leftover countdown/prompt/guidance elements');
  check(atSpawn(), 'car respawned at the menu idle state');
  for (let i = 0; i < 30; i += 1) pumpFrame();
  check(game.getTickCount() === t3, 'no sim ticks after quit (world idle behind the menu)');

  // --- placeholder results: racing -> results -> retry / menu ----------------
  menu.cardButtons['blitz-downtown'].fire('click', {});
  check(modes.current === 'racing' && modes.data.event === 'blitz-downtown',
    'blitz card click -> racing with its event id');
  check(game.showResults({ eventName: 'BLITZ · DOWNTOWN SPRINT', timeMs: 81234, medal: 'gold' }) === true,
    'showResults(data) enters results mode (5.4 wires real endings)');
  check(modes.current === 'results', 'RESULTS mode active');
  check(!game.hud.isOpen(), 'HUD hidden in results');
  check(resultsScreen.isOpen(), 'results screen open');
  check(resultsScreen.slots.time.textContent === '1:21.234', 'results time slot renders data');
  check(resultsScreen.slots.medal.textContent === 'GOLD', 'results medal slot renders data');
  resultsScreen.buttons.retry.fire('click', {});
  check(modes.current === 'racing', 'results RETRY -> racing');
  check(game.hud.isOpen() && game.countdown.isActive(),
    'retry (fresh entry) shows the HUD + runs the countdown');
  for (let i = 0; i < 3; i += 1) pumpFrame();
  // Task 5.4: RETRY re-runs the SAME event — the car respawns at the
  // blitz-downtown ROUTE start pose (races.js), not the app spawn.
  const downtownStart = RACE_EVENT_BY_ID['blitz-downtown'].start;
  check(
    Math.abs(car.state.x - downtownStart.x) < 0.01 &&
      Math.abs(car.state.z - downtownStart.z) < 0.01 &&
      car.state.speed === 0,
    'retry respawned fresh at the blitz-downtown route start'
  );
  game.showResults({ eventName: 'X', timeMs: 1000 });
  check(modes.current === 'results', 'results again');
  resultsScreen.buttons.menu.fire('click', {});
  check(modes.current === 'menu', 'results MENU -> menu');
  check(modes.lastFlushed === 1 && modes.pendingCleanups === 1,
    'final menu: results teardown flushed, only the menu hide registered');
  check(menu.root.style.display === 'flex' && pauseMenu.root.style.display === 'none' &&
      resultsScreen.root.style.display === 'none',
    'only the menu overlay is visible at the end');
  const t4 = game.getTickCount();
  for (let i = 0; i < 30; i += 1) pumpFrame();
  check(game.getTickCount() === t4, 'menu stays frozen after every path');
  check(atSpawn(), 'car idles at the spawn after every path');
  check(!game.hud.isOpen(), 'HUD hidden in the final menu');

  // =========================================================================
  // Task 5.3: ?debug T TEST ROUTE — countdown lock, world marker, ordered
  // checkpoint passes with the placeholder chime, edge-arrow guidance for
  // the off-screen next target, and full teardown on quit.
  // =========================================================================
  menu.cardButtons['cruise'].fire('click', {});
  check(modes.current === 'racing', 'cruise again for the T-route check');
  for (let i = 0; i < 250; i += 1) pumpFrame(); // clear the entry countdown
  check(!game.countdown.isActive(), 'entry countdown finished before T');
  check(atSpawn() && car.state.speed === 0, 'car still parked at the spawn before T');

  const oscBefore = oscLog.length;
  winFire('keydown', KE('KeyT'));
  check(typeof game.getTestRoute() === 'object' && !!game.getTestRoute(),
    'T starts the test route');
  check(game.getTestRoute().total() === 3 && game.getTestRoute().currentIndex() === 0,
    'test route has 3 ordered checkpoints, target = first');
  check(game.checkpointMarker.isVisible(), 'world marker shown for the first target');
  const marker0 = game.checkpointMarker.group.position;
  check(Math.abs(marker0.x - 0) < 0.01 && Math.abs(marker0.z - -78) < 0.01,
    'marker at test checkpoint 1 (grid 0, -78)');
  pumpFrame(); // one rendered frame: updateCheckpoint computes the guidance info
  check(game.hud.getCheckpointInfo() !== null, 'HUD has a checkpoint target');
  check(game.countdown.isActive() && game.countdown.controlsLocked(),
    'T starts a countdown that locks the controls');
  keyDown('KeyW');
  for (let i = 0; i < 30; i += 1) pumpFrame();
  check(car.state.speed === 0 && atSpawn(), 'T countdown blocks the throttle');
  for (let i = 0; i < 230; i += 1) pumpFrame();
  check(!game.countdown.controlsLocked(), 'GO fired for the T route');

  // Straight north from the spawn passes 3.5 m from checkpoint 1 (inside
  // the 12 m pass radius) — pure throttle is enough to take it.
  let advanced = false;
  for (let i = 0; i < 600; i += 1) {
    pumpFrame();
    if (game.getTestRoute() && game.getTestRoute().currentIndex() === 1) {
      advanced = true;
      break;
    }
  }
  check(advanced, 'driving through checkpoint 1 advanced the target');
  check(oscLog.length > oscBefore, 'passing chimed (task 6.1 synthesized chime)');
  const marker1 = game.checkpointMarker.group.position;
  check(Math.abs(marker1.x - 78) < 0.01 && Math.abs(marker1.z - -78) < 0.01,
    'marker moved to checkpoint 2 (grid 78, -78)');
  const cpInfo = game.hud.getCheckpointInfo();
  check(!!cpInfo && cpInfo.onScreen === false,
    'checkpoint 2 is off-screen from the northbound car');
  check(game.hud.parts.edgeArrow.style.display === 'block' &&
    game.hud.parts.diamond.style.display === 'none',
    'edge arrow shown (diamond hidden) for the off-screen target');
  const idxAfterFirst = game.getTestRoute().currentIndex();
  for (let i = 0; i < 120; i += 1) pumpFrame(); // keep driving north, away
  check(game.getTestRoute() && game.getTestRoute().currentIndex() === idxAfterFirst,
    'no out-of-order pass while checkpoint 2 stays ahead-left');
  keyUp('KeyW');

  // Quit: the racing-mode teardown must clear route + marker + guidance.
  keyDown('Escape');
  keyUp('Escape');
  pauseMenu.buttons.quit.fire('click', {});
  check(modes.current === 'menu', 'quit to menu after the T route');
  check(game.getTestRoute() === null, 'test route torn down with the racing mode');
  check(!game.checkpointMarker.isVisible(), 'world marker hidden after teardown');
  check(game.hud.getCheckpointInfo() === null, 'HUD guidance cleared after teardown');
  check(game.hud.parts.edgeArrow.style.display === 'none' &&
    game.hud.parts.diamond.style.display === 'none',
    'guidance elements hidden after teardown');

  // =========================================================================
  // Task 5.4: REAL Blitz races + Cruise. A Blitz card click respawns the car
  // at the ROUTE's start pose (races.js), shows the full time limit
  // undimmed, locks the controls through the countdown, then the timer
  // counts DOWN while racing — pausing freezes it exactly, resume continues
  // it. Quitting tears the session down completely. Real result payloads
  // render the win variant AND the TIME UP failure variant, with RETRY
  // re-entering the same event fresh. Cruise runs a minute-plus of
  // simulated driving with no timer, no results, and no end (the pure
  // race-controller harness covers the full 10 minutes).
  // =========================================================================
  const downtown = RACE_EVENT_BY_ID['blitz-downtown'];
  const hud = game.hud;
  const atAppSpawn = () =>
    Math.abs(car.state.x - -3.5) < 0.01 && Math.abs(car.state.z - -117) < 0.01;
  const atRouteStart = () =>
    Math.abs(car.state.x - downtown.start.x) < 0.01 &&
    Math.abs(car.state.z - downtown.start.z) < 0.01;

  // --- Blitz card -> route start + countdown + full-limit timer -------------
  menu.cardButtons['blitz-downtown'].fire('click', {});
  check(modes.current === 'racing' && modes.data.event === 'blitz-downtown',
    'blitz card starts its real race');
  check(!!game.getRace() && game.getRace().phase() === 'countdown',
    'a live race session is counting down');
  check(!!game.getRace() && game.getRace().eventId() === 'blitz-downtown' && !game.getRace().isCruise(),
    'the session is the blitz-downtown route');
  check(atRouteStart() && car.state.speed === 0,
    'car respawned at the ROUTE start pose (not the app spawn)');
  check(game.countdown.isActive() && game.countdown.controlsLocked(),
    'the race countdown locks the controls');
  check(hud.parts.timer.textContent === formatRaceTime(downtown.timeLimitMs) &&
    hud.parts.timer.style.opacity === '1',
    `HUD timer shows the full limit undimmed (${formatRaceTime(downtown.timeLimitMs)})`);
  check(game.checkpointMarker.isVisible() &&
    Math.abs(game.checkpointMarker.group.position.x - downtown.checkpoints[0].x) < 0.01 &&
    Math.abs(game.checkpointMarker.group.position.z - downtown.checkpoints[0].z) < 0.01,
    'world marker sits on the first gate');

  keyDown('KeyW');
  for (let i = 0; i < 60; i += 1) pumpFrame();
  check(car.state.speed === 0 && atRouteStart(), 'countdown blocks the throttle in a Blitz race too');
  for (let i = 0; i < 220; i += 1) pumpFrame(); // past 3-2-1-GO + the linger
  check(game.getRace().phase() === 'running' && !game.countdown.controlsLocked(),
    'GO: the race is RUNNING with the controls unlocked');
  keyUp('KeyW');

  const timerTextAtGo = hud.parts.timer.textContent;
  for (let i = 0; i < 40; i += 1) pumpFrame();
  const timerTextRunning = hud.parts.timer.textContent;
  check(timerTextRunning !== timerTextAtGo && timerTextRunning !== formatRaceTime(downtown.timeLimitMs),
    `timer counts DOWN while racing (${timerTextAtGo} -> ${timerTextRunning})`);

  // --- pause freezes the timer EXACTLY; resume continues it ------------------
  keyDown('Escape');
  keyUp('Escape');
  check(modes.current === 'paused', 'paused mid-race');
  const elapsedAtPause = game.getRace().elapsedMs();
  check(hud.parts.timer.textContent === timerTextRunning, 'timer text frozen exactly at pause');
  for (let i = 0; i < 60; i += 1) pumpFrame();
  check(hud.parts.timer.textContent === timerTextRunning && game.getRace().elapsedMs() === elapsedAtPause,
    'frozen sim: no timer movement and the session kept its exact state');
  pauseMenu.buttons.resume.fire('click', {});
  check(modes.current === 'racing' && game.getRace().phase() === 'running' &&
    game.getRace().elapsedMs() === elapsedAtPause,
    'resume continues the SAME session (no restart, clock intact)');
  for (let i = 0; i < 40; i += 1) pumpFrame();
  check(hud.parts.timer.textContent !== timerTextRunning, 'timer continues after resume');

  // --- quit to menu: the session is torn down completely ----------------------
  keyDown('Escape');
  keyUp('Escape');
  pauseMenu.buttons.quit.fire('click', {});
  check(modes.current === 'menu', 'quit mid-race -> menu');
  check(game.getRace() === null, 'no live race session after quit');
  check(!game.countdown.isActive() && !game.countdown.controlsLocked(),
    'countdown dead after quit');
  check(hud.parts.timer.textContent === '0:00.0' && hud.parts.timer.style.opacity === '0.35',
    'timer restored to the dimmed placeholder');
  check(!game.checkpointMarker.isVisible(), 'world marker hidden after quit');
  check(atAppSpawn(), 'car back at the menu idle');

  // --- real result payloads: win variant + TIME UP failure variant ------------
  menu.cardButtons['blitz-downtown'].fire('click', {});
  check(modes.current === 'racing' && !!game.getRace() && game.getRace().phase() === 'countdown',
    'fresh blitz entry (a new countdown, old session torn down)');
  for (let i = 0; i < 260; i += 1) pumpFrame(); // clear the countdown
  game.showResults({
    eventName: downtown.name,
    eventId: 'blitz-downtown',
    timeMs: 30000,
    medal: 'silver',
  });
  check(modes.current === 'results' && resultsScreen.isOpen(), 'win payload -> results screen');
  check(resultsScreen.slots.title.textContent === 'RESULTS', 'win variant keeps the RESULTS title');
  check(resultsScreen.slots.medal.textContent === 'SILVER' &&
    resultsScreen.slots.time.textContent === formatRecordTime(30000),
    'win slots render the finish time + medal');
  resultsScreen.buttons.retry.fire('click', {});
  check(modes.current === 'racing' && modes.data.event === 'blitz-downtown',
    'RETRY re-enters the SAME event (the result payload eventId)');
  for (let i = 0; i < 260; i += 1) pumpFrame();
  game.showResults({
    eventName: downtown.name,
    eventId: 'blitz-downtown',
    timeMs: downtown.timeLimitMs,
    medal: null,
    failed: true,
  });
  check(modes.current === 'results' && resultsScreen.isOpen(), 'failure payload -> results screen');
  check(resultsScreen.slots.title.textContent === 'TIME UP', 'failure variant: TIME UP title');
  check(resultsScreen.slots.medal.textContent === '—', 'failure variant: no medal');
  check(resultsScreen.slots.time.textContent === formatRecordTime(downtown.timeLimitMs),
    'failure variant shows the at-expiry time');
  resultsScreen.buttons.menu.fire('click', {});
  check(modes.current === 'menu' && game.getRace() === null,
    'results MENU -> menu with the session torn down');

  // --- Cruise runs indefinitely (60+ simulated seconds sampled) ---------------
  menu.cardButtons['cruise'].fire('click', {});
  check(modes.current === 'racing' && modes.data.event === 'cruise', 'cruise card -> racing');
  check(!!game.getRace() && game.getRace().isCruise() && game.getRace().phase() === 'countdown',
    'a CRUISE session is counting down');
  check(hud.parts.timer.style.opacity === '0.35',
    'cruise shows no timer (the dimmed placeholder)');
  for (let i = 0; i < 260; i += 1) pumpFrame();
  check(game.getRace().phase() === 'cruising', 'cruise cruising after GO');
  for (let i = 0; i < 3600; i += 1) pumpFrame(); // 60 simulated seconds
  check(modes.current === 'racing' && !resultsScreen.isOpen(),
    'still racing after 60 sim seconds — no results, no failure');
  check(game.getRace().phase() === 'cruising' && !game.getRace().isDisposed(),
    'the cruise session is still alive (never ends on its own)');

  // Clean exit for anything that follows.
  keyDown('Escape');
  keyUp('Escape');
  pauseMenu.buttons.quit.fire('click', {});
  check(modes.current === 'menu' && game.getRace() === null,
    'final quit: clean menu, no session');

  // =========================================================================
  // Task 5.5: records + medals end-to-end. The car is TELEPORTED through a
  // route's checkpoints (the sequence only ever samples the CURRENT target),
  // so a race can be WON deterministically headless: finish #1 is immediate
  // (gold — a brand-new record), finish #2 idles ~10 s of sim first (slower,
  // so NOT a record). Asserts the real wiring: onFinish folds the finish
  // into the records map and persists the WHOLE blob through the debounced
  // writer, the results screen calls out NEW RECORD only on the record run
  // and shows the standing best, quitting to the menu shows the saved best
  // + medal (the menu re-reads the live records on every entry), and the
  // slower follow-up moves nothing. Persistence runs through save.js's
  // in-memory fallback (node has no localStorage) — the same path a browser
  // reload reads back.
  // =========================================================================
  {
    /**
     * Collect an element subtree's text (stub elements keep `children`).
     * @param {{ textContent?: unknown, children?: unknown[] }} el Stub element.
     * @returns {string} The concatenated text.
     */
    const collectText = (el) => {
      let out = String(el.textContent ?? '');
      for (const child of el.children ?? []) out += ` ${collectText(child)}`;
      return out;
    };
    /**
     * Parse `m:ss.mmm` back to ms (the results/menu record format).
     * @param {string} text Formatted time.
     * @returns {number} Milliseconds, or NaN when not parseable.
     */
    const parseTime = (text) => {
      const m = /^(\d+):(\d{2})\.(\d{3})$/.exec(String(text).trim());
      return m ? Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3]) : Number.NaN;
    };
    /**
     * Win one Blitz event headless: click the card, clear the countdown
     * (260 frames > 3-2-1-GO + linger), optionally idle `idleFrames` of sim
     * first (to make the finish time slower), then teleport onto each
     * checkpoint in order until the final gate finishes the race.
     * @param {string} eventId Route id (a MENU_EVENTS card id).
     * @param {number} [idleFrames] Sim frames to burn before running.
     * @returns {void}
     */
    const winRace = (eventId, idleFrames = 0) => {
      menu.cardButtons[eventId].fire('click', {});
      check(modes.current === 'racing' && !!game.getRace() && game.getRace().eventId() === eventId,
        `5.5: ${eventId} card -> racing with a live session`);
      for (let i = 0; i < 260; i += 1) pumpFrame(); // 3-2-1-GO + linger
      check(!!game.getRace() && game.getRace().phase() === 'running', '5.5: race RUNNING after GO');
      for (let i = 0; i < idleFrames; i += 1) pumpFrame();
      const route = RACE_EVENT_BY_ID[eventId];
      for (const cp of route.checkpoints) {
        if (modes.current === 'results') break; // the final gate already finished it
        car.reset({ x: cp.x, z: cp.z, heading: 0 });
        pumpFrame(); // one sim tick: the sequence samples the fresh position
      }
      check(modes.current === 'results' && resultsScreen.isOpen(),
        `5.5: crossing every ${eventId} gate finished the race into results`);
    };

    // --- finish #1: immediate -> a new record + the NEW RECORD callout ------
    winRace('blitz-downtown');
    check(resultsScreen.slots.record.textContent === 'NEW RECORD' &&
        resultsScreen.slots.record.style.display === 'inline-block',
      '5.5: the FIRST finish shows the NEW RECORD callout');
    check(resultsScreen.slots.medal.textContent === 'GOLD' &&
        resultsScreen.slots.medal.style.color === '#ffd452',
      '5.5: the immediate win renders a tinted gold medal');
    // The debounced blob writer lands ~250 ms later in REAL time — wait it
    // out, then read the record back through the save handle (the same
    // loadSave path a browser reload takes).
    await new Promise((r) => setTimeout(r, 350));
    const saved1 = game.save.load();
    const firstBest = saved1.records['blitz-downtown'] && saved1.records['blitz-downtown'].bestTimeMs;
    check(typeof firstBest === 'number' && Number.isFinite(firstBest) && firstBest >= 0,
      `5.5: finish #1 persisted a finite best time (${firstBest} ms)`);
    check(saved1.records['blitz-downtown'].bestMedal === 'gold',
      '5.5: finish #1 persisted the gold medal');
    check(saved1.settings && typeof saved1.settings.volume === 'number',
      '5.5: the persisted blob still carries the settings half');
    check(resultsScreen.slots.best.textContent === formatRecordTime(firstBest),
      '5.5: the results BEST slot shows the (new) standing best');
    check(resultsScreen.slots.time.textContent === formatRecordTime(firstBest),
      '5.5: on a record run the TIME slot equals the stored best');

    // Quit to menu: the menu re-reads the live records on entry.
    resultsScreen.buttons.menu.fire('click', {});
    check(modes.current === 'menu' && menu.isOpen(), '5.5: results MENU -> menu');
    const cardText1 = collectText(menu.cardButtons['blitz-downtown']);
    check(cardText1.includes(formatRecordTime(firstBest)),
      `5.5: the menu shows the saved best (${formatRecordTime(firstBest)})`);
    check(cardText1.includes('GOLD'), '5.5: the menu shows the gold medal');

    // --- finish #2: ~10 s of sim first -> slower, NOT a record ---------------
    winRace('blitz-downtown', 600);
    check(resultsScreen.slots.record.style.display === 'none',
      '5.5: the SLOWER finish does NOT show the NEW RECORD callout');
    const secondTime = parseTime(resultsScreen.slots.time.textContent);
    check(Number.isFinite(secondTime) && secondTime > firstBest,
      `5.5: finish #2 really is slower (${secondTime} ms > ${firstBest} ms)`);
    await new Promise((r) => setTimeout(r, 350));
    const saved2 = game.save.load().records['blitz-downtown'];
    check(saved2.bestTimeMs === firstBest,
      '5.5: the slower run did NOT move the stored best time');
    check(saved2.bestMedal === 'gold', '5.5: the stored medal is unchanged');
    check(resultsScreen.slots.best.textContent === formatRecordTime(firstBest),
      '5.5: the results BEST slot shows the kept best on a non-record run');
    resultsScreen.buttons.menu.fire('click', {});
    check(modes.current === 'menu' &&
        collectText(menu.cardButtons['blitz-downtown']).includes(formatRecordTime(firstBest)),
      '5.5: the menu still shows the unchanged best after finish #2');
  }
}

// --- applyTierFog per tier (engine contract) --------------------------------
for (const tierName of Object.keys(QUALITY_TIERS)) {
  const scn = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1);
  const tier = applyTierFog(scn, cam, tierName);
  const t = QUALITY_TIERS[tierName];
  check(scn.fog.near === t.fogNear && scn.fog.far === t.fogFar, `applyTierFog(${tierName}) fog values`);
  check(cam.far === t.cameraFar, `applyTierFog(${tierName}) camera.far`);
  check(
    Number.isFinite(scn.fog.near) && Number.isFinite(scn.fog.far) && scn.fog.near < scn.fog.far,
    `applyTierFog(${tierName}) fog strictly ordered`
  );
  check(cam.far > scn.fog.far, `applyTierFog(${tierName}) far plane beyond fog`);
}

// helper hoisted after use is illegal — define before use instead
function iBrokeEarly() {
  return false;
}

const failed = checkResults.filter(([ok]) => !ok).length;
log(
  failed === 0
    ? `  PASS boot-integration (${checkResults.length} checks)`
    : `  boot-integration: ${failed}/${checkResults.length} checks FAILED`
);
process.exitCode = failed === 0 ? 0 : 1;
