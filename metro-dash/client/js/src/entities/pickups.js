/**
 * @file entities/pickups.js
 * Wave-4 powerup pickups: magnet (horseshoe), jetpack (canister pair) and
 * x2 (gold token), pooled per type on InstancedMeshes so ALL pickups on
 * screen cost <= 3 draw calls.
 *
 * Visual-only for wave 4 gameplay: run.js spawns them rarely inside coin
 * lines and routes collection into RunController.collectPowerup(), which
 * wave 5 turns into real powerup behaviour (magnet already feeds the coin
 * magnet hook, x2 already doubles the multiplier via the existing stubs).
 *
 * Determinism: matrices derive from a fixed-step time accumulator only, so
 * ?freeze renders identical frames.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const PICKUP_TYPES = ["magnet", "jetpack", "x2"];

const PICKUP_RADIUS = 1.25; // x/z collection half-extent (slightly sticky)
const PICKUP_HEIGHT = 1.7; // collection window above the feet
const SPIN_RATE = 2.4; // rad/s
const BOB_RATE = 2.0;
const BOB_AMP = 0.09;
const DESPAWN_BEHIND = 25;

/**
 * Fill a geometry's `color` attribute with one flat color (vertex-painted
 * parts merge into a single vertexColors material).
 * @param {THREE.BufferGeometry} geo
 * @param {number} hex
 * @returns {THREE.BufferGeometry}
 */
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Translate helper (chainable). */
function place(geo, x, y, z) {
  geo.translate(x, y, z);
  return geo;
}

/**
 * Magnet horseshoe: red U-body (torus half) + silver pole tips.
 * @returns {THREE.BufferGeometry}
 */
function buildMagnetGeometry() {
  const body = paint(new THREE.TorusGeometry(0.2, 0.075, 10, 20, Math.PI), 0xd83a2e);
  const tipL = paint(new THREE.BoxGeometry(0.16, 0.1, 0.16), 0xb9c0c6);
  const tipR = paint(new THREE.BoxGeometry(0.16, 0.1, 0.16), 0xb9c0c6);
  return mergeGeometries(
    [body, place(tipL, -0.2, -0.05, 0), place(tipR, 0.2, -0.05, 0)],
    false,
  );
}

/**
 * Jetpack: twin orange canisters with silver caps, dark nozzles and a strap
 * bar.
 * @returns {THREE.BufferGeometry}
 */
function buildJetpackGeometry() {
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(paint(place(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 12), sx * 0.12, 0, 0), 0xe8742c));
    for (const sy of [-1, 1]) {
      parts.push(paint(place(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 12), sx * 0.12, sy * 0.23, 0), 0xb9c0c6));
    }
    parts.push(paint(place(new THREE.CylinderGeometry(0.045, 0.08, 0.1, 10), sx * 0.12, -0.29, 0), 0x33383e));
  }
  parts.push(paint(place(new THREE.BoxGeometry(0.34, 0.06, 0.08), 0, 0.12, 0), 0xb9c0c6));
  return mergeGeometries(parts, false);
}

/**
 * x2 token: thin box whose large faces map the "2x" canvas; the edges sample
 * the solid-gold corner patch of the same texture.
 * @returns {THREE.BufferGeometry}
 */
function buildTokenGeometry() {
  const geo = new THREE.BoxGeometry(0.46, 0.46, 0.075);
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const uf = uv.getX(i);
      const vf = uv.getY(i);
      if (f === 4 || f === 5) uv.setXY(i, uf, vf); // large faces: full design
      else uv.setXY(i, uf * 0.03, vf * 0.03); // edges: gold corner patch
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export class PickupField {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").MaterialLibrary} lib
   * @param {number} [perType] Pool capacity per pickup type.
   */
  constructor(scene, lib, perType = 4) {
    this.perType = perType;
    this.onCollect = null; // (type: string) => void
    this._spinTime = 0;
    // Wave 5 (additive): position of the pickup collected in the last
    // fixedUpdate (consumed by the VFX layer via run.js).
    this.lastCollectPos = null;

    /** @type {Record<string, THREE.InstancedMesh>} */
    this.meshes = {
      magnet: new THREE.InstancedMesh(buildMagnetGeometry(), lib.pickupPaint, perType),
      jetpack: new THREE.InstancedMesh(buildJetpackGeometry(), lib.pickupPaint, perType),
      x2: new THREE.InstancedMesh(buildTokenGeometry(), lib.pickupToken, perType),
    };
    for (const mesh of Object.values(this.meshes)) {
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
    }

    /** @type {{type: string, active: boolean, x: number, y: number, baseY: number, z: number, phase: number}[]} */
    this.slots = [];
    for (const type of PICKUP_TYPES) {
      for (let i = 0; i < perType; i++) {
        this.slots.push({
          type,
          active: false,
          x: 0,
          y: 0,
          baseY: 0,
          z: 0,
          phase: i * 1.3 + PICKUP_TYPES.indexOf(type) * 0.9,
        });
      }
    }
    this._dummy = new THREE.Object3D();
  }

  /**
   * Spawn a pickup (silently ignored when its type pool is full).
   * @param {string} type One of PICKUP_TYPES.
   * @param {number} x @param {number} y @param {number} z
   * @returns {boolean} True if placed.
   */
  spawn(type, x, y, z) {
    for (const s of this.slots) {
      if (s.type === type && !s.active) {
        s.active = true;
        s.x = x;
        s.y = y;
        s.baseY = y;
        s.z = z;
        return true;
      }
    }
    return false;
  }

  /**
   * Fixed-step update: spin time, collection, despawn behind the player.
   * @param {number} dt Fixed delta.
   * @param {{x: number, y: number, z: number}} player Player sim position.
   * @returns {string|null} Collected pickup type this step (if any).
   */
  fixedUpdate(dt, player) {
    this._spinTime += dt;
    let collected = null;
    for (const s of this.slots) {
      if (!s.active) continue;
      if (
        Math.abs(player.z - s.z) < PICKUP_RADIUS &&
        Math.abs(player.x - s.x) < PICKUP_RADIUS &&
        s.y > player.y - 0.4 &&
        s.y < player.y + PICKUP_HEIGHT
      ) {
        s.active = false;
        collected = s.type;
        // Wave 5 (additive): stash the collect position for the VFX layer.
        this.lastCollectPos = { type: s.type, x: s.x, y: s.y, z: s.z };
        if (this.onCollect) this.onCollect(s.type);
        continue;
      }
      if (s.z < player.z - DESPAWN_BEHIND) s.active = false;
    }
    return collected;
  }

  /**
   * Render-time: write per-type instance matrices (spin + bob). Driven by the
   * fixed-step accumulator only.
   */
  updateRender() {
    const t = this._spinTime;
    for (const type of PICKUP_TYPES) {
      const mesh = this.meshes[type];
      let n = 0;
      for (const s of this.slots) {
        if (s.type !== type || !s.active) continue;
        const d = this._dummy;
        d.position.set(s.x, s.baseY + Math.sin(t * BOB_RATE + s.phase) * BOB_AMP, s.z);
        d.rotation.set(0, t * SPIN_RATE + s.phase, 0);
        d.updateMatrix();
        mesh.setMatrixAt(n++, d.matrix);
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Deactivate everything. */
  reset() {
    for (const s of this.slots) s.active = false;
    for (const mesh of Object.values(this.meshes)) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }
}
