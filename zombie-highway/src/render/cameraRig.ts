import * as THREE from "three";
import { CONFIG } from "../config";

const C = CONFIG.camera;

/**
 * Chase camera: smoothed follow with a speed-driven fov kick and decaying shake.
 *
 * Direction note: the streaming invariant pinned by tests/worldStream.test.ts
 * makes +z the direction of travel, so the brief's offset/lookAt z values are
 * mirrored here to keep the rig behind the car, looking forward along travel.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private shakeAmp = 0;
  private tmp = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    // Start settled at the car so the first frames don't swoop in from origin;
    // same mirrored-z convention as follow() (behind the car, looking forward).
    this.camera.position.set(0, C.offset.y, -C.offset.z);
    this.camera.lookAt(C.lookAt.x, C.lookAt.y, -C.lookAt.z);
  }

  /** Position offset lerp + fov = base->boost by speed01. */
  follow(carX: number, carZ: number, speed01: number, dt: number): void {
    const target = this.tmp.set(
      carX * C.offset.x,
      C.offset.y,
      carZ - C.offset.z,
    );
    const k = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(target, k);
    this.camera.lookAt(carX * C.lookAt.x, C.lookAt.y, carZ - C.lookAt.z);
    const fov = THREE.MathUtils.lerp(C.fovBase, C.fovBoost, THREE.MathUtils.clamp(speed01, 0, 1));
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Kick exponential-decay shake; applied as a random offset each frame. */
  shake(intensity: number): void {
    if (intensity > this.shakeAmp) this.shakeAmp = intensity;
  }

  /** Advance shake decay and apply the random offset; call once per frame after follow. */
  tick(dt: number): void {
    this.shakeAmp *= Math.exp(-dt * 4);
    if (this.shakeAmp < 1e-4) {
      this.shakeAmp = 0;
      return;
    }
    this.camera.position.x += (Math.random() * 2 - 1) * this.shakeAmp;
    this.camera.position.y += (Math.random() * 2 - 1) * this.shakeAmp;
  }
}
