/**
 * @file entities/particles.js — ONE pooled Points system for the shared
 * gameplay bursts (run-core-loop design 5, task 3.3): pickup collect sparks
 * (small amber) + death impact (larger dark crimson/dust). ONE THREE.Points
 * of CONFIG.PARTICLES.max preallocated points = 1 draw (additive, size
 * attenuation, the shared dustDot sprite). CPU-integrated positions/colors
 * per fixed step (dt 0 rewrites the current frame — frozen warmup), zero
 * per-frame allocation, NO rng (burst direction/velocity derive from the
 * pool slot's golden-ratio streams). Ring allocation: bursts write from a
 * round-robin cursor, so a burst never refuses and an exhausted pool
 * sacrifices its oldest sparks — fire-and-forget cosmetics by design.
 * Per-point sprite size would need a custom shader, so the event types
 * read apart through count/spread/tone (the documented 1-draw trade);
 * "darker" death tones ride the additive blend as dim embers + dust.
 *
 * API contract (mode 4.3 / pickups staging consume this):
 *   const fx = createParticleSystem(scene, lib); // once per session
 *   fx.burst(x, y, z, "pickup" | "death"); // fire-and-forget (unknown
 *                                          // type falls back to pickup)
 *   fx.update(dt);    // once per fixed step; dt 0 keeps the frame
 *   fx.reset();       // kill + park everything (retry)
 *   fx.live / fx.max  // live point count, capacity
 *   fx.setVisible(on) // QA draw A/B (update re-shows while anything lives)
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);

/**
 * @param {THREE.Scene} scene
 * @param {import("../core/assets.js").materialLibrary} lib
 */
export function createParticleSystem(scene, lib) {
  const P = CONFIG.PARTICLES;
  const max = P.max;
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const life = new Float32Array(max); // remaining seconds (<= 0 dead)
  const ttl = new Float32Array(max);
  const vel = new Float32Array(max * 3);
  const base = new Float32Array(max * 3); // pre-fade vertex colors
  for (let i = 0; i < max; i++) positions[i * 3 + 1] = -50; // parked below the road

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: P.size,
    map: lib.canvas("dustDot"),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    fog: false, // burst sparks never read through distance haze
  });
  mat.name = "burstPoints";
  const points = new THREE.Points(geo, mat);
  points.name = "bursts";
  points.frustumCulled = false;
  points.renderOrder = P.renderOrder;
  points.visible = false;
  scene.add(points);

  let cursor = 0;
  let liveCount = 0;

  return {
    max,
    points,

    get live() {
      return liveCount;
    },

    /** Fire-and-forget burst at (x, y, z). `type` picks the
     *  CONFIG.PARTICLES event. Ring-spawns count points. */
    burst(x, y, z, type = "pickup") {
      const T = P.types[type] || P.types.pickup;
      for (let k = 0; k < T.count; k++) {
        const i = cursor;
        cursor = (cursor + 1) % max;
        if (life[i] > 0) liveCount--; // the ring stole a live spark
        const f = i * 3;
        const a = frac(i * 0.618034) * TAU; // even angle coverage per slot
        const r = Math.sqrt(frac(i * 0.2917)) * T.spread; // disc launch site
        positions[f] = x + Math.cos(a) * r;
        positions[f + 1] = y + frac(i * 0.937) * P.jitterY;
        positions[f + 2] = z + Math.sin(a) * r;
        const sp = T.speed[0] + frac(i * 0.7548776) * (T.speed[1] - T.speed[0]);
        const h = 0.35 + 0.65 * frac(i * 0.4454); // horizontal share
        vel[f] = Math.cos(a) * sp * h;
        vel[f + 1] = T.up * (0.4 + 0.8 * frac(i * 0.9106));
        vel[f + 2] = Math.sin(a) * sp * h;
        const t = T.ttl[0] + frac(i * 0.1273) * (T.ttl[1] - T.ttl[0]);
        life[i] = ttl[i] = t;
        const c = T.colors[i % T.colors.length];
        base[f] = colors[f] = c[0];
        base[f + 1] = colors[f + 1] = c[1];
        base[f + 2] = colors[f + 2] = c[2];
        liveCount++;
      }
    },

    /** Integrate one fixed step. Skips entirely while nothing lives — the
     *  last dying point's pass already zeroed and parked it. */
    update(dt) {
      if (liveCount === 0) return;
      const drag = Math.exp(-P.drag * dt);
      const g = P.gravity * dt;
      for (let i = 0; i < max; i++) {
        const l = life[i];
        if (l <= 0) continue;
        const nl = l - dt;
        life[i] = nl;
        const f = i * 3;
        if (nl <= 0) {
          liveCount--;
          positions[f + 1] = -50;
          colors[f] = colors[f + 1] = colors[f + 2] = 0;
          continue;
        }
        vel[f + 1] -= g;
        vel[f] *= drag;
        vel[f + 1] *= drag;
        vel[f + 2] *= drag;
        positions[f] += vel[f] * dt;
        positions[f + 1] += vel[f + 1] * dt;
        positions[f + 2] += vel[f + 2] * dt;
        if (positions[f + 1] < P.bounceY) { // ground bounce keeps sparks off the plane
          positions[f + 1] = P.bounceY;
          vel[f + 1] *= -P.bounce;
        }
        const fade = (nl / ttl[i]) * (nl / ttl[i]); // quadratic spark gutter
        colors[f] = base[f] * fade;
        colors[f + 1] = base[f + 1] * fade;
        colors[f + 2] = base[f + 2] * fade;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      points.visible = liveCount > 0;
    },

    /** Pooled reset (mode restart / retry): kill + park everything. */
    reset() {
      liveCount = 0;
      cursor = 0;
      for (let i = 0; i < max; i++) {
        life[i] = 0;
        positions[i * 3 + 1] = -50;
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      points.visible = false;
    },

    /** QA draw A/B hook; update() re-shows while anything lives. */
    setVisible(on) {
      points.visible = !!on;
    },
  };
}
