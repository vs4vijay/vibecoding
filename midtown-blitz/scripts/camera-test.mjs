#!/usr/bin/env node
/**
 * Scripted verification harness for task 1.5 — engine renderer, quality
 * tiers, and the chase-camera rig (src/engine/renderer.js,
 * src/engine/camera-rig.js).
 *
 * Everything runs in plain node against the REAL three.js classes: the
 * camera rig is exercised with real Object3D/PerspectiveCamera math, and a
 * real THREE.WebGLRenderer is constructed by injecting a fake WebGL
 * context through createEngineRenderer's `context` option (three only
 * stores it until render — which tests never call).
 *
 *   1. Tier table: low < medium < high on pixel ratio cap and every
 *      draw-distance value (fogNear/fogFar/cameraFar); shadow casting only
 *      at high; resolveTierName rejects unknown tiers; effectivePixelRatio
 *      clamps correctly (including dpr below every cap).
 *   2. Renderer (real THREE.WebGLRenderer, fake GL context): default tier
 *      is medium; setQualityTier applies immediately (pixel ratio +
 *      shadowMap.enabled flags); a shadow-flag flip with a scene refreshes
 *      its materials; unknown tier throws without changing state; resize
 *      keeps the drawing buffer and camera aspect in sync; degenerate
 *      resizes (0 / non-finite dimensions, e.g. a collapsed embed pane) are
 *      ignored exactly — last-known-good renderer size and camera state
 *      survive, a later valid resize applies, and degenerate initial sizes
 *      fall back to 1280x720; resolution scale visibly changes with tier at
 *      a fixed CSS size; applyTierFog copies the tier's fog/camera far into
 *      a scene.
 *   3. Resize wiring: attachResize against a fake window dispatches a
 *      resize event and updates renderer + camera; degenerate window
 *      dimensions are ignored and a later valid resize still applies;
 *      detach stops it.
 *   4. Camera rig, following: on a moving circuit target the rig converges
 *      to the desired chase pose with no overshoot spikes (error bounded,
 *      never dives through the target, steady-state error small), and the
 *      camera ends up behind + above the target.
 *   5. Camera rig, convergence without overshoot: after a target teleport
 *      the error decreases strictly monotonically (exponential follow).
 *   6. Camera rig, modes: cycleMode wraps through >= 2 modes and snaps to
 *      the new pose; chase sits behind, hood sits near the front; the
 *      camera actually aims at the mode's look point; setMode validates.
 *   7. Camera rig, robustness: getter-form targets and nested (world-space)
 *      targets; dt = 0 / negative / NaN are safe; huge dt is clamped.
 *   8. Frame-rate independence: the same 10 s circuit run at 30/60/120 Hz
 *      ends with camera positions within a small tolerance.
 *
 * Run: node scripts/camera-test.mjs   (plain node, no dependencies beyond
 * the repo's own three install)
 */
import * as THREE from 'three';
import {
  createEngineRenderer,
  QUALITY_TIERS,
  QUALITY_TIER_NAMES,
  DEFAULT_TIER,
  resolveTierName,
  effectivePixelRatio,
  applyQualityTier,
  applyTierFog,
  getResolutionScale,
  resizeRenderer,
} from '../src/engine/renderer.js';
import { createCameraRig } from '../src/engine/camera-rig.js';

let checks = 0;
let failed = 0;

// three's WebGLRenderer wires its rAF driver to the global `self` when it
// exists (browsers). Node has none, so renderer.dispose() would hit a null
// context; a minimal stub keeps dispose() exercised in the harness.
if (typeof globalThis.self === 'undefined') {
  globalThis.self = {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
}

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

/**
 * Assert |actual - expected| <= tol.
 * @param {number} actual Actual value.
 * @param {number} expected Expected value.
 * @param {number} tol Absolute tolerance.
 * @param {string} label Assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function checkClose(actual, expected, tol, label) {
  return check(
    Math.abs(actual - expected) <= tol,
    `${label} (got ${actual}, want ${expected} +/- ${tol})`
  );
}

/**
 * Assert that calling fn throws a TypeError.
 * @param {() => void} fn Thunk expected to throw.
 * @param {string} label Assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function checkThrows(fn, label) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof TypeError;
  }
  return check(threw, `${label} (expected TypeError)`);
}

/**
 * Snapshot the sizing state a resize must either fully apply or fully leave
 * alone: renderer CSS size, drawing buffer, camera aspect, and every
 * projection-matrix element. A degenerate-resize guard must leave this
 * state bit-identical (no reprojection, only refraining), so comparisons
 * are exact, never approximate.
 * @param {THREE.WebGLRenderer} renderer Renderer to read.
 * @param {THREE.PerspectiveCamera} camera Camera to read.
 * @returns {object} Frozen snapshot of the sizing state.
 */
function snapshotSizeState(renderer, camera) {
  const size = new THREE.Vector2();
  const buffer = new THREE.Vector2();
  renderer.getSize(size);
  renderer.getDrawingBufferSize(buffer);
  return Object.freeze({
    width: size.x,
    height: size.y,
    bufferX: buffer.x,
    bufferY: buffer.y,
    aspect: camera.aspect,
    projection: Object.freeze(Array.from(camera.projectionMatrix.elements)),
  });
}

/**
 * Assert two sizing snapshots are exactly equal (every projection element
 * identical with ===, not a tolerance).
 * @param {object} a Snapshot before.
 * @param {object} b Snapshot after.
 * @returns {boolean} Whether every field matches exactly.
 */
function sameSizeState(a, b) {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.bufferX === b.bufferX &&
    a.bufferY === b.bufferY &&
    a.aspect === b.aspect &&
    a.projection.length === b.projection.length &&
    a.projection.every((v, i) => v === b.projection[i])
  );
}

// ---------------------------------------------------------------------------
// Fake WebGL context: enough of the GL surface for THREE.WebGLRenderer's
// constructor and non-render API to run headless. GL constants get unique
// made-up numbers so getParameter can resolve which parameter was asked for.
// ---------------------------------------------------------------------------

/**
 * Build a fake WebGL2 context for headless renderer construction.
 * @returns {object} A Proxy standing in for a WebGL2 context.
 */
function makeFakeGLContext() {
  const valueByName = {};
  const nameByValue = {};
  let nextConst = 1;
  const STRING_PARAMS = new Set(['VERSION', 'SHADING_LANGUAGE_VERSION', 'RENDERER', 'VENDOR']);
  const ARRAY_PARAMS = new Set([
    'MAX_VIEWPORT_DIMS',
    'ALIASED_LINE_WIDTH_RANGE',
    'ALIASED_POINT_SIZE_RANGE',
    'SCISSOR_BOX',
    'VIEWPORT',
    'COLOR_WRITEMASK',
    'DEPTH_RANGE',
  ]);
  const impl = {
    getParameter(p) {
      const name = nameByValue[p];
      if (STRING_PARAMS.has(name)) return 'WebGL 2.0 (fake)';
      if (ARRAY_PARAMS.has(name)) return Int32Array.of(16384, 16384);
      return 4096;
    },
    getExtension(name) {
      if (name === 'EXT_texture_filter_anisotropic') return { getMaxAnisotropy: () => 8 };
      if (name === 'WEBGL_lose_context') return { loseContext() {}, restoreContext() {} };
      if (name === 'WEBGL_multi_draw') {
        return { multiDrawArraysInstanced() {}, multiDrawElementsInstanced() {} };
      }
      return null;
    },
    getShaderPrecisionFormat() {
      return { rangeMin: 127, rangeMax: 127, precision: 23 };
    },
    getSupportedExtensions() {
      return [];
    },
    getContextAttributes() {
      return { alpha: true, antialias: true };
    },
    getError() {
      return 0;
    },
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop in impl) return impl[prop];
        if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) {
          if (!(prop in valueByName)) {
            valueByName[prop] = nextConst;
            nameByValue[nextConst] = prop;
            nextConst += 1;
          }
          return valueByName[prop];
        }
        return () => {};
      },
      has() {
        return true;
      },
    }
  );
}

/**
 * Stub canvas standing in for HTMLCanvasElement (three only stores it until
 * render, which the harness never calls).
 * @returns {object} Stub canvas.
 */
function makeStubCanvas() {
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    width: 300,
    height: 150,
    getContext: () => null,
  };
}

/**
 * Minimal duck-typed window for attachResize wiring tests.
 * @param {number} width Initial innerWidth.
 * @param {number} height Initial innerHeight.
 * @returns {object} Fake window with add/remove/dispatch.
 */
function makeFakeWindow(width, height) {
  const listeners = {};
  return {
    innerWidth: width,
    innerHeight: height,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners[type];
      if (arr) listeners[type] = arr.filter((f) => f !== fn);
    },
    dispatch(type) {
      for (const fn of listeners[type] ?? []) fn({ type });
    },
  };
}

console.log('camera-test: renderer, quality tiers, and chase-cam rig verification\n');

// --- 1. Tier table -----------------------------------------------------------
{
  const name = 'tier table';
  console.log(`  ${name}`);
  check(DEFAULT_TIER === 'medium', 'default tier is medium');
  check(
    JSON.stringify(QUALITY_TIER_NAMES) === JSON.stringify(['low', 'medium', 'high']),
    'tier names are low/medium/high in order'
  );
  const caps = QUALITY_TIER_NAMES.map((t) => QUALITY_TIERS[t].pixelRatioCap);
  check(caps[0] < caps[1] && caps[1] < caps[2], `pixel ratio cap strictly increases low->high (${caps.join(' < ')})`);
  for (const key of ['fogNear', 'fogFar', 'cameraFar']) {
    const vals = QUALITY_TIER_NAMES.map((t) => QUALITY_TIERS[t][key]);
    check(vals[0] < vals[1] && vals[1] < vals[2], `${key} (draw distance) strictly increases low->high (${vals.join(' < ')})`);
  }
  check(
    QUALITY_TIER_NAMES.map((t) => QUALITY_TIERS[t].shadows).join() === 'false,false,true',
    'shadow casting enabled at high tier only'
  );
  check(QUALITY_TIERS.high.shadowMapSize >= QUALITY_TIERS.medium.shadowMapSize, 'high-tier shadow map is the largest');
  check(resolveTierName('low') === 'low', 'resolveTierName passes known tiers through');
  checkThrows(() => resolveTierName('ultra'), 'resolveTierName rejects unknown tier names');
  checkThrows(() => resolveTierName('Medium'), 'resolveTierName is case-sensitive');

  checkClose(effectivePixelRatio('low', 3), 0.75, 1e-9, 'low caps dpr 3 at 0.75');
  checkClose(effectivePixelRatio('medium', 3), 1.5, 1e-9, 'medium caps dpr 3 at 1.5');
  checkClose(effectivePixelRatio('high', 3), 2, 1e-9, 'high caps dpr 3 at 2');
  checkClose(effectivePixelRatio('high', 1.2), 1.2, 1e-9, 'dpr below the cap passes through unclamped');
  checkClose(effectivePixelRatio('high', 0.5), 0.5, 1e-9, 'dpr below every cap is identical across tiers');
  checkClose(effectivePixelRatio('high', Number.NaN), 1, 1e-9, 'non-finite dpr falls back to 1');
}

// --- 2. Real THREE.WebGLRenderer on a fake GL context: tiers + resize --------
let gfx;
{
  const name = 'renderer tiers (real WebGLRenderer, fake GL context)';
  console.log(`  ${name}`);
  gfx = createEngineRenderer({
    canvas: makeStubCanvas(),
    context: makeFakeGLContext(),
    width: 1280,
    height: 720,
    devicePixelRatio: 2,
  });
  const renderer = gfx.renderer;
  check(renderer.isWebGLRenderer === true, 'createEngineRenderer returns a real THREE.WebGLRenderer');
  check(gfx.getQualityTier() === 'medium', 'boots at the default (medium) tier');
  checkClose(gfx.getResolutionScale(), 1.5, 1e-9, 'medium tier applies min(dpr=2, cap 1.5) = 1.5x immediately');
  check(renderer.shadowMap.enabled === false, 'medium tier keeps shadowMap disabled');
  checkClose(getResolutionScale(renderer), gfx.getResolutionScale(), 1e-9, 'standalone getResolutionScale matches the facade');

  gfx.setQualityTier('low');
  checkClose(gfx.getResolutionScale(), 0.75, 1e-9, 'switching to low drops resolution scale to 0.75x immediately');
  check(renderer.shadowMap.enabled === false, 'low tier keeps shadowMap disabled');
  const buf = new THREE.Vector2();
  renderer.getDrawingBufferSize(buf);
  checkClose(buf.x, 1280 * 0.75, 0.51, 'low tier drawing buffer width = 0.75 * CSS width');
  checkClose(buf.y, 720 * 0.75, 0.51, 'low tier drawing buffer height = 0.75 * CSS height');

  gfx.setQualityTier('high');
  checkClose(gfx.getResolutionScale(), 2, 1e-9, 'switching to high raises resolution scale to 2x immediately');
  check(renderer.shadowMap.enabled === true, 'high tier enables shadowMap immediately');
  check(renderer.shadowMap.type === THREE.PCFSoftShadowMap, 'high tier uses PCF soft shadow maps');

  const beforeTier = gfx.getQualityTier();
  const beforeScale = gfx.getResolutionScale();
  let threw = false;
  try {
    gfx.setQualityTier('potato');
  } catch (e) {
    threw = e instanceof TypeError;
  }
  check(threw, 'unknown tier throws a TypeError');
  check(gfx.getQualityTier() === beforeTier && gfx.getResolutionScale() === beforeScale, 'failed tier switch leaves state untouched');

  // Resolution scale visibly changes with tier at a fixed CSS size (the
  // task's renderer.info/screenshot criterion, measured headlessly).
  const widths = QUALITY_TIER_NAMES.map((t) => {
    gfx.setQualityTier(t);
    renderer.getDrawingBufferSize(buf);
    return buf.x;
  });
  check(
    widths[0] < widths[1] && widths[1] < widths[2],
    `drawing buffer width strictly increases low->high at fixed CSS size (${widths.join(' < ')})`
  );

  // Resize: drawing buffer and camera aspect stay in sync.
  const cam = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 500);
  gfx.setQualityTier('high');
  gfx.resize(1024, 768, cam);
  checkClose(cam.aspect, 1024 / 768, 1e-9, 'resize updates the camera aspect');
  renderer.getDrawingBufferSize(buf);
  checkClose(buf.x, 2048, 1, 'resize applies the pixel ratio (buffer = 2x CSS width at high)');
  checkClose(buf.y, 1536, 1, 'resize applies the pixel ratio (buffer = 2x CSS height at high)');

  // Degenerate resizes (collapsed embed pane) are ignored wholesale: the
  // guard must leave the last-known-good size + camera state exactly
  // unchanged (regression: 0/NaN dimensions NaN'd the camera aspect,
  // degenerated the projection matrix, and GPU-clipped every draw call to
  // the clear color while renderer.info kept counting draws).
  const good = snapshotSizeState(renderer, cam);
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    resizeRenderer(renderer, cam, bad, 768);
    resizeRenderer(renderer, cam, 1024, bad);
  }
  resizeRenderer(renderer, cam, 0, 0);
  resizeRenderer(renderer, cam); // both dimensions undefined
  check(
    sameSizeState(snapshotSizeState(renderer, cam), good),
    'degenerate resizes (0, -5, NaN, Infinity, undefined) leave renderer size + camera state exactly unchanged'
  );
  check(
    Number.isFinite(cam.aspect) && cam.projectionMatrix.elements.every(Number.isFinite),
    'camera aspect and every projection element stay finite through degenerate resizes'
  );
  // Documented scenario: good -> degenerate (ignored) -> still good -> a
  // later valid resize applies.
  resizeRenderer(renderer, cam, 800, 600);
  checkClose(cam.aspect, 800 / 600, 1e-9, 'a valid resize after the ignored degenerate ones applies');
  renderer.getDrawingBufferSize(buf);
  checkClose(buf.x, 1600, 1, 'valid resize updates the drawing buffer too (2x CSS at high tier)');

  // Degenerate INITIAL sizes take the fallbacks instead of sizing the
  // drawing buffer to 0/NaN (same contract as resizeRenderer, at boot).
  const bootGfx = createEngineRenderer({
    canvas: makeStubCanvas(),
    context: makeFakeGLContext(),
    width: 0,
    height: Number.NaN,
    devicePixelRatio: 1,
  });
  const bootSize = new THREE.Vector2();
  bootGfx.renderer.getSize(bootSize);
  check(
    bootSize.x === 1280 && bootSize.y === 720,
    `degenerate initial width/height fall back to the 1280x720 default (got ${bootSize.x}x${bootSize.y})`
  );
  bootGfx.dispose();
  globalThis.window = { innerWidth: 0, innerHeight: 0, devicePixelRatio: 1 };
  const winGfx = createEngineRenderer({
    canvas: makeStubCanvas(),
    context: makeFakeGLContext(),
    devicePixelRatio: 1,
  });
  winGfx.renderer.getSize(bootSize);
  check(
    bootSize.x === 1280 && bootSize.y === 720,
    `degenerate window dimensions at boot also fall back to 1280x720 (got ${bootSize.x}x${bootSize.y})`
  );
  winGfx.dispose();
  delete globalThis.window;

  // applyTierFog: scene fog + camera far adopt the tier's draw distance.
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9db8cc, 60, 220);
  const fogCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const tier = applyTierFog(scene, fogCam, 'low');
  checkClose(scene.fog.near, tier.fogNear, 1e-9, 'applyTierFog copies fogNear from the tier');
  checkClose(scene.fog.far, tier.fogFar, 1e-9, 'applyTierFog copies fogFar from the tier');
  checkClose(fogCam.far, tier.cameraFar, 1e-9, 'applyTierFog copies cameraFar from the tier');
  const fresh = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, tier.cameraFar);
  fresh.updateProjectionMatrix();
  check(
    fresh.projectionMatrix.equals(fogCam.projectionMatrix),
    'camera projection matrix reprojected after the far-plane change'
  );
  gfx.applyTierFog(scene, fogCam); // facade form uses the current tier
  checkClose(scene.fog.far, QUALITY_TIERS.high.fogFar, 1e-9, 'facade applyTierFog uses the current (high) tier');
}

// --- 3. Shadow-flag flip refreshes scene materials ---------------------------
{
  const name = 'shadow toggle refreshes materials';
  console.log(`  ${name}`);
  const renderer = gfx.renderer;
  const scene = new THREE.Scene();
  const material = new THREE.MeshLambertMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  applyQualityTier(renderer, 'low', { scene, devicePixelRatio: 2 }); // baseline: shadows off
  // Material.needsUpdate is setter-only in three (true bumps `version`,
  // the signal the renderer uses to recompile) — assert via version deltas.
  let versionBefore = material.version;
  applyQualityTier(renderer, 'high', { scene, devicePixelRatio: 2 });
  check(renderer.shadowMap.enabled === true, 'standalone applyQualityTier enables shadowMap at high');
  check(material.version > versionBefore, 'off->on flip marks scene materials for recompilation');
  versionBefore = material.version;
  applyQualityTier(renderer, 'low', { scene, devicePixelRatio: 2 });
  check(renderer.shadowMap.enabled === false, 'standalone applyQualityTier disables shadowMap at low');
  check(material.version > versionBefore, 'on->off flip marks scene materials for recompilation');
  versionBefore = material.version;
  applyQualityTier(renderer, 'medium', { scene, devicePixelRatio: 2 });
  check(material.version === versionBefore, 'flag did not flip: materials untouched (no needless recompiles)');
  // Restore the facade's canonical state for later sections.
  gfx.setQualityTier('medium', scene);
  check(gfx.getQualityTier() === 'medium', 'facade restored to medium');
}

// --- 4. attachResize wiring ---------------------------------------------------
{
  const name = 'attachResize wiring';
  console.log(`  ${name}`);
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const fakeWindow = makeFakeWindow(800, 600);
  gfx.setQualityTier('high'); // 2x CSS buffer at dpr 2
  const detach = gfx.attachResize(cam, fakeWindow);
  fakeWindow.innerWidth = 1000;
  fakeWindow.innerHeight = 500;
  fakeWindow.dispatch('resize');
  checkClose(cam.aspect, 2, 1e-9, 'resize event updates camera aspect through the engine handler');
  const buf = new THREE.Vector2();
  gfx.renderer.getDrawingBufferSize(buf);
  checkClose(buf.x, 2000, 1, 'resize event resizes the drawing buffer (2x CSS at high tier)');
  detach();
  fakeWindow.innerWidth = 300;
  fakeWindow.innerHeight = 200;
  fakeWindow.dispatch('resize');
  checkClose(cam.aspect, 2, 1e-9, 'after detach, resize events no longer touch the camera');

  // The collapsed-pane guard flows through attachResize: a resize event
  // carrying degenerate window dimensions is a no-op (last-known-good
  // renderer + camera state survives exactly), and the next valid event
  // applies normally.
  const reattach = gfx.attachResize(cam, fakeWindow);
  const frozenState = snapshotSizeState(gfx.renderer, cam);
  fakeWindow.innerWidth = 0;
  fakeWindow.innerHeight = 0;
  fakeWindow.dispatch('resize');
  fakeWindow.innerWidth = Number.NaN;
  fakeWindow.innerHeight = Number.NaN;
  fakeWindow.dispatch('resize');
  check(
    sameSizeState(snapshotSizeState(gfx.renderer, cam), frozenState),
    'attachResize with degenerate window dimensions (0, NaN) is ignored (collapsed embed pane)'
  );
  fakeWindow.innerWidth = 1200;
  fakeWindow.innerHeight = 900;
  fakeWindow.dispatch('resize');
  checkClose(cam.aspect, 1200 / 900, 1e-9, 'a valid resize after the ignored ones applies through attachResize');
  reattach();
}

// --- 5. Camera rig: smooth following on a moving target ----------------------
{
  const name = 'rig follows a moving target smoothly';
  console.log(`  ${name}`);
  const R = 26;
  const OMEGA = 0.5; // rad/s -> 13 m/s circuit speed
  const target = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 0, 0);
  const rig = createCameraRig(camera, { modes: ['chase', 'hood'] });
  rig.setTarget(target);
  check(rig.getMode() === 'chase', 'rig starts in chase mode');
  check(JSON.stringify(rig.getModes()) === JSON.stringify(['chase', 'hood']), 'rig exposes two modes in cycle order');

  const place = (a) => {
    target.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    target.rotation.y = -a; // tangent heading (+Z forward convention)
  };
  place(0);
  rig.snap();
  checkClose(camera.position.distanceTo(rig.getDesiredPose().position), 0, 1e-6, 'snap frames the target exactly');

  const dt = 1 / 60;
  const errors = [];
  const distsToTarget = [];
  const steps = 60 * 6;
  let a = 0;
  let maxStepMove = 0;
  for (let i = 0; i < steps; i += 1) {
    const before = camera.position.clone();
    a += OMEGA * dt;
    place(a);
    rig.update(dt);
    errors.push(camera.position.distanceTo(rig.getDesiredPose().position));
    distsToTarget.push(camera.position.distanceTo(target.position));
    if (i > 0) maxStepMove = Math.max(maxStepMove, camera.position.distanceTo(before));
  }
  // First-order follow of a target orbiting at omega has a theoretical
  // steady-state lag of ~radius * omega / sqrt(stiffness^2 + omega^2)
  // (~1.6 m at stiffness 8, 13 m/s on this circuit): bounded, stable, and
  // overshoot-free.
  const steady = errors.slice(-120); // last 2 s
  const steadyMax = Math.max(...steady);
  const steadyMean = steady.reduce((s, v) => s + v, 0) / steady.length;
  check(errors[0] < 0.3, 'error right after snap is one tick of target motion, not a snap-back');
  check(Math.max(...errors) < 1.8, `follow error stays bounded (max ${Math.max(...errors).toFixed(3)} m, no overshoot spike)`);
  check(steadyMax < 1.75, `error settles into the theoretical steady lag and stays there (max last 2 s ${steadyMax.toFixed(3)} m)`);
  check(steadyMean > 0.9 && steadyMean < 1.65, `steady-state lag is the known stable trail (mean ${steadyMean.toFixed(3)} m)`);
  check(maxStepMove < 0.35, `per-tick camera motion stays smooth (max ${maxStepMove.toFixed(3)} m vs ${(13 / 60).toFixed(3)} m/tick target)`);
  check(Math.min(...distsToTarget) > 5, `camera never dives through the target (min distance ${Math.min(...distsToTarget).toFixed(2)} m)`);

  // Behind + above at steady state: chase cam trails along +Z-forward.
  const forward = new THREE.Vector3(Math.sin(-a), 0, Math.cos(-a));
  const toCam = camera.position.clone().sub(target.position);
  check(toCam.dot(forward) < -5, `camera is behind the target (dot ${toCam.dot(forward).toFixed(2)})`);
  check(camera.position.y > target.position.y + 2, 'camera is above the target');
}

// --- 6. Rig converges monotonically after a teleport (no overshoot) ----------
{
  const name = 'rig converges without overshoot after target teleport';
  console.log(`  ${name}`);
  const target = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const rig = createCameraRig(camera);
  rig.setTarget(target);
  target.position.set(26, 0, 0);
  target.rotation.y = 0; // facing +Z
  rig.snap();
  target.position.z += 5; // "car" jumps 5 m along its heading
  const ideal = rig.getDesiredPose().position;
  const errors = [];
  for (let i = 0; i < 90; i += 1) {
    rig.update(1 / 60);
    errors.push(camera.position.distanceTo(ideal));
  }
  let monotone = true;
  for (let i = 1; i < errors.length; i += 1) {
    if (errors[i] > errors[i - 1] + 1e-9) monotone = false;
  }
  check(monotone, 'error to the fixed ideal pose decreases strictly monotonically (pure exponential approach)');
  check(errors[0] > errors[errors.length - 1] * 50, 'the rig actually closes the gap (convergence is substantial)');
  check(errors[errors.length - 1] < 0.05, `converged to within 5 cm after 1.5 s (${errors[errors.length - 1] * 100} cm)`);
}

// --- 7. Mode cycling wraps, snaps, and frames correctly ----------------------
{
  const name = 'mode cycling';
  console.log(`  ${name}`);
  const target = new THREE.Object3D();
  target.position.set(26, 0, 0);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const rig = createCameraRig(camera, { modes: ['chase', 'hood'] });
  rig.setTarget(target);

  const first = rig.cycleMode();
  check(first === 'hood' && rig.getMode() === 'hood', 'cycleMode switches chase -> hood and returns the new mode');
  let pose = rig.getDesiredPose();
  checkClose(camera.position.distanceTo(pose.position), 0, 1e-6, 'hood switch snaps the camera to the hood pose (a cut, not a lerp)');

  const second = rig.cycleMode();
  check(second === 'chase' && rig.getMode() === 'chase', 'cycleMode wraps hood -> chase (>= 2 modes cycle indefinitely)');
  pose = rig.getDesiredPose();
  checkClose(camera.position.distanceTo(pose.position), 0, 1e-6, 'wrap back to chase snaps to the chase pose');

  // Hood: close to the hull, in FRONT of the target (+Z forward side).
  rig.setMode('hood');
  const toCam = camera.position.clone().sub(target.position);
  check(toCam.length() < 3, `hood cam sits close to the hull (${toCam.length().toFixed(2)} m)`);
  check(toCam.z > 0 && Math.abs(toCam.x) < 0.5, 'hood cam sits on the forward axis of the target');

  // The camera aims at the mode's look point.
  const look = rig.getDesiredPose().look;
  const dirToLook = look.clone().sub(camera.position).normalize();
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  check(camDir.dot(dirToLook) > 0.999, 'camera orientation actually points at the mode look point');

  checkThrows(() => rig.setMode('cinematic'), 'setMode rejects undefined modes');
  check(rig.setMode('chase') === 'chase', 'setMode returns the applied mode name');
}

// --- 8. Rig robustness --------------------------------------------------------
{
  const name = 'rig robustness';
  console.log(`  ${name}`);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const rig = createCameraRig(camera);

  // Getter-form target + nested (world-space) target.
  const group = new THREE.Object3D();
  group.position.set(100, 0, 0);
  const nested = new THREE.Object3D();
  nested.position.set(0, 0, 5);
  group.add(nested);
  rig.setTarget(() => nested);
  check(rig.getTarget() === nested, 'getter-form targets are stored and resolved');
  rig.update(1 / 60); // first update snaps
  const pose = rig.getDesiredPose();
  checkClose(camera.position.distanceTo(pose.position), 0, 1e-6, 'nested target followed in WORLD space (group offset respected)');
  check(camera.position.x > 90, 'world-space follow actually applies the parent group offset (not the local position)');

  // dt guards.
  const frozen = camera.position.clone();
  rig.update(0);
  rig.update(-1);
  rig.update(Number.NaN);
  check(camera.position.distanceTo(frozen) < 1e-9, 'dt <= 0 / NaN dt are ignored (no motion, no NaN drift)');
  check(Number.isFinite(camera.position.length()), 'camera position stays finite');
  rig.update(1000);
  check(Number.isFinite(camera.position.length()), 'huge dt is clamped (no explosion)');

  // No target at all: update is a no-op.
  const emptyCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const emptyRig = createCameraRig(emptyCam);
  emptyRig.update(1 / 60); // must not throw without a target
  emptyRig.snap();
  check(emptyCam.position.lengthSq() === 0, 'rig without a target is inert');

  // A second rig must not alias the first rig's scratch state.
  const camB = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const targetB = new THREE.Object3D();
  targetB.position.set(-50, 0, 20);
  const rigB = createCameraRig(camB);
  rigB.setTarget(targetB);
  rigB.update(1 / 60);
  checkClose(camB.position.distanceTo(rigB.getDesiredPose().position), 0, 1e-6, 'independent rigs do not share smoothing state');
  checkClose(camera.position.distanceTo(pose.position), 0, 1e-6, 'the first rig is unaffected by the second');

  // Custom mode definitions are accepted (data-driven extension point).
  const camC = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const targetC = new THREE.Object3D();
  targetC.position.set(0, 0, 0);
  const rigC = createCameraRig(camC, {
    modes: ['orbit'],
    modeDefs: { orbit: { position: new THREE.Vector3(6, 4, 0), look: new THREE.Vector3(0, 0, 0) } },
  });
  rigC.setTarget(targetC);
  rigC.update(1 / 60);
  check(rigC.getMode() === 'orbit', 'custom mode definitions (data, not code) are supported');
}

// --- 9. Frame-rate independence ----------------------------------------------
{
  const name = 'frame-rate independence';
  console.log(`  ${name}`);
  const R = 26;
  const OMEGA = 0.5;
  const finals = [];
  for (const fps of [30, 60, 120]) {
    const target = new THREE.Object3D();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const rig = createCameraRig(camera);
    rig.setTarget(target);
    const dt = 1 / fps;
    const steps = 10 * fps; // same 10 simulated seconds at each rate
    let a = 0;
    target.position.set(R, 0, 0);
    rig.snap();
    for (let i = 0; i < steps; i += 1) {
      a += OMEGA * dt;
      target.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
      target.rotation.y = -a;
      rig.update(dt);
    }
    finals.push(camera.position.clone());
  }
  const spread = Math.max(
    finals[0].distanceTo(finals[1]),
    finals[1].distanceTo(finals[2]),
    finals[0].distanceTo(finals[2])
  );
  check(spread < 0.5, `30/60/120 Hz runs of the same trajectory end within ${(spread * 100).toFixed(1)} cm of each other (< 50 cm)`);
}

gfx.dispose();
console.log(`\ncamera-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`camera-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('camera-test: ALL PASS');
