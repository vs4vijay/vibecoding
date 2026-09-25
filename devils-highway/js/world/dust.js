/**
 * @file world/dust.js
 * Pooled dust motes: one THREE.Points cloud recycled around the camera,
 * drifting with the desert wind. Round-3 re-author: motes are warm amber-
 * grey (warm vertex colors x warm sprite), small and dim, spawned biased to
 * the ground band (0.1-box.y m) and concentrated near the camera; a per-
 * frame depth fade (vertex-color dim, config DUST.fadeStart/fadeEnd) plus
 * `fog: false` keeps them off the horizon entirely — the old fog-mixed
 * additive points brightened toward the haze color and read as white bokeh
 * dots. Zero per-frame allocation; `dt = 0` (freeze) keeps the field
 * exactly where it was.
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";

const smooth01 = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Dust {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").materialLibrary} lib Material library (dot texture).
   * @param {number} budget Quality multiplier on CONFIG.DUST.count.
   */
  constructor(scene, lib, budget = 1) {
    const D = CONFIG.DUST;
    this.count = Math.max(24, Math.round(D.count * budget));
    this.box = D.box;
    this.wind = D.wind;
    this._time = 0;

    const positions = new Float32Array(this.count * 3);
    this._phase = new Float32Array(this.count);
    this._rise = new Float32Array(this.count);
    this._base = new Float32Array(this.count * 3); // pre-fade vertex colors
    const colors = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * this.box.x;
      positions[i * 3 + 1] = this._spawnY();
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this._phase[i] = Math.random() * Math.PI * 2;
      this._rise[i] = 0.4 + Math.random() * 0.9;
      const b = (0.7 + Math.random() * 0.3) * D.brightness;
      this._base[i * 3] = b;
      this._base[i * 3 + 1] = b * 0.87;
      this._base[i * 3 + 2] = b * 0.7; // warm amber motes (sprite adds warmth)
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this._mat = new THREE.PointsMaterial({
      size: D.size,
      map: lib.canvas("dustDot"),
      vertexColors: true,
      transparent: true,
      opacity: D.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false, // scene fog would ADD haze color per mote (horizon bokeh)
    });
    this.points = new THREE.Points(geo, this._mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this._pos = geo.attributes.position;
    this._col = geo.attributes.color;
  }

  /** Ground-biased spawn height (exponent CONFIG.DUST.yBias > 1). */
  _spawnY() {
    const D = CONFIG.DUST;
    return 0.1 + (this.box.y - 0.1) * Math.pow(Math.random(), D.yBias);
  }

  /**
   * Drift + recycle into a box that tracks the camera (ahead-biased), then
   * dim each mote by camera distance (depth fade in the vertex colors).
   * @param {number} dt @param {number} camX @param {number} camZ
   */
  update(dt, camX, camZ) {
    const D = CONFIG.DUST;
    this._time += dt;
    const t = this._time;
    const p = this._pos.array;
    const col = this._col.array;
    const hx = this.box.x / 2;
    const zMin = camZ - D.behind, zMax = camZ + this.box.z - D.behind;
    const w = D.wander;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const ph = this._phase[i];
      p[j] += (this.wind.x + Math.sin(t * 0.7 + ph) * w.x) * dt;
      p[j + 1] += Math.sin(t * 0.45 + ph * 1.7) * w.y * dt + this._rise[i] * w.rise * dt;
      p[j + 2] += (this.wind.z + Math.cos(t * 0.5 + ph) * w.z) * dt;
      // Wrap x/z into the tracking box; clamp the ground (bob can dip) and
      // respawn at the ground on overflow so the low-band density bias
      // survives the slow upward drift.
      p[j] = camX + wrapf(p[j] - camX, -hx, hx);
      if (p[j + 1] > this.box.y) p[j + 1] = this._spawnY();
      else if (p[j + 1] < 0.1) p[j + 1] = 0.1;
      p[j + 2] = zMin + wrapf(p[j + 2] - zMin, 0, zMax - zMin);
      // Depth fade: gone beyond fadeEnd, faded-in only past near range.
      const dx = p[j] - camX, dz = p[j + 2] - camZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const fade = smooth01(clamp01((D.fadeEnd - dist) / (D.fadeEnd - D.fadeStart)))
        * smooth01(clamp01((dist - 0.8) / (D.nearFade - 0.8)));
      col[j] = this._base[j] * fade;
      col[j + 1] = this._base[j + 1] * fade;
      col[j + 2] = this._base[j + 2] * fade;
    }
    this._pos.needsUpdate = true;
    this._col.needsUpdate = true;
  }
}

/** Wrap v into [min, max). */
function wrapf(v, min, max) {
  const r = max - min;
  let out = (v - min) % r;
  if (out < 0) out += r;
  return min + out;
}
