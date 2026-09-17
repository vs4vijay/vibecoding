import type { RaceState, Rider } from "./types";
import type { InputState } from "../core/input";
import { MAX_SPEED, PLAYER, SIM } from "../config";
import { approach, clamp } from "../core/math";
import { findSegment } from "./track";

// OWNER: Agent B. Player + shared rider kinematics. Contract per .plan.md §5
// and §6. Do not change signatures.

/** Player HP ceiling (plan §6: "Player HP 100"). */
const MAX_HP = 100;
/** AI riders steer at this fraction of PLAYER.steerRate. */
const AI_STEER_MUL = 0.9;
/** |x| beyond this counts as off-road (road spans -1..1). */
const ROAD_EDGE = 1;

/**
 * Step the player: throttle/brake/coast, steering with speed falloff,
 * centrifugal push from the current segment curve, off-road drag + cap,
 * lean calculation, wobble steering interference, z advance, x clamp to
 * PLAYER.xClamp. Does NOT handle combat, crashes, or downed riders.
 */
export function stepPlayer(
  state: RaceState,
  input: InputState,
  dt: number,
): void {
  const p = state.player;
  if (p.downT > 0) return; // downed riders are stepped by crash.stepDowned

  const bike = state.cfg.bike;
  const maxSpeed = raceMaxSpeed(state);

  // Longitudinal: throttle / brake / coast.
  if (input.throttle) {
    p.speed = approach(
      p.speed,
      maxSpeed,
      PLAYER.accelMul * maxSpeed * bike.accelMul * dt,
    );
  } else if (input.brake) {
    p.speed = approach(p.speed, 0, PLAYER.brakeMul * maxSpeed * bike.brakeMul * dt);
  } else {
    p.speed = approach(p.speed, 0, PLAYER.coastMul * maxSpeed * dt);
  }

  // Off-road: hard cap plus extra drag while above it.
  p.offRoad = Math.abs(p.x) > ROAD_EDGE;
  const offRoadLimit = PLAYER.offRoadLimitMul * maxSpeed;
  if (p.offRoad && p.speed > offRoadLimit) {
    p.speed = approach(p.speed, offRoadLimit, PLAYER.offRoadDecelMul * maxSpeed * dt);
  }

  const speedFrac = p.speed / maxSpeed;

  // Steering authority falls with speed; wobble both damps input and injects
  // a deterministic shake (time-based sine — no rng allowed here).
  const steerIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const authority = 1 - speedFrac * PLAYER.steerSpeedFalloff;
  const effectiveSteer =
    steerIn * authority * (1 - p.wobble * 0.5) +
    Math.sin(state.time * 37) * p.wobble * 0.35;
  p.x += effectiveSteer * PLAYER.steerRate * bike.steerMul * dt;
  p.steer = steerIn;

  // Centrifugal pull on curves: positive curve shoves the rider left (outward).
  const seg = findSegment(state.track, p.z);
  p.x -=
    seg.curve *
    speedFrac *
    PLAYER.centrifugal *
    dt *
    (p.speed * dt / SIM.segmentLength + 0.3);

  p.x = clamp(p.x, -PLAYER.xClamp, PLAYER.xClamp);
  // Point-to-point race: z is never wrapped here; finish detection is race.ts's job.
  p.z += p.speed * dt;

  p.lean = clamp(
    steerIn * (0.4 + 0.6 * speedFrac) - seg.curve * 2 * speedFrac,
    -1,
    1,
  );

  if (p.invulnT > 0) p.invulnT = Math.max(0, p.invulnT - dt);

  // HP regen after riding clean (combat resets cleanT on every hit given/taken).
  p.cleanT += dt;
  if (p.cleanT > PLAYER.regenDelay) {
    p.hp = Math.min(MAX_HP, p.hp + PLAYER.hpRegen * dt);
  }
}

/**
 * Shared kinematics for AI riders: move speed toward targetSpeed (using the
 * same accel/brake profile as the player), steer toward targetX, apply
 * centrifugal drift, advance z, clamp x. Riders being knocked down must be
 * stepped by crash.ts instead.
 */
export function moveRider(
  state: RaceState,
  r: Rider,
  targetSpeed: number,
  targetX: number,
  dt: number,
): void {
  if (r.downT > 0) return;

  // AI riders use the base level cap, not the player's bike top speed.
  const maxSpeed = MAX_SPEED * state.cfg.level.maxSpeedMul;
  if (targetSpeed > r.speed) {
    r.speed = approach(r.speed, targetSpeed, PLAYER.accelMul * maxSpeed * dt);
  } else {
    r.speed = approach(r.speed, targetSpeed, PLAYER.coastMul * maxSpeed * dt);
  }

  const speedFrac = r.speed / maxSpeed;

  // Steer toward the requested line at a rate-limited fraction of player lock.
  const maxDx = PLAYER.steerRate * AI_STEER_MUL * dt;
  const dx = clamp(targetX - r.x, -maxDx, maxDx);
  r.x += dx;
  r.steer = maxDx > 0 ? clamp(dx / maxDx, -1, 1) : 0;

  // Same centrifugal drift as the player so rivals hold believable lines.
  const seg = findSegment(state.track, r.z);
  r.x -=
    seg.curve *
    speedFrac *
    PLAYER.centrifugal *
    dt *
    (r.speed * dt / SIM.segmentLength + 0.3);

  r.x = clamp(r.x, -PLAYER.xClamp, PLAYER.xClamp);
  r.z += r.speed * dt; // never wrapped (finish detection is race.ts's job)
  r.offRoad = Math.abs(r.x) > ROAD_EDGE;

  r.lean = clamp(
    r.steer * (0.4 + 0.6 * speedFrac) - seg.curve * 2 * speedFrac,
    -1,
    1,
  );

  if (r.invulnT > 0) r.invulnT = Math.max(0, r.invulnT - dt);
}

/** Speed cap for this race in world units/second (level + bike adjusted). */
export function raceMaxSpeed(state: RaceState): number {
  return SIM.segmentLength / SIM.step * state.cfg.level.maxSpeedMul * state.cfg.bike.topSpeedMul;
}
