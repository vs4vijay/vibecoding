import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import { heightAt } from '../world/terrain';
import type { Rig } from './skeleton';
import type { SpeciesDef } from '../data/species';
import { ClipPlayer } from './clips';

export type Stance = 'standing' | 'running' | 'crouched' | 'airborne';

const GRAVITY = -14;
const JUMP_SPEED = 5.4;
const ACCEL = 40;
const FRICTION = 24;
/** Speed above which stance reads as running (m/s). */
const RUN_STANCE_SPEED = 4;
/** Ground contact slack: within this of terrain height counts as grounded. */
const GROUND_SLACK = 0.02;
/** Finite-difference step for terrain slope sampling (m). */
const SLOPE_DS = 0.35;
/** Heading/pitch/roll smoothing rate (exp-decay constant, 1/s). */
const TURN_RATE = 12;

/**
 * Rabbit/wolf kinematics + display driver. Display and movement only — all
 * combat decisions live in a later resolver that READS the public state
 * fields here (pos, vel, heading, stance, crouchHeldMs, grounded) and drives
 * action clips through `anim`.
 *
 * Movement is camera-relative: pass the chase camera's yaw each update.
 * Zero allocation per step; scratch vectors live on the instance.
 */
export class CharacterController {
  readonly anim: ClipPlayer;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  heading = 0;
  stance: Stance = 'standing';
  crouchHeldMs = 0;
  grounded = true;

  private readonly rig: Rig;
  private readonly def: SpeciesDef;

  private crouching = false;
  /** Currently dominant animation clip ('' before the first update). */
  private locoClip = '';
  private pitchSm = 0;
  private rollSm = 0;
  private dipSm = 0;

  constructor(rig: Rig, def: SpeciesDef, player: ClipPlayer) {
    this.rig = rig;
    this.def = def;
    this.anim = player;
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.rig.root.position.copy(this.pos);
  }

  /**
   * Advance one sim step. `locked` freezes intent (no move/jump/crouch) —
   * physics and animation still settle. `camYaw` is the chase camera's yaw.
   */
  update(dtMs: number, input: InputFrame, locked: boolean, camYaw = 0): void {
    const dt = Math.min(dtMs, 50) / 1000; // clamp tab-away spikes

    // --- intent ------------------------------------------------------------
    const heldCrouch = !locked && input.held.crouch;
    if (heldCrouch) this.crouchHeldMs += dtMs;
    else this.crouchHeldMs = 0;
    this.crouching = heldCrouch;

    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    // Camera-right in the ground plane.
    const rx = -fz;
    const rz = fx;

    let wishX = 0;
    let wishZ = 0;
    if (!locked && (input.moveX !== 0 || input.moveZ !== 0)) {
      // moveZ = -1 means forward (away from camera).
      wishX = fx * -input.moveZ + rx * input.moveX;
      wishZ = fz * -input.moveZ + rz * input.moveX;
    }

    const speedCap = this.crouching ? this.def.crouchSpeed : this.def.runSpeed;

    // --- horizontal velocity ----------------------------------------------
    const wishing = wishX !== 0 || wishZ !== 0;
    const rate = (wishing ? ACCEL : FRICTION) * dt;
    const tx = wishing ? wishX * speedCap : 0;
    const tz = wishing ? wishZ * speedCap : 0;
    this.vel.x = approach(this.vel.x, tx, rate);
    this.vel.z = approach(this.vel.z, tz, rate);

    // --- vertical -----------------------------------------------------------
    if (!locked && this.grounded && input.pressed.jump) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.vel.y += GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const gy = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > gy + GROUND_SLACK) {
      this.grounded = false;
    }

    // --- derived state ------------------------------------------------------
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.stance =
      !this.grounded ? 'airborne'
      : hSpeed > RUN_STANCE_SPEED ? 'running'
      : this.crouching ? 'crouched'
      : 'standing';

    // Face velocity when it is meaningful.
    if (hSpeed > 0.5) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      this.heading = angleLerp(this.heading, target, 1 - Math.exp(-TURN_RATE * dt));
    }

    // Terrain-slope alignment: pitch from grade along facing, roll across.
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    // right = facing rotated −90° about Y: (−fdz, fdx) = (ch, −sh)
    const fdx = -sh;
    const fdz = -ch;
    const rdx = ch;
    const rdz = -sh;
    const px = this.pos.x;
    const pz = this.pos.z;
    const gradF =
      (heightAt(px + fdx * SLOPE_DS, pz + fdz * SLOPE_DS) -
        heightAt(px - fdx * SLOPE_DS, pz - fdz * SLOPE_DS)) / (2 * SLOPE_DS);
    const gradR =
      (heightAt(px + rdx * SLOPE_DS, pz + rdz * SLOPE_DS) -
        heightAt(px - rdx * SLOPE_DS, pz - rdz * SLOPE_DS)) / (2 * SLOPE_DS);
    const k = 1 - Math.exp(-TURN_RATE * dt);
    const targetPitch = this.grounded ? Math.atan(gradF) : 0;
    const targetRoll = this.grounded ? Math.atan(gradR) : 0;
    this.pitchSm += (targetPitch - this.pitchSm) * k;
    this.rollSm += (targetRoll - this.rollSm) * k;

    // --- clip selection -----------------------------------------------------
    this.selectClip(hSpeed);

    // --- write display -------------------------------------------------------
    this.anim.update(dtMs);
    this.anim.applyTo(this.rig);
    // Crouch lowers the whole body toward the ground (clips keep the pose).
    const dipTarget = this.crouching && this.grounded
      ? this.def.hipHeight * 0.55
      : 0;
    const kd = 1 - Math.exp(-10 * dt);
    this.dipSm += (dipTarget - this.dipSm) * kd;
    this.rig.root.position.set(this.pos.x, this.pos.y - this.dipSm, this.pos.z);
    this.rig.root.rotation.set(this.pitchSm, this.heading, this.rollSm);
  }

  /**
   * Locomotion picks its clip every step, but only issues play() when the
   * wanted clip differs from what is on stage. Airborne demand interrupts
   * anything (one-shots included); grounded demand waits for a running
   * one-shot (jump landing, roll, hurt) to finish.
   */
  private selectClip(hSpeed: number): void {
    let want: string;
    if (!this.grounded) {
      want = this.vel.y > 0.6 ? 'jump' : 'fall';
    } else if (this.stance === 'running') {
      want = 'run';
    } else if (this.crouching && hSpeed > 0.2) {
      want = 'crouchWalk';
    } else {
      want = 'idle';
    }
    if (want === this.locoClip) return;

    const current = this.anim.current;
    const busyOneShot = current !== '' && current !== this.locoClip && !this.anim.finished;
    const interruptible = !busyOneShot || !this.grounded;
    if (!interruptible) return;

    // Jump replays from its launch pose each hop; loops just take over.
    this.anim.play(want, this.grounded ? this.anim.fadeMs : 60);
    this.locoClip = want;
  }
}

/** Move `v` toward `target` by at most `maxDelta`. */
function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}

/** Shortest-arc angle interpolation: a→b by fraction t∈[0..1]. */
function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

