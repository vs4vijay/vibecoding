/**
 * FINAL-POLISH probe: identify geometry near the menu-camera junction
 * (world origin, z -12..8, ground level). Run: node .qa/final-polish-probe.mjs
 */

// ---- DOM/canvas shims (same pattern as wave5-probe) -------------------------
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
const { materialLibrary } = await import("../client/js/src/core/assets.js");
const { QUALITY_PRESETS } = await import("../client/js/src/core/config.js");

const preset = QUALITY_PRESETS.high;
const scene = new THREE.Scene();
const world = new World(scene, materialLibrary, 7, preset);
world.update(0, 0); // menu state: playerZ = 0

scene.updateMatrixWorld(true);
const box = new THREE.Box3();
console.log("=== meshes intersecting z[-12, 6], y[-1, 1], x[-8, 8] ===");
for (const root of scene.children) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    o.updateWorldMatrix(true, false);
    if (o.geometry?.boundingBox === null) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox ?? new THREE.Box3());
    // For instanced meshes, union instance boxes coarsely via boundingSphere
    let note = "";
    if (o.isInstancedMesh) {
      o.computeBoundingSphere();
      const s = o.boundingSphere;
      box.min.set(s.center.x - s.radius, s.center.y - s.radius, s.center.z - s.radius);
      box.max.set(s.center.x + s.radius, s.center.y + s.radius, s.center.z + s.radius);
      note = ` (instanced sphere r=${s.radius.toFixed(1)})`;
    }
    box.applyMatrix4(o.matrixWorld);
    if (box.max.z < -12 || box.min.z > 6) return;
    if (box.max.y < -1 || box.min.y > 1) return;
    if (box.max.x < -8 || box.min.x > 8) return;
    const p = o.geometry?.parameters;
    console.log(
      `${o.type} name='${o.name}' mat='${o.material?.name ?? "?"}'` +
      ` geo=[${p ? Object.entries(p).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k}:${v}`).join(",") : "?"}]` +
      ` worldBox x[${box.min.x.toFixed(2)},${box.max.x.toFixed(2)}]` +
      ` y[${box.min.y.toFixed(2)},${box.max.y.toFixed(2)}]` +
      ` z[${box.min.z.toFixed(2)},${box.max.z.toFixed(2)}]` +
      ` parent='${o.parent?.name || o.parent?.type}'${note}`,
    );
  });
}

// Also: which chunk types are active at indices -2..2?
console.log("\n=== active chunks ===");
const active = world._active;
for (const [idx, chunk] of [...active.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`chunk ${idx}: type=${chunk.type} groupZ=${chunk.group.position.z}`);
}
