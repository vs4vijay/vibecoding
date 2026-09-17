import type { RaceState, Rider, RiderAI, Side, TrafficCar } from "./types";
import {
  COMBAT,
  MAX_SPEED,
  PLAYER,
  RIVAL,
  RIVAL_COLORS,
  RIVAL_NAMES,
  SIM,
} from "../config";
import { clamp } from "../core/math";
import { moveRider, raceMaxSpeed } from "./bike";
import { tryAttack } from "./combat";
import { startCrash } from "./crash";
import { findSegment } from "./track";
import { checkTrafficHit } from "./traffic";

// OWNER: Agent C. Rival + cop brains. Contract per .plan.md §5 and §6. Do
// not change signatures.

// ---------------------------------------------------------------------------
// AI contract constants (spec numbers from .plan.md §5/§6 — not tunables).
// ---------------------------------------------------------------------------
const SKILL_JITTER = 0.06;
const GRID_X = 0.45; // staggered grid lane offset
const GRID_X_JITTER = 0.08;
const GRID_Z_MIN = 300; // rivals start 300..1500 units ahead of the player
const GRID_Z_MAX = 1500;
const COP_GRID_Z = 150; // cops at the back of the grid, just ahead of the player
const COP_COLOR = "#dfe6f2";
const COP_ACCENT = "#1b2a5e";
const RIVAL_ACCENT = "#16101f";
const COP_AGGRESSION = 0.8;
const COP_NAMES = ["PATROL ONE", "PATROL TWO"] as const;
/** Segments of upcoming curve averaged for line anticipation. */
const CURVE_LOOK_SEGS = 25;
const CURVE_BIAS_GAIN = 6;
const CURVE_BIAS_MAX = 0.5;
/** AI steering-target clamp (keeps racers on the tarmac). */
const LANE_CLAMP = 0.85;
const DECISION_BIAS_RANGE = 0.5;
const DECISION_T_MIN = 1.5;
const DECISION_T_MAX = 4;
/** Scan this far ahead for blocking traffic (same-dir closing window). */
const CAR_AVOID_DIST = 10 * SIM.segmentLength;
const CAR_AVOID_WIDTH = 0.3;
const CAR_AVOID_SHIFT = 0.45;
const RIDER_AVOID_DZ = 700;
const RIDER_AVOID_DX = 0.3;
const RIDER_AVOID_SHIFT = 0.35;
/** Hunt speed floor above the player while chasing. */
const COP_HUNT_CATCHUP = 800;
const COP_BUST_OFFSET = 0.25; // hold this far off the player's line
const COP_ALONGSIDE_DX = 0.5;
/** Rival-vs-rival attack chance per attack window, scaled by aggression. */
const RIVAL_ATTACK_RIVAL = 0.2;
/** attackGap is scaled by (1.6 - aggression). */
const AGGRESSION_GAP_SCALE = 1.6;

/** Fill state.rivals per the level spec and reset id/totalRacers bookkeeping. */
export function spawnRivals(state: RaceState): void {
  const level = state.cfg.level;
  const rng = state.rng;
  const player = state.player;

  state.rivals = [];
  let nextId = state.nextId;

  const addRider = (
    kind: "rival" | "cop",
    gridIndex: number,
    name: string,
    color: string,
    accent: string,
  ): void => {
    const cop = kind === "cop";
    const z = cop
      ? player.z + COP_GRID_Z
      : player.z + rng.range(GRID_Z_MIN, GRID_Z_MAX);
    // Staggered sides; cops hold a clean line (no grid jitter).
    const x =
      (gridIndex % 2 === 0 ? -GRID_X : GRID_X) +
      (cop ? 0 : rng.range(-GRID_X_JITTER, GRID_X_JITTER));
    const rider: Rider = {
      id: nextId++,
      name,
      kind,
      color,
      accent,
      z,
      x,
      speed: 0,
      hp: RIVAL.hp,
      wobble: 0,
      lean: 0,
      steer: 0,
      offRoad: false,
      invulnT: 0,
      downT: 0,
      downSpin: 0,
      attackT: 0,
      attackSide: "left",
      attackKind: null,
      attackHitDone: true,
      attackCd: 0,
      hitFlashT: 0,
      cleanT: 99,
      finished: false,
      finishTime: null,
      place: 0,
      ai: {
        skill: clamp(
          level.rivalSkill + rng.range(-SKILL_JITTER, SKILL_JITTER),
          0.05,
          1,
        ),
        aggression: cop ? COP_AGGRESSION : level.rivalAggression,
        targetX: x,
        decisionT: rng.range(0, 2),
        attackT: rng.range(1, 3),
        mode: cop ? "hunt" : "race",
      },
    };
    state.rivals.push(rider);
  };

  for (let i = 0; i < level.rivalCount; i++) {
    addRider(
      "rival",
      i,
      RIVAL_NAMES[i % RIVAL_NAMES.length]!,
      RIVAL_COLORS[i % RIVAL_COLORS.length]!,
      RIVAL_ACCENT,
    );
  }
  for (let c = 0; c < level.copCount; c++) {
    addRider("cop", level.rivalCount + c, COP_NAMES[c] ?? "PATROL", COP_COLOR, COP_ACCENT);
  }

  state.nextId = nextId;
  state.totalRacers = state.rivals.length + 1;
}

/**
 * Step every rival/cop that is not downed and not finished: pick a target
 * speed (skill + rubber-band per RIVAL config), steer around traffic and
 * other riders toward a racing line that anticipates curve pull, attack the
 * player (or block rivals) per aggression via combat.tryAttack, cops hunt
 * the player and hold alongside while the player is slow (mode "bust").
 * Movement itself goes through bike.moveRider.
 */
export function stepRivals(state: RaceState, dt: number): void {
  const player = state.player;
  const maxSpeed = raceMaxSpeed(state);
  // moveRider brakes AI riders at this rate — the safe-pursuit cap below is
  // built on it so hunting cops can always track their allowed speed.
  const aiBrake = PLAYER.coastMul * MAX_SPEED * state.cfg.level.maxSpeedMul;

  for (const r of state.rivals) {
    const ai = r.ai;
    if (!ai) continue;
    if (r.downT > 0) continue; // crash.stepDowned owns downed riders
    // invulnT is owned by bike.moveRider — deliberately untouched here.

    if (r.finished) {
      // Cruising off into the distance, drifting back to the center line.
      moveRider(state, r, 0.5 * maxSpeed, 0, dt);
      continue;
    }

    if (r.kind === "cop") {
      const alongside =
        Math.abs(r.z - player.z) <= COMBAT.rangeZ &&
        Math.abs(r.x - player.x) < COP_ALONGSIDE_DX;
      ai.mode = alongside ? "bust" : "hunt";
    }

    let targetSpeed: number;
    let targetX: number;

    if (ai.mode === "bust") {
      // Hold alongside the slow player: match their pace, hug their line.
      targetSpeed = player.speed;
      targetX = clamp(
        player.x + (r.x < player.x ? -COP_BUST_OFFSET : COP_BUST_OFFSET),
        -LANE_CLAMP,
        LANE_CLAMP,
      );
    } else {
      targetSpeed =
        (RIVAL.speedFracMin +
          (RIVAL.speedFracMax - RIVAL.speedFracMin) * ai.skill) *
        maxSpeed;
      const dz = r.z - player.z;
      if (dz > RIVAL.rubberbandRange) targetSpeed *= RIVAL.rubberbandAhead;
      else if (dz < -RIVAL.rubberbandRange) {
        targetSpeed *= RIVAL.rubberbandBehind;
      }
      if (ai.mode === "hunt") {
        let hunt = Math.max(targetSpeed, player.speed + COP_HUNT_CATCHUP);
        hunt = clamp(hunt, 0, maxSpeed * RIVAL.copHuntBoost);
        // Safe-pursuit profile: from behind, approach no faster than a
        // full-brake parabola can bleed off by the time the gap closes;
        // from ahead, mirror it so the cop eases back to the player. Keeps
        // the bust capture stable instead of flyby-overshooting.
        const capped = Math.sqrt(
          Math.max(0, player.speed * player.speed + 2 * aiBrake * -dz),
        );
        targetSpeed = Math.min(hunt, capped);
      }

      // Racing line: personal lane bias blended toward the inside of the
      // upcoming curve — better riders read the corner harder.
      let avgCurve = 0;
      for (let k = 1; k <= CURVE_LOOK_SEGS; k++) {
        avgCurve += findSegment(state.track, r.z + k * SIM.segmentLength).curve;
      }
      avgCurve /= CURVE_LOOK_SEGS;
      const insideBias =
        -Math.sign(avgCurve) *
        Math.min(CURVE_BIAS_MAX, Math.abs(avgCurve) * CURVE_BIAS_GAIN);
      targetX = clamp(ai.targetX + insideBias * ai.skill, -LANE_CLAMP, LANE_CLAMP);

      targetX = avoidTraffic(state, r, targetX);
      // Committed attackers keep their line — they need proximity to swing.
      if (r.attackT <= 0) targetX = avoidRiders(state, r, targetX);
    }

    // Periodic re-decision of the personal lane bias.
    ai.decisionT -= dt;
    if (ai.decisionT <= 0) {
      ai.targetX = state.rng.range(-DECISION_BIAS_RANGE, DECISION_BIAS_RANGE);
      ai.decisionT = state.rng.range(DECISION_T_MIN, DECISION_T_MAX);
    }

    moveRider(state, r, Math.max(0, targetSpeed), targetX, dt);

    if (r.invulnT <= 0 && checkTrafficHit(state, r)) {
      startCrash(state, r, "traffic");
    }

    stepAttacks(state, r, ai, dt);
  }
}

/** Distance from x to the nearest scan-window car other than `exclude`. */
function clearance(
  state: RaceState,
  r: Rider,
  x: number,
  exclude: TrafficCar,
): number {
  let best = Infinity;
  for (const car of state.traffic) {
    if (car === exclude || !car.active) continue;
    const dz = car.z - r.z;
    if (dz <= 0 || dz > CAR_AVOID_DIST) continue;
    const d = Math.abs(x - car.x);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Nudge the line off any car directly ahead in the race direction; pick the
 * side with more clearance from other traffic (ties toward the center).
 */
function avoidTraffic(state: RaceState, r: Rider, targetX: number): number {
  let tx = targetX;
  for (const car of state.traffic) {
    if (!car.active) continue;
    const dz = car.z - r.z;
    if (dz <= 0 || dz > CAR_AVOID_DIST) continue;
    if (Math.abs(tx - car.x) >= CAR_AVOID_WIDTH) continue;
    const left = clamp(car.x - CAR_AVOID_SHIFT, -LANE_CLAMP, LANE_CLAMP);
    const right = clamp(car.x + CAR_AVOID_SHIFT, -LANE_CLAMP, LANE_CLAMP);
    const clearLeft = clearance(state, r, left, car);
    const clearRight = clearance(state, r, right, car);
    if (clearLeft > clearRight) tx = left;
    else if (clearRight > clearLeft) tx = right;
    else tx = Math.abs(left) <= Math.abs(right) ? left : right;
  }
  return tx;
}

/** Step away from riders boxed alongside (player included). */
function avoidRiders(state: RaceState, r: Rider, targetX: number): number {
  let tx = targetX;
  const others: Rider[] = [state.player, ...state.rivals];
  for (const o of others) {
    if (o === r || o.downT > 0) continue;
    if (Math.abs(o.z - r.z) >= RIDER_AVOID_DZ) continue;
    if (Math.abs(tx - o.x) >= RIDER_AVOID_DX) continue;
    const dir = tx >= o.x ? 1 : -1;
    tx = clamp(o.x + dir * RIDER_AVOID_SHIFT, -LANE_CLAMP, LANE_CLAMP);
  }
  return tx;
}

/** Strike side if `target` is within strike adjacency, else null. */
function sideOf(attacker: Rider, target: Rider): Side | null {
  if (target.downT > 0) return null;
  if (Math.abs(target.z - attacker.z) > COMBAT.rangeZ) return null;
  const gap = target.x - attacker.x; // >0 => attacker sits left of the target
  if (gap >= COMBAT.minSideGap && gap <= COMBAT.maxSideGap) return "left";
  if (-gap >= COMBAT.minSideGap && -gap <= COMBAT.maxSideGap) return "right";
  return null;
}

/** Countdown the attack timer; on expiry reset it and maybe throw a swing. */
function stepAttacks(state: RaceState, r: Rider, ai: RiderAI, dt: number): void {
  ai.attackT -= dt;
  if (ai.attackT > 0) return;
  // Reset on every expiry whether or not a swing starts: cadence per config.
  ai.attackT =
    state.rng.range(RIVAL.attackGapMin, RIVAL.attackGapMax) *
    (AGGRESSION_GAP_SCALE - ai.aggression);
  if (r.kind !== "rival") return; // cops never attack

  const playerSide = sideOf(r, state.player);
  if (playerSide) {
    tryAttack(state, r, playerSide);
    return;
  }
  // Rarely turn on a neighbouring rival instead.
  if (state.rng.chance(ai.aggression * RIVAL_ATTACK_RIVAL)) {
    for (const o of state.rivals) {
      if (o === r || o.kind !== "rival" || o.downT > 0) continue;
      const side = sideOf(r, o);
      if (side) {
        tryAttack(state, r, side);
        break;
      }
    }
  }
}
