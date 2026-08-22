// Phase 4: spline-following driver brain, rubber-banding, targeting.
//
// Each AI tank runs `think()` once per frame. It produces the same
// { throttle, steer } input the player's keyboard produces (fed straight into
// updateTankPhysics), plus a fire flag handled by weapons.tryFire — so AI obey
// the exact same turn limits, acceleration curve, wreck rules and pickups as
// the player.

import {
  getPoint,
  getTangent,
  closestOnSpline,
  type ClosestTable,
} from "./spline";
import { applySpeedBoost, MAX_SPEED, type TankInput, type TankState } from "./tank";
import type { Track } from "./track";
import type { World, Racer } from "./game";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const LOOK_BASE = 7; // u of lookahead at standstill
const LOOK_PER_SPEED = 0.55; // extra lookahead per u/s (≈29u at top speed)
const LOOK_MAX = 34;
const STEER_GAIN = 2.6; // P-gain on heading error → steer axis
const STEER_DEADZONE = 0.015; // rad — ignore tiny errors to avoid weaving
/** Re-aim at the centerline when drifting this close to the wall boundary. */
const CENTER_RECOVERY_DIST = 5.2;

const CURV_SAMPLE_STEP = 6; // u between curvature probes
const CURV_SAMPLES = 7; // ≈42u of forward planning
const BRAKE_DECEL_EST = 26; // conservative braking capability for corner planning

const RUBBER_GAP = 0.06; // fraction-of-lap gap that maps to full rubber-band
const RUBBER_AMOUNT = 0.18; // ±18% effective max speed — keeps avg players mid-pack
/** Gap (same fraction-of-lap units) behind which AI fire more aggressively. */
const DESPERATE_GAP = -RUBBER_GAP * 0.5;
const DESPERATE_FIRE_MULT = 1.5; // fire-clock speedup when far behind the player

const FIRE_RANGE = 60; // u
const FIRE_DOT = 0.88; // cos(≈28°) — "roughly in front" cone
const FIRE_ALIGN = 0.11; // rad hull-vs-target alignment needed to shoot
const AIM_JITTER = 0.05; // rad aim error (spec)
const CADENCE_MIN = 2; // s between shot attempts (spec: 2–4s)
const CADENCE_MAX = 4;

const STUCK_SPEED = 3; // u/s below which we count as stuck while on throttle
const STUCK_TIME = 1.4; // s of being stuck before reversing out
const REVERSE_TIME = 1.0; // s of reverse-steer to escape

// ---------------------------------------------------------------------------
// Personalities
// ---------------------------------------------------------------------------

export interface AIPersonality {
  name: string;
  hullColor: number;
  turretColor: number;
  /** Max lateral offset from the centerline (u) — racing-line personality. */
  lateralAmp: number;
  /** rad/s-ish wander speed of the lateral offset. */
  wanderSpeed: number;
  phase: number;
  /** Lateral accel budget (u/s²) for corner planning — higher corners harder. */
  cornerGrip: number;
}

export const AI_PERSONALITIES: AIPersonality[] = [
  {
    name: "RUSTY",
    hullColor: 0xb0492f,
    turretColor: 0xc96a3f,
    lateralAmp: 2.4,
    wanderSpeed: 0.21,
    phase: 0.0,
    cornerGrip: 24,
  },
  {
    name: "VIPER",
    hullColor: 0x2f6d33,
    turretColor: 0x3f8f47,
    lateralAmp: 3.2,
    wanderSpeed: 0.34,
    phase: 2.1,
    cornerGrip: 31,
  },
  {
    name: "MAULER",
    hullColor: 0x8c2b2b,
    turretColor: 0xa84a3a,
    lateralAmp: 2.8,
    wanderSpeed: 0.27,
    phase: 4.2,
    cornerGrip: 26,
  },
];

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface AIDecision extends TankInput {
  fire: boolean;
}

export interface AIController {
  tank: TankState;
  name: string;
  think(dt: number, world: World): AIDecision;
}

/** Total spline length in world units, from the dense closest-point table. */
function splineLength(table: ClosestTable): number {
  let len = 0;
  for (let i = 0; i < table.points.length; i++) {
    const a = table.points[i];
    const b = table.points[(i + 1) % table.points.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

export function createAIController(
  pers: AIPersonality,
  self: Racer,
  track: Track,
): AIController {
  const trackLen = splineLength(track.table);
  let clock = Math.random() * 100; // desync the lateral wander between AIs
  let fireTimer = CADENCE_MIN + Math.random() * (CADENCE_MAX - CADENCE_MIN);
  let stuckTime = 0;
  let reversing = 0;

  function think(dt: number, world: World): AIDecision {
    clock += dt;
    const idle: AIDecision = { throttle: 0, steer: 0, fire: false };
    const tank = self.tank;

    // Wrecked / spinning tanks keep their hands off the controls; physics and
    // weapons.ts own everything about those states already.
    if (tank.wreckTimer > 0 || tank.spinTimer > 0) {
      stuckTime = 0;
      return idle;
    }

    const cp = closestOnSpline(track.table, tank.position.x, tank.position.z);
    const t = cp.t;
    const speed = tank.velocity.length();

    // --- Rubber-band: ±15% effective max speed vs the player ----------------
    const playerRacer = world.racers.find((r) => r.tank === world.player)!;
    const gap = self.progress.totalProgress - playerRacer.progress.totalProgress;
    const rubber = 1 - clamp(gap / RUBBER_GAP, -1, 1) * RUBBER_AMOUNT;
    // Faster side rides a managed micro-boost; never clobbers a stronger pad
    // or pickup boost (those set boostTimer > 0 with a bigger multiplier).
    if (rubber > 1.001 && tank.boostTimer <= 0) {
      applySpeedBoost(tank, rubber, 0.25);
    }
    const cruiseCap = MAX_SPEED * Math.min(rubber, 1); // slower side via throttle only

    // --- Target point: lookahead + slowly wandering lateral offset ----------
    const look = Math.min(LOOK_MAX, LOOK_BASE + LOOK_PER_SPEED * speed);
    const lt = t + look / trackLen;
    const p = getPoint(track.points, lt);
    const tan = getTangent(track.points, lt);
    const tl = Math.hypot(tan.x, tan.z) || 1;
    const nx = tan.z / tl; // right-hand normal in XZ
    const nz = -tan.x / tl;
    const lat = pers.lateralAmp * Math.sin(clock * pers.wanderSpeed + pers.phase);
    const tx = p.x + nx * lat - tank.position.x;
    const tz = p.z + nz * lat - tank.position.z;

    // --- Steering: same turn limits as the player, we just pick the axis ----
    let desired = Math.atan2(tx, tz);
    if (cp.distSq > CENTER_RECOVERY_DIST * CENTER_RECOVERY_DIST) {
      // Drifting wide near a wall: prioritize rejoining over the race line
      const c = getPoint(track.points, t);
      desired = Math.atan2(c.x - tank.position.x, c.z - tank.position.z);
    }
    const err = wrapPi(desired - tank.heading);
    // Physics applies heading -= steer * rate, so positive error needs negative steer.
    let steer = Math.abs(err) < STEER_DEADZONE ? 0 : clamp(-err * STEER_GAIN, -1, 1);

    // --- Corner speed: sample curvature ahead, brake-curve into it ----------
    let angPrev = headingAt(track.points, t);
    let vLimit = Infinity;
    for (let i = 1; i <= CURV_SAMPLES; i++) {
      const ti = t + (i * CURV_SAMPLE_STEP) / trackLen;
      const ang = headingAt(track.points, ti);
      const kappa = Math.abs(wrapPi(ang - angPrev)) / CURV_SAMPLE_STEP;
      angPrev = ang;
      const cornerSpeed = Math.sqrt(pers.cornerGrip / Math.max(kappa, 1e-5));
      const dist = i * CURV_SAMPLE_STEP;
      vLimit = Math.min(vLimit, Math.sqrt(cornerSpeed * cornerSpeed + 2 * BRAKE_DECEL_EST * dist));
    }

    // --- Throttle ------------------------------------------------------------
    const fx = Math.sin(tank.heading);
    const fz = Math.cos(tank.heading);
    const vFwd = tank.velocity.x * fx + tank.velocity.z * fz;
    const targetSpeed = Math.min(vLimit, cruiseCap);
    let throttle = 1;
    if (vFwd > targetSpeed + 1.5) throttle = vFwd > 0.5 ? -1 : 0;
    else if (vFwd > targetSpeed) throttle = 0;

    // --- Stuck recovery (rare, but walls happen) -----------------------------
    if (reversing > 0) {
      reversing -= dt;
      throttle = -1;
      steer = -Math.sign(err || 1);
    } else {
      if (throttle > 0 && speed < STUCK_SPEED) stuckTime += dt;
      else stuckTime = 0;
      if (stuckTime > STUCK_TIME) {
        reversing = REVERSE_TIME;
        stuckTime = 0;
      }
    }

    // --- Firing: nearest tank ahead in a forward cone, 2–4s cadence ----------
    // Far-behind AI run their fire clock faster (desperation catch-up).
    const desperate = gap < DESPERATE_GAP;
    fireTimer -= dt * (desperate ? DESPERATE_FIRE_MULT : 1);
    let fire = false;
    if (fireTimer <= 0) {
      const target = pickTarget(world, tank, fx, fz);
      if (target) {
        const aim = wrapPi(
          Math.atan2(target.position.x - tank.position.x, target.position.z - tank.position.z) -
            tank.heading,
        );
        if (Math.abs(aim) < FIRE_ALIGN + (Math.random() * 2 - 1) * AIM_JITTER) {
          fire = true;
          fireTimer = CADENCE_MIN + Math.random() * (CADENCE_MAX - CADENCE_MIN);
        }
      }
    }

    return { throttle, steer, fire };
  }

  return { tank: self.tank, name: pers.name, think };
}

/** Nearest live, hittable tank inside range and roughly in front. */
function pickTarget(
  world: World,
  self: TankState,
  fx: number,
  fz: number,
): TankState | null {
  let best: TankState | null = null;
  let bestDistSq = FIRE_RANGE * FIRE_RANGE;
  for (const other of world.tanks) {
    if (other === self) continue;
    if (other.wreckTimer > 0 || other.invulnTimer > 0) continue;
    const dx = other.position.x - self.position.x;
    const dz = other.position.z - self.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq >= bestDistSq) continue;
    const dist = Math.sqrt(distSq) || 1;
    if ((dx / dist) * fx + (dz / dist) * fz < FIRE_DOT) continue;
    bestDistSq = distSq;
    best = other;
  }
  return best;
}

/** Tangent direction angle at parameter t (same convention as tank.heading). */
function headingAt(points: { x: number; z: number }[], t: number): number {
  const tan = getTangent(points, t);
  const len = Math.hypot(tan.x, tan.z) || 1;
  return Math.atan2(tan.x / len, tan.z / len);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapPi(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
