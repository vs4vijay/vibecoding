/**
 * WAVE 5 headless smoke test (no browser, no GL).
 * Run: bun .qa/wave5-smoke.mjs   (or node .qa/wave5-smoke.mjs)
 *
 * Verifies:
 *  1. Event bus: coin/step events fire during a god-mode run; jump/land/
 *     roll/lane/crash fire on scripted actions; handlers stay isolated.
 *  2. VFX pools: bounded, spawn effects fill them, reset clears them.
 *  3. VFX determinism: two identical runs -> identical particle buffers at
 *     the frozen state; advanceFixed(0) is idempotent (?freeze warmup).
 *  4. Speed lines: opacity 0 below 30 m/s, ramps to <= 0.35 near max speed;
 *     world-locked rebuild is a pure function (same band -> same buffer).
 *  5. Contact blob: shrinks + fades with jump height (pose-driven).
 *  6. Audio: context NEVER created at boot (lazy), play() is a safe no-op
 *     pre-gesture, mute state flag works, SFX/music no-op without ctx, and
 *     with a STUB AudioContext the graph + scheduler + SFX run clean.
 *  7. Corridor wire material carries the near-fade patch (artifact fix).
 *  8. Draw-call accounting for the added VFX layer (<= 5, hidden when idle).
 */
import * as THREE from "three";
import { RunController } from "../client/js/src/game/run.js";
import { VfxSystem } from "../client/js/src/game/vfx.js";
import { materialLibrary } from "../client/js/src/core/assets.js";
import { World } from "../client/js/src/world/world.js";
import { AudioManager } from "../client/js/src/core/audio.js";
import { CONFIG, QUALITY_PRESETS } from "../client/js/src/core/config.js";

const FIXED = CONFIG.FIXED_DT;
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name} ${extra}`);
  else {
    console.error(`  FAIL ${name} ${extra}`);
    failures++;
  }
}

// ---- DOM/canvas shims (corridor + player blob build headlessly) ------------
class GradientShim { addColorStop() {} }
class Context2DShim {
  constructor(canvas) { this.canvas = canvas; this.fillStyle = "#000"; }
  fillRect() {} strokeRect() {} clearRect() {} fillText() {} save() {} restore() {}
  translate() {} rotate() {} scale() {} beginPath() {} closePath() {} arc() {}
  fill() {} stroke() {} moveTo() {} lineTo() {} drawImage() {}
  createLinearGradient() { return new GradientShim(); }
  createRadialGradient() { return new GradientShim(); }
  putImageData() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
}
class CanvasShim {
  constructor() { this.width = 300; this.height = 150; }
  set width(v) { this._w = v; } get width() { return this._w; }
  set height(v) { this._h = v; } get height() { return this._h; }
  getContext() { return new Context2DShim(this); }
}
const listeners = {};
globalThis.document = { createElement(tag) { return tag === "canvas" ? new CanvasShim() : {}; } };
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
globalThis.window = {
  innerWidth: 800, innerHeight: 500, devicePixelRatio: 1,
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  removeEventListener() {},
};
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
};
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

const preset = QUALITY_PRESETS.high;

/**
 * Boot a full run + VFX stack (world included so the corridor wire material
 * check runs against the real builder).
 */
function boot(seed) {
  const scene = new THREE.Scene();
  const world = new World(scene, materialLibrary, seed, preset);
  const run = new RunController({ scene, lib: materialLibrary, seed, preset, onGameOver: () => {}, onDeath: () => {} });
  run.godMode = true;
  const vfx = new VfxSystem(scene, seed, run.events);
  const info = {
    x: run.curr.x, y: run.curr.y, z: run.curr.z, speed: run.speed,
    phase: run.phase, coinNear: null,
  };
  return { scene, world, run, vfx, info };
}

/** Simulate n fixed steps exactly like main.fastForward does. */
function stepN(b, n, actions) {
  for (let i = 0; i < n; i++) {
    if (actions) for (const a of actions) b.run.bufferAction(a);
    b.run.fixedUpdate(FIXED);
    b.run.updateRender(1, FIXED);
    b.info.x = b.run.curr.x;
    b.info.y = b.run.curr.y;
    b.info.z = b.run.curr.z;
    b.info.speed = b.run.speed;
    b.info.phase = b.run.phase;
    b.info.coinNear = b.run.coinNear;
    b.vfx.advanceFixed(FIXED, b.info);
  }
}

function poolState(v) {
  return [
    Array.from(v.sparks.pos),
    Array.from(v.sparks.col),
    Array.from(v.sparks.size),
    Array.from(v.dust.pos),
    Array.from(v.dust.col),
    Array.from(v.dust.size),
    Array.from(v._speedLines.geometry.attributes.position.array),
    v._speedLineMat.opacity,
  ].map((a) => (Array.isArray(a) ? a.join(",") : String(a))).join("|");
}

console.log("1) event bus during god-mode run (?qa=1&seed=7&time=10 trace)");
{
  const b = boot(7);
  const counts = {};
  for (const ev of ["coin", "powerup", "jump", "land", "roll", "lane", "step", "crash", "reset"]) {
    b.run.events.on(ev, () => counts[ev] = (counts[ev] || 0) + 1);
  }
  b.run.start();
  stepN(b, 600);
  check("reset emitted once on start()", counts.reset === 1, `(${counts.reset})`);
  check("coins collected in god mode fire coin events", (counts.coin || 0) > 0, `(${counts.coin} coins)`);
  check("footstep steps fire continuously", (counts.step || 0) > 15, `(${counts.step} steps / 10 s)`);
  check("step count ~ cadence (2 per cycle)", counts.step > 25 && counts.step < 80, `(${counts.step})`);
  check("no jumps/lands without input", !counts.jump && !counts.land, "");
  check("coin events carry finite positions", (() => {
    let ok = true;
    b.run.events.on("coin", (x, y, z) => { ok = ok && Number.isFinite(x + y + z); });
    stepN(b, 30);
    return ok;
  })());
}

console.log("2) scripted actions fire jump/land/roll/lane/crash");
{
  const b = boot(7);
  b.run.start();
  const got = [];
  for (const ev of ["jump", "land", "roll", "lane", "crash"]) {
    b.run.events.on(ev, () => got.push(ev));
  }
  // Jump (airtime ~0.64 s = ~38 steps).
  b.run.bufferAction("jump");
  stepN(b, 60);
  check("jump + land fired", got.includes("jump") && got.includes("land"), got.join(","));
  // Lane switch.
  b.run.bufferAction("left");
  stepN(b, 20);
  check("lane fired", got.includes("lane"));
  // Roll.
  b.run.bufferAction("roll");
  stepN(b, 50);
  check("roll fired", got.includes("roll"));
  // Crash: non-god run against a spawned train wall.
  const b2 = boot(7);
  b2.run.start();
  b2.run.godMode = false;
  let crashed = false;
  b2.run.events.on("crash", () => { crashed = true; });
  b2.run.obstacles.spawn("train", 0, b2.run.curr.z + 20);
  for (let i = 0; i < 200 && !crashed; i++) stepN(b2, 1);
  check("crash fires on collision", crashed);
}

console.log("3) VFX pools: bounded, filled by events, cleared by reset");
{
  const b = boot(7);
  b.run.start();
  stepN(b, 600);
  const sAlive = b.vfx.sparks.life.reduce((a, l) => a + (l > 0 ? 1 : 0), 0);
  const dAlive = b.vfx.dust.life.reduce((a, l) => a + (l > 0 ? 1 : 0), 0);
  check("spark pool bounded", sAlive <= b.vfx.sparks.cap, `(${sAlive}/${b.vfx.sparks.cap})`);
  check("dust pool bounded", dAlive <= b.vfx.dust.cap, `(${dAlive}/${b.vfx.dust.cap})`);
  check("dust produced by footsteps", dAlive > 0, `(${dAlive} alive at t=10)`);
  // Deterministic ambient state: some glints may be alive at the freeze.
  b.vfx.reset();
  check("reset kills all particles", b.vfx.sparks.life.every((l) => l <= 0) && b.vfx.dust.life.every((l) => l <= 0));
  check("reset hides rings", b.vfx._rings.every((r) => !r.mesh.visible));
}

console.log("4) VFX determinism (cross-run + freeze idempotent)");
{
  const frozen = () => {
    const b = boot(7);
    b.run.start();
    stepN(b, 600);
    const s1 = poolState(b.vfx);
    b.vfx.advanceFixed(0, b.info); // freeze warmup frame
    const s2 = poolState(b.vfx);
    b.vfx.advanceFixed(0, b.info);
    const s3 = poolState(b.vfx);
    return { s1, s2, s3 };
  };
  const a = frozen();
  const c = frozen();
  check("frozen state identical across runs", a.s1 === c.s1);
  check("advanceFixed(0) idempotent (warmup frames identical)", a.s1 === a.s2 && a.s2 === a.s3);
}

console.log("5) speed lines: speed-gated opacity + world-locked rebuild");
{
  const b = boot(7);
  b.run.start();
  stepN(b, 60); // ~16 m/s
  check("opacity 0 below 30 m/s", b.vfx._speedLineMat.opacity === 0, `(${b.vfx._speedLineMat.opacity.toFixed(3)})`);
  const pos1 = Array.from(b.vfx._speedLines.geometry.attributes.position.array).join(",");
  // Force max speed by rewinding distance accumulation: directly set sim speed.
  b.run.distance = 2000; // speed clamps to MAX_SPEED on the next step
  stepN(b, 2);
  const op = b.vfx._speedLineMat.opacity;
  check("opacity ramps to <= 0.35 at max speed", op > 0.05 && op <= 0.35, `(${op.toFixed(3)})`);
  const pos2 = Array.from(b.vfx._speedLines.geometry.attributes.position.array).join(",");
  check("positions unchanged when band unchanged", pos1 === pos2);
  // Force a band change then verify purity: same band -> same buffer.
  const z = b.run.curr.z;
  const band = Math.round(z / 9);
  b.vfx._speedLineBand = -1;
  b.info.z = band * 9;
  b.vfx.advanceFixed(FIXED, b.info);
  const rebuilt1 = Array.from(b.vfx._speedLines.geometry.attributes.position.array).join(",");
  b.vfx._speedLineBand = -1;
  b.vfx.advanceFixed(FIXED, b.info);
  const rebuilt2 = Array.from(b.vfx._speedLines.geometry.attributes.position.array).join(",");
  check("band rebuild is a pure function of world slot", rebuilt1 === rebuilt2);
  check("streaks sit near the corridor edges (|x| 3..4.6)", (() => {
    const arr = b.vfx._speedLines.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const ax = Math.abs(arr[i]);
      if (ax < 3.0 || ax > 4.6) return false;
    }
    return true;
  })());
  check("streak alpha within the 0.1-0.35 spec band at full speed", op <= 0.35 && op >= 0.1);
}

console.log("6) powerup ring pulse");
{
  const b = boot(7);
  b.run.start();
  b.vfx.powerupRing("magnet", 0, 1.05, b.run.curr.z + 5);
  const ring = b.vfx._rings.find((r) => r.mesh.visible);
  check("ring becomes visible", !!ring);
  const s0 = ring.mesh.scale.x;
  for (let i = 0; i < 20; i++) {
    b.info.phase = "running";
    b.vfx.advanceFixed(FIXED, b.info);
  }
  check("ring expands", ring.mesh.scale.x > s0, `(${s0.toFixed(2)} -> ${ring.mesh.scale.x.toFixed(2)})`);
  let allDead = false;
  for (let i = 0; i < 40; i++) {
    b.vfx.advanceFixed(FIXED, b.info);
  }
  allDead = b.vfx._rings.every((r) => !r.mesh.visible);
  check("ring dies and hides after its life", allDead);
}

console.log("7) contact blob scales with jump height");
{
  const b = boot(7);
  b.run.start();
  stepN(b, 10);
  const blob = b.run.player.group.children.find((c) => c.material && c.material.transparent);
  check("blob present in player group", !!blob);
  stepN(b, 2);
  const groundedScale = blob.scale.x;
  const groundedOpacity = blob.material.opacity;
  check("grounded blob full size + opacity", Math.abs(groundedScale - 1) < 1e-6 && Math.abs(groundedOpacity - 0.85) < 1e-6, `(${groundedScale.toFixed(2)}, ${groundedOpacity.toFixed(2)})`);
  b.run.bufferAction("jump");
  stepN(b, 22); // near apex (~1.96 m)
  check("airborne blob shrinks", blob.scale.x < 0.65, `(${blob.scale.x.toFixed(2)})`);
  check("airborne blob fades", blob.material.opacity < 0.5, `(${blob.material.opacity.toFixed(2)})`);
  stepN(b, 60); // land + settle
  check("blob recovers on landing", Math.abs(blob.scale.x - 1) < 0.02);
}

console.log("8) audio: lazy, silent, headless-safe");
{
  // No AudioContext in Node: constructor must not throw nor create anything,
  // play() must be a silent no-op, mute persists.
  const audio = new AudioManager();
  check("no context before any gesture", audio.ctx === null);
  audio.play("coin");
  audio.play("crash");
  audio.startMusic();
  check("startMusic is a no-op without ctx", audio.ctx === null && audio._timer === 0);
  check("mute toggles cleanly without ctx", (audio.setMuted(true), audio.muted === true));
  check("mute persisted flag readable", audio.muted === true);
  audio.setMuted(false);
  check("unmute restores enabled", audio.enabled === true && audio.muted === false);

  // Stub AudioContext: verify the graph builds and SFX/music run clean.
  class FakeParam {
    constructor(v = 1) { this.value = v; }
    setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {}
    cancelScheduledValues() {} setTargetAtTime() {}
  }
  class FakeNode {
    constructor(ctx) { this.ctx = ctx; this.gain = new FakeParam(1); this.frequency = new FakeParam(440); this.Q = new FakeParam(1); this.threshold = new FakeParam(0); this.knee = new FakeParam(0); this.ratio = new FakeParam(1); this.attack = new FakeParam(0); this.release = new FakeParam(0); this.type = ""; this.buffer = null; this.loop = false; }
    connect() { return this; }
    start() {} stop() {}
  }
  class FakeCtx {
    constructor() { this.currentTime = 10; this.state = "running"; this.sampleRate = 48000; this.destination = new FakeNode(this); }
    createGain() { return new FakeNode(this); }
    createDynamicsCompressor() { return new FakeNode(this); }
    createBiquadFilter() { return new FakeNode(this); }
    createOscillator() { return new FakeNode(this); }
    createBufferSource() { return new FakeNode(this); }
    createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  globalThis.window.AudioContext = FakeCtx;
  const audio2 = new AudioManager();
  check("stub ctx still not created pre-gesture", audio2.ctx === null);
  // Simulate the first user gesture.
  for (const fn of listeners.keydown || []) fn({ code: "KeyM" });
  check("gesture creates the context lazily", audio2.ctx instanceof FakeCtx);
  audio2.startMusic();
  check("music scheduler starts after gesture", audio2._timer !== 0);
  audio2._schedule(); // one scheduler tick must not throw
  for (const id of ["coin", "jump", "roll", "lane", "crash", "powerup", "unknown"]) audio2.play(id);
  audio2.setMuted(true);
  check("muting stops the scheduler", audio2._timer === 0);
  audio2.play("coin"); // must be a silent no-op (no throw)
  audio2.setMuted(false);
  check("unmute resumes the groove", audio2._timer !== 0);
  audio2.dispose();
  check("dispose stops the scheduler", audio2._timer === 0);
  delete globalThis.window.AudioContext;
}

console.log("9) corridor wire near-fade patch (artifact fix present)");
{
  const scene = new THREE.Scene();
  const world = new World(scene, materialLibrary, 7, preset);
  const wires = world._corridor._wires;
  check("wire material is a dedicated clone (not shared brushedMetal)", wires.material !== materialLibrary.brushedMetal);
  check("wire material transparent + depthWrite off", wires.material.transparent === true && wires.material.depthWrite === false);
  check("wire material tagged with the near-fade program key", wires.material.customProgramCacheKey() === "wire-nearfade");
  let patchedVert = false;
  let patchedFrag = false;
  const shader = {
    vertexShader: "#include <fog_vertex>\n",
    fragmentShader: "#include <dithering_fragment>\n",
  };
  wires.material.onBeforeCompile(shader);
  patchedVert = shader.vertexShader.includes("vWireWorldY");
  patchedFrag = shader.fragmentShader.includes("nearCam * above");
  check("vertex patch injects the world-Y varying", patchedVert);
  check("fragment patch injects the near-field fade", patchedFrag);
}

console.log("10) draw-call accounting for the VFX layer");
{
  const b = boot(7);
  b.run.start();
  stepN(b, 600);
  let extra = 0;
  const kinds = [];
  b.scene.traverse((o) => {
    if (o.isPoints || o.isLineSegments || (o.isMesh && o.geometry && o.geometry.type === "RingGeometry")) {
      extra += o.visible ? 1 : 0;
      kinds.push(`${o.type}:${o.visible ? "vis" : "hidden"}`);
    }
  });
  check("VFX adds <= 5 draw calls (worst case)", extra <= 5, `(${extra}: ${kinds.join(" ")})`);
  check("no Sprites anywhere in the scene", (() => {
    let sprites = 0;
    b.scene.traverse((o) => { if (o.isSprite) sprites++; });
    return sprites === 0;
  })());
  // HalfFloat guard: no VFX render target / material touches HalfFloatType.
  check("no HalfFloat introduced", (() => {
    let bad = 0;
    b.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.type && String(v.type).includes("HalfFloat")) bad++;
        }
      }
    });
    return bad === 0;
  })());
}

console.log(failures === 0 ? "\nALL WAVE-5 SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
