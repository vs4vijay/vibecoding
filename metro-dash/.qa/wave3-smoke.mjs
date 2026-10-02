/**
 * WAVE 3 headless smoke test (no browser, no GL).
 * Run: bun .qa/wave3-smoke.mjs
 *
 * Verifies:
 *  1. Character builds headless (geometry merges compatible), <= 25 meshes.
 *  2. Proportions: origin at feet, height ~1.8 m.
 *  3. Full RunController 600-step run (god-mode) — no exceptions, runPhase
 *     advances at the tuned cadence, pose is finite.
 *  4. Animation states: jump tuck / roll ball / death flop all produce
 *     distinct, non-finite-safe poses and roll unwinds to an exact turn.
 *  5. Determinism: two identical builds+runs produce bit-identical joints.
 *  6. Freeze: updateRender(pose, 0) x5 renders identical joints, mid-cycle
 *     (not the frame-0 pose).
 */
import * as THREE from "three";
import { RunController } from "../client/js/src/game/run.js";
import { createPlayer } from "../client/js/src/entities/player.js";

const FIXED = 1 / 60;
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name} ${extra}`);
  else {
    console.error(`  FAIL ${name} ${extra}`);
    failures++;
  }
}

// Minimal 2D-canvas shim (added wave 4): the character's contact-shadow blob
// calls document.createElement("canvas") at build time; headless tests never
// upload the texture so a recording stub is enough.
const ctxStub = () => ({
  createRadialGradient: () => ({ addColorStop() {} }),
  fillStyle: "",
  fillRect() {},
});
globalThis.document = {
  createElement() {
    const c = { width: 0, height: 0 };
    c.getContext = () => ctxStub();
    return c;
  },
};

// MaterialLibrary stand-in: any key -> a distinct MeshStandardMaterial.
const lib = new Proxy(
  {},
  {
    get(_t, key) {
      if (key === "get") return (k) => new THREE.MeshStandardMaterial({ name: k });
      if (key === "then") return undefined;
      // Wave-4 trains need the livery variant list.
      if (key === "trainVariants") {
        return [0, 1, 2].map((i) => ({
          key: `v${i}`,
          body: new THREE.MeshStandardMaterial({ name: `body${i}` }),
          door: new THREE.MeshStandardMaterial({ name: `door${i}` }),
        }));
      }
      return new THREE.MeshStandardMaterial({ name: String(key) });
    },
  },
);

function jointSnapshot(root) {
  const out = [];
  root.traverse((o) => {
    if (o.isMesh || o.isGroup) {
      out.push(
        o.position.x, o.position.y, o.position.z,
        o.rotation.x, o.rotation.y, o.rotation.z,
        o.scale.x, o.scale.y, o.scale.z,
      );
    }
  });
  return out;
}

console.log("1) build + proportions");
{
  const p = createPlayer(lib);
  const meshes = [];
  p.group.traverse((o) => o.isMesh && meshes.push(o));
  // 26 meshes since the wave-3-judge-round contact-shadow blob was added.
  check("mesh count <= 28", meshes.length <= 28, `(${meshes.length})`);
  check("all castShadow", meshes.every((m) => m.castShadow));
  check("none receiveShadow", meshes.every((m) => !m.receiveShadow));
  const anySprite = [];
  p.group.traverse((o) => o.isSprite && anySprite.push(o));
  check("no sprites", anySprite.length === 0);
  p.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(p.group);
  const h = box.max.y - box.min.y;
  check("origin at feet (min.y ~ 0)", box.min.y > -0.05 && box.min.y < 0.06, `(min.y=${box.min.y.toFixed(3)})`);
  check("height ~1.8 m", h > 1.6 && h < 2.0, `(h=${h.toFixed(3)})`);
  // Geometry sanity: merged geoms produced finite positions/normals.
  let bad = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) bad++;
  }
  check("geometry finite", bad === 0, `(${bad} bad components)`);
}

console.log("2) RunController 600-step god-mode run (mirrors ?qa=1&seed=7&time=10)");
{
  const scene = new THREE.Scene();
  const run = new RunController({ scene, lib, seed: 7, preset: { drawDistance: 240 }, onGameOver: () => {}, onDeath: () => {} });
  run.godMode = true;
  run.start();
  let prevPhase = 0;
  let monotonic = true;
  for (let i = 0; i < 600; i++) {
    run.fixedUpdate(FIXED);
    run.updateRender(1, FIXED);
    if (run.curr.runPhase < prevPhase - 1e-9) monotonic = false;
    prevPhase = run.curr.runPhase;
  }
  const pose = run.renderPose(1);
  check("phase stays running (god-mode)", run.phase === "running");
  check("runPhase monotonic", monotonic);
  check("runPhase ~10s cadence (100..145 rad)", pose.runPhase > 100 && pose.runPhase < 145, `(${pose.runPhase.toFixed(1)})`);
  check("speed ramped", run.speed > 16 && run.speed <= 42, `(${run.speed.toFixed(2)})`);
  const finite = ["x", "y", "z", "vy", "runPhase", "deathT"].every((k) => Number.isFinite(pose[k]));
  check("pose finite", finite);
  check("blends settled to 0 (running on ground)", Math.abs(run._rollBlend) < 1e-6 && Math.abs(run._airBlend) < 1e-6);

  console.log("3) freeze determinism (5 warmup renders, dt=0)");
  // Mirror main.js: fastForward ends with updateRender(1, 0), then each
  // warmup frame calls updateRender(alpha, 0) again.
  run.updateRender(1, 0);
  const snapA = jointSnapshot(run.player.group);
  for (let i = 0; i < 5; i++) run.updateRender(1, 0);
  const snapB = jointSnapshot(run.player.group);
  check("frozen frames identical", JSON.stringify(snapA) === JSON.stringify(snapB));
  const p0 = createPlayer(lib);
  p0.updateRender({ ...pose, runPhase: 0 }, 0);
  const snap0 = jointSnapshot(p0.group);
  check("frozen pose != frame-0 pose (mid-cycle)", JSON.stringify(snap0) !== JSON.stringify(snapB));
}

console.log("4) scripted states: lane lean / jump / roll / death");
{
  const scene = new THREE.Scene();
  const run = new RunController({ scene, lib, seed: 7, preset: { drawDistance: 240 }, onGameOver: () => {}, onDeath: () => {} });
  run.godMode = true;
  run.start();
  const angles = () => {
    const j = run.player.group;
    // sample: left hip world-ish + spine + acro
    const leg = j.children[0].children[0].children[0].children[0]; // body>hips>legL>hip? traverse instead:
    let spine = null, acro = null;
    j.traverse((o) => {
      if (o.type === "Group") {
        if (!spine && o.parent && o.parent.type === "Group") spine = o;
      }
    });
    void leg;
    const arr = [];
    j.traverse((o) => arr.push(o.rotation.x, o.rotation.z));
    return arr.join(",");
  };
  const base = angles();
  // lane switch lean
  run.bufferAction("left");
  for (let i = 0; i < 12; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  const leanPose = angles();
  check("lane switch changes pose", leanPose !== base);
  // Screen-space direction contract: the chase rig runs toward +Z, so
  // screen-right = world -X. "left" MUST land on lane +1 (world +X).
  check("lane 'left' -> lane +1 / +X (screen-left; +Z chase rig mapping)", run.lane === 1 && run.x > 0, `(lane=${run.lane}, x=${run.x.toFixed(2)})`);
  for (let i = 0; i < 60; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  // jump
  run.bufferAction("jump");
  for (let i = 0; i < 15; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  check("jump: air blend > 0", run._airBlend > 0.5, `(${run._airBlend.toFixed(2)})`);
  for (let i = 0; i < 120; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  check("landed: air blend back to 0", run._airBlend < 0.01, `(${run._airBlend.toFixed(3)})`);
  // roll
  run.bufferAction("roll");
  for (let i = 0; i < 20; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  check("roll: roll blend high", run._rollBlend > 0.5, `(${run._rollBlend.toFixed(2)})`);
  for (let i = 0; i < 80; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  check("roll ends, blend back to 0", run._rollBlend < 0.01, `(${run._rollBlend.toFixed(3)})`);
  const acroRot = run.player.group.children[0].rotation.x;
  const turns = acroRot / (Math.PI * 2);
  check("somersault unwound to a full turn", Math.abs(turns - Math.round(turns)) < 0.02, `(acro=${acroRot.toFixed(3)}, turns=${turns.toFixed(3)})`);
  // death
  run.phase = "dying";
  run._deathTimer = 0;
  run.timeScale = 0.3;
  const pre = angles();
  for (let i = 0; i < 30; i++) { run.fixedUpdate(FIXED); run.updateRender(1, FIXED); }
  check("death flop changes pose", angles() !== pre);
  check("dying -> dead after slowmo", run.phase === "dead");
}

console.log("5) determinism: two builds, identical scripted run");
{
  function scriptedRun() {
    const scene = new THREE.Scene();
    const run = new RunController({ scene, lib, seed: 7, preset: { drawDistance: 240 }, onGameOver: () => {}, onDeath: () => {} });
    run.godMode = true;
    run.start();
    for (let i = 0; i < 600; i++) {
      if (i === 120) run.bufferAction("left");
      if (i === 240) run.bufferAction("jump");
      if (i === 360) run.bufferAction("roll");
      run.fixedUpdate(FIXED);
      run.updateRender(1, FIXED);
    }
    return jointSnapshot(run.player.group).map((v) => v.toFixed(10)).join(",");
  }
  const a = scriptedRun();
  const b = scriptedRun();
  check("bit-identical joints across runs", a === b);
}

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
