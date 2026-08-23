import { CONFIG } from "../config";

export type ZombieType = "walker" | "runner" | "brute";
export type ZombieSide = "left" | "right";
export type ZombieState = "lurking" | "telegraphing" | "leaping" | "clinging" | "dead";

export type Zombie = {
  active: boolean;
  id: number;
  type: ZombieType;
  state: ZombieState;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  hp: number;
  side: ZombieSide;
  slot: number;
  telegraphT: number;
  recentLeapUntil: number;
  deathT: number;
};

export type ZombieUpdateCtx = {
  carX: number;
  carVx: number;
  carZ: number;
  accuracy: number;
  /** Live forward speed m/s; leap prediction falls back to cruise baseline when absent. */
  carSpeed?: number;
  /** Invoked when a leaper lands and latches onto the hull (audio/fx hook). */
  onAttach?: (side: "left" | "right") => void;
};

// Pure simulation constants (mesh binding arrives in Task 9).
const GRAVITY = -22; // m/s^2, per brief
const TELEGRAPH_S = 0.35; // crouch windup before a leap
const CAR_SPEED_FACTOR = 0.9; // brief's closing model: car barrels at cruise * 0.9
const ASSUMED_CAR_SPEED = 28; // fallback when ctx.carSpeed is not supplied

/** Car-relative closure rate m/s given live car speed (cruise fallback). */
function closingSpeed(carSpeed?: number): number {
  return (carSpeed ?? ASSUMED_CAR_SPEED) * CAR_SPEED_FACTOR;
}

const DEATH_TUMBLE_S = 1; // ragdoll time before deactivation
const CLING_X_OFFSET = 0.45; // hang-off distance from the car hull
const MAX_SLOT = 2; // deepest cling slot along the car flank

/**
 * Where a leaper should aim on the x axis.
 *
 * `accuracy` scales confidence in the whole lateral track of the car: at 1 the
 * zombie fully leads the car's sideways velocity over the flight time; at 0 it
 * tracks nothing and dives straight down the road. Result is clamped inside the
 * drivable rails (|x| <= halfWidth - car halfWidth).
 */
export function predictLanding(
  carX: number,
  carVx: number,
  dz: number,
  speed: number,
  accuracy: number,
): number {
  const flightS = dz / (speed + closingSpeed());
  const aim = accuracy * (carX + carVx * flightS);
  const limit = CONFIG.road.halfWidth - CONFIG.car.halfWidth;
  return Math.min(limit, Math.max(-limit, aim));
}

/**
 * Pooled zombie simulation. Positions are car-relative: +z is ahead of the car,
 * and lurking zombies close the gap at run speed plus the oncoming car speed.
 */
export class ZombiePool {
  private zombies: Zombie[];
  private now = 0;
  private nextId = 1;

  constructor(capacity = 24) {
    this.zombies = [];
    for (let i = 0; i < capacity; i++) {
      const z: Zombie = {
        active: false,
        id: 0,
        type: "walker",
        state: "lurking",
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        hp: 0,
        side: "right",
        slot: 0,
        telegraphT: 0,
        recentLeapUntil: -Infinity,
        deathT: 0,
      };
      this.zombies.push(z);
    }
  }
  /** Fixed pool size; mesh pools bind one mesh per stable slot index. */
  slotCount(): number {
    return this.zombies.length;
  }
  /** Every pool slot by index (active or not); stable for mesh binding. */
  *allSlots(): IterableIterator<Zombie> {
    for (const z of this.zombies) yield z;
  }

  spawnLurker(type: ZombieType, shoulderX: number, z: number): Zombie | null {
    const spot = this.zombies.find((cand) => !cand.active);
    if (!spot) return null;
    const spec = CONFIG.zombies[type];
    spot.active = true;
    spot.id = this.nextId++;
    spot.type = type;
    spot.state = "lurking";
    spot.x = shoulderX;
    spot.y = 0;
    spot.z = z;
    spot.vx = 0;
    spot.vy = 0;
    spot.vz = 0;
    spot.hp = spec.hp;
    spot.side = shoulderX >= 0 ? "right" : "left";
    spot.slot = 0;
    spot.telegraphT = 0;
    spot.recentLeapUntil = -Infinity;
    spot.deathT = 0;
    return spot;
  }

  update(dt: number, ctx: ZombieUpdateCtx): void {
    this.now += dt;
    for (const z of this.zombies) {
      if (!z.active) continue;
      switch (z.state) {
        case "lurking":
          this.stepLurking(z, dt, ctx);
          break;
        case "telegraphing":
          this.stepTelegraphing(z, dt, ctx);
          break;
        case "leaping":
          this.stepLeaping(z, dt, ctx);
          break;
        case "clinging":
          this.stepClinging(z, ctx);
          break;
        case "dead":
          this.stepDead(z, dt);
          break;
      }
    }
  }

  /**
   * Road rash against one flank; appends the clingers it killed to `out`
   * (preallocated by the caller — no per-call allocation).
   */
  scrapeSide(side: ZombieSide, out: Zombie[]): void {
    for (const z of this.zombies) {
      if (!z.active || z.state !== "clinging" || z.side !== side) continue;
      z.hp -= CONFIG.scrape.dmgToClingers;
      if (z.hp <= 0) {
        this.kill(z, true);
        out.push(z);
      }
    }
  }

  /**
   * Returns true when the target SURVIVES the blow, false when it drops.
   * Recent-leap doubling happens inside (window checked against leap start +
   * recentLeapWindowS), so a doubled shot that kills returns false.
   */
  hit(z: Zombie, dmg: number): boolean {
    if (!z.active || z.state === "dead") return false;
    const mult = this.now < z.recentLeapUntil ? CONFIG.gun.recentLeapMult : 1;
    z.hp -= dmg * mult;
    if (z.hp <= 0) {
      this.kill(z, true);
      return false;
    }
    return true;
  }

  /** True while the recent-leap damage doubling window is open for this zombie. */
  isRecentLeap(z: Zombie): boolean {
    return this.now < z.recentLeapUntil;
  }

  /**
   * Weight currently hanging off each flank (drives car tilt/flip risk).
   * Writes into `out` — preallocated by the caller, no per-call allocation.
   */
  attachedWeight(_carX: number, out: { left: number; right: number }): void {
    out.left = 0;
    out.right = 0;
    for (const z of this.zombies) {
      if (!z.active || z.state !== "clinging") continue;
      const w = CONFIG.zombies[z.type].weight;
      if (z.side === "left") out.left += w;
      else out.right += w;
    }
  }

  forEachClinging(fn: (z: Zombie) => void): void {
    for (const z of this.zombies) {
      if (z.active && z.state === "clinging") fn(z);
    }
  }

  /** Live zombies only; slots are stable objects safe to bind meshes to. */
  *all(): IterableIterator<Zombie> {
    for (const z of this.zombies) {
      if (z.active) yield z;
    }
  }

  reset(): void {
    this.now = 0;
    this.nextId = 1;
    for (const z of this.zombies) z.active = false;
  }

  private stepLurking(z: Zombie, dt: number, ctx: ZombieUpdateCtx): void {
    const spec = CONFIG.zombies[z.type];
    const closing = closingSpeed(ctx.carSpeed);
    // Gap to the car closes at run speed plus oncoming car speed.
    z.z -= (spec.speed + closing) * dt;
    if (z.z - ctx.carZ <= spec.leapRange) {
      z.state = "telegraphing";
      z.telegraphT = 0;
    }

  }

  private stepTelegraphing(z: Zombie, dt: number, ctx: ZombieUpdateCtx): void {
    z.telegraphT += dt; // planted crouch; position frozen
    if (z.telegraphT < TELEGRAPH_S) return;
    this.launchLeap(z, ctx);
  }

  private launchLeap(z: Zombie, ctx: ZombieUpdateCtx): void {
    const spec = CONFIG.zombies[z.type];
    const gap = Math.max(z.z - ctx.carZ, 0.5);
    const closing = closingSpeed(ctx.carSpeed);
    const flightS = gap / (spec.speed + closing);
    const aim = predictLanding(ctx.carX, ctx.carVx, gap, spec.speed, ctx.accuracy);
    z.vx = (aim - z.x) / flightS;
    z.vz = -gap / flightS;
    z.vy = -0.5 * GRAVITY * flightS; // ballistic solve: touches y=0 at t=flightS
    z.recentLeapUntil = this.now + CONFIG.gun.recentLeapWindowS;
    z.state = "leaping";
  }

  private stepLeaping(z: Zombie, dt: number, ctx: ZombieUpdateCtx): void {
    z.vy += GRAVITY * dt;
    z.x += z.vx * dt;
    z.y += z.vy * dt;
    z.z += z.vz * dt;
    if (z.vy >= 0 || z.y > 0) return;
    z.y = 0;
    const dx = z.x - ctx.carX;
    const dzLand = z.z - ctx.carZ;
    const grabsCar =
      Math.abs(dx) <= CONFIG.car.halfWidth + CLING_X_OFFSET &&
      Math.abs(dzLand) <= CONFIG.car.length / 2 + CLING_X_OFFSET;
    if (grabsCar) {
      this.attachClinging(z, dx, ctx);
      ctx.onAttach?.(z.side);
    } else {
      this.kill(z, false);
    }
  }

  private attachClinging(z: Zombie, dx: number, ctx: ZombieUpdateCtx): void {
    z.side = dx >= 0 ? "right" : "left";
    z.slot = Math.min(this.countOnSide(z.side), MAX_SLOT);
    z.state = "clinging";
    z.x = (z.side === "right" ? 1 : -1) * (CONFIG.car.halfWidth + CLING_X_OFFSET);
    z.y = 0;
    z.z = ctx.carZ - z.slot * 0.9;
    z.vx = 0;
    z.vy = 0;
    z.vz = 0;
    z.deathT = 0;
  }

  private stepClinging(z: Zombie, ctx: ZombieUpdateCtx): void {
    const sign = z.side === "right" ? 1 : -1;
    z.x = sign * (CONFIG.car.halfWidth + CLING_X_OFFSET);
    z.y = 0;
    z.z = ctx.carZ - z.slot * 0.9;
  }

  private stepDead(z: Zombie, dt: number): void {
    z.deathT += dt;
    z.vy += GRAVITY * dt;
    z.x += z.vx * dt;
    z.y += z.vy * dt;
    z.z += z.vz * dt;
    if (z.y < 0) {
      z.y = 0;
      z.vy = -z.vy * 0.3; // damped tumble bounce
      z.vx *= 0.7;
      z.vz *= 0.7;
    }
    if (z.deathT >= DEATH_TUMBLE_S) z.active = false;
  }

  private countOnSide(side: ZombieSide): number {
    let n = 0;
    for (const z of this.zombies) {
      if (z.active && z.state === "clinging" && z.side === side) n++;
    }
    return n;
  }

  /** Enter the ~1 s ragdoll tumble; flung corpses pop off the car outward. */
  private kill(z: Zombie, flung: boolean): void {
    z.state = "dead";
    z.deathT = 0;
    if (flung) {
      z.vx = (z.side === "right" ? 1 : -1) * 3;
      z.vy = 2.5;
      z.vz *= 0.3;
    } else {
      z.vx *= 0.4; // whiffed leap: momentum carries the tumble onward
      z.vy = 1.5;
      z.vz *= 0.5;
    }
  }
}
