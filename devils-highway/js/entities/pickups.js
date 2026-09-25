/**
 * @file entities/pickups.js — pooled instanced RUN pickup system
 * (run-core-loop design 5, task 3.3). ONE InstancedMesh of amber-banded
 * supply crates = 1 draw: a merged 4-box silhouette (weathered body + lid,
 * protruding amber band, small hazard stencil on top — the chase camera
 * looks down on it) with every part's UVs remapped into the shared
 * OBSTACLE_ATLAS pair (albedo + emissive mask), carried by ONE parameter-
 * clone of `obstacleBarrier` (same compiled program, own uniform state).
 * Emissive pulse: the SHARED material's emissiveIntensity breathes between
 * CONFIG.PICKUPS.pulse min/max in fixedUpdate — the cheapest channel (one
 * uniform write; the obstacle gantry-blink precedent). Per-instance
 * emissive would need an onBeforeCompile program variant and r172
 * instanceColor cannot reach emissive, so variety rides slot-derived
 * diffuse tone + yaw jitter instead. Pooled like obstacles.js, static like
 * dressing (spawn/release write matrices), zero per-frame allocation, NO
 * rng consumed (tone/jitter derive from the pool slot — bible rule 7).
 *
 * API contract (spawn director 4.2 / mode 4.3 consume this):
 *   const mgr = createPickupManager(scene, lib); // once per session
 *   const p = mgr.spawn(spec);  // -> live record, or null (pool full)
 *     spec { z (REQUIRED world z), lane (-1|0|1) | x — x wins when both }
 *   Strand support: spawn per pickup, 3-6 markers down one lane at even
 *   spacing (2.2 m in the staging); the manager is per-pickup and agnostic.
 *   Records are STATIC (p.lane/p.x/p.z read-only): the caller never moves
 *   them — the director releases a chunk's uncollected pickups on chunk
 *   despawn (spec: missed pickups despawn with the chunk, award nothing;
 *   only tryCollect pays).
 *   mgr.tryCollect({ x? | lane?, z }) -> record | null  // CONSUMES: first
 *     live pickup inside the window is released and returned (the mode
 *     fires burst + score/currency off it); null = nothing in range. One
 *     call per fixed step; call again next step for a further pickup
 *     (strand run-throughs outpace the window: dz/step << spacing).
 *     Window: |px - p.x| < halfW + playerHalfW, |pz - p.z| < zHalf +
 *     playerHalfD — x-with-tolerance, NOT a lane index (lane easing makes
 *     a discrete test lie mid-transition — the obstacles.collide
 *     precedent); no Y test (ground-level pickup, any player state).
 *   mgr.release(p) / mgr.reset()  // recycle one (chunk despawn) / all
 *   mgr.count / mgr.max / mgr.records
 *   mgr.fixedUpdate(dt)  // emissive pulse ONLY (dt 0 keeps the frame value)
 *   mgr.flush()          // rewrite live matrices (QA staging conveyor ONLY)
 *   mgr.setVisible(on)   // QA draw A/B
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";
import { OBSTACLE_ATLAS } from "../core/assets.js";

// Module-scope scratch (bible hot-path rule: nothing allocates per frame).
const _m = new THREE.Matrix4();
const _dead = new THREE.Matrix4().makeScale(0, 0, 0); // parked instance slots
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const frac = (v) => v - Math.floor(v);

/** UV-remapped crate box: one atlas region per part (obstacles.js remapUV). */
function part(w, h, d, x, y, z, region) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const uv = g.attributes.uv;
  const [u0, v0, u1, v1] = OBSTACLE_ATLAS.regions[region];
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  return g.translate(x, y, z);
}

/** Concatenate parts into one geometry (positions/normals/uvs align). */
function mergeParts(parts) {
  const pos = [], nor = [], uvs = [];
  for (const g of parts) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uvs.push(...g.attributes.uv.array);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

/** Supply-crate silhouette (metres; ~0.44 m tall — readable at strand
 *  distance with the band glow): weathered painted body + lid, hazard-lamp
 *  chip band (the emissive read), small hazard-stencil top. 48 tris. */
function buildGeometry() {
  return mergeParts([
    part(0.55, 0.36, 0.75, 0, 0.18, 0, "rust"),
    part(0.6, 0.06, 0.8, 0, 0.39, 0, "rust"),
    part(0.57, 0.11, 0.77, 0, 0.18, 0, "lamp"),
    part(0.36, 0.024, 0.48, 0, 0.432, 0, "stripes"),
  ]);
}

/**
 * @param {THREE.Scene} scene
 * @param {import("../core/assets.js").materialLibrary} lib
 */
export function createPickupManager(scene, lib) {
  const P = CONFIG.PICKUPS;
  const max = P.max;
  // Time-of-day pulse band baked at construct (obstacles.js glow precedent;
  // the only night path is ?time=night).
  const NIGHT = new URLSearchParams(window.location.search).get("time") === "night";
  const band = NIGHT ? P.pulse.night : P.pulse.dusk;
  // Parameter clone (uniform-only; the shared atlas textures come along, so
  // no new program compiles) — the pulse must not move the obstacle
  // archetypes' shared material.
  const mat = lib.get("obstacleBarrier").clone();
  mat.name = "pickupCrate";
  mat.emissiveIntensity = band.min;

  const mesh = new THREE.InstancedMesh(buildGeometry(), mat, max);
  mesh.name = "pickups";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.castShadow = P.castShadow; // false holds the +1 draw gate
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // instances stream with the run
  mesh.count = 0;
  mesh.visible = false;
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, _dead);
  scene.add(mesh);

  const pool = new Array(max);
  for (let i = 0; i < max; i++) {
    pool[i] = {
      alive: false,
      id: i,
      // placement truth (spawn-time, read-only after)
      lane: 0, x: 0, z: 0, ry: 0,
    };
  }
  let high = -1; // highest live slot (release scans down)
  let live = 0;
  let phase = 0;

  function write(rec) {
    _q.setFromEuler(_e.set(0, rec.ry, 0));
    _v.set(rec.x, 0, rec.z);
    _m.compose(_v, _q, _one);
    mesh.setMatrixAt(rec.id, _m);
  }

  return {
    max,
    mesh,
    material: mat,

    get count() {
      return live;
    },

    get records() {
      return pool;
    },

    /**
     * Take one record from the pool. Returns null when full — the caller
     * owns back-pressure (director skips the strand tail / releases).
     * @returns {object|null} The live record (STATIC placement).
     */
    spawn(spec = {}) {
      let id = -1;
      for (let i = 0; i < max; i++) {
        if (!pool[i].alive) {
          id = i;
          break;
        }
      }
      if (id < 0) return null;
      const rec = pool[id];
      rec.alive = true;
      live++;
      rec.lane = spec.lane || 0;
      rec.x = spec.x !== undefined ? spec.x : rec.lane * CONFIG.LANE_W;
      rec.z = spec.z || 0;
      // Debris-feel yaw jitter (visual only; slot-derived — no rng).
      rec.ry = (frac(id * 0.381966) - 0.5) * 2 * P.jitter;
      // Dust brightness variance per instance (diffuse-only channel).
      const tone = 1 + frac(id * 0.618034) * 0.12;
      const col = mesh.instanceColor.array;
      col[id * 3] = tone;
      col[id * 3 + 1] = tone;
      col[id * 3 + 2] = tone;
      mesh.instanceColor.needsUpdate = true;
      write(rec);
      mesh.instanceMatrix.needsUpdate = true;
      if (id > high) high = id;
      mesh.count = high + 1;
      mesh.visible = true;
      return rec;
    },

    release(rec) {
      if (!rec || !rec.alive) return;
      rec.alive = false;
      live--;
      mesh.setMatrixAt(rec.id, _dead);
      mesh.instanceMatrix.needsUpdate = true;
      while (high >= 0 && !pool[high].alive) high--;
      mesh.count = high + 1;
      mesh.visible = high >= 0;
    },

    /** Pooled reset (mode restart / retry): recycle everything. */
    reset() {
      for (let i = 0; i < max; i++) this.release(pool[i]);
    },

    /**
     * Collection truth for one player position (semantics in the file
     * header). Consumes the hit: releases it and returns the record (burst
     * position + score/currency payload for the mode), or null. Exactly
     * once — a consumed pickup can never be collected again.
     * @param {{x?: number, lane?: number, z: number}} p
     * @returns {object|null}
     */
    tryCollect(p) {
      const px = p.x !== undefined ? p.x : (p.lane || 0) * CONFIG.LANE_W;
      const pz = p.z;
      for (let i = 0; i <= high; i++) {
        const rec = pool[i];
        if (!rec.alive) continue;
        if (Math.abs(pz - rec.z) >= P.zHalf + P.playerHalfD) continue;
        if (Math.abs(px - rec.x) >= P.halfW + P.playerHalfW) continue;
        this.release(rec);
        return rec;
      }
      return null;
    },

    /** QA draw A/B hook; the next spawn re-shows the mesh. */
    setVisible(on) {
      mesh.visible = !!on && high >= 0;
    },

    /** Rewrite every live record's matrix (QA staging conveyor ONLY —
     *  gameplay pickups are static; see the file header). Allocation-free. */
    flush() {
      if (high < 0) return;
      for (let i = 0; i <= high; i++) {
        if (pool[i].alive) write(pool[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    /**
     * Emissive pulse — the shared material breathes between the time-of-day
     * band's min/max (all markers in phase; one uniform write). dt 0
     * (frozen warmup) keeps the current frame's intensity. Call once per
     * fixed step; no-op while nothing is live.
     * @param {number} dt
     */
    fixedUpdate(dt) {
      if (high < 0 || live === 0) return;
      phase = (phase + Math.PI * 2 * P.pulse.hz * dt) % (Math.PI * 2);
      mat.emissiveIntensity = band.min + (band.max - band.min) * (0.5 - 0.5 * Math.cos(phase));
    },
  };
}
