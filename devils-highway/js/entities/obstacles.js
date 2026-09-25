/**
 * @file entities/obstacles.js — pooled instanced RUN obstacle system
 * (run-core-loop design 5, task 3.2). THREE archetypes, ONE InstancedMesh
 * each (3 draws total, single material each — the atlas pair in assets.js
 * carries every finish via per-part UVs, so no material groups):
 *   low    — roadwork trestle barrier, striped planks, ~0.83 m tall. JUMP
 *            clears it (feet at/above its top inside the z-window).
 *   gantry — sign gantry / fallen beam across one lane, gap under 1.1 m.
 *            SLIDE passes (profile top below the beam); standing hits;
 *            hazard lamps on the beam's face mark the gap (night: blinking
 *            battery lamps — one shared material intensity, no extra draw).
 *   block  — concrete separator + rusted rebar filling one lane. DODGE
 *            only: solid at any player Y.
 * Static like dressing (spawn/release write matrices; nothing moves per
 * frame), pooled like zombies.js: <= CONFIG.OBSTACLES.maxPerType live per
 * archetype, zero per-frame allocation (module-scope scratch), no rng
 * consumed (tone/yaw derive from the pool slot — the director's seeded
 * streams alone decide placement, bible rule 7).
 *
 * API contract (spawn director 4.2 / mode 4.3 consume this):
 *   const mgr = createObstacleManager(scene, lib); // once per session
 *   const o = mgr.spawn(spec);  // -> live record, or null (type full/invalid)
 *     spec { type: "low"|"gantry"|"block", z (REQUIRED world z),
 *            lane (-1|0|1) | x — x wins when both given (metres) }
 *   Records are STATIC: the caller never moves them (streaming releases
 *   them behind the player instead). o.type/o.lane/o.x/o.z/o.halfW/
 *   o.zHalf/o.y0/o.y1/o.solidAlways are read-only collision truth.
 *   mgr.release(o)   // recycle one
 *   mgr.reset()      // release all (pooled; no allocation)
 *   mgr.count / mgr.max / mgr.records   // live count, per-type capacity,
 *                                       // record array (director scans it)
 *   mgr.occupied(z0, z1[, lane]) -> bool  // BAND QUERY for 4.2: true when a
 *      live obstacle's z-window [z - zHalf, z + zHalf] overlaps [z0, z1]
 *      (and sits in `lane`, when given). The director validates every band
 *      against this BEFORE accepting placements — e.g. spawn only when
 *      !occupied(z - pad, z + pad, lane) so spawns never straddle a
 *      shoulder-wreck z-window it has reserved.
 *   mgr.collide(player) -> record | null  // fixed-update truth (below)
 *   mgr.fixedUpdate(dt)  // night hazard blink ONLY (no-op at dusk/frozen)
 *   mgr.flush()          // rewrite live matrices (QA staging conveyor only;
 *                        // gameplay spawns never move, so never call it)
 *   mgr.setVisible(on)   // QA draw A/B
 *
 * Collision semantics (design 5: lane-x + z-window + height, no physics):
 *   collide({ x (m, or lane), z (m), y0, y1 (profile interval, m above the
 *   road) }) — the MODE owns the profile: run {0, ~1.75}, slide {0, ~0.85},
 *   jump {arcY, arcY + tucked top}; pass the live eased values. X is tested
 *   as |px - o.x| < o.halfW + playerHalfW — x-with-tolerance, NOT a lane
 *   index: the mode eases between lanes, so mid-transition the body is
 *   genuinely between lanes and a discrete-lane test would lie at both
 *   ends of the ease. o.lane is still recorded for band validation.
 *   Z is tested as |pz - o.z| < o.zHalf + playerHalfD (the z-window).
 *   Y is the archetype rule:
 *     low    hit unless y0 >= o.y1        (feet clear the top = jumped it)
 *     gantry hit unless y1 <= o.y0        (profile fits under = slid it)
 *     block  always hit inside x/z        (solidAlways — dodge only)
 *   Hit returns the record (which archetype / where) for death framing.
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

const TYPE_KEYS = ["low", "gantry", "block"];
const MAT_KEYS = { low: "obstacleBarrier", gantry: "obstacleGantry", block: "obstacleBlock" };

// ---- archetype geometry (boot-time only; one merged mesh per type) ---------

/** UV-remap a BoxGeometry's every face into one atlas region, so all of the
 *  part samples the same finish (regions: assets.js OBSTACLE_ATLAS). */
function remapUV(geo, region) {
  const uv = geo.attributes.uv;
  const [u0, v0, u1, v1] = region;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
}

/** Transformed, UV-remapped box part: size, centre, z-tilts (rad), region. */
function part(w, h, d, x, y, z, region, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (region) remapUV(g, region);
  const m = new THREE.Matrix4().makeRotationFromEuler(_e.set(rx, 0, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
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

/** Archetype silhouettes (metres; collision truth is CONFIG.OBSTACLES.types).
 *  Forward is -z (the player approaches from below). ~48-84 tris each. */
function buildGeometries() {
  const R = OBSTACLE_ATLAS.regions;
  return {
    // Trestle roadwork barrier: two rust legs + brace, two striped planks
    // (the plank pair reads "construction — jump it" day or night).
    low: mergeParts([
      part(0.14, 0.74, 0.34, -1.42, 0.37, 0, R.rust),
      part(0.14, 0.74, 0.34, 1.42, 0.37, 0, R.rust),
      part(0.07, 0.86, 0.06, -1.05, 0.4, -0.08, R.rust, 0, 0.55),
      part(2.98, 0.26, 0.07, 0, 0.44, 0, R.stripes),
      part(2.98, 0.26, 0.07, 0, 0.7, 0, R.stripes),
    ]),
    // Sign gantry: posts just outside the lane edges, beam (bottom edge =
    // the slide gap at 1.1 m), three hazard lamps on the beam's face
    // marking the gap's top edge, weathered blank panel above.
    gantry: mergeParts([
      part(0.16, 2.5, 0.16, -1.75, 1.25, 0, R.rust),
      part(0.16, 2.5, 0.16, 1.75, 1.25, 0, R.rust),
      part(3.66, 0.4, 0.18, 0, 1.3, 0, R.rust),
      part(0.16, 0.12, 0.09, -1.1, 1.24, -0.12, R.lamp),
      part(0.16, 0.12, 0.09, 0, 1.24, -0.12, R.lamp),
      part(0.16, 0.12, 0.09, 1.1, 1.24, -0.12, R.lamp),
      part(2.7, 0.8, 0.07, 0, 2.05, 0.04, R.rust, 0, 0.03),
    ]),
    // Concrete separator filling the lane: Jersey base + tapered top,
    // rusted rebar stubs (kills the "jump it" read — ragged ~1.5 m top),
    // amber-red reflectors on the approaching face.
    block: mergeParts([
      part(3.3, 0.5, 1.05, 0, 0.25, 0, R.concrete),
      part(2.9, 0.55, 0.78, 0, 0.775, 0, R.concrete),
      part(0.05, 0.5, 0.05, -0.9, 1.26, 0.1, R.rust, 0, -0.12),
      part(0.05, 0.5, 0.05, 0.05, 1.3, -0.15, R.rust, 0.06, 0.04),
      part(0.05, 0.5, 0.05, 0.85, 1.24, 0.2, R.rust, 0, 0.14),
      part(0.11, 0.17, 0.04, -1.2, 0.62, -0.545, R.refl),
      part(0.11, 0.17, 0.04, 1.2, 0.62, -0.545, R.refl),
    ]),
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {import("../core/assets.js").materialLibrary} lib
 */
export function createObstacleManager(scene, lib) {
  const O = CONFIG.OBSTACLES;
  const max = O.maxPerType;
  const standTop = CONFIG.PLAYER.profile.standTop; // collide()'s QA-mock default (single source, 4.4)
  // Time-of-day bake at construct (chunks.js taillight/reflector precedent;
  // the only night path is ?time=night). Night raises the accents and arms
  // the gantry blink in fixedUpdate.
  const NIGHT = new URLSearchParams(window.location.search).get("time") === "night";
  const glow = NIGHT ? O.glow.night : O.glow.dusk;

  const geos = buildGeometries();
  const meshes = {};
  const mats = {};
  for (const key of TYPE_KEYS) {
    const mat = lib.get(MAT_KEYS[key]);
    mat.emissiveIntensity = key === "gantry" && NIGHT ? glow.gantryMax : glow[key];
    const mesh = new THREE.InstancedMesh(geos[key], mat, max);
    mesh.name = `obstacle${key}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    mesh.castShadow = O.castShadow; // false holds the +3 gate (shadow draws count)
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // instances stream with the run
    mesh.count = 0;
    mesh.visible = false;
    for (let i = 0; i < max; i++) mesh.setMatrixAt(i, _dead);
    scene.add(mesh);
    meshes[key] = mesh;
    mats[key] = mat;
  }

  const pool = new Array(max * TYPE_KEYS.length);
  for (let ti = 0; ti < TYPE_KEYS.length; ti++) {
    for (let i = 0; i < max; i++) {
      pool[ti * max + i] = {
        alive: false,
        ti, slot: i,
        type: TYPE_KEYS[ti],
        // placement + collision truth (spawn-time, read-only after)
        lane: 0, x: 0, z: 0, ry: 0,
        halfW: 0, zHalf: 0, y0: 0, y1: 0, solidAlways: false,
      };
    }
  }
  const highs = [-1, -1, -1]; // highest live slot per type (release scans down)
  let live = 0;
  let blinkPhase = 0;

  function write(rec) {
    _q.setFromEuler(_e.set(0, rec.ry, 0));
    _v.set(rec.x, 0, rec.z);
    _m.compose(_v, _q, _one);
    meshes[TYPE_KEYS[rec.ti]].setMatrixAt(rec.slot, _m);
  }

  function setCount(ti) {
    const mesh = meshes[TYPE_KEYS[ti]];
    mesh.count = highs[ti] + 1;
    mesh.visible = highs[ti] >= 0;
  }

  return {
    max,
    meshes,

    get count() {
      return live;
    },

    get records() {
      return pool;
    },

    /**
     * Take one record of `spec.type` from its type pool. Returns null when
     * that type is full (caller owns back-pressure: skip / release farthest)
     * or the type key is invalid.
     * @returns {object|null} The live record (STATIC placement).
     */
    spawn(spec = {}) {
      const ti = TYPE_KEYS.indexOf(spec.type);
      if (ti < 0) return null;
      const base = ti * max;
      let slot = -1;
      for (let i = 0; i < max; i++) {
        if (!pool[base + i].alive) {
          slot = i;
          break;
        }
      }
      if (slot < 0) return null;
      const rec = pool[base + slot];
      rec.alive = true;
      live++;
      rec.lane = spec.lane || 0;
      rec.x = spec.x !== undefined ? spec.x : rec.lane * CONFIG.LANE_W;
      rec.z = spec.z || 0;
      const T = O.types[spec.type];
      rec.halfW = T.halfW;
      rec.zHalf = T.zHalf;
      rec.y0 = T.y0 || 0;
      rec.y1 = T.y1 || 0;
      rec.solidAlways = !!T.solidAlways;
      // Debris-feel yaw jitter (visual only; bands already carry tolerance),
      // gantry square (its gap must read true along z). Slot-derived — no rng.
      rec.ry = spec.ry !== undefined
        ? spec.ry
        : (frac(slot * 0.381966 + ti * 0.2917) - 0.5) * 2 * O.jitter[spec.type];
      // Dust/rust brightness variance per instance (diffuse-only channel).
      const tone = 1 + frac(slot * 0.618034 + ti * 0.7355) * 0.12;
      const col = meshes[spec.type].instanceColor.array;
      col[rec.slot * 3] = tone;
      col[rec.slot * 3 + 1] = tone;
      col[rec.slot * 3 + 2] = tone;
      meshes[spec.type].instanceColor.needsUpdate = true;
      write(rec);
      meshes[spec.type].instanceMatrix.needsUpdate = true;
      if (slot > highs[ti]) highs[ti] = slot;
      setCount(ti);
      return rec;
    },

    release(rec) {
      if (!rec || !rec.alive) return;
      rec.alive = false;
      live--;
      const mesh = meshes[TYPE_KEYS[rec.ti]];
      mesh.setMatrixAt(rec.slot, _dead);
      mesh.instanceMatrix.needsUpdate = true;
      while (highs[rec.ti] >= 0 && !pool[rec.ti * max + highs[rec.ti]].alive) highs[rec.ti]--;
      setCount(rec.ti);
    },

    /** Pooled reset (mode restart / retry): recycle everything. */
    reset() {
      for (let i = 0; i < pool.length; i++) this.release(pool[i]);
    },

    /** QA draw A/B hook; the next spawn re-shows its mesh. */
    setVisible(on) {
      for (let ti = 0; ti < TYPE_KEYS.length; ti++) {
        meshes[TYPE_KEYS[ti]].visible = !!on && highs[ti] >= 0;
      }
    },

    /** Rewrite every live record's matrix (QA staging conveyor ONLY —
     *  gameplay obstacles are static; see the file header). Allocation-free. */
    flush() {
      for (let ti = 0; ti < TYPE_KEYS.length; ti++) {
        if (highs[ti] < 0) continue;
        const base = ti * max;
        for (let i = 0; i <= highs[ti]; i++) {
          if (pool[base + i].alive) write(pool[base + i]);
        }
        meshes[TYPE_KEYS[ti]].instanceMatrix.needsUpdate = true;
      }
    },

    /**
     * Night hazard blink — the gantry's shared lamp material dips between
     * glow.night.gantryMin/gantryMax (all lamps in phase; one uniform write).
     * No-op at dusk and while no gantry is live; dt 0 (frozen warmup) keeps
     * the current frame's intensity. Call once per fixed step.
     * @param {number} dt
     */
    fixedUpdate(dt) {
      if (!NIGHT || highs[1] < 0) return;
      blinkPhase = (blinkPhase + Math.PI * 2 * O.glow.blinkHz * dt) % (Math.PI * 2);
      const w = 0.5 - 0.5 * Math.cos(blinkPhase);
      mats.gantry.emissiveIntensity = O.glow.night.gantryMin +
        (O.glow.night.gantryMax - O.glow.night.gantryMin) * w;
    },

    /**
     * Collision truth for one player profile (see the file header for the
     * semantics table). Returns the hit record (archetype + placement for
     * the death sting / gameover framing) or null. Allocation-free.
     * @param {{x?: number, lane?: number, z: number, y0?: number, y1?: number}} p
     * @returns {object|null}
     */
    collide(p) {
      const px = p.x !== undefined ? p.x : (p.lane || 0) * CONFIG.LANE_W;
      const pz = p.z;
      const y0 = p.y0 || 0;
      const y1 = p.y1 !== undefined ? p.y1 : standTop;
      for (let ti = 0; ti < TYPE_KEYS.length; ti++) {
        const hi = highs[ti];
        if (hi < 0) continue;
        const base = ti * max;
        for (let i = 0; i <= hi; i++) {
          const rec = pool[base + i];
          if (!rec.alive) continue;
          if (Math.abs(pz - rec.z) >= rec.zHalf + O.playerHalfD) continue;
          if (Math.abs(px - rec.x) >= rec.halfW + O.playerHalfW) continue;
          if (!rec.solidAlways && (y0 >= rec.y1 || y1 <= rec.y0)) continue;
          return rec;
        }
      }
      return null;
    },

    /**
     * Band query for the spawn director (4.2): does any live obstacle's
     * z-window overlap [z0, z1] (and sit in `lane`, when given)? The
     * director calls this BEFORE accepting a placement — a band is only
     * laid out where every lane it needs is unoccupied (design risk note:
     * "director reserves lane z-windows so spawns never straddle a shoulder
     * wreck" — this is the read side of that reservation).
     * @param {number} z0
     * @param {number} z1
     * @param {number} [lane]
     * @returns {boolean}
     */
    occupied(z0, z1, lane) {
      for (let i = 0; i < pool.length; i++) {
        const rec = pool[i];
        if (!rec.alive) continue;
        if (rec.z + rec.zHalf < z0 || rec.z - rec.zHalf > z1) continue;
        if (lane !== undefined && rec.lane !== lane) continue;
        return true;
      }
      return false;
    },
  };
}
