/**
 * @file entities/coins.js
 * Wave-4 coin field: beveled gold coins (lathe rim + embossed 5-point star)
 * pooled in a single InstancedMesh, wobbling as they spin.
 *
 * Fixed-step update handles collection (with a magnet radius hook) so the
 * simulation stays deterministic; the visual spin/wobble runs from the same
 * fixed-step time accumulator (dt=0 under ?freeze renders identical frames).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../core/config.js";

const COIN_RADIUS = 0.34;
const COIN_THICKNESS = 0.07;
// Wave-4 feel tunables (gameplay-safe: no speed/jump/gravity changes).
const PICKUP_RADIUS = 1.2; // was 1.05 — slightly stickier collection
const PICKUP_HEIGHT = 1.7;
const MAGNET_RADIUS = 7; // was 6
const MAGNET_PULL_SPEED = 26;
const SPIN_RATE = 5.2; // rad/s (was 4) — reads livelier at chase speed
const BOB_RATE = 2;
const WOBBLE_RATE = 2.6;

/**
 * 5-point star cross-section for the embossed face.
 * @param {number} outerR @param {number} innerR
 * @returns {THREE.Shape}
 */
function starShape(outerR, innerR) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2; // point up
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/**
 * Beveled coin: lathe profile with raised rim + recessed faces, plus an
 * embossed star proud of each face. Built in coin-axis space (flat faces
 * toward +/-Y), then rotated so faces point at +/-Z like the old disc.
 * @returns {THREE.BufferGeometry}
 */
function buildCoinGeometry() {
  const R = COIN_RADIUS;
  const rim = COIN_THICKNESS / 2; // 0.035
  const face = 0.022; // recessed face height
  const profile = [
    new THREE.Vector2(0.0, -face),
    new THREE.Vector2(0.26, -face),
    new THREE.Vector2(0.3, -rim),
    new THREE.Vector2(R - 0.005, -rim),
    new THREE.Vector2(R, -rim + 0.017),
    new THREE.Vector2(R, rim - 0.017),
    new THREE.Vector2(R - 0.005, rim),
    new THREE.Vector2(0.3, rim),
    new THREE.Vector2(0.26, face),
    new THREE.Vector2(0.0, face),
  ];
  const lathe = new THREE.LatheGeometry(profile, 28).toNonIndexed();

  // Embossed star on both faces (extruded 12 mm, sitting on the recessed
  // faces and flush with the rim top).
  const starGeo = new THREE.ExtrudeGeometry(starShape(0.165, 0.072), {
    depth: 0.012,
    bevelEnabled: false,
  });
  const starTop = starGeo.clone().rotateX(-Math.PI / 2); // extrude toward +Y
  starTop.translate(0, face, 0);
  const starBottom = starGeo.clone().rotateX(Math.PI / 2); // extrude toward -Y
  starBottom.rotateY(Math.PI); // mirrored orientation reads correct when flipped
  starBottom.translate(0, -face, 0);

  const geo = mergeGeometries([lathe, starTop, starBottom], false);
  geo.rotateX(Math.PI / 2); // faces toward +/-Z (player)
  return geo;
}

export class CoinField {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").MaterialLibrary} lib
   * @param {number} [max] Pool capacity.
   */
  constructor(scene, lib, max = 256) {
    this.max = max;
    this.onCollect = null; // (count) => void
    this._spinTime = 0;
    // Wave 5 (additive): world positions of coins collected in the LAST
    // fixedUpdate call (x,y,z flat), consumed by run.js for the pickup-burst
    // event. Drained at the start of every fixed step.
    this.lastCollected = [];

    this.mesh = new THREE.InstancedMesh(buildCoinGeometry(), lib.gold, max);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    /** @type {{active: boolean, x: number, y: number, z: number, baseY: number, phase: number}[]} */
    this.coins = [];
    for (let i = 0; i < max; i++) {
      this.coins.push({ active: false, x: 0, y: 0, z: 0, baseY: 0, phase: 0 });
    }
    this._dummy = new THREE.Object3D();
    this._firstFree = 0;
  }

  /** @param {number} playerZ Despawn behind this. */
  _freeIndex() {
    for (let n = 0; n < this.max; n++) {
      const i = (this._firstFree + n) % this.max;
      if (!this.coins[i].active) {
        this._firstFree = (i + 1) % this.max;
        return i;
      }
    }
    return -1;
  }

  /**
   * Spawn a straight line of coins.
   * @param {number} lane -1|0|1
   * @param {number} zStart
   * @param {number} count
   * @param {number} [spacing]
   * @param {number} [y]
   */
  spawnLine(lane, zStart, count, spacing = 1.6, y = 1.0) {
    for (let i = 0; i < count; i++) this._place(lane * CONFIG.LANE_WIDTH, y, zStart - i * spacing);
  }

  /**
   * Spawn an arc of coins (e.g. over a jump barrier).
   * @param {number} lane
   * @param {number} zStart
   * @param {number} count
   * @param {number} [spacing]
   * @param {number} [height] Arc peak height above base.
   */
  spawnArc(lane, zStart, count, spacing = 1.4, height = 2.2) {
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const y = 1.0 + Math.sin(t * Math.PI) * height;
      this._place(lane * CONFIG.LANE_WIDTH, y, zStart - i * spacing);
    }
  }

  /** @private */
  _place(x, y, z) {
    const idx = this._freeIndex();
    if (idx < 0) return;
    const c = this.coins[idx];
    c.active = true;
    c.x = x;
    c.y = y;
    c.baseY = y;
    c.z = z;
    c.phase = idx * 0.7;
  }

  /**
   * Fixed-step update: spin time, magnet pull, collection, despawn.
   * @param {number} dt Fixed delta.
   * @param {{x: number, y: number, z: number}} player Player sim position.
   * @param {boolean} magnetActive
   * @returns {number} Coins collected this step.
   */
  fixedUpdate(dt, player, magnetActive) {
    this._spinTime += dt;
    this.lastCollected.length = 0;
    let collected = 0;
    const magnetR = magnetActive ? MAGNET_RADIUS : 0;
    for (const c of this.coins) {
      if (!c.active) continue;
      // Magnet: pull toward the player within radius (powerup hook, wave 5).
      const dx = player.x - c.x;
      const dy = player.y + 0.9 - c.y;
      const dz = player.z - c.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (magnetR > 0 && dist < magnetR && dist > 0.01) {
        const pull = Math.min(1, (MAGNET_PULL_SPEED * dt) / dist);
        c.x += dx * pull;
        c.y += dy * pull;
        c.z += dz * pull;
      }
      // Collection.
      if (
        Math.abs(dz) < PICKUP_RADIUS &&
        Math.abs(dx) < PICKUP_RADIUS &&
        c.y > player.y - 0.4 &&
        c.y < player.y + PICKUP_HEIGHT
      ) {
        c.active = false;
        collected++;
        this.lastCollected.push(c.x, c.y, c.z); // wave 5 burst position
        continue;
      }
      // Despawn behind camera.
      if (c.z < player.z - 25) c.active = false;
    }
    if (collected > 0 && this.onCollect) this.onCollect(collected);
    return collected;
  }

  /**
   * Render-time: write instance matrices (spin + wobble + bob) for active
   * coins. Driven solely by the fixed-step _spinTime, so ?freeze frames are
   * identical.
   */
  updateRender() {
    let n = 0;
    const t = this._spinTime;
    for (const c of this.coins) {
      if (!c.active) continue;
      const d = this._dummy;
      d.position.set(c.x, c.baseY + Math.sin(t * BOB_RATE + c.phase) * 0.06, c.z);
      d.rotation.set(
        Math.sin(t * WOBBLE_RATE + c.phase) * 0.14,
        t * SPIN_RATE + c.phase,
        Math.cos(t * (WOBBLE_RATE * 0.8) + c.phase) * 0.1,
      );
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Deactivate everything. */
  reset() {
    for (const c of this.coins) c.active = false;
    this.mesh.count = 0;
  }
}
