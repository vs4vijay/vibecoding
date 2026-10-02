/**
 * FINAL-POLISH probe 3: match the captured menu camera time, then identify
 * the bottom-left "junction" geometry by raycasting. node .qa/final-polish-match.mjs
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

const W = 1600;
const H = 900;
const camera = new THREE.PerspectiveCamera(CONFIG.FOV_BASE, W / H, 0.1, 600);
const v = new THREE.Vector3();

function menuCam(t) {
  camera.position.set(Math.sin(t * 0.22) * 4, 3.4 + Math.sin(t * 0.5) * 0.2, -7 + Math.cos(t * 0.16) * 1.5);
  camera.lookAt(-1.35, 1.5, 10);
  camera.updateMatrixWorld(true);
}

// Character center in the shot ~ (515, 615) px (head 545, feet 730).
let bestT = 0;
let bestD = 1e9;
for (let t = 0.5; t <= 20; t += 0.01) {
  menuCam(t);
  v.set(0, 0.9, 0).project(camera);
  const px = (v.x * 0.5 + 0.5) * W;
  const py = (-v.y * 0.5 + 0.5) * H;
  const d = (px - 515) ** 2 + (py - 615) ** 2;
  if (d < bestD) { bestD = d; bestT = t; }
}
console.log(`best menuTime t=${bestT.toFixed(2)} (dist ${Math.sqrt(bestD).toFixed(0)}px)`);
menuCam(bestT);
console.log(`camera pos=(${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)})`);

for (const [label, x, y, z] of [
  ["character", 0, 0.9, 0],
  ["ballastNearCornerL", -4, -0.28, 0],
  ["ballastNearCornerR", 4, -0.28, 0],
  ["railLaneL_near", -2.92, -0.02, 0],
  ["railLaneR_near", 2.92, -0.02, 0],
  ["platformNearEdgeMid", -4.5, 1.1, -1],
  ["platformFarEnd", -4.5, 1.1, -39],
  ["wallBaseL", -5.9, 0, 0],
]) {
  v.set(x, y, z).project(camera);
  console.log(`${label}: px=${((v.x * 0.5 + 0.5) * W).toFixed(0)},${((-v.y * 0.5 + 0.5) * H).toFixed(0)}`);
}

// Raycast through the mystery bottom-left pixels.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pixels = [
  [430, 700], [480, 730], [520, 760], [560, 790], [300, 780], [200, 740], [620, 700], [700, 740],
];
for (const [px, py] of pixels) {
  ndc.set((px / W) * 2 - 1, 1 - (py / H) * 2);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(scene.children, true);
  const h = hits.find((hh) => hh.distance < 80);
  if (!h) { console.log(`pix(${px},${py}): MISS`); continue; }
  const o = h.object;
  const mat = o.material?.name || "?";
  const p = o.geometry?.parameters;
  console.log(
    `pix(${px},${py}): dist=${h.distance.toFixed(1)} pt=(${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)})` +
    ` ${o.type} mat=${mat} geoDepth=${p?.depth ?? p?.height ?? "?"} parent=${o.parent?.type}`,
  );
}
