/**
 * @file game/camera.js
 * Cinematic chase camera.
 *
 * Classic endless-runner angle: high behind the player, looking slightly
 * down the track. Features:
 *  - smooth exponential follow with per-axis stiffness
 *  - speed-based FOV push (65 -> 72)
 *  - lane-based lookahead
 *  - idle "breathing" micro-motion at low speed
 *  - trauma-based screen shake (decaying, noise driven) for later waves
 *
 * QA modes (?cam=): close | side | front | chase for beauty shots.
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";

const CAMERA_MODES = ["chase", "close", "side", "front"];

/** Smooth pseudo-perlin: sum of incommensurate sines. */
function noise1(t, a, b) {
  return (
    Math.sin(t * 13.1 + a) * 0.5 +
    Math.sin(t * 7.7 + b) * 0.3 +
    Math.sin(t * 23.7 + a * 2.1) * 0.2
  );
}

export class ChaseCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(camera) {
    this.camera = camera;
    this.mode = "chase";
    this.trauma = 0; // 0..1, shake intensity
    this._time = 0;
    this._fov = CONFIG.FOV_BASE;
    this._pos = new THREE.Vector3(0, CONFIG.CAMERA_HEIGHT, -CONFIG.CAMERA_DISTANCE);
    this._look = new THREE.Vector3(0, CONFIG.CAMERA_LOOK_HEIGHT, CONFIG.CAMERA_LOOK_AHEAD);
    this._lookTarget = new THREE.Vector3();
    camera.position.copy(this._pos);
    camera.lookAt(this._look);
  }

  /**
   * Override camera framing (QA beauty shots).
   * @param {string} mode "chase"|"close"|"side"|"front"
   */
  setMode(mode) {
    if (CAMERA_MODES.includes(mode)) this.mode = mode;
  }

  /**
   * Add screen shake. Consumed by VFX/collision waves.
   * @param {number} amount 0..1 (clamped).
   */
  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * Target position/look for the current mode.
   * @param {{x: number, y: number, z: number, speed: number}} p
   *   Interpolated player pose (world space).
   * @returns {number[]} [px, py, pz, lx, ly, lz]
   */
  _modePose(p) {
    let px;
    let py;
    let pz;
    let lx;
    let ly;
    let lz;
    switch (this.mode) {
      case "close": // tight beauty shot: character fills ~30% of frame.
        // ~2 m back at ~2 m height, look at the upper torso so pack/hood/
        // cap detail is legible and the hero outweighs adjacent scenery.
        px = p.x * 0.7;
        py = 2.2 + p.y * 0.55;
        pz = p.z - 4.5;
        lx = p.x * 0.9;
        ly = 0.95 + p.y * 0.8;
        lz = p.z + 2.0;
        break;
      case "side": // elevated 3/4 view from +x: 9 m lateral at 6.2 m height.
        // Must fly above the 4.6 m side walls (a low lateral camera only
        // sees wall) while staying clear of the building band (x >= 13.5).
        // Player and track corridor read fully, track recedes ahead.
        px = p.x + 9;
        py = 6.2 + p.y * 0.35;
        pz = p.z - 2;
        lx = p.x;
        ly = 1.1 + p.y * 0.55;
        lz = p.z + 6;
        break;
      case "front": // 10 m ahead looking back
        px = p.x * 0.4;
        py = 4.1;
        pz = p.z + 10;
        lx = p.x;
        ly = 1.3 + p.y * 0.5;
        lz = p.z;
        break;
      default: // chase
        px = p.x * 0.42;
        py = CONFIG.CAMERA_HEIGHT + p.y * 0.35;
        pz = p.z - CONFIG.CAMERA_DISTANCE;
        lx = p.x * 0.62;
        ly = CONFIG.CAMERA_LOOK_HEIGHT + p.y * 0.5;
        lz = p.z + CONFIG.CAMERA_LOOK_AHEAD;
        break;
    }
    return [px, py, pz, lx, ly, lz];
  }

  /**
   * Per-render-frame update.
   * @param {number} dt Real frame delta (s).
   * @param {{x: number, y: number, z: number, speed: number}} p
   *   Interpolated player pose (world space).
   * @param {number} [timeScale] Slow-mo scales shake time too.
   */
  update(dt, p, timeScale = 1) {
    const sdt = dt * timeScale;
    this._time += sdt;

    const [px, py, pz, lx, ly, lz] = this._modePose(p);

    // Exponential smoothing (frame-rate independent).
    const kPos = 1 - Math.exp(-6.5 * dt);
    const kLook = 1 - Math.exp(-9 * dt);
    this._pos.x += (px - this._pos.x) * kPos;
    this._pos.y += (py - this._pos.y) * kPos;
    this._pos.z += (pz - this._pos.z) * kPos;
    this._lookTarget.set(lx, ly, lz);
    this._look.lerp(this._lookTarget, kLook);

    // Idle breathing at low speed.
    const idle = Math.max(0, 1 - p.speed / CONFIG.BASE_SPEED);
    const breatheY = noise1(this._time, 0, 1.7) * 0.025 * idle;
    const breatheX = noise1(this._time, 3.1, 0.4) * 0.02 * idle;

    // Trauma-based shake (quadratic falloff).
    this.trauma = Math.max(0, this.trauma - 1.6 * sdt);
    const shake = this.trauma * this.trauma;

    this.camera.position.set(
      this._pos.x + breatheX + noise1(this._time, 1.3, 5.9) * 0.35 * shake,
      this._pos.y + breatheY + noise1(this._time, 2.7, 8.3) * 0.3 * shake,
      this._pos.z,
    );
    this.camera.lookAt(this._look);
    this.camera.rotateZ(noise1(this._time, 4.4, 2.2) * 0.035 * shake);
    this.camera.rotateX(noise1(this._time, 0.9, 7.6) * 0.03 * shake);

    // Speed-based FOV push.
    const speedRatio = THREE.MathUtils.clamp(
      (p.speed - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED),
      0,
      1,
    );
    const targetFov = CONFIG.FOV_BASE + (CONFIG.FOV_MAX - CONFIG.FOV_BASE) * speedRatio;
    this._fov += (targetFov - this._fov) * (1 - Math.exp(-2.5 * dt));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap instantly to the player (run restart). */
  snapTo(p) {
    this._pos.set(p.x * 0.42, CONFIG.CAMERA_HEIGHT, p.z - CONFIG.CAMERA_DISTANCE);
    this._look.set(p.x * 0.62, CONFIG.CAMERA_LOOK_HEIGHT, p.z + CONFIG.CAMERA_LOOK_AHEAD);
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
  }

  /**
   * QA: pin the camera EXACTLY to the current mode's pose (no smoothing).
   * Used after ?time fast-forward so frozen captures use the requested rig
   * deterministically (accumulated smoothing drift could otherwise leave the
   * camera anywhere, at any resolution).
   * @param {{x: number, y: number, z: number, speed: number}} p
   */
  snapToMode(p) {
    const [px, py, pz, lx, ly, lz] = this._modePose(p);
    this._pos.set(px, py, pz);
    this._look.set(lx, ly, lz);
    this._time = 0; // freeze shake/breathing at a deterministic phase
    this.camera.position.set(this._pos.x, this._pos.y, this._pos.z);
    this.camera.lookAt(this._look);
  }
}
