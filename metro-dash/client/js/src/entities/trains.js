/**
 * @file entities/trains.js
 * Wave-4 obstacle set: detailed metro cars, striped barricades, signal
 * gantries and tread-plate ramps assembled from MaterialLibrary materials.
 * All geometry is procedural (primitives merged per material to keep draw
 * calls flat); all textures come from core/assets.js canvas painters.
 *
 * Collider contract (UNCHANGED from wave 1 — run.js, the QA god-mode and the
 * pattern director depend on these exact volumes):
 *   train    { halfW 1.0, halfD 6.0, y0 0,   y1 3.2, solid }
 *   barrier  { halfW 0.95, halfD 0.16, y0 0,   y1 1.0, solid }
 *   overhead { halfW 1.1, halfD 0.2,  y0 1.7, y1 3.0, solid }
 *   ramp     no collider (visual prop, as before)
 *
 * Moving-train hook: an obstacle may carry `vz` (m/s, world-relative);
 * fixedUpdate() advances it. Moving trains swap their lamp material to the
 * emissive lens set (a lit headlight read, no lens flares/sprites).
 *
 * Livery variants: 3 palettes (transit orange/cream, teal/navy, yellow/gray)
 * chosen deterministically from the run seed per spawned car; pooled cars are
 * re-skinned on spawn (materials only — geometry is shared).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../core/config.js";
import { hashSeed, mulberry32 } from "../core/rng.js";
import { TRAIN_DOOR_Z } from "../core/assets.js";

/**
 * @typedef {object} Collider
 * @property {number} x Center X.
 * @property {number} z Center Z.
 * @property {number} halfW
 * @property {number} halfD
 * @property {number} y0 Bottom.
 * @property {number} y1 Top.
 * @property {boolean} solid False = walk-through decoration.
 */

/** @typedef {{group: THREE.Group, colliders: Collider[], vz: number, active: boolean, kind: string, parts: object}} Obstacle */

// --- Car layout constants (metres) -----------------------------------------
const BODY_W = 2.0;
const BODY_H = 2.25;
const BODY_LEN = 12;
const BODY_Y0 = 0.85; // body underside; top at 3.10 (roof gear to ~3.38)
const LEAF_W = 0.6; // door leaf width
const LEAF_H = 1.92;
const LEAF_GAP = 0.04; // gap between a door pair (dark reveal shows through)
const WHEEL_R = 0.33;
const BOGIE_Z = 3.8; // bogie centre distance from car centre

// --- UV helpers ------------------------------------------------------------

/**
 * Rewrite a BoxGeometry's UVs into the train body atlas (1024x768):
 *   sides -> v [0.58, 1] (u = car length), roof -> v [0.25, 0.58] with the
 *   length along u, ends -> v [0, 0.25] / u [0, 0.16], bottom -> dark patch.
 * BoxGeometry face order: px, nx, py, ny, pz, nz; each face's default UVs
 * are the face-local (u, v) in {0,1}.
 * @param {THREE.BoxGeometry} geo
 * @returns {THREE.BoxGeometry}
 */
function mapBodyUVs(geo) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const uf = uv.getX(i);
      const vf = uv.getY(i);
      let tu;
      let tv;
      if (f === 0 || f === 1) {
        // Sides: full band, u along the 12 m length.
        tu = uf;
        tv = 0.58 + vf * 0.42;
      } else if (f === 2) {
        // Roof: length (12 m) along texture u, across (2 m) along v.
        tu = vf;
        tv = 0.25 + uf * 0.33;
      } else if (f === 3) {
        // Bottom (unseen): dark patch.
        tu = 0.16 + uf * 0.04;
        tv = vf * 0.05;
      } else {
        // Ends (2.0 x 2.25 m): shared block.
        tu = uf * 0.16;
        tv = vf * 0.25;
      }
      uv.setXY(i, tu, tv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Door leaf UVs: outer faces (px AND nx so one shared geometry serves both
 * car sides) map the full leaf canvas; the thin edges sample a plain patch.
 * @param {THREE.BoxGeometry} geo
 * @returns {THREE.BoxGeometry}
 */
function mapLeafUVs(geo) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const uf = uv.getX(i);
      const vf = uv.getY(i);
      if (f === 0 || f === 1) uv.setXY(i, uf, vf);
      else uv.setXY(i, 0.4 + uf * 0.05, 0.55 + vf * 0.05);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Barricade plank UVs: front/back faces map the full stripe canvas; all
 * other faces sample a narrow stripe slice.
 * @param {THREE.BoxGeometry} geo
 * @returns {THREE.BoxGeometry}
 */
function mapPlankUVs(geo) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const uf = uv.getX(i);
      const vf = uv.getY(i);
      if (f === 4 || f === 5) uv.setXY(i, uf, vf);
      else uv.setXY(i, uf * 0.08, 0.2 + vf * 0.5);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Sign panel UVs: front/back faces map the full sign canvas; edges sample a
 * border sliver.
 * @param {THREE.BoxGeometry} geo
 * @returns {THREE.BoxGeometry}
 */
function mapSignUVs(geo) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const uf = uv.getX(i);
      const vf = uv.getY(i);
      if (f === 4 || f === 5) uv.setXY(i, uf, vf);
      else uv.setXY(i, uf * 0.04, 0.48 + vf * 0.04);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** Translate helper (chainable clone-free). */
function place(geo, x, y, z) {
  geo.translate(x, y, z);
  return geo;
}

// --- Shared train geometry -------------------------------------------------

/**
 * Undercarriage + roof equipment, all merged into ONE dark-steel geometry:
 * under-frame, side/end skirts, 2 bogies (frames, wheels, axles), couplers,
 * AC hump, vents and a folded pantograph.
 * @returns {THREE.BufferGeometry}
 */
function trainDarkGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z) => parts.push(place(new THREE.BoxGeometry(w, h, d), x, y, z));

  // Under-frame + skirts (bogies stay visible between them).
  box(1.7, 0.28, 11.6, 0, 0.75, 0);
  for (const sx of [-1, 1]) {
    box(0.05, 0.26, 5.2, sx * 0.97, 0.66, 0); // centre skirt
    box(0.05, 0.26, 0.9, sx * 0.97, 0.66, 5.35); // end skirts
    box(0.05, 0.26, 0.9, sx * 0.97, 0.66, -5.35);
  }
  // Bogies: frame + 4 wheels + 2 axles each.
  for (const bz of [-BOGIE_Z, BOGIE_Z]) {
    box(1.5, 0.36, 2.1, 0, 0.44, bz);
    for (const az of [-0.65, 0.65]) {
      const axle = new THREE.CylinderGeometry(0.09, 0.09, 1.44, 8);
      axle.rotateZ(Math.PI / 2); // axis -> x
      parts.push(place(axle, 0, WHEEL_R, bz + az));
      for (const sx of [-1, 1]) {
        const wheel = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.11, 14);
        wheel.rotateZ(Math.PI / 2); // axis -> x
        parts.push(place(wheel, sx * 0.72, WHEEL_R, bz + az));
      }
    }
  }
  // Couplers + head plates.
  for (const ez of [-1, 1]) {
    box(0.28, 0.2, 0.5, 0, 0.6, ez * 6.0);
    box(0.5, 0.28, 0.14, 0, 0.62, ez * 6.2);
  }
  // Roof gear: AC hump, 2 vents, folded pantograph.
  box(1.3, 0.22, 2.4, 0, 3.21, 2.0);
  box(0.85, 0.1, 1.1, 0, 3.15, -1.6);
  box(0.85, 0.1, 1.1, 0, 3.15, -0.3);
  for (const sx of [-1, 1]) {
    const ins = new THREE.CylinderGeometry(0.05, 0.065, 0.1, 8);
    parts.push(place(ins, sx * 0.45, 3.15, -3.9));
  }
  box(1.2, 0.05, 0.14, 0, 3.22, -3.9); // panto base
  const armL = new THREE.BoxGeometry(0.04, 0.04, 1.4);
  armL.rotateX(0.16);
  parts.push(place(armL, 0.15, 3.27, -3.9));
  const armR = new THREE.BoxGeometry(0.04, 0.04, 1.4);
  armR.rotateX(-0.16);
  parts.push(place(armR, -0.15, 3.27, -3.9));
  box(0.8, 0.06, 0.6, 0, 3.3, -3.9); // saddle
  box(1.15, 0.035, 0.09, 0, 3.36, -3.9); // contact strip

  return mergeGeometries(parts, false);
}

/**
 * Headlight/taillight lenses: 4 small cylinders (2 per car end), merged.
 * Material is swapped at spawn: dark tinted glass when parked, emissive warm
 * glass on moving trains.
 * @returns {THREE.BufferGeometry}
 */
function trainLensGeometry() {
  const parts = [];
  for (const ez of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const lens = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 10);
      lens.rotateX(Math.PI / 2); // axis -> z
      parts.push(place(lens, sx * 0.62, 1.05, ez * 6.01));
    }
  }
  return mergeGeometries(parts, false);
}

/**
 * Car-number decal: 8 tiny quads (4 digits x both sides) sampling the digit
 * atlas. Number is derived deterministically from the pool slot index, so
 * every pooled car carries its own stable number.
 * @param {number} carIndex Pool slot index.
 * @returns {THREE.BufferGeometry}
 */
function trainDecalGeometry(carIndex) {
  const h = hashSeed(0xca27, carIndex);
  const digits = [0, 1, 2, 3].map((k) => (h >>> (k * 8 + 2)) % 10);
  const parts = [];
  for (const sx of [-1, 1]) {
    for (let d = 0; d < 4; d++) {
      const quad = new THREE.PlaneGeometry(0.17, 0.26);
      // Per-digit atlas window.
      const uv = quad.attributes.uv;
      const u0 = digits[d] * 0.1;
      for (let v = 0; v < 4; v++) uv.setX(v, u0 + uv.getX(v) * 0.1);
      quad.rotateY(sx * (Math.PI / 2));
      // 4-digit group centred 1.15 m from the -z car end on both flanks; the
      // run advances in each side's reading direction (outside viewer's
      // left-to-right), clear of the door reveal at z -4.06.
      const z = -4.85 + (sx > 0 ? -1 : 1) * (d - 1.5) * 0.19;
      place(quad, sx * 1.008, 1.53, z);
      parts.push(quad);
    }
  }
  return mergeGeometries(parts, false);
}

// --- Obstacle builders -----------------------------------------------------

/**
 * Build one detailed metro car. 5 meshes:
 * body (livery atlas), doors (12 leaves), dark parts (undercarriage + roof
 * gear), lenses (swappable glass), number decals.
 * @param {import("../core/assets.js").MaterialLibrary} lib
 * @param {{bodyGeo: THREE.BufferGeometry, leafGeo: THREE.BufferGeometry,
 *     darkGeo: THREE.BufferGeometry, lensGeo: THREE.BufferGeometry}} shared
 * @param {number} carIndex
 * @returns {{group: THREE.Group, colliders: Collider[], parts: object}}
 */
function buildTrainCar(lib, shared, carIndex) {
  const group = new THREE.Group();
  const variants = lib.trainVariants;
  const mk = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const body = mk(shared.bodyGeo, variants[0].body, 0, BODY_Y0 + BODY_H / 2, 0);
  const doors = mk(shared.leafGeo, variants[0].door, 0, 0, 0);
  mk(shared.darkGeo, lib.steelDark, 0, 0, 0);
  const lenses = mk(shared.lensGeo, lib.lensDark, 0, 0, 0);
  mk(trainDecalGeometry(carIndex), lib.trainDigit, 0, 0, 0);

  // Collider contract: IDENTICAL to wave 1.
  const colliders = [{ x: 0, z: 0, halfW: 1.0, halfD: 6.0, y0: 0, y1: 3.2, solid: true }];
  return { group, colliders, parts: { body, doors, lenses } };
}

/**
 * Door leaves: one shared geometry holding all 12 leaves of a car.
 * @returns {THREE.BufferGeometry}
 */
function trainLeavesGeometry() {
  const parts = [];
  for (const sx of [-1, 1]) {
    for (const dz of TRAIN_DOOR_Z) {
      for (const half of [-1, 1]) {
        const leaf = mapLeafUVs(new THREE.BoxGeometry(0.035, LEAF_H, LEAF_W));
        place(leaf, sx * 1.005, BODY_Y0 + 0.01 + LEAF_H / 2, dz + half * (LEAF_W / 2 + LEAF_GAP / 2));
        parts.push(leaf);
      }
    }
  }
  return mergeGeometries(parts, false);
}

/** Striped construction barricade (jump obstacle). 3 meshes. */
function buildBarrier(lib) {
  const group = new THREE.Group();
  const mk = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Striped plank (top at 1.0 m = collider top).
  mk(mapPlankUVs(new THREE.BoxGeometry(2.0, 0.3, 0.12)), lib.barrierStripe, 0, 0.85, 0);

  // Frame: trestle legs, feet, braces, mid rail, lamp bases.
  const frame = [];
  for (const sx of [-1, 1]) {
    frame.push(place(new THREE.BoxGeometry(0.08, 0.86, 0.08), sx * 0.85, 0.43, 0));
    frame.push(place(new THREE.BoxGeometry(0.16, 0.06, 0.5), sx * 0.85, 0.03, 0));
    const brace = new THREE.BoxGeometry(0.05, 0.05, 0.72);
    brace.rotateX(0.6);
    frame.push(place(brace, sx * 0.85, 0.36, 0));
    frame.push(place(new THREE.CylinderGeometry(0.06, 0.075, 0.05, 10), sx * 0.8, 1.01, 0));
  }
  frame.push(place(new THREE.BoxGeometry(2.0, 0.1, 0.08), 0, 0.42, 0));
  mk(mergeGeometries(frame, false), lib.steelDark, 0, 0, 0);

  // Lamp caps: small amber domes on the plank top.
  const lamps = [];
  for (const sx of [-1, 1]) {
    lamps.push(place(new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), sx * 0.8, 1.035, 0));
  }
  mk(mergeGeometries(lamps, false), lib.lampAmber, 0, 0, 0);

  const colliders = [{ x: 0, z: 0, halfW: 0.95, halfD: 0.16, y0: 0, y1: 1.0, solid: true }];
  return { group, colliders, parts: {} };
}

/** Signal gantry with STOP sign + lamps (roll-under obstacle). 3 meshes. */
function buildOverhead(lib) {
  const group = new THREE.Group();
  const mk = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Frame: two posts, top beam, drop rods, lamp housings.
  const frame = [];
  for (const sx of [-1, 1]) {
    frame.push(place(new THREE.BoxGeometry(0.14, 3.1, 0.14), sx * 1.1, 1.55, 0));
    frame.push(place(new THREE.BoxGeometry(0.2, 0.08, 0.4), sx * 1.1, 0.04, 0)); // foot pad
    frame.push(place(new THREE.BoxGeometry(0.05, 0.12, 0.05), sx * 0.8, 2.97, 0)); // drop rod
    frame.push(place(new THREE.CylinderGeometry(0.07, 0.09, 0.09, 10), sx * 0.9, 3.17, 0.12)); // lamp housing
  }
  frame.push(place(new THREE.BoxGeometry(2.6, 0.16, 0.16), 0, 3.06, 0));
  mk(mergeGeometries(frame, false), lib.catSteel, 0, 0, 0);

  // Hanging sign panel (bottom at 1.7 m = collider y0).
  mk(mapSignUVs(new THREE.BoxGeometry(2.2, 1.3, 0.08)), lib.gantrySign, 0, 2.35, 0);

  // Amber lamp domes (static daytime tint, blink-capable later).
  const lamps = [];
  for (const sx of [-1, 1]) {
    const dome = new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI); // lower hemisphere, facing down at traffic
    lamps.push(place(dome, sx * 0.9, 3.14, 0.12));
  }
  mk(mergeGeometries(lamps, false), lib.lampAmber, 0, 0, 0);

  const colliders = [{ x: 0, z: 0, halfW: 1.1, halfD: 0.2, y0: 1.7, y1: 3.0, solid: true }];
  return { group, colliders, parts: {} };
}

/** Worn metal ramp with tread plate, chevrons and side rails. 2 meshes. */
function buildRamp(lib) {
  const group = new THREE.Group();
  const w = 1.0; // half width
  const h = 1.1; // height at the high end
  const l = 1.7; // half length

  // Wedge with UVs: slope face maps the tread-plate tile (u across width,
  // v along the 3.57 m slope = 1.79 tiles so chevrons repeat up the ramp).
  const A = [-w, 0, l];
  const B = [w, 0, l];
  const C = [w, 0, -l];
  const D = [-w, 0, -l];
  const E = [w, h, -l];
  const F = [-w, h, -l];
  const vRep = Math.sqrt(2 * l * 2 * l + h * h) / 2; // slope length / 2 m tile
  const tris = [
    // [p0, p1, p2, u0, v0, u1, v1, u2, v2]
    [A, B, E, 0, 0, 1, 0, 1, vRep],
    [A, E, F, 0, 0, 1, vRep, 0, vRep],
    [A, B, C, 0, 0, 1, 0, 1, 1],
    [A, C, D, 0, 0, 1, 1, 0, 1],
    [C, D, F, 0, 0, 1, 0, 1, 1],
    [C, F, E, 0, 0, 1, 1, 0, 1],
    [A, F, D, 0, 0, 1, 1, 0, 0],
    [B, C, E, 0, 0, 1, 0, 1, 1],
  ];
  const pos = [];
  const uv = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      pos.push(t[k][0], t[k][1], t[k][2]);
      uv.push(t[3 + k * 2], t[4 + k * 2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, lib.treadPlate);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Side rails (matching the slope angle) + support legs.
  const slope = Math.atan2(h, 2 * l);
  const railLen = Math.sqrt(2 * l * 2 * l + h * h) + 0.1;
  const frame = [];
  for (const sx of [-1, 1]) {
    const rail = new THREE.BoxGeometry(0.06, 0.1, railLen);
    rail.rotateX(slope);
    frame.push(place(rail, sx * 0.99, h / 2 + 0.09, 0));
    frame.push(place(new THREE.BoxGeometry(0.08, h / 2, 0.08), sx * 0.75, h / 4, -l + 0.15));
  }
  frame.push(place(new THREE.BoxGeometry(1.6, 0.08, 0.08), 0, 0.08, -l + 0.15));
  const frameMesh = new THREE.Mesh(mergeGeometries(frame, false), lib.steelDark);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  return { group, colliders: [], parts: {} };
}

// ---------------------------------------------------------------------------

export class ObstacleManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").MaterialLibrary} lib
   * @param {number} [seed] Run seed (deterministic livery variants).
   */
  constructor(scene, lib, seed = 0) {
    this.scene = scene;
    this.lib = lib;
    this.seed = seed;
    /** @type {Obstacle[]} */
    this.obstacles = [];

    // Pools per kind.
    this._pools = {
      train: [],
      barrier: [],
      overhead: [],
      ramp: [],
    };
    // Shared geometries (built once, reused by every pooled train car).
    this._trainShared = null;
    this._trainBuilt = 0; // pool slot counter (stable per-car numbers)
    this._trainSpawned = 0; // spawn counter (seeded variant pick)
  }

  /**
   * Lazily build the shared train geometries.
   * @private
   */
  _sharedTrainGeometry() {
    if (!this._trainShared) {
      this._trainShared = {
        bodyGeo: mapBodyUVs(new THREE.BoxGeometry(BODY_W, BODY_H, BODY_LEN)),
        leafGeo: trainLeavesGeometry(),
        darkGeo: trainDarkGeometry(),
        lensGeo: trainLensGeometry(),
      };
    }
    return this._trainShared;
  }

  /**
   * Acquire an obstacle from a pool (or build one).
   * @param {string} kind
   * @returns {Obstacle}
   * @private
   */
  _acquire(kind) {
    const pool = this._pools[kind];
    let obs = pool.pop();
    if (!obs) {
      obs = this._build(kind);
      this.scene.add(obs.group);
    }
    obs.active = true;
    obs.group.visible = true;
    obs.vz = 0;
    this.obstacles.push(obs);
    return obs;
  }

  /**
   * Build a fresh obstacle of the given kind.
   * @param {string} kind
   * @returns {Obstacle}
   * @private
   */
  _build(kind) {
    if (kind === "train") {
      const built = buildTrainCar(this.lib, this._sharedTrainGeometry(), this._trainBuilt++);
      return { group: built.group, colliders: built.colliders, parts: built.parts, vz: 0, active: false, kind };
    }
    let built;
    if (kind === "barrier") built = buildBarrier(this.lib);
    else if (kind === "overhead") built = buildOverhead(this.lib);
    else built = buildRamp(this.lib);
    return { group: built.group, colliders: built.colliders, parts: {}, vz: 0, active: false, kind };
  }

  /**
   * Spawn an obstacle at a lane/z.
   * @param {string} kind "train"|"barrier"|"overhead"|"ramp"
   * @param {number} lane -1|0|1
   * @param {number} z
   * @param {number} [vz] Relative speed (moving-train hook).
   * @returns {Obstacle}
   */
  spawn(kind, lane, z, vz = 0) {
    const obs = this._acquire(kind);
    obs.group.position.set(lane * CONFIG.LANE_WIDTH, 0, z);
    obs.vz = vz;
    if (kind === "train") this._skin(obs, vz);
    // Colliders are stored group-local; world position applied on read.
    return obs;
  }

  /**
   * Re-skin a pooled car: seeded livery variant + lens state (lit when the
   * train moves). Deterministic per spawn order for a given seed.
   * @private
   */
  _skin(obs, vz) {
    const variants = this.lib.trainVariants;
    const v = variants.length
      ? Math.floor(
          mulberry32(hashSeed(this.seed ^ 0x74a1, this._trainSpawned++, 0x9e37))() *
            variants.length,
        )
      : 0;
    const variant = variants[v];
    if (variant) {
      obs.parts.body.material = variant.body;
      obs.parts.doors.material = variant.door;
    }
    obs.parts.lenses.material = vz !== 0 ? this.lib.lensLit : this.lib.lensDark;
  }

  /**
   * Fixed-step update: advance moving trains, recycle behind the player.
   * @param {number} dt
   * @param {number} playerZ
   */
  fixedUpdate(dt, playerZ) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      if (obs.vz !== 0) obs.group.position.z += obs.vz * dt;
      if (obs.group.position.z < playerZ - 30) {
        obs.active = false;
        obs.group.visible = false;
        this._pools[obs.kind].push(obs);
        this.obstacles.splice(i, 1);
      }
    }
  }

  /**
   * All active world-space colliders (reused array; valid until next call).
   * @returns {Collider[]}
   */
  getColliders() {
    const out = [];
    for (const obs of this.obstacles) {
      const ox = obs.group.position.x;
      const oz = obs.group.position.z;
      for (const c of obs.colliders) {
        out.push({
          x: c.x + ox,
          z: c.z + oz,
          halfW: c.halfW,
          halfD: c.halfD,
          y0: c.y0,
          y1: c.y1,
          solid: c.solid,
        });
      }
    }
    return out;
  }

  /** Return everything to pools. */
  reset() {
    for (const obs of this.obstacles) {
      obs.active = false;
      obs.group.visible = false;
      this._pools[obs.kind].push(obs);
    }
    this.obstacles.length = 0;
    this._trainSpawned = 0; // variant sequence restarts deterministically
  }

  // -----------------------------------------------------------------
  // READ-ONLY teaching-layer queries (ui-ux-pass design D8, task 7.1).
  // The first-run coach asks "is a jump/roll hazard closing in?" without
  // mutating anything: pure scans of the ACTIVE obstacle list by kind
  // (the spawn director already classifies them — barrier rows are the
  // jump verb, overhead gantries the roll verb, trains a lane dodge).
  // No pool traffic, no position writes, no allocation, no RNG.
  // -----------------------------------------------------------------

  /**
   * Is a jumpable ground obstacle (barrier) within `range` m ahead of `z`?
   * @param {number} z Player z (metres).
   * @param {number} range Look-ahead window in metres.
   * @param {number} [x] Player x — when given, only the player's lane counts.
   * @returns {boolean}
   */
  nearestJumpable(z, range, x) {
    return this._nearestKindAhead(z, range, "barrier", x);
  }

  /**
   * Is an overhead (roll-under) obstacle within `range` m ahead of `z`?
   * @param {number} z Player z (metres).
   * @param {number} range Look-ahead window in metres.
   * @param {number} [x] Player x — when given, only the player's lane counts.
   * @returns {boolean}
   */
  nearestOverhead(z, range, x) {
    return this._nearestKindAhead(z, range, "overhead", x);
  }

  /**
   * Shared scan behind both queries. Strictly read-only: iterates the
   * active list, compares world positions, returns on the first hit.
   * @private
   */
  _nearestKindAhead(z, range, kind, x) {
    const laneTol = CONFIG.LANE_WIDTH * 0.5;
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (!obs.active || obs.kind !== kind) continue;
      const oz = obs.group.position.z;
      if (oz < z || oz > z + range) continue; // ahead-only window
      if (typeof x === "number" && Math.abs(obs.group.position.x - x) > laneTol) continue;
      return true;
    }
    return false;
  }
}
