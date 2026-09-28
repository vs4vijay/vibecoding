import * as THREE from "three";
import { clamp, damp, dampAngle } from "../util/MathX";
import { mulberry32, rangeRng, type Rng } from "../util/Rng";
import type { SfxName } from "../audio/Audio";
import type { Meadow } from "../world/Meadow";
import type { PlayerController } from "../player/PlayerController";
import type { Ant } from "../player/Ant";
import type { ForageLoop } from "../gameplay/ForageLoop";
import type { GrainField } from "../gameplay/GrainField";
import type { CarriedGrain } from "../gameplay/CarriedGrain";
import type { Puffs } from "../gameplay/Puffs";
import { Grasshopper, type HopperPoseInput } from "./Grasshopper";

/**
 * The patrol grasshopper's brain. A fixed-step state machine:
 *
 *   PATROL  — seeded waypoint loop around the mid-field clusters (occasional
 *             hops), never nearer than ~4.2 u to the anthill (home advantage).
 *   SPOT    — vision cone + distance suspicion; at threshold: a brief reared
 *             telegraph before the chase.
 *   CHASE   — faster than the ant's sprint, hops to cut corners; loses the ant
 *             by distance/time out of the cone, or when it takes the high
 *             route (the apple top is unreachable) → SEARCH at last-seen.
 *   SNATCH  — in reach: steals the CARRIED grain (or scoops a loose one),
 *             knocks the ant back, then RETREATs to a perch and EATs the grain
 *             (gone for the day), with an 8 s no-re-aggro grace.
 *   STUNNED — hit by a thrown grain: dizzy wobble with circling stars, drops
 *             any carried grain where it stands (the recover moment).
 *
 * All randomness flows through a seeded mulberry32 stream re-created in
 * startDay(), so the same day is reproducible and Enter-restart resets it.
 */

export type HopperState = "patrol" | "spot" | "chase" | "search" | "snatch" | "retreat" | "eat" | "stunned";

export const HOPPER_TUNING = {
  walkSpeed: 1.0,
  chaseSpeed: 3.9, // 1.15× the ant's sprint — barely outrunnable
  retreatSpeed: 2.9,
  gravity: 26, // matches the controller
  hopWindup: 0.14,
  hopLandTime: 0.16,
  hopChaseVh: 3.6,
  hopChaseVy: 4.4,
  hopPatrolVh: 2.0,
  hopPatrolVy: 3.9,
  patrolHopInterval: [4.5, 9] as [number, number],
  chaseHopGap: 1.3,
  visionRange: 3.6,
  /** cos of the half-angle of the vision cone (~66°). */
  visionCos: Math.cos(1.15),
  suspicionRate: 2.3,
  suspicionDecay: 0.85,
  spotTime: 0.55,
  loseDist: 5.8,
  loseTime: 1.9,
  coneLoseTime: 1.25,
  searchTime: 2.1,
  chaseFrustration: 2.8,
  snatchRange: 0.5,
  looseSnatchRange: 0.42,
  snatchRearTime: 0.55,
  eatTime: 2.4,
  stunTime: 4.6,
  graceTime: 8,
  hitRadius: 0.42,
  hitHeightMax: 0.62,
  /** Minimum patrol radius around the anthill (the home-field advantage). */
  routeMinRadius: 4.3,
  routeMaxRadius: 8.6,
} as const;

const DUST = {
  count: 12,
  colorA: 0xc7a878,
  colorB: 0x8a6c48,
  speed: [0.3, 0.8] as [number, number],
  up: 0.6,
  gravity: 2.4,
  drag: 2.2,
  life: [0.28, 0.45] as [number, number],
  size: [0.014, 0.034] as [number, number],
};

const CHAFF = {
  count: 12,
  colorA: 0xffdf8e,
  colorB: 0xc98d3a,
  speed: [0.35, 0.9] as [number, number],
  up: 0.9,
  gravity: 2.6,
  drag: 1.6,
  life: [0.32, 0.5] as [number, number],
  size: [0.012, 0.03] as [number, number],
};

export interface HopperContext {
  meadow: Meadow;
  controller: PlayerController;
  ant: Ant;
  loop: ForageLoop;
  grains: GrainField;
  carried: CarriedGrain;
  puffs: Puffs;
  /**
   * Audio bridge (design D4): fired from the LIVE snatch site only —
   * stage() never calls it, and Game's bridge drops it while pinned.
   */
  onSfx?: (name: SfxName) => void;
}

export interface ThreatCue {
  intensity: number;
  /** Screen-space direction to the threat (radians; 0 = right, CCW). */
  angle: number;
}

export class Hopper {
  readonly group: THREE.Group;
  /** Root position (ground contact while grounded). */
  readonly position = new THREE.Vector3();
  yaw = 0;
  state: HopperState = "patrol";
  stateT = 0;
  /** 0..1 smoothed danger drive for the HUD cue. */
  threatLevel = 0;

  private readonly ctx: HopperContext;
  private readonly visual: Grasshopper;
  private daySeed = 1337;
  private rng: Rng = mulberry32(1);
  private route: THREE.Vector3[] = [];
  private routeIdx = 0;
  private waitT = 0;
  private patrolHopT = 5;

  // Movement / hop state.
  private grounded = true;
  private planarSpeed = 0;
  private vy = 0;
  private hopVel = new THREE.Vector3();
  private hopPhase: "none" | "windup" | "air" | "land" = "none";
  private hopT = 0;

  // Perception.
  private suspicion = 0;
  private grace = 0;
  private loseT = 0;
  private coneOutT = 0;
  private frustration = 0;
  private readonly lastSeen = new THREE.Vector3();
  private readonly perch = new THREE.Vector3();
  private grabbedLoose = false;

  // Animation blends (consumed by Grasshopper.pose).
  private gaitTime = 0;
  private anim = 0;
  private squash = 0;
  private airBlend = 0;
  private airPitch = 0;
  private wingFlutter = 0;
  private carryBlend = 0;
  private carrying = false;
  private eatRemain = 0;
  private headYaw = 0;
  private stunClock = 0;
  private crumbT = 0;

  private readonly _v = new THREE.Vector3();

  constructor(ctx: HopperContext, seed: number) {
    this.ctx = ctx;
    this.visual = new Grasshopper(ctx.meadow.grains.grainGeo, ctx.meadow.grains.grainMat, (x, z) =>
      ctx.meadow.heightAt(x, z),
    );
    this.group = this.visual.group;
    this.startDay(seed);
  }

  get isCarrying(): boolean {
    return this.carrying;
  }

  /** Viewport attenuation for the dizzy stars (resize hook). */
  setPointScale(heightPx: number): void {
    this.visual.setPointScale(heightPx);
  }

  get suspicionLevel(): number {
    return this.suspicion;
  }

  // --- day lifecycle -----------------------------------------------------------

  /** One hopper per day: fresh seeded route, parked at waypoint 0. */
  startDay(seed?: number): void {
    if (seed !== undefined) this.daySeed = seed;
    this.rng = mulberry32(this.daySeed ^ 0x70915e3);
    this.route = this.buildRoute();
    this.routeIdx = 0;
    this.waitT = 0;
    this.patrolHopT = rangeRng(this.rng, HOPPER_TUNING.patrolHopInterval[0], HOPPER_TUNING.patrolHopInterval[1]);
    const p0 = this.route[0];
    this.position.set(p0.x, this.ctx.meadow.heightAt(p0.x, p0.z), p0.z);
    const p1 = this.route[1];
    this.yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    this.state = "patrol";
    this.stateT = 0;
    this.suspicion = 0;
    this.grace = 0;
    this.loseT = 0;
    this.coneOutT = 0;
    this.frustration = 0;
    this.carrying = false;
    this.eatRemain = 0;
    this.squash = 0;
    this.airBlend = 0;
    this.wingFlutter = 0;
    this.hopPhase = "none";
    this.vy = 0;
    this.threatLevel = 0;
    this.stunClock = 0;
    this.gaitTime = 0;
    this.anim = 0;
    this.group.visible = true;
    this.poseNow();
  }

  /** Seeded patrol ring around the mid-field, clear of anthill + apple. */
  private buildRoute(): THREE.Vector3[] {
    const route: THREE.Vector3[] = [];
    const apple = this.ctx.meadow.apple;
    let guard = 0;
    while (route.length < 6 && guard++ < 200) {
      const ang = this.rng() * Math.PI * 2;
      const r = rangeRng(this.rng, HOPPER_TUNING.routeMinRadius, HOPPER_TUNING.routeMaxRadius);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (Math.hypot(x - apple.center.x, z - apple.center.z) < 2.2) continue; // keep the high route safe
      if (route.some((p) => Math.hypot(p.x - x, p.z - z) < 1.4)) continue;
      route.push(new THREE.Vector3(x, 0, z));
    }
    // Sort into a loop by bearing so the patrol walks a ring, not a zigzag.
    route.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
    return route;
  }

  // --- perception ---------------------------------------------------------------

  /** The apple top is the safe high route: unreachable, out of mind. */
  private antUnreachable(): boolean {
    const c = this.ctx.controller;
    return c.position.y - this.ctx.meadow.terrainHeight(c.position.x, c.position.z) > 0.55;
  }

  private antInCone(): boolean {
    const c = this.ctx.controller.position;
    const dx = c.x - this.position.x;
    const dz = c.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    if (dist > HOPPER_TUNING.visionRange) return false;
    const dot = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / dist;
    return dot > HOPPER_TUNING.visionCos;
  }

  private antDistance(): number {
    const c = this.ctx.controller.position;
    return Math.hypot(c.x - this.position.x, c.z - this.position.z);
  }

  // --- movement ------------------------------------------------------------------

  /** Walk toward (tx, tz) on the ground; returns true on arrival. */
  private moveToward(dt: number, tx: number, tz: number, speed: number): boolean {
    const dx = tx - this.position.x;
    const dz = tz - this.position.z;
    const dist = Math.hypot(dx, dz);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6.5, dt);
    if (dist < 0.26) {
      this.planarSpeed = damp(this.planarSpeed, 0, 10, dt);
      const step = Math.min(dist, this.planarSpeed * dt);
      this.position.x += Math.sin(this.yaw) * step;
      this.position.z += Math.cos(this.yaw) * step;
      return true;
    }
    this.planarSpeed = damp(this.planarSpeed, speed, 8, dt);
    const step = Math.min(dist, this.planarSpeed * dt);
    this.position.x += Math.sin(this.yaw) * step;
    this.position.z += Math.cos(this.yaw) * step;
    return false;
  }

  private startHop(vx: number, vy: number, vz: number): void {
    this.hopPhase = "windup";
    this.hopT = 0;
    this.hopVel.set(vx, vy, vz);
  }

  /** Hop ballistic + squash phases; also drives grounded/planar bookkeeping. */
  private updateHop(dt: number): void {
    const g = HOPPER_TUNING.gravity;
    if (this.hopPhase === "windup") {
      this.hopT += dt;
      this.squash = Math.min(1, this.hopT / HOPPER_TUNING.hopWindup);
      this.planarSpeed = damp(this.planarSpeed, 0, 12, dt);
      if (this.hopT >= HOPPER_TUNING.hopWindup) {
        this.hopPhase = "air";
        this.vy = this.hopVel.y;
        this.planarSpeed = Math.hypot(this.hopVel.x, this.hopVel.z);
        this.grounded = false;
      }
    } else if (this.hopPhase === "air") {
      this.vy -= g * dt;
      this.position.x += this.hopVel.x * dt;
      this.position.z += this.hopVel.z * dt;
      this.position.y += this.vy * dt;
      const gy = this.ctx.meadow.heightAt(this.position.x, this.position.z);
      if (this.position.y <= gy && this.vy < 0) {
        this.position.y = gy;
        this.hopPhase = "land";
        this.hopT = 0;
        this.squash = 1;
        this.grounded = true;
        this.ctx.puffs.burst(this.position, DUST);
      }
    } else if (this.hopPhase === "land") {
      this.hopT += dt;
      this.squash = Math.max(0, 1 - this.hopT / HOPPER_TUNING.hopLandTime);
      this.planarSpeed = damp(this.planarSpeed, 0, 9, dt);
      if (this.hopT >= HOPPER_TUNING.hopLandTime) this.hopPhase = "none";
    } else {
      this.squash = damp(this.squash, 0, 10, dt);
    }
    if (this.grounded && this.hopPhase !== "air") {
      this.position.y = this.ctx.meadow.heightAt(this.position.x, this.position.z);
    }
  }

  // --- the fixed-step AI tick ------------------------------------------------------

  update(dt: number): void {
    this.anim += dt;
    this.stateT += dt;
    if (this.grace > 0) this.grace -= dt;

    switch (this.state) {
      case "patrol":
        this.updatePatrol(dt);
        break;
      case "spot":
        this.updateSpot(dt);
        break;
      case "chase":
        this.updateChase(dt);
        break;
      case "search":
        this.updateSearch(dt);
        break;
      case "snatch":
        this.updateSnatch();
        break;
      case "retreat":
        this.updateRetreat(dt);
        break;
      case "eat":
        this.updateEat(dt);
        break;
      case "stunned":
        this.updateStunned(dt);
        break;
    }

    this.updateHop(dt);
    this.checkGrainHit();
    this.updateThreatLevel(dt);
    this.updateBlendAnim(dt);
    this.poseNow();
  }

  private updatePatrol(dt: number): void {
    const wp = this.route[this.routeIdx];
    const arrived = this.moveToward(dt, wp.x, wp.z, HOPPER_TUNING.walkSpeed);
    if (arrived) {
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.routeIdx = (this.routeIdx + 1) % this.route.length;
        this.waitT = rangeRng(this.rng, 0.4, 1.6);
      }
    }
    // Occasional patrol hops.
    if (this.hopPhase === "none" && this.planarSpeed > 0.4) {
      this.patrolHopT -= dt;
      if (this.patrolHopT <= 0) {
        this.startHop(
          Math.sin(this.yaw) * HOPPER_TUNING.hopPatrolVh,
          HOPPER_TUNING.hopPatrolVy,
          Math.cos(this.yaw) * HOPPER_TUNING.hopPatrolVh,
        );
        this.patrolHopT = rangeRng(this.rng, HOPPER_TUNING.patrolHopInterval[0], HOPPER_TUNING.patrolHopInterval[1]);
      }
    }
    this.accumulateSuspicion(dt);
    if (this.suspicion >= 1) {
      this.state = "spot";
      this.stateT = 0;
      this.planarSpeed = 0;
    }
  }

  private accumulateSuspicion(dt: number): void {
    if (this.grace > 0 || this.antUnreachable()) {
      this.suspicion = Math.max(0, this.suspicion - HOPPER_TUNING.suspicionDecay * dt);
      return;
    }
    const c = this.ctx.controller.position;
    this.lastSeen.set(c.x, c.y, c.z);
    if (this.antInCone()) {
      const dist = this.antDistance();
      const closeness = 1 - dist / HOPPER_TUNING.visionRange;
      const rate = HOPPER_TUNING.suspicionRate * (0.35 + 0.65 * closeness);
      this.suspicion = Math.min(1, this.suspicion + rate * dt);
    } else {
      this.suspicion = Math.max(0, this.suspicion - HOPPER_TUNING.suspicionDecay * dt);
    }
  }

  private updateSpot(dt: number): void {
    this.planarSpeed = damp(this.planarSpeed, 0, 10, dt);
    const c = this.ctx.controller.position;
    this.headYaw = damp(this.headYaw, clamp(this.bearingTo(c.x, c.z), -0.5, 0.5), 6, dt);
    if (this.stateT >= HOPPER_TUNING.spotTime) {
      this.state = "chase";
      this.stateT = 0;
      this.loseT = 0;
      this.coneOutT = 0;
      this.frustration = 0;
    }
  }

  private bearingTo(x: number, z: number): number {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    let d = Math.atan2(dx, dz) - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private updateChase(dt: number): void {
    const c = this.ctx.controller;
    const dist = this.antDistance();
    this.lastSeen.set(c.position.x, c.position.y, c.position.z);
    this.headYaw = damp(this.headYaw, clamp(this.bearingTo(c.position.x, c.position.z), -0.45, 0.45), 7, dt);

    // Snatch window: carried grain in reach, or a loose one underfoot.
    if (dist < HOPPER_TUNING.snatchRange && this.grounded && this.ctx.carried.mode === "held") {
      this.beginSnatch(false);
      return;
    }
    const looseIdx = this.ctx.grains.looseNear(this.position, HOPPER_TUNING.looseSnatchRange);
    if (looseIdx !== null && this.grounded) {
      this.beginSnatch(true);
      return;
    }

    // Movement: sprint with hops to close gaps.
    if (this.hopPhase === "none" && dist > HOPPER_TUNING.chaseHopGap) {
      const lead = 0.18;
      const tx = c.position.x + c.velocity.x * lead;
      const tz = c.position.z + c.velocity.z * lead;
      const dx = tx - this.position.x;
      const dz = tz - this.position.z;
      const dl = Math.max(0.001, Math.hypot(dx, dz));
      this.startHop(
        (dx / dl) * HOPPER_TUNING.hopChaseVh,
        HOPPER_TUNING.hopChaseVy,
        (dz / dl) * HOPPER_TUNING.hopChaseVh,
      );
    } else if (this.hopPhase === "none" || this.hopPhase === "land") {
      this.moveToward(dt, c.position.x, c.position.z, HOPPER_TUNING.chaseSpeed);
    }

    // Give-up checks.
    if (dist > HOPPER_TUNING.loseDist) this.loseT += dt;
    else this.loseT = 0;
    if (!this.antInCone() && dist > 1.4) this.coneOutT += dt;
    else this.coneOutT = 0;
    const hasBait = this.ctx.carried.mode === "held" || this.ctx.grains.looseNear(c.position, 0.9) !== null;
    if (!hasBait) this.frustration += dt;
    else this.frustration = 0;

    if (
      this.loseT > HOPPER_TUNING.loseTime ||
      this.coneOutT > HOPPER_TUNING.coneLoseTime ||
      this.frustration > HOPPER_TUNING.chaseFrustration ||
      this.antUnreachable()
    ) {
      this.enterSearch();
    }
  }

  private enterSearch(): void {
    this.state = "search";
    this.stateT = 0;
    this.suspicion = 0.4;
    this.loseT = 0;
    this.coneOutT = 0;
    this.frustration = 0;
  }

  private updateSearch(dt: number): void {
    const arrived = this.moveToward(dt, this.lastSeen.x, this.lastSeen.z, HOPPER_TUNING.walkSpeed * 1.25);
    // Sweeping the head while searching.
    this.headYaw = damp(this.headYaw, Math.sin(this.stateT * 3.4) * 0.55, 5, dt);
    this.accumulateSuspicion(dt);
    if (this.suspicion >= 1) {
      this.state = "spot";
      this.stateT = 0;
      return;
    }
    if (arrived || this.stateT > HOPPER_TUNING.searchTime) {
      this.state = "patrol";
      this.stateT = 0;
      this.suspicion = 0;
    }
  }

  private beginSnatch(loose: boolean): void {
    this.state = "snatch";
    this.stateT = 0;
    this.grabbedLoose = loose;
    this.planarSpeed = 0;
    this.headYaw = 0;
  }

  private updateSnatch(): void {
    // Rear up, grab at the apex of the rear, then pivot to retreat. Timing
    // flows through this.stateT (accumulated in update()), so no dt needed.
    if (this.stateT >= HOPPER_TUNING.snatchRearTime * 0.42 && !this.carrying) {
      const c = this.ctx;
      if (this.grabbedLoose) {
        const idx = c.grains.looseNear(this.position, HOPPER_TUNING.looseSnatchRange + 0.15);
        if (idx !== null) {
          c.grains.takeLoose(idx);
          this.carrying = true;
          c.puffs.burst(this.position, CHAFF);
        }
      } else if (c.loop.stealCarried()) {
        this.carrying = true;
        // Knock the ant back — the sting beat.
        const ant = c.controller;
        const dx = ant.position.x - this.position.x;
        const dz = ant.position.z - this.position.z;
        const dl = Math.max(0.05, Math.hypot(dx, dz));
        ant.velocity.set((dx / dl) * 2.3, 1.7, (dz / dl) * 2.3);
        ant.grounded = false;
        c.puffs.burst(ant.position, CHAFF);
        c.loop.triggerSting();
        c.loop.announce("Snatched! Run next time.");
        c.onSfx?.("sting");
      }
      if (!this.carrying) {
        // The grain vanished mid-rear (thrown/deposited): back to the hunt.
        this.state = "chase";
        this.stateT = 0;
        return;
      }
    }
    if (this.stateT >= HOPPER_TUNING.snatchRearTime) {
      this.pickPerch();
      this.state = "retreat";
      this.stateT = 0;
    }
  }

  /** A perch a couple of units off the snatch point, still in the field. */
  private pickPerch(): void {
    const apple = this.ctx.meadow.apple;
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2;
      const d = rangeRng(this.rng, 2.4, 3.6);
      const x = this.position.x + Math.cos(a) * d;
      const z = this.position.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < HOPPER_TUNING.routeMinRadius) continue;
      if (Math.hypot(x - apple.center.x, z - apple.center.z) < 2.2) continue;
      this.perch.set(x, 0, z);
      return;
    }
    this.perch.copy(this.route[this.routeIdx]);
  }

  private updateRetreat(dt: number): void {
    const arrived = this.moveToward(dt, this.perch.x, this.perch.z, HOPPER_TUNING.retreatSpeed);
    if (this.hopPhase === "none" && !arrived && Math.hypot(this.perch.x - this.position.x, this.perch.z - this.position.z) > 1.5) {
      this.startHop(
        Math.sin(this.yaw) * HOPPER_TUNING.hopChaseVh * 0.8,
        HOPPER_TUNING.hopChaseVy * 0.85,
        Math.cos(this.yaw) * HOPPER_TUNING.hopChaseVh * 0.8,
      );
    }
    if (arrived) {
      this.state = "eat";
      this.stateT = 0;
      this.eatRemain = 1;
      this.crumbT = 0;
    }
  }

  private updateEat(dt: number): void {
    this.planarSpeed = damp(this.planarSpeed, 0, 10, dt);
    this.eatRemain = clamp(1 - this.stateT / HOPPER_TUNING.eatTime, 0, 1);
    this.crumbT -= dt;
    if (this.crumbT <= 0 && this.eatRemain > 0.02) {
      this.crumbT = 0.45;
      this._v.copy(this.position);
      this._v.x += Math.sin(this.yaw) * 0.24;
      this._v.z += Math.cos(this.yaw) * 0.24;
      this._v.y += 0.16;
      this.ctx.puffs.burst(this._v, { ...CHAFF, count: 4, speed: [0.15, 0.4], up: 0.5 });
    }
    if (this.stateT >= HOPPER_TUNING.eatTime) {
      this.carrying = false;
      this.eatRemain = 0;
      this.grace = HOPPER_TUNING.graceTime;
      this.state = "patrol";
      this.stateT = 0;
      this.suspicion = 0;
      this.ctx.loop.announce("The stolen grain is gone… find more.");
    }
  }

  private updateStunned(dt: number): void {
    this.stunClock += dt;
    this.planarSpeed = damp(this.planarSpeed, 0, 8, dt);
    if (this.stateT >= HOPPER_TUNING.stunTime) {
      this.state = "patrol";
      this.stateT = 0;
      this.suspicion = 0;
      this.grace = 3;
      this.stunClock = 0;
    }
  }

  /** A carried grain in flight that strikes the carapace → STUNNED. */
  private checkGrainHit(): void {
    const carried = this.ctx.carried;
    if (this.state === "stunned" || carried.mode !== "flight") return;
    const gp = carried.position;
    const dx = gp.x - this.position.x;
    const dz = gp.z - this.position.z;
    const dy = gp.y - this.position.y;
    if (dx * dx + dz * dz > HOPPER_TUNING.hitRadius * HOPPER_TUNING.hitRadius) return;
    if (dy < 0.0 || dy > HOPPER_TUNING.hitHeightMax) return;

    // Stun! The grain ricochets off; any stolen grain drops where it stands.
    const dl = Math.max(0.05, Math.hypot(dx, dz));
    carried.deflect(-dx / dl, -dz / dl);
    this.ctx.puffs.burst(gp, CHAFF);
    if (this.carrying) this.dropGrain();
    this.state = "stunned";
    this.stateT = 0;
    this.stunClock = 0;
    this.hopPhase = "none";
    this.vy = 0;
    this.squash = 0.7;
    this.position.y = this.ctx.meadow.heightAt(this.position.x, this.position.z);
    this.grounded = true;
    this.suspicion = 0;
    this.ctx.loop.announce("Stunned! Grab it back!");
  }

  private dropGrain(): void {
    this.carrying = false;
    this.eatRemain = 0;
    const q = new THREE.Quaternion().setFromAxisAngle(_up, this.rng() * Math.PI * 2);
    this._v.copy(this.position);
    this._v.x += Math.sin(this.yaw + 2.2) * 0.3;
    this._v.z += Math.cos(this.yaw + 2.2) * 0.3;
    this.ctx.grains.addLoose(this._v, q, 1);
    this.ctx.puffs.burst(this._v, CHAFF);
  }

  private updateThreatLevel(dt: number): void {
    const target =
      this.state === "chase"
        ? 1
        : this.state === "spot"
          ? 0.55 + this.suspicion * 0.45
          : this.state === "snatch"
            ? 0.9
            : this.state === "retreat" || this.state === "eat"
              ? 0.45
              : this.state === "search"
                ? 0.25
                : this.state === "stunned"
                  ? 0.12
                  : 0;
    this.threatLevel = damp(this.threatLevel, target, 7, dt);
  }

  private updateBlendAnim(dt: number): void {
    const gaitFreq = clamp(3 + this.planarSpeed * 2.6, 3, 11);
    if (this.hopPhase !== "windup") this.gaitTime += gaitFreq * dt;
    this.airBlend = damp(this.airBlend, this.hopPhase === "air" ? 1 : 0, 14, dt);
    this.airPitch = this.hopPhase === "air" ? clamp(-this.vy * 0.055, -0.42, 0.45) : 0;
    this.wingFlutter = damp(this.wingFlutter, this.hopPhase === "air" ? 1 : 0, 10, dt);
    this.carryBlend = damp(this.carryBlend, this.carrying ? 1 : 0, 9, dt);
    this.headYaw = this.state === "chase" || this.state === "search" ? this.headYaw : damp(this.headYaw, 0, 5, dt);
  }

  /** Pushes the current AI state through the visual pose (analytic). */
  private poseNow(): void {
    const input: HopperPoseInput = {
      pos: this.position,
      yaw: this.yaw,
      planarSpeed: this.planarSpeed,
      grounded: this.grounded && this.hopPhase !== "air",
      squash: this.squash,
      airBlend: this.airBlend,
      airPitch: this.airPitch,
      rear: this.rearBlend,
      stun: this.stunBlend,
      stunClock: this.stunClock,
      gaitTime: this.gaitTime,
      anim: this.anim,
      wingFlutter: this.wingFlutter,
      carry: this.carryBlend,
      eat: this.eatRemain,
      headYaw: this.headYaw,
    };
    this.visual.pose(input);
  }

  private get rearBlend(): number {
    if (this.state === "spot") return clamp(this.stateT / HOPPER_TUNING.spotTime, 0, 1);
    if (this.state === "snatch") {
      const u = this.stateT / HOPPER_TUNING.snatchRearTime;
      return 1 - Math.abs(u - 0.42) * 1.2; // rear up, dip to grab, rise again
    }
    if (this.state === "eat") return 0.25 + Math.sin(this.anim * 8) * 0.06;
    return 0;
  }

  private get stunBlend(): number {
    return this.state === "stunned" ? 1 : 0;
  }

  // --- HUD support -----------------------------------------------------------------

  /** Screen-edge threat cue data, or null when the meadow is calm. */
  threatCue(camera: THREE.PerspectiveCamera): ThreatCue | null {
    if (this.threatLevel < 0.03 || !this.group.visible) return null;
    _cue.copy(this.position);
    _cue.y += 0.22;
    _cue.applyMatrix4(camera.matrixWorldInverse);
    let x = _cue.x;
    let y = _cue.y;
    if (_cue.z > -0.05) {
      x = -x; // behind the lens: flip to the honest off-screen side
      y = -y;
    }
    return { intensity: this.threatLevel, angle: Math.atan2(y, x) };
  }

  // --- staging (ShotDirector) --------------------------------------------------------

  /**
   * Freezes the hopper deterministically for a pinned shot. Live AI values
   * are set directly; the visual pose is analytic, so a single pose() snap is
   * pixel-stable.
   */
  stage(opts: {
    x: number;
    z: number;
    yaw: number;
    state?: HopperState;
    stateT?: number;
    speed?: number;
    gaitTime?: number;
    anim?: number;
    /** Airborne pose: height above the local ground. */
    airHeight?: number;
    airPitch?: number;
    squash?: number;
    stun?: boolean;
    stunClock?: number;
    carry?: boolean;
    eat?: number;
    suspicion?: number;
    /** Head look offset (radians) for staged portrait reads. */
    headYaw?: number;
    visible?: boolean;
  }): void {
    const m = this.ctx.meadow;
    this.position.set(opts.x, m.heightAt(opts.x, opts.z) + (opts.airHeight ?? 0), opts.z);
    this.yaw = opts.yaw;
    this.state = opts.state ?? "patrol";
    this.stateT = opts.stateT ?? 0;
    this.planarSpeed = opts.speed ?? 0;
    this.gaitTime = opts.gaitTime ?? 0;
    this.anim = opts.anim ?? 0;
    this.grounded = opts.airHeight === undefined;
    this.airBlend = opts.airHeight !== undefined ? 1 : 0;
    this.airPitch = opts.airPitch ?? 0;
    this.squash = opts.squash ?? 0;
    this.wingFlutter = opts.airHeight !== undefined ? 1 : 0;
    this.carrying = opts.carry ?? false;
    this.carryBlend = this.carrying ? 1 : 0;
    this.eatRemain = opts.eat ?? 0;
    this.suspicion = opts.suspicion ?? 0;
    this.headYaw = opts.headYaw ?? 0;
    if (opts.stun) {
      this.stunClock = opts.stunClock ?? 0;
    } else {
      this.stunClock = 0;
    }
    this.threatLevel = this.state === "chase" ? 1 : this.state === "spot" ? 0.7 : this.state === "snatch" ? 0.9 : this.state === "retreat" || this.state === "eat" ? 0.45 : 0;
    this.group.visible = opts.visible ?? true;
    this.poseNow();
  }

  /** Parks the hopper out of frame for shots it must not interfere with. */
  stageDefault(): void {
    this.stage({
      x: -11.5,
      z: -13.5,
      yaw: 2.4,
      state: "patrol",
      speed: 0,
      visible: false,
    });
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _cue = new THREE.Vector3();
