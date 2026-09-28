import * as THREE from "three";
import { angleDelta, damp, smoothDampVec3 } from "../util/MathX";
import { Input } from "../player/Input";
import type { PlayerController } from "../player/PlayerController";

const CAM = {
  baseFov: 55,
  sprintFovKick: 6,
  launchFovKick: 12, // wind-rush widen while riding a spring-seed arc
  baseDist: 3.4,
  minDist: 2.2,
  maxDist: 7,
  pitch: 0.42,
  minPitch: 0.14,
  maxPitch: 1.05,
  followLambda: 3.6, // how fast the camera swings behind the ant
  manualYawRate: 2.3, // Q/E orbit speed
  recenterLambda: 2.2, // manual orbit decays once the ant moves
  posSmoothTime: 0.11,
  pivotSmoothTime: 0.17,
  groundMargin: 0.32,
  lookAhead: 0.22,
  lookAheadMax: 0.55,
} as const;

/**
 * Spring-arm follow camera: critically-damped position/pivot smoothing,
 * velocity look-ahead, manual orbit (Q/E + mouse drag) that re-centers when
 * moving, wheel zoom, sprint FOV kick, idle drift, and a terrain clamp so the
 * arm never dips below the ground.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;

  private dist: number = CAM.baseDist;
  private distTarget: number = CAM.baseDist;
  private followYaw = 0;
  private manualYaw = 0;
  private pitch: number = CAM.pitch;
  private fov: number = CAM.baseFov;
  private idleTime = 0;
  private enabled = true;

  private readonly pivot = new THREE.Vector3();
  private readonly pivotVel = new THREE.Vector3();
  private readonly posVel = new THREE.Vector3();
  private readonly lookAheadVel = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredPivot = new THREE.Vector3();
  private readonly drag = new THREE.Vector2();

  constructor(
    private readonly player: PlayerController,
    private readonly input: Input,
    private readonly groundAt: (x: number, z: number) => number,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(CAM.baseFov, aspect, 0.08, 520);
    this.pivot.copy(player.position);
    this.snap();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Teleport-safe: clears spring velocity and recenters instantly. */
  snap(): void {
    this.pivot.copy(this.player.position);
    this.followYaw = this.player.yaw;
    this.manualYaw = 0;
    this.computeDesired(0);
    this.camera.position.copy(this.desiredPos);
    this.camera.lookAt(this.desiredPivot);
    this.pivotVel.set(0, 0, 0);
    this.posVel.set(0, 0, 0);
  }

  /** Current yaw of the camera's forward direction (controller move basis). */
  get yaw(): number {
    return this.followYaw + this.manualYaw;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    // Manual orbit input.
    this.manualYaw += this.input.yawKey * CAM.manualYawRate * dt;
    this.input.consumeDrag(this.drag);
    if (this.input.dragging) {
      this.manualYaw -= this.drag.x * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.drag.y * 0.003, CAM.minPitch, CAM.maxPitch);
    }
    const moving = this.player.planarSpeed > 0.35;
    if (moving && !this.input.dragging) {
      this.manualYaw = damp(this.manualYaw, 0, CAM.recenterLambda, dt);
    }

    // Swing behind the ant while it moves.
    if (moving) {
      this.followYaw += angleDelta(this.followYaw, this.player.yaw) * (1 - Math.exp(-CAM.followLambda * dt));
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
    }

    // Wheel zoom.
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) {
      this.distTarget = THREE.MathUtils.clamp(this.distTarget + wheel * 0.55, CAM.minDist, CAM.maxDist);
    }
    this.dist = damp(this.dist, this.distTarget, 8, dt);

    this.computeDesired(dt);

    smoothDampVec3(this.camera.position, this.desiredPos, this.posVel, CAM.posSmoothTime, dt, this.camera.position);
    smoothDampVec3(this.pivot, this.desiredPivot, this.pivotVel, CAM.pivotSmoothTime, dt, this.pivot);

    // FOV kick while sprinting — and a bigger wind-rush widen on launch arcs.
    const targetFov =
      CAM.baseFov +
      (this.player.planarSpeed > 2.6 ? CAM.sprintFovKick : 0) +
      (this.player.launchAir ? CAM.launchFovKick : 0);
    this.fov = damp(this.fov, targetFov, this.player.launchAir ? 9 : 5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(this.pivot);
  }

  private computeDesired(dt: number): void {
    const yaw = this.followYaw + this.manualYaw + (this.player.planarSpeed <= 0.35 ? Math.sin(this.idleTime * 0.24) * 0.05 : 0);
    // Look-ahead: lean the frame into the ant's velocity.
    const la = Math.min(this.player.planarSpeed * CAM.lookAhead, CAM.lookAheadMax);
    this.lookAheadVel.lerp(this._v1.set(Math.sin(this.player.yaw) * la, 0, Math.cos(this.player.yaw) * la), dt > 0 ? 1 - Math.exp(-6 * dt) : 1);

    this.desiredPivot.set(
      this.player.position.x + this.lookAheadVel.x,
      this.player.position.y + 0.28,
      this.player.position.z + this.lookAheadVel.z,
    );
    this.desiredPivot.y = Math.max(this.desiredPivot.y, this.groundAt(this.desiredPivot.x, this.desiredPivot.z) + 0.18);

    const cosP = Math.cos(this.pitch);
    this.desiredPos.set(
      this.desiredPivot.x - Math.sin(yaw) * cosP * this.dist,
      this.desiredPivot.y + Math.sin(this.pitch) * this.dist,
      this.desiredPivot.z - Math.cos(yaw) * cosP * this.dist,
    );
    // Never dip below the terrain (checked at the arm end and mid-arm).
    const groundCam = this.groundAt(this.desiredPos.x, this.desiredPos.z) + CAM.groundMargin;
    if (this.desiredPos.y < groundCam) this.desiredPos.y = groundCam;
    const midX = (this.desiredPos.x + this.desiredPivot.x) / 2;
    const midZ = (this.desiredPos.z + this.desiredPivot.z) / 2;
    const groundMid = this.groundAt(midX, midZ) + CAM.groundMargin * 0.6;
    if (this.desiredPos.y < groundMid) this.desiredPos.y = groundMid;
  }

  private readonly _v1 = new THREE.Vector3();
}
