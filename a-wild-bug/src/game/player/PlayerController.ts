import * as THREE from "three";
import { angleDelta, damp } from "../util/MathX";
import { Input } from "./Input";
import type { Meadow } from "../world/Meadow";

export const PLAYER_TUNING = {
  walkSpeed: 1.55,
  runSpeed: 3.4,
  /** Reach run top speed in ~0.25 s. */
  accel: 14,
  decel: 20,
  airAccel: 4.2,
  gravity: 26,
  /** Reduced gravity near the apex for hang time. */
  apexGravityScale: 0.55,
  apexThreshold: 1.1,
  jumpVel: 4.9,
  /** Early release cuts upward velocity — variable jump height. */
  jumpCutScale: 0.45,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
  maxTurnRate: 10.5,
  /** How far below the feet the controller sticks to ground while walking down. */
  snapDown: 0.3,
} as const;

/**
 * Kinematic third-person controller. No physics engine: heightfield sampling
 * via Meadow.heightAt, acceleration curves, coyote/buffered jumps, slope-aware
 * speed. All simulation happens in fixed steps.
 */
export class PlayerController {
  readonly position = new THREE.Vector3(0, 0, 0);
  /** xz = planar velocity, y = vertical velocity. */
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  groundY = 0;
  /**
   * True while riding a spring-seed launch arc: gravity runs at full strength
   * (no apex hang) so the seed's ballistic solve lands exactly on its target,
   * and the follow camera widens its FOV for the wind-rush read.
   */
  launchAir = false;

  /**
   * Total jumps + seed launches since construction (monotonic; the teaching
   * hints observe the delta to dismiss "on the verb's first successful use").
   */
  jumps = 0;

  /** Diagnostics/state consumed by the ant visuals and camera. */
  planarSpeed = 0;
  forwardAccel = 0;
  turnRate = 0;
  private turnRateSmoothed = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private jumpCutArmed = false;
  private prevPlanarSpeed = 0;

  private readonly slope = new THREE.Vector2();
  private readonly wish = new THREE.Vector3();

  constructor(
    private readonly meadow: Meadow,
    private readonly input: Input,
  ) {
    this.groundY = meadow.heightAt(0, 0);
    this.position.y = this.groundY;
  }

  update(dt: number, camYaw: number): void {
    // Camera-relative movement basis (yaw 0 faces +Z). Right is forward × up:
    // (cos yaw, -sin yaw) is screen-LEFT, so the strafe basis is negated —
    // pressing D must steer toward screen-right, not world +X.
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    const rx = -fz;
    const rz = fx;
    const intent = this.input.move;

    this.wish.set(fx * intent.y + rx * intent.x, 0, fz * intent.y + rz * intent.x);
    const wishLen = Math.min(this.wish.length(), 1);
    if (wishLen > 0.001) this.wish.multiplyScalar(1 / wishLen);

    // Slope-aware target speed: slower uphill, slightly faster downhill.
    let targetSpeed = (this.input.sprint ? PLAYER_TUNING.runSpeed : PLAYER_TUNING.walkSpeed) * wishLen;
    if (wishLen > 0.001) {
      this.meadow.slopeAt(this.position.x, this.position.z, this.slope);
      const slopeAlong = this.wish.x * this.slope.x + this.wish.z * this.slope.y;
      targetSpeed *= THREE.MathUtils.clamp(1 - slopeAlong * 0.55, 0.55, 1.3);
    }

    // Horizontal acceleration / deceleration.
    const accel = this.grounded ? (wishLen > 0.001 ? PLAYER_TUNING.accel : PLAYER_TUNING.decel) : PLAYER_TUNING.airAccel;
    if (wishLen > 0.001) {
      this.velocity.x += this.wish.x * accel * dt;
      this.velocity.z += this.wish.z * accel * dt;
      const len = Math.hypot(this.velocity.x, this.velocity.z);
      if (len > targetSpeed) {
        // Never accelerate past the (slope-aware) target, but allow carrying
        // momentum downhill rather than hard-clamping.
        const capped = Math.max(targetSpeed, len - PLAYER_TUNING.decel * dt * (this.grounded ? 1 : 0.2));
        const k = capped / len;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
    } else if (this.grounded) {
      const len = Math.hypot(this.velocity.x, this.velocity.z);
      const newLen = Math.max(0, len - PLAYER_TUNING.decel * dt);
      if (len > 1e-6) {
        this.velocity.x *= newLen / len;
        this.velocity.z *= newLen / len;
      }
    }

    // Jump: buffering + coyote time.
    if (this.input.consumeJump()) this.jumpBuffer = PLAYER_TUNING.jumpBufferTime;
    else this.jumpBuffer -= dt;
    this.coyote = this.grounded ? PLAYER_TUNING.coyoteTime : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = PLAYER_TUNING.jumpVel;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpCutArmed = true;
      this.jumps++;
    }
    // Variable jump height: early release cuts the rise.
    if (this.jumpCutArmed && !this.input.jumpHeld && this.velocity.y > 0) {
      this.velocity.y *= PLAYER_TUNING.jumpCutScale;
      this.jumpCutArmed = false;
    }

    // Gravity with apex hang (skipped on launch arcs so the seed's solve holds).
    const g =
      PLAYER_TUNING.gravity *
      (!this.grounded && !this.launchAir && Math.abs(this.velocity.y) < PLAYER_TUNING.apexThreshold
        ? PLAYER_TUNING.apexGravityScale
        : 1);

    // Integrate.
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;
    this.velocity.y -= g * dt;

    // Ground snap / landing against the walkable heightfield.
    const gy = this.meadow.heightAt(this.position.x, this.position.z);
    if (this.position.y <= gy) {
      this.position.y = gy;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
      this.launchAir = false; // launch arc complete
    } else if (this.grounded && this.velocity.y <= 0 && this.position.y - gy <= PLAYER_TUNING.snapDown) {
      this.position.y = gy; // stick while walking down slopes / small bumps
    } else {
      this.grounded = false;
    }
    this.groundY = gy;

    // Facing: turn toward the movement direction at a capped rate.
    this.planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let turn = 0;
    if (this.planarSpeed > 0.22) {
      const desired = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = angleDelta(this.yaw, desired);
      const step = THREE.MathUtils.clamp(delta, -PLAYER_TUNING.maxTurnRate * dt, PLAYER_TUNING.maxTurnRate * dt);
      this.yaw += step;
      turn = step / dt;
    }
    this.turnRate = turn;
    this.turnRateSmoothed = damp(this.turnRateSmoothed, turn, 9, dt);

    // Signed acceleration along the facing direction (for body pitch).
    const accelNow = (this.planarSpeed - this.prevPlanarSpeed) / dt;
    const movingForward =
      this.planarSpeed > 0.05 &&
      this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw) > 0;
    this.forwardAccel = damp(this.forwardAccel, movingForward ? accelNow : -accelNow, 8, dt);
    this.prevPlanarSpeed = this.planarSpeed;
  }

  get smoothedTurnRate(): number {
    return this.turnRateSmoothed;
  }

  teleport(x: number, z: number, yaw: number): void {
    this.position.set(x, this.meadow.heightAt(x, z), z);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.planarSpeed = 0;
    this.forwardAccel = 0;
    this.turnRate = 0;
    this.turnRateSmoothed = 0;
    this.grounded = true;
    this.launchAir = false;
    this.groundY = this.position.y;
  }

  /**
   * Launch impulse (spring-seed catapult): replaces velocity outright; the
   * caller has already solved the arc against PLAYER_TUNING.gravity.
   */
  launch(vx: number, vy: number, vz: number): void {
    this.velocity.set(vx, vy, vz);
    this.grounded = false;
    this.jumpCutArmed = false;
    this.launchAir = true;
    this.jumps++; // a seed launch is the verb the jump hint teaches, too
  }

  /** Shot setup: freeze the controller into a believable mid-action pose. */
  pin(yaw: number, speed: number, forwardAccel: number): void {
    this.yaw = yaw;
    this.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    this.planarSpeed = speed;
    this.forwardAccel = forwardAccel;
    this.turnRate = 0;
    this.turnRateSmoothed = 0;
    this.grounded = true;
  }
}
