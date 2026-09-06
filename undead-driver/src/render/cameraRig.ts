import * as THREE from "three";
import { CONFIG } from "../config";

const C = CONFIG.camera;
/** Death-cam pull duration; matches the session's 0.35x slow-mo window. */
const DEATH_PULL_S = 1.4;

/**
 * Chase camera: smoothed follow with a speed-driven fov kick, decaying shake,
 * and the end-of-run death pull (up + back off the wreck).
 *
 * Direction note: the streaming invariant pinned by tests/worldStream.test.ts
 * makes +z the direction of travel, so the brief's offset/lookAt z values are
 * mirrored here to keep the rig behind the car, looking forward along travel.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private shakeAmp = 0;
  private tmp = new THREE.Vector3();
  /** Death cam: >0 while the rig is lerping up/back away from the wreck. */
  private deathPull = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.resetDeathCam();
  }

  /**
   * Position offset lerp + fov = base->boost by speed01. While the death cam
   * is active the offset target itself pulls up and back toward
   * (carX * 0.55, 8, carZ - 16) — mirrored z like every other offset here.
   */
  follow(carX: number, carZ: number, speed01: number, dt: number): void {
    const pull = this.deathPull;
    const target = this.tmp.set(
      carX * C.offset.x,
      C.offset.y + 3.8 * pull,
      carZ - C.offset.z - 7 * pull,
    );
    const k = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(target, k);
    this.camera.lookAt(carX * C.lookAt.x, C.lookAt.y + 1.5 * pull, carZ - C.lookAt.z);
    const fov = THREE.MathUtils.lerp(C.fovBase, C.fovBoost, THREE.MathUtils.clamp(speed01, 0, 1));
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Kick exponential-decay shake; applied as a random offset each frame in
   * tick(), which also advances the death-cam pull over ~1.4 s of wall time
   * while the session runs its 0.35x corpse tumble.
   */
  shake(intensity: number): void {
    if (intensity > this.shakeAmp) this.shakeAmp = intensity;
  }

  tick(dt: number): void {
    // Advance only while armed (deathPull > 0 sentinel from armDeathCam);
    // an unarmed rig must stay at 0 or the death cam would engage every run.
    if (this.deathPull > 0 && this.deathPull < 1) {
      this.deathPull = Math.min(1, this.deathPull + dt / DEATH_PULL_S);
    }
    this.shakeAmp *= Math.exp(-dt * 4);
    if (this.shakeAmp < 1e-4) {
      this.shakeAmp = 0;
      return;
    }
    this.camera.position.x += (Math.random() * 2 - 1) * this.shakeAmp;
    this.camera.position.y += (Math.random() * 2 - 1) * this.shakeAmp;
  }

  /** Arms the death-cam pull (starts it advancing in tick()); call on game
   * over. resetDeathCam() clears it when the next run starts. */
  armDeathCam(): void {
    if (this.deathPull === 0) this.deathPull = 1e-6;
  }

  /** Clears the death-cam pull and snaps the camera to the run-start chase
   * pose (car spawns at z=0). Called when a new run starts — without the snap
   * the rig would swoop in from the previous run's death position, flying
   * over/past the freshly respawned car for ~1 s. */
  resetDeathCam(): void {
    this.deathPull = 0;
    this.camera.position.set(0, C.offset.y, -C.offset.z);
    this.camera.lookAt(C.lookAt.x, C.lookAt.y, -C.lookAt.z);
  }
}
