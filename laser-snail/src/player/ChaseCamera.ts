import * as THREE from 'three';

/**
 * Chase camera: damped lerp-follow behind and above the snail, banking
 * slightly with steering.
 *
 * Runs at render rate (not fixed-step) with frame-rate-independent
 * exponential damping — the smoothing averages out the 60 Hz simulation
 * stepping instead of duplicating it, which is what keeps the framing free of
 * jitter on high-refresh displays.
 */

export interface ChaseCameraOptions {
  /** Distance behind the snail. Defaults to 9.5. */
  distance?: number;
  /** Height above the snail. Defaults to 4.4. */
  height?: number;
  /** How far ahead of the snail the camera looks, in world units. Defaults to 8. */
  lookAhead?: number;
  /** Height of the look target above the snail. Defaults to 1.6. */
  lookUp?: number;
  /** Position damping (1/s). Higher = tighter follow. Defaults to 5.5. */
  positionDamping?: number;
  /** Look-target damping (1/s). Defaults to 7.5. */
  lookDamping?: number;
  /** Max camera bank at full steering, radians. Defaults to 0.09. */
  maxRoll?: number;
  /** Bank damping (1/s). Defaults to 9. */
  rollDamping?: number;
  /** Fraction of the snail's lateral `x` the camera follows. Defaults to 0.55. */
  lateralFollow?: number;
  /**
   * FOV removed at zero speed relative to cruise (the slow-down "dip").
   * Defaults to 0.16 (≈9° on a 55° camera at full stop).
   */
  fovDip?: number;
  /** FOV damping (1/s). Higher = snappier speed-change kicks. Defaults to 5. */
  fovDamping?: number;
  /** How quickly shake energy decays (1/s). Defaults to 5.5. */
  shakeDecay?: number;
  /** Peak positional shake at full energy, world units. Defaults to 0.4. */
  shakeMax?: number;
}

/** What the camera needs to know about the player this frame. */
export interface ChaseTarget {
  /** Interpolated snail world position. */
  position: THREE.Vector3;
  /** Interpolated snail orientation (tangent frame + bank). */
  quaternion: THREE.Quaternion;
  /** Track-space lateral offset of the snail. */
  x: number;
  /** Smoothed steering in [-1, 1] driving the bank. */
  steering: number;
  /**
   * Current speed relative to cruise speed (speed mods, boosts). 1 = cruise;
   * an asteroid slow-down dips to 0.6. Defaults to 1 when omitted.
   */
  speedRatio?: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);

export class ChaseCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly distance: number;
  private readonly height: number;
  private readonly lookAhead: number;
  private readonly lookUp: number;
  private readonly positionDamping: number;
  private readonly lookDamping: number;
  private readonly maxRoll: number;
  private readonly rollDamping: number;
  private readonly lateralFollow: number;
  private readonly fovDip: number;
  private readonly fovDamping: number;
  private readonly shakeDecay: number;
  private readonly shakeMax: number;
  private readonly baseFov: number;

  // Smoothed camera state (persist between frames — this IS the damping).
  private readonly smoothedPosition = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();
  private smoothedSteering = 0;
  private smoothedSpeedRatio = 1;
  private shakeEnergy = 0;
  private shakeTime = 0;

  // Scratch — update() runs every frame, so nothing allocates here.
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly toLook = new THREE.Vector3();

  public constructor(camera: THREE.PerspectiveCamera, options: ChaseCameraOptions = {}) {
    this.camera = camera;
    this.distance = options.distance ?? 9.5;
    this.height = options.height ?? 4.4;
    this.lookAhead = options.lookAhead ?? 8;
    this.lookUp = options.lookUp ?? 1.6;
    this.positionDamping = options.positionDamping ?? 5.5;
    this.lookDamping = options.lookDamping ?? 7.5;
    this.maxRoll = options.maxRoll ?? 0.09;
    this.rollDamping = options.rollDamping ?? 9;
    this.lateralFollow = options.lateralFollow ?? 0.55;
    this.fovDip = options.fovDip ?? 0.16;
    this.fovDamping = options.fovDamping ?? 5;
    this.shakeDecay = options.shakeDecay ?? 5.5;
    this.shakeMax = options.shakeMax ?? 0.4;
    this.baseFov = camera.fov;
  }

  /**
   * Adds a shake impulse (0..~1.2; "small" hits ~0.45, the smart bomb ~1).
   * Energy decays exponentially; the offset itself is a fast damped wobble so
   * it reads as impact, never as a shaky camera fault.
   */
  public shake(intensity: number): void {
    if (!Number.isFinite(intensity) || intensity <= 0) return;
    this.shakeEnergy = Math.min(1.5, this.shakeEnergy + intensity);
  }

  /** Current un-decayed shake energy (tests). */
  public get shakeLevel(): number {
    return this.shakeEnergy;
  }

  /**
   * Teleports the camera to the correct framing for `target` with zero
   * smoothing — used on level start / restart so the camera never lerps
   * across the map.
   */
  public snap(target: ChaseTarget): void {
    this.computeDesired(target);
    this.smoothedPosition.copy(this.desiredPosition);
    this.smoothedLook.copy(this.desiredLook);
    this.smoothedSteering = 0;
    this.smoothedSpeedRatio = target.speedRatio ?? 1;
    this.shakeEnergy = 0;
    this.applyToCamera();
  }

  /** Advances the camera smoothing by `dt` seconds (real render delta). */
  public update(dt: number, target: ChaseTarget): void {
    if (dt <= 0) return;
    this.computeDesired(target);

    const positionBlend = 1 - Math.exp(-this.positionDamping * dt);
    const lookBlend = 1 - Math.exp(-this.lookDamping * dt);
    this.smoothedPosition.lerp(this.desiredPosition, positionBlend);
    this.smoothedLook.lerp(this.desiredLook, lookBlend);
    this.smoothedSteering += (target.steering - this.smoothedSteering) * (1 - Math.exp(-this.rollDamping * dt));

    // FOV rides the speed ratio: a slow-down visibly narrows the view, a
    // recovery widens it. Damped so the kick eases in over ~200 ms.
    const speedRatio = target.speedRatio ?? 1;
    this.smoothedSpeedRatio += (speedRatio - this.smoothedSpeedRatio) * (1 - Math.exp(-this.fovDamping * dt));

    if (this.shakeEnergy > 0.0001) {
      this.shakeEnergy *= Math.exp(-this.shakeDecay * dt);
      this.shakeTime += dt;
    } else {
      this.shakeEnergy = 0;
    }

    this.applyToCamera();
  }

  private computeDesired(target: ChaseTarget): void {
    this.forward.copy(LOCAL_FORWARD).applyQuaternion(target.quaternion);
    this.right.copy(LOCAL_RIGHT).applyQuaternion(target.quaternion);

    // Park behind and above, partially following the snail's lane so big
    // lateral corrections don't whip the framing around.
    this.desiredPosition.copy(target.position);
    this.desiredPosition.addScaledVector(this.forward, -this.distance);
    this.desiredPosition.addScaledVector(WORLD_UP, this.height);
    this.desiredPosition.addScaledVector(this.right, target.x * this.lateralFollow);

    this.desiredLook.copy(target.position);
    this.desiredLook.addScaledVector(this.forward, this.lookAhead);
    this.desiredLook.addScaledVector(WORLD_UP, this.lookUp);
  }

  private applyToCamera(): void {
    this.camera.position.copy(this.smoothedPosition);

    // Impact wobble: three incommensurate frequencies look random without a
    // noise function, and the exponential energy decay keeps it subtle.
    if (this.shakeEnergy > 0) {
      const amplitude = this.shakeEnergy * this.shakeMax;
      this.camera.position.x += Math.sin(this.shakeTime * 47.0) * amplitude;
      this.camera.position.y += Math.cos(this.shakeTime * 39.0) * amplitude * 0.7;
      this.camera.position.z += Math.sin(this.shakeTime * 31.0 + 1.7) * amplitude;
    }

    // Bank by tilting the camera's up vector around the view direction, then
    // lookAt consumes it — one orientation solve, no Euler fighting. Same
    // sign convention as the snail: steering right leans the view right.
    const roll = -this.smoothedSteering * this.maxRoll;
    this.toLook.subVectors(this.smoothedLook, this.camera.position);
    if (this.toLook.lengthSq() < 1e-10) this.toLook.set(0, 0, -1);
    this.toLook.normalize();
    this.cameraUp.copy(WORLD_UP).applyAxisAngle(this.toLook, roll);
    this.camera.up.copy(this.cameraUp);
    this.camera.lookAt(this.smoothedLook);

    const fov = this.baseFov * (1 - this.fovDip * (1 - this.smoothedSpeedRatio));
    if (Math.abs(fov - this.camera.fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
