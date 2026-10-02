/**
 * WAVE 5 probe B: precise identity of upper-center objects in the chase shot
 * (?qa=1&seed=7&time=10&cam=chase). Run: bun .qa/wave5-probe.mjs
 */

// ---- DOM/canvas shims -------------------------------------------------------
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
globalThis.document = { createElement(tag) { return tag === "canvas" ? new CanvasShim() : {}; } };
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
globalThis.window = { innerWidth: 800, innerHeight: 500, devicePixelRatio: 1 };
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

const THREE = await import("three");
const { World } = await import("../client/js/src/world/world.js");
const { RunController } = await import("../client/js/src/game/run.js");
const { ChaseCamera } = await import("../client/js/src/game/camera.js");
const { materialLibrary } = await import("../client/js/src/core/assets.js");
const { CONFIG, QUALITY_PRESETS } = await import("../client/js/src/core/config.js");

const preset = QUALITY_PRESETS.high;
const FIXED = CONFIG.FIXED_DT;

const scene = new THREE.Scene();
const world = new World(scene, materialLibrary, 7, preset);
const run = new RunController({ scene, lib: materialLibrary, seed: 7, preset, onGameOver: () => {}, onDeath: () => {} });
run.godMode = true;
run.start();
const camera = new THREE.PerspectiveCamera(CONFIG.FOV_BASE, 800 / 500, 0.1, 600);
const chaseCam = new ChaseCamera(camera);
for (let i = 0; i < 600; i++) {
  run.fixedUpdate(FIXED);
  run.updateRender(1, FIXED);
  if (i % 20 === 0) world.update(FIXED, run.curr.z);
  chaseCam.update(FIXED, run.renderPose(1), run.timeScale);
}
world.update(FIXED, run.curr.z);
run.updateRender(1, 0);
chaseCam.snapToMode(run.renderPose(1));
camera.position.copy(chaseCam.camera.position);
camera.quaternion.copy(chaseCam.camera.quaternion);
camera.fov = chaseCam.camera.fov;
camera.aspect = 800 / 500;
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);
const projScreen = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

function pathOf(o) {
  const names = [];
  let p = o;
  for (let i = 0; i < 6 && p; i++) {
    names.unshift(p.name || (p.type === "Scene" ? "SCENE" : `#${p.id}`));
    p = p.parent;
  }
  return names.join("/");
}

scene.updateMatrixWorld(true);
const v = new THREE.Vector3();
const m4 = new THREE.Matrix4();
// Bucket by mesh, keep the instance closest to frame center-x in the sky zone.
const buckets = new Map();
for (const root of scene.children) {
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const key = `${pathOf(o)} mat=${mat.name || mat.type}:${mat.color ? mat.color.getHexString() : "?"} geo=${g.type} inst=${o.isInstancedMesh ? o.count : 1}`;
    if (!buckets.has(key)) buckets.set(key, []);
    const arr = buckets.get(key);
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        const c = g.boundingSphere.clone().applyMatrix4(m4).applyMatrix4(o.matrixWorld);
        v.copy(c.center).applyMatrix4(projScreen);
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.45 || v.y < 0.45) continue;
        arr.push({ i, x: v.x, y: v.y, d: c.center.distanceTo(camera.position), r: c.radius });
      }
    } else {
      const c = g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      v.copy(c.center).applyMatrix4(projScreen);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.45 || v.y < 0.45) return;
      arr.push({ i: -1, x: v.x, y: v.y, d: c.center.distanceTo(camera.position), r: c.radius });
    }
  });
}

console.log(`player z=${run.curr.z.toFixed(1)} speed=${run.speed.toFixed(1)} fov=${camera.fov.toFixed(1)} camY=${camera.position.y.toFixed(1)}`);
console.log(`\nMeshes with instances in the SKY ZONE (|x|<=0.45, y>=0.45):`);
const rows = [...buckets.entries()].filter(([, a]) => a.length > 0);
rows.sort((a, b) => b[1].length - a[1].length);
for (const [key, arr] of rows) {
  const closest = arr.reduce((m, e) => (e.d < m.d ? e : m), arr[0]);
  console.log(`  n=${String(arr.length).padStart(3)} nearest d=${closest.d.toFixed(1)} ndc=(${closest.x.toFixed(2)},${closest.y.toFixed(2)}) r=${closest.r.toFixed(2)}\n      ${key}`);
}
