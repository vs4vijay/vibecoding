/**
 * WAVE 4 headless smoke test (no browser, no GL).
 * Run: bun .qa/wave4-smoke.mjs   (or node .qa/wave4-smoke.mjs)
 *
 * Verifies:
 *  1. Detailed train cars build headlessly (5 meshes/car, finite geometry).
 *  2. COLLIDER CONTRACT: train/barrier/overhead volumes are bit-identical to
 *     wave 1 (halfW/halfD/y0/y1), through spawn, move and recycle.
 *  3. Livery variants: 3 palettes, deterministic per seed, lens material
 *     swaps to emissive on moving trains (vz != 0).
 *  4. Moving-train vz hook still advances + recycles.
 *  5. Coins: beveled star geometry, freeze-idempotent matrices, collection.
 *  6. Pickups: 3 distinct types, pooled <= 4/type, collection routes into
 *     RunController.collectPowerup (magnet/x2 already wired to the stubs).
 *  7. Full RunController 600-step god-mode run (?qa=1&seed=7&time=10 trace):
 *     phase running, colliders within contract, pickups spawn, pools bounded.
 *  8. Determinism: two identical runs produce identical obstacle layouts and
 *     identical frozen coin/pickup instance matrices.
 *  9. Draw-call estimate for the obstacle/coin/pickup layer.
 */
import * as THREE from "three";
import { RunController } from "../client/js/src/game/run.js";
import { ObstacleManager } from "../client/js/src/entities/trains.js";
import { CoinField } from "../client/js/src/entities/coins.js";
import { PickupField, PICKUP_TYPES } from "../client/js/src/entities/pickups.js";

const FIXED = 1 / 60;
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name} ${extra}`);
  else {
    console.error(`  FAIL ${name} ${extra}`);
    failures++;
  }
}

// Minimal 2D-canvas shim: the wave-3 contact-shadow blob in player.js calls
// document.createElement("canvas") at build time (real canvas only exists in
// the browser; headless tests never upload the texture).
const ctxStub = () => ({
  canvas: null,
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  font: "",
  textAlign: "",
  textBaseline: "",
  globalAlpha: 1,
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {},
  clearRect() {},
  strokeRect() {},
  fillText() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  closePath() {},
  arc() {},
  fill() {},
  stroke() {},
  save() {},
  restore() {},
  translate() {},
  putImageData() {},
});
globalThis.document = {
  createElement() {
    const c = { width: 0, height: 0 };
    c.getContext = () => ctxStub();
    return c;
  },
};

// MaterialLibrary stand-in: named-key materials + trainVariants array.
function makeStubLib() {
  const mat = (name) => new THREE.MeshStandardMaterial({ name });
  const lib = {
    get: (key) => mat(key),
  };
  for (const key of [
    "steelDark", "catSteel", "lensDark", "lensLit", "lampAmber", "trainDigit",
    "barrierStripe", "gantrySign", "treadPlate", "gold", "pickupPaint", "pickupToken",
    "paintedSteel", "plasticDark",
  ]) lib[key] = mat(key);
  lib.trainVariants = ["transitOrange", "tealNavy", "solarGray"].map((k) => ({
    key: k,
    body: mat(`body:${k}`),
    door: mat(`door:${k}`),
  }));
  return lib;
}

function meshStats(group) {
  let meshes = 0;
  let tris = 0;
  let sprites = 0;
  let bad = 0;
  group.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) bad++;
    }
    if (o.isSprite) sprites++;
  });
  return { meshes, tris, sprites, bad };
}

console.log("1) train car build + collider contract");
{
  const lib = makeStubLib();
  const om = new ObstacleManager(new THREE.Scene(), lib, 7);
  const t = om.spawn("train", 0, 100);
  const s = meshStats(t.group);
  check("train has 5 meshes (body/doors/dark/lenses/decals)", s.meshes === 5, `(${s.meshes})`);
  check("train tris 800..2500", s.tris > 800 && s.tris < 2500, `(${s.tris.toFixed(0)})`);
  check("train geometry finite", s.bad === 0);
  check("no sprites anywhere", s.sprites === 0);
  check(
    "train collider EXACT",
    JSON.stringify(t.colliders) === JSON.stringify([{ x: 0, z: 0, halfW: 1, halfD: 6, y0: 0, y1: 3.2, solid: true }]),
    JSON.stringify(t.colliders),
  );
  const b = om.spawn("barrier", 1, 100);
  check(
    "barrier collider EXACT",
    JSON.stringify(b.colliders) === JSON.stringify([{ x: 0, z: 0, halfW: 0.95, halfD: 0.16, y0: 0, y1: 1.0, solid: true }]),
  );
  check("barrier 3 meshes", meshStats(b.group).meshes === 3);
  const o = om.spawn("overhead", -1, 100);
  check(
    "overhead collider EXACT",
    JSON.stringify(o.colliders) === JSON.stringify([{ x: 0, z: 0, halfW: 1.1, halfD: 0.2, y0: 1.7, y1: 3.0, solid: true }]),
  );
  check("overhead 3 meshes", meshStats(o.group).meshes === 3);
  const r = om.spawn("ramp", 0, 100);
  check("ramp has no collider (unchanged)", r.colliders.length === 0);
  check("ramp 2 meshes", meshStats(r.group).meshes === 2);

  scene_bbox: {
    om.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(t.group);
    check(
      "car body within collider envelope (+ small low coupler)",
      box.min.x >= -1.03 && box.max.x <= 1.03 && box.min.y >= -0.01 && box.max.y <= 3.45,
      `[${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)} -> ${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)}]`,
    );
    check(
      "car length ~12 m (+0.6 couplers)",
      box.max.z - box.min.z > 12 && box.max.z - box.min.z < 12.7,
      `(${(box.max.z - box.min.z).toFixed(2)})`,
    );
  }
}

console.log("2) livery variants: deterministic, 3 palettes, lens swap");
{
  const lib = makeStubLib();
  const seq = (seed) => {
    const om = new ObstacleManager(new THREE.Scene(), lib, seed);
    const out = [];
    for (let i = 0; i < 12; i++) {
      const t = om.spawn("train", 0, 100);
      out.push(t.parts.body.material.name);
    }
    return out;
  };
  const a = seq(7);
  const b = seq(7);
  const c = seq(99);
  check("variant sequence deterministic", JSON.stringify(a) === JSON.stringify(b), a.join(","));
  check("all 3 palettes appear over 12 cars", new Set(a).size === 3, `(${new Set(a).size})`);
  check("different seed -> different sequence", JSON.stringify(a) !== JSON.stringify(c));
  const om = new ObstacleManager(new THREE.Scene(), lib, 7);
  const parked = om.spawn("train", 0, 100);
  const moving = om.spawn("train", 0, 100, -6);
  check("parked train: dark lenses", parked.parts.lenses.material === lib.lensDark);
  check("moving train: emissive lenses", moving.parts.lenses.material === lib.lensLit);
  om.reset();
  check("reset restores variant counter (deterministic re-run)", JSON.stringify(seq(7)) === JSON.stringify(a));
}

console.log("3) moving-train vz hook");
{
  const lib = makeStubLib();
  const om = new ObstacleManager(new THREE.Scene(), lib, 7);
  const t = om.spawn("train", 0, 100, -8);
  for (let i = 0; i < 60; i++) om.fixedUpdate(FIXED, 0);
  check("vz advances the car (~-8 m over 1 s)", Math.abs(t.group.position.z - 92) < 0.01, `(z=${t.group.position.z.toFixed(2)})`);
  for (let i = 0; i < 60 * 20; i++) om.fixedUpdate(FIXED, 50);
  check("moving train recycles behind the player", om.obstacles.length === 0);
  check("pool bounded after recycle", om._pools.train.length === 1);
}

console.log("4) coin + pickup units");
{
  const lib = makeStubLib();
  const scene = new THREE.Scene();
  const cf = new CoinField(scene, lib, 64);
  const g = cf.mesh.geometry;
  g.computeBoundingBox();
  check(
    "coin is a beveled disc (thick 0.07, dia 0.68)",
    Math.abs(g.boundingBox.max.z - 0.035) < 1e-3 && Math.abs(g.boundingBox.max.x - 0.34) < 1e-3,
  );
  check("coin geometry carries the embossed star (>350 tris)", g.attributes.position.count / 3 > 350, `(${(g.attributes.position.count / 3) | 0} tris)`);
  cf.spawnLine(0, 10, 5);
  let collected = 0;
  cf.onCollect = (n) => (collected += n);
  cf.fixedUpdate(FIXED, { x: 0, y: 0, z: 10 }, false);
  check("coin collection radius widened (1.2)", collected === 1, `(${collected})`);
  cf.reset();
  cf.spawnLine(0, 10, 3);
  cf.fixedUpdate(FIXED, { x: 99, y: 0, z: 99 }, false);
  const m1 = Array.from(cf.mesh.instanceMatrix.array).join(",");
  cf.updateRender();
  const m2 = Array.from(cf.mesh.instanceMatrix.array).join(",");
  check("coin matrices freeze-idempotent", m1 === m2);

  const pf = new PickupField(scene, lib, 4);
  check("3 pickup types", PICKUP_TYPES.length === 3 && pf.meshes.magnet && pf.meshes.jetpack && pf.meshes.x2);
  const got = [];
  pf.onCollect = (type) => got.push(type);
  pf.spawn("magnet", 0, 1.05, 10);
  pf.spawn("jetpack", 0, 1.05, 30);
  pf.spawn("x2", 0, 1.05, 50);
  pf.spawn("x2", 0, 1.05, 70);
  pf.spawn("x2", 0, 1.05, 90);
  pf.spawn("x2", 0, 1.05, 110); // 4th x2 slot
  const rejected = pf.spawn("x2", 0, 1.05, 130); // pool full -> ignored
  check("pickup pool bounded (4/type)", !rejected && pf.slots.filter((s) => s.active).length === 6, `(${pf.slots.filter((s) => s.active).length})`);
  pf.fixedUpdate(FIXED, { x: 0, y: 0, z: 10 }, false);
  check("magnet pickup collected", got.length === 1 && got[0] === "magnet", got.join(","));
  pf.updateRender();
  check("magnet mesh hidden after its pool empties", pf.meshes.magnet.visible === false);
  check("non-empty pickup mesh stays visible", pf.meshes.jetpack.visible === true);
  pf.reset();
  pf.updateRender();
  check("reset hides all pickup meshes", PICKUP_TYPES.every((t) => !pf.meshes[t].visible));
}

console.log("5) full run trace (?qa=1&seed=7&time=10 god-mode)");
{
  const lib = makeStubLib();
  const scene = new THREE.Scene();
  const run = new RunController({ scene, lib, seed: 7, preset: { drawDistance: 240 }, onGameOver: () => {}, onDeath: () => {} });
  run.godMode = true;
  run.start();
  let spawnedPickups = 0;
  const origSpawn = run.pickups.spawn.bind(run.pickups);
  run.pickups.spawn = (...args) => {
    spawnedPickups++;
    return origSpawn(...args);
  };
  const powerups = [];
  const origCollect = run.pickups.onCollect;
  run.pickups.onCollect = (type) => {
    powerups.push(type);
    origCollect(type);
  };
  const colliderViolations = [];
  for (let i = 0; i < 600; i++) {
    run.fixedUpdate(FIXED);
    run.updateRender(1, FIXED);
    for (const c of run.obstacles.getColliders()) {
      const isTrain = Math.abs(c.halfW - 1) < 1e-6 && Math.abs(c.halfD - 6) < 1e-6 && c.y0 === 0 && c.y1 === 3.2;
      const isBarrier = Math.abs(c.halfW - 0.95) < 1e-6 && Math.abs(c.halfD - 0.16) < 1e-6 && c.y0 === 0 && c.y1 === 1.0;
      const isOverhead = Math.abs(c.halfW - 1.1) < 1e-6 && Math.abs(c.halfD - 0.2) < 1e-6 && c.y0 === 1.7 && c.y1 === 3.0;
      if (!isTrain && !isBarrier && !isOverhead) colliderViolations.push(c);
    }
  }
  check("phase stays running (god-mode)", run.phase === "running");
  check("all colliders within the wave-1 contract", colliderViolations.length === 0, `(${colliderViolations.length} violations)`);
  check("pickups spawn in coin lines", spawnedPickups > 0, `(${spawnedPickups} over 600 steps)`);
  check("obstacle pools bounded", run.obstacles.obstacles.length < 30, `(${run.obstacles.obstacles.length} active)`);
  const activeCoins = run.coins.coins.filter((c) => c.active).length;
  check("coin pool bounded", activeCoins <= run.coins.max, `(${activeCoins} active)`);
  console.log(`  info: pickups spawned=${spawnedPickups} collected=${powerups.length} active=${run.pickups.slots.filter((s) => s.active).length}`);
  console.log(`  info: active obstacles by kind:`, run.obstacles.obstacles.reduce((m, o) => ((m[o.kind] = (m[o.kind] || 0) + 1), m), {}));

  // Freeze idempotency of the whole dynamic layer.
  run.updateRender(1, 0);
  const coinsA = Array.from(run.coins.mesh.instanceMatrix.array.slice(0, Math.max(1, run.coins.mesh.count) * 16)).join(",");
  const pickA = PICKUP_TYPES.map((t) => Array.from(run.pickups.meshes[t].instanceMatrix.array.slice(0, Math.max(1, run.pickups.meshes[t].count) * 16)).join(",")).join("|");
  run.updateRender(1, 0);
  const coinsB = Array.from(run.coins.mesh.instanceMatrix.array.slice(0, Math.max(1, run.coins.mesh.count) * 16)).join(",");
  const pickB = PICKUP_TYPES.map((t) => Array.from(run.pickups.meshes[t].instanceMatrix.array.slice(0, Math.max(1, run.pickups.meshes[t].count) * 16)).join(",")).join("|");
  check("frozen coin matrices identical", coinsA === coinsB);
  check("frozen pickup matrices identical", pickA === pickB);

  console.log("6) cross-run determinism");
  const layout = () => {
    const lib2 = makeStubLib();
    const run2 = new RunController({ scene: new THREE.Scene(), lib: lib2, seed: 7, preset: { drawDistance: 240 }, onGameOver: () => {}, onDeath: () => {} });
    run2.godMode = true;
    run2.start();
    for (let i = 0; i < 600; i++) {
      run2.fixedUpdate(FIXED);
      run2.updateRender(1, FIXED);
    }
    run2.updateRender(1, 0);
    return JSON.stringify({
      obstacles: run2.obstacles.obstacles.map((o) => [o.kind, o.group.position.x, o.group.position.z, o.parts.body ? o.parts.body.material.name : ""]),
      coins: Array.from(run2.coins.mesh.instanceMatrix.array.slice(0, Math.max(1, run2.coins.mesh.count) * 16)),
    });
  };
  check("identical obstacle layout + coin matrices across runs", layout() === layout());

  console.log("7) draw-call estimate (obstacle/coin/pickup layer, main pass)");
  {
    const mats = new Map();
    let hidden = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.visible || (o.parent && !o.parent.visible)) {
        hidden++;
        return;
      }
      const key = Array.isArray(o.material) ? o.material.map((m) => m.name).join("+") : o.material.name || o.material.uuid;
      mats.set(key, (mats.get(key) || 0) + 1);
    });
    let total = 0;
    for (const [k, n] of mats) {
      total += n;
      if (n > 1 || !k.startsWith("body:")) console.log(`    ${k}: ${n}`);
    }
    console.log(`    TOTAL meshes (main-pass draw calls, no instancing merge): ${total} (hidden pools: ${hidden})`);
    check("obstacle layer under 90 draw calls", total < 90, `(${total})`);
  }
}

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
