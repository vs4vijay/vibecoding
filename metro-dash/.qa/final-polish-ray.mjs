/**
 * FINAL-POLISH probe 2: raycast through the menu-shot junction pixels to
 * identify the floating rails. Run: node .qa/final-polish-ray.mjs
 */
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
const { QUALITY_PRESETS, CONFIG } = await import("../client/js/src/core/config.js");

const scene = new THREE.Scene();
const world = new World(scene, materialLibrary, 7, QUALITY_PRESETS.high);
world.update(0, 0);
scene.updateMatrixWorld(true);

const camera = new THREE.PerspectiveCamera(CONFIG.FOV_BASE, 1600 / 900, 0.1, 600);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Mystery rails pixels (menu shot 1600x900): sample a few points bottom-left.
const pixels = [
  ["railA", 500, 700],
  ["railB", 560, 745],
  ["edge", 620, 590],
  ["dark1", 300, 800],
];

for (let t = 2.0; t <= 12.0; t += 0.25) {
  camera.position.set(Math.sin(t * 0.22) * 4, 3.4 + Math.sin(t * 0.5) * 0.2, -7 + Math.cos(t * 0.16) * 1.5);
  camera.lookAt(-1.35, 1.5, 10);
  camera.updateMatrixWorld(true);
  for (const [label, px, py] of pixels) {
    ndc.set((px / 1600) * 2 - 1, 1 - (py / 900) * 2);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(scene.children, true);
    if (!hits.length) continue;
    const h = hits[0];
    if (h.distance > 60) continue;
    const o = h.object;
    const mat = o.material?.name || (Array.isArray(o.material) ? "multi" : "?");
    console.log(
      `t=${t.toFixed(2)} ${label}: dist=${h.distance.toFixed(2)} pt=(${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)})` +
      ` ${o.type} mat=${mat} parent=${o.parent?.type}`,
    );
  }
}
