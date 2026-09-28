import * as THREE from "three";
import { clamp, damp } from "../util/MathX";

/**
 * The hero grain — the single seed the ant plucks, holds over its head in its
 * mandibles, throws ballistically, or plunks into the anthill. One mesh, five
 * modes. Held mode adds gait-driven bob + acceleration lag so the carry reads
 * as physically held, not glued. Flight is simple ballistic integration vs
 * the walkable heightfield with a restitution bounce, ground roll, and tumble.
 */

export type CarryMode = "hidden" | "collect" | "held" | "flight" | "deposit";

export const THROW_TUNING = {
  speed: 5.0,
  /** Launch angle above horizontal (degrees). */
  angleDeg: 35,
  gravity: 11,
  restitution: 0.32,
  /** Horizontal velocity kept on each bounce. */
  bounceFriction: 0.65,
  /** Ground-roll deceleration (u/s²). */
  rollFriction: 4.4,
  settleSpeed: 0.34,
  collectTime: 0.26,
  depositTime: 0.55,
} as const;

export interface CarryContext {
  anchorPos: THREE.Vector3;
  anchorQuat: THREE.Quaternion;
  /** Aim direction for throws (camera yaw). */
  throwYaw: number;
  /** Carry-bob drivers. */
  gaitPhase: number;
  antTime: number;
  speedFactor: number;
  forwardAccel: number;
}

export class CarriedGrain {
  readonly mesh: THREE.Mesh;
  mode: CarryMode = "hidden";

  private readonly groundAt: (x: number, z: number) => number;
  private readonly velocity = new THREE.Vector3();
  private readonly spin = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly control = new THREE.Vector3();
  private t = 0;
  private grounded = false;
  private bounces = 0;
  private scale = 1;
  private throwIndex = 0;
  private flightTime = 0;

  // Smoothed lag state (held mode).
  private lagX = 0;
  private lagZ = 0;

  onSettle: ((pos: THREE.Vector3, quat: THREE.Quaternion, scale: number) => void) | null = null;
  onBounce: ((pos: THREE.Vector3, speed: number) => void) | null = null;

  private readonly _q = new THREE.Quaternion();
  private readonly _qs = new THREE.Quaternion();
  private readonly _axis = new THREE.Vector3();
  private readonly _euler = new THREE.Euler();

  constructor(grainGeo: THREE.BufferGeometry, grainMat: THREE.Material, groundAt: (x: number, z: number) => number) {
    this.groundAt = groundAt;
    this.mesh = new THREE.Mesh(grainGeo, grainMat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.scale = 1;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  /** From a harvested node/loose seed: grain flies to the anchor. */
  startCollect(from: THREE.Vector3, scale = 1): void {
    this.mode = "collect";
    this.from.copy(from);
    this.t = 0;
    this.scale = scale;
    this.mesh.visible = true;
  }

  /** Held over the head (snap — no collect animation). */
  snapHeld(): void {
    this.mode = "held";
    this.mesh.visible = true;
    this.lagX = 0;
    this.lagZ = 0;
  }

  /** Ballistic launch toward `yaw` (camera aim). Deterministic tumble. */
  throw_(yaw: number): void {
    const a = (THROW_TUNING.angleDeg * Math.PI) / 180;
    this.mode = "flight";
    this.velocity.set(Math.sin(yaw) * Math.cos(a) * THROW_TUNING.speed, Math.sin(a) * THROW_TUNING.speed, Math.cos(yaw) * Math.cos(a) * THROW_TUNING.speed);
    const h = hash2(this.throwIndex++ * 2654435761, 91);
    this.spin.set((h - 0.5) * 4, ((h * 7.3) % 1 - 0.5) * 6, 7 + ((h * 3.1) % 1) * 4);
    this.grounded = false;
    this.bounces = 0;
    this.flightTime = 0;
    this.mesh.visible = true;
  }

  /**
   * The grain ricochets off the grasshopper's carapace (a hit stun): keeps the
   * ballistic flow so it settles as a normal loose seed nearby.
   */
  deflect(nx: number, nz: number): void {
    if (this.mode !== "flight") return;
    const sp = Math.max(1.4, Math.hypot(this.velocity.x, this.velocity.z) * 0.32);
    this.velocity.set(nx * sp, 1.7, nz * sp);
    this.grounded = false;
    this.bounces = Math.min(this.bounces + 1, 3);
  }

  /** Plunk arc from the ant's head into the deposit hole. */
  startDeposit(holePos: THREE.Vector3, fromPos: THREE.Vector3): void {
    this.mode = "deposit";
    this.from.copy(fromPos);
    this.to.copy(holePos).addScaledVector(UP, 0.05);
    this.control.copy(fromPos).add(holePos).multiplyScalar(0.5).addScaledVector(UP, 0.42);
    this.t = 0;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mode = "hidden";
    this.mesh.visible = false;
  }

  /** Staged shot support: freeze mid-deposit at fraction `f`. */
  stageDeposit(holePos: THREE.Vector3, fromPos: THREE.Vector3, f: number): void {
    this.startDeposit(holePos, fromPos);
    this.t = f;
    this.applyDepositPose();
  }

  update(dt: number, ctx: CarryContext): void {
    switch (this.mode) {
      case "held":
        this.updateHeld(dt, ctx);
        break;
      case "collect":
        this.t = Math.min(1, this.t + dt / THROW_TUNING.collectTime);
        if (this.t >= 1) {
          this.mode = "held";
          this.updateHeld(dt, ctx);
          break;
        }
        this.mesh.position.lerpVectors(this.from, ctx.anchorPos, this.t * this.t * (3 - 2 * this.t));
        this.mesh.position.y += Math.sin(this.t * Math.PI) * 0.22;
        this.mesh.quaternion.copy(ctx.anchorQuat).multiply(CollectTilt);
        this.mesh.scale.setScalar(this.scale * (0.4 + 0.6 * this.t));
        break;
      case "flight":
        this.updateFlight(dt);
        break;
      case "deposit":
        this.t = Math.min(1, this.t + dt / THROW_TUNING.depositTime);
        this.applyDepositPose();
        if (this.t >= 1) this.hide();
        break;
      case "hidden":
        break;
    }
  }

  private applyDepositPose(): void {
    const t = this.t;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    this.mesh.position.set(
      this.from.x * a + this.control.x * b + this.to.x * c,
      this.from.y * a + this.control.y * b + this.to.y * c,
      this.from.z * a + this.control.z * b + this.to.z * c,
    );
    this._q.setFromAxisAngle(RIGHT, -0.9 - t * 1.6);
    this.mesh.quaternion.copy(this._q);
    this.mesh.scale.setScalar(this.scale);
  }

  private updateHeld(dt: number, ctx: CarryContext): void {
    // Pixar carry: the grain rides above the head with a small lag opposite
    // to acceleration and a gentle two-frequency bob keyed to the gait.
    const targetX = clamp(-ctx.forwardAccel * 0.02, -0.03, 0.035);
    const targetZ = Math.sin(ctx.antTime * 1.3) * 0.018;
    this.lagX = damp(this.lagX, targetX, 9, dt);
    this.lagZ = damp(this.lagZ, targetZ, 7, dt);
    const bob = Math.sin(ctx.gaitPhase * Math.PI * 4) * 0.006 * ctx.speedFactor + Math.sin(ctx.antTime * 2.2) * 0.0022;

    this.mesh.position.copy(ctx.anchorPos);
    this.mesh.position.y += bob - Math.abs(this.lagX) * 0.3;
    this.mesh.quaternion.copy(ctx.anchorQuat).multiply(HeldTilt);
    this.mesh.quaternion.multiply(this._qs.setFromEuler(this._euler.set(this.lagX, 0, this.lagZ)));
    this.mesh.scale.setScalar(this.scale);
  }

  private updateFlight(dt: number): void {
    this.flightTime += dt;
    this.velocity.y -= THROW_TUNING.gravity * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);

    const gy = this.groundAt(this.mesh.position.x, this.mesh.position.z) + 0.018;
    if (this.mesh.position.y <= gy) {
      this.mesh.position.y = gy;
      const impact = -this.velocity.y;
      if (impact > 0.7 && this.bounces < 4) {
        // Bounce with restitution + horizontal scrub, keep tumbling.
        this.velocity.y = impact * THROW_TUNING.restitution;
        this.velocity.x *= THROW_TUNING.bounceFriction;
        this.velocity.z *= THROW_TUNING.bounceFriction;
        this.bounces++;
        this.onBounce?.(this.mesh.position, impact);
      } else {
        // Grounded: roll/slide with terrain friction until settling.
        this.grounded = true;
        this.velocity.y = 0;
        const dampF = Math.max(0, 1 - THROW_TUNING.rollFriction * dt);
        this.velocity.x *= dampF;
        this.velocity.z *= dampF;
      }
    } else if (this.grounded && this.mesh.position.y > gy + 0.015) {
      this.grounded = false; // rolled off an edge
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);

    // Tumble: roll axis perpendicular to travel when rolling, free spin airborne.
    if (this.grounded && speed > 0.01) {
      this._axis.set(-this.velocity.z, 0, this.velocity.x).normalize();
      this._q.setFromAxisAngle(this._axis, (speed / 0.05) * dt);
      this.mesh.quaternion.premultiply(this._q);
    } else {
      this._q.setFromEuler(this._euler.set(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt));
      this.mesh.quaternion.multiply(this._q);
    }

    // Settle: at rest on the ground — or force-settled after a long skip down
    // micro-slopes (the meadow's gentle undulation can keep a slow grain
    // hop-skipping indefinitely; the snap reads as the seed bedding in).
    if (
      (this.grounded && speed < THROW_TUNING.settleSpeed && this.velocity.y <= 0.01) ||
      this.flightTime > 3
    ) {
      this.mesh.position.y = this.groundAt(this.mesh.position.x, this.mesh.position.z) + 0.018;
      const q = new THREE.Quaternion().copy(this.mesh.quaternion);
      this.onSettle?.(this.mesh.position.clone(), q, this.scale);
      this.hide();
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
/** Held pose: grain upright (tip up) with a slight back-lean in the anchor frame. */
const HeldTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.32, 0, 0.05));
const CollectTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
