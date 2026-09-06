import * as THREE from 'three';
import { heightAt } from '../world/terrain';

const HEAD_HEIGHT = 1.4;
const BASE_DISTANCE = 4.6;
const BASE_FOV = 60;
const PITCH_MIN = -0.15 * Math.PI;
const PITCH_MAX = 0.45 * Math.PI;

/**
 * Pointer-driven third-person orbit camera. Smoothing is exp-decay based
 * (`1 - exp(-k·dt)`), so behavior is framerate independent.
 */
export class ChaseCamera {
  distance = BASE_DISTANCE;
  yaw = 0;
  pitch = 0.2;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly desired = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  /** FOV kick state — remaining degrees + time to recover. */
  private fovKickDeg = 0;
  private fovRecoverMsLeft = 0;
  private fovRecoverTotalMs = 1;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(
    dtSec: number,
    targetPos: { x: number; y: number; z: number },
    targetHeading: number,
    lookDX: number,
    lookDY: number,
  ): void {
    this.yaw -= lookDX * 0.0022;
    this.pitch += lookDY * 0.0022;
    if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
    else if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;

    // Spherical offset around the target head point.
    const headY = targetPos.y + HEAD_HEIGHT;
    const cosPitch = Math.cos(this.pitch);
    this.offset.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    ).multiplyScalar(this.distance);

    this.desired.set(
      targetPos.x + this.offset.x,
      headY + this.offset.y,
      targetPos.z + this.offset.z,
    );

    // Framerate-independent follow: fraction of remaining gap closed per
    // frame is `1 - exp(-12·dt)`.
    const k = 1 - Math.exp(-12 * dtSec);
    this.camera.position.lerp(this.desired, k);

    // Post-lerp clearance: smoothing overshoot can leave the real camera
    // below the floor even when `desired` was clamped, so re-clamp here
    // against the camera's FINAL x/z.
    const minY = heightAt(this.camera.position.x, this.camera.position.z) + 0.4;
    if (this.camera.position.y < minY) this.camera.position.y = minY;

    // FOV kick recovery — linear decay back to BASE_FOV.
    if (this.fovRecoverMsLeft > 0) {
      const dtMs = dtSec * 1000;
      const prev = this.fovRecoverMsLeft;
      this.fovRecoverMsLeft = Math.max(0, this.fovRecoverMsLeft - dtMs);
      const t = 1 - this.fovRecoverMsLeft / prev; // 0→1 over recovery
      this.camera.fov = BASE_FOV + this.fovKickDeg * (1 - t);
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(targetPos.x, headY, targetPos.z + Math.sin(targetHeading));
  }

  /** Kick the FOV by `deg` degrees, recovering linearly over `recoverMs`. */
  kickFov(deg: number, recoverMs: number): void {
    this.fovKickDeg = deg;
    this.fovRecoverMsLeft = recoverMs;
    this.fovRecoverTotalMs = recoverMs;
    this.camera.fov = BASE_FOV + deg;
    this.camera.updateProjectionMatrix();
  }
}
