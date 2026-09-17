import type { RaceState, Rider, Side } from "./types";
import { COMBAT, HUD } from "../config";
import { RNG } from "../core/rng";
import { raceMaxSpeed } from "./bike";
import { startCrash } from "./crash";

// OWNER: Agent B. Fists, boots, knockdowns, cop pressure. Contract per
// .plan.md §5 and §6. Do not change signatures.

/** Hit-flash duration in seconds (visual only). */
const HIT_FLASH_T = 0.25;
/** Bust pressure lost per second while no cop has the player boxed in (plan §6). */
const BUST_DECAY = 0.5;
/** One-shot cop-alert proximity in world units. */
const COP_ALERT_RANGE = 8000;
/** Cop "alongside" window is twice the strike gap (plan: minSideGap * 2). */
const COP_ALONGSIDE_GAP_MUL = 2;
/** Speed drag applied to an attacker whose swing connects. */
const HIT_ATTACKER_DRAG = 0.985;

// Alerted-cop ids per race (WeakMap: dies with the state, no cross-race leaks).
const copAlerts = new WeakMap<RaceState, Set<number>>();

// RaceState does not carry an rng field in the final types, so combat keeps a
// private per-state stream seeded from cfg.seed. If a shared rng is ever
// assigned onto the state at runtime, it takes precedence.
const stateRngs = new WeakMap<RaceState, RNG>();

function rngFor(state: RaceState): RNG {
  const shared = (state as { rng?: RNG }).rng;
  if (shared) return shared;
  let rng = stateRngs.get(state);
  if (!rng) {
    rng = new RNG(state.cfg.seed);
    stateRngs.set(state, rng);
  }
  return rng;
}

function pushToast(state: RaceState, text: string, big = false): void {
  state.toasts.push({ text, t: HUD.toastTime, big });
}

/** The riders `attacker` is allowed to strike. */
function opponentsOf(state: RaceState, attacker: Rider): Rider[] {
  if (attacker.kind === "player") return state.rivals;
  if (attacker.kind === "cop") return [state.player];
  const foes: Rider[] = [state.player];
  for (const r of state.rivals) {
    if (r !== attacker && r.kind === "rival") foes.push(r);
  }
  return foes;
}

/** Closest hittable opponent on `side`, or null. */
function closestTarget(
  state: RaceState,
  attacker: Rider,
  side: Side,
): Rider | null {
  let best: Rider | null = null;
  let bestDz = Infinity;
  for (const t of opponentsOf(state, attacker)) {
    if (!inStrikeRange(attacker, t, side)) continue;
    const dz = Math.abs(t.z - attacker.z);
    if (dz < bestDz) {
      bestDz = dz;
      best = t;
    }
  }
  return best;
}

/** Is `target` hittable by `attacker` on the given side right now? */
export function inStrikeRange(
  attacker: Rider,
  target: Rider,
  side: Side,
): boolean {
  if (attacker.downT > 0 || target.downT > 0) return false;
  if (Math.abs(target.z - attacker.z) > COMBAT.rangeZ) return false;
  // "left" = attacker sits to the target's left (target.x > attacker.x).
  const gap = side === "left" ? target.x - attacker.x : attacker.x - target.x;
  return gap >= COMBAT.minSideGap && gap <= COMBAT.maxSideGap;
}

/**
 * Start an attack swing for the attacker on `side` if the cooldown allows and
 * any target is in range. Picks punch/kick from rng. Returns true if a swing
 * started (emits "swing" + sets attacker attack fields).
 */
export function tryAttack(
  state: RaceState,
  attacker: Rider,
  side: Side,
): boolean {
  if (attacker.attackT > 0 || attacker.attackCd > 0 || attacker.downT > 0) {
    return false;
  }
  if (!closestTarget(state, attacker, side)) return false;

  attacker.attackKind = rngFor(state).chance(0.6) ? "punch" : "kick";
  attacker.attackT = COMBAT.swingTime;
  attacker.attackHitDone = false;
  attacker.attackSide = side;
  // Cooldown runs concurrently with the swing so the next swing needs
  // max(swingTime, cooldown) seconds total.
  attacker.attackCd = COMBAT.cooldown;
  state.events.push({ type: "swing", z: attacker.z, x: attacker.x, side });
  return true;
}

/**
 * Advance attack timers + land impacts at COMBAT.impactAt, decay wobble,
 * roll knockdowns, apply HP regen for clean riders, accumulate cop bust
 * pressure (player slow + cop alongside -> "busted"), emit events/toasts.
 */
export function resolveCombat(state: RaceState, dt: number): void {
  const riders: Rider[] = [state.player, ...state.rivals];

  // 1) Timer advance + wobble decay. Player cleanT is stepped by stepPlayer.
  for (const r of riders) {
    if (r.attackT > 0) r.attackT = Math.max(0, r.attackT - dt);
    if (r.attackCd > 0) r.attackCd = Math.max(0, r.attackCd - dt);
    if (r.hitFlashT > 0) r.hitFlashT = Math.max(0, r.hitFlashT - dt);
    r.wobble = Math.max(0, r.wobble - COMBAT.wobbleDecay * dt);
    if (r.kind !== "player") r.cleanT += dt;
  }

  // 2) Impacts: each swing lands damage exactly once, at its impact point.
  const impactT = COMBAT.swingTime * (1 - COMBAT.impactAt);
  for (const attacker of riders) {
    if (attacker.downT > 0) continue;
    if (attacker.attackT <= 0 || attacker.attackHitDone) continue;
    if (attacker.attackT > impactT) continue;
    attacker.attackHitDone = true;

    const target = closestTarget(state, attacker, attacker.attackSide);
    if (!target) continue; // whiff — target rode out of range mid-swing

    const punch = attacker.attackKind === "punch";
    const damage = punch ? COMBAT.punchDamage : COMBAT.kickDamage;
    const wobbleAdd = punch ? COMBAT.punchWobble : COMBAT.kickWobble;
    // Only the player has a BikeSpec; AI riders weigh in at 1.0.
    const weight = target === state.player ? state.cfg.bike.weight : 1;
    target.hp -= damage;
    target.hitFlashT = HIT_FLASH_T;
    target.wobble += wobbleAdd / weight;
    target.cleanT = 0;
    attacker.cleanT = 0;
    attacker.speed *= HIT_ATTACKER_DRAG;
    state.events.push({ type: "hit-given", z: attacker.z, x: attacker.x });
    state.events.push({
      type: "hit-taken",
      z: target.z,
      x: target.x,
      big: !punch,
    });
    if (attacker === state.player) {
      pushToast(state, "HIT!");
    } else if (target === state.player) {
      pushToast(state, punch ? "PUNCHED!" : "KICKED!");
    }
  }

  // 3) Knockdowns: out of HP, or wobbling hard while moving fast.
  const maxSpeed = raceMaxSpeed(state);
  for (const r of riders) {
    if (r.downT > 0) continue;
    if (r.hp <= 0) {
      startCrash(state, r, "combat");
    } else if (
      r.wobble >= 1 &&
      r.speed > COMBAT.knockdownSpeedFrac * maxSpeed
    ) {
      startCrash(state, r, "wobble");
    } else {
      continue;
    }
    if (r.kind !== "player") pushToast(state, "DOWN!");
  }

  // 4) Cop pressure: an alongside cop boxes the player in while they crawl.
  const player = state.player;
  let pressured = false;
  let alerts = copAlerts.get(state);
  if (!alerts) {
    alerts = new Set<number>();
    copAlerts.set(state, alerts);
  }
  for (const cop of state.rivals) {
    if (cop.kind !== "cop" || cop.downT > 0) continue;
    const dz = Math.abs(cop.z - player.z);
    if (dz > COP_ALERT_RANGE) {
      alerts.delete(cop.id); // far again — allowed to alert on the next approach
      continue;
    }
    if (!alerts.has(cop.id)) {
      alerts.add(cop.id);
      state.events.push({ type: "cop-alert", z: cop.z, x: cop.x });
    }
    if (
      dz <= COMBAT.rangeZ &&
      Math.abs(cop.x - player.x) <= COMBAT.minSideGap * COP_ALONGSIDE_GAP_MUL &&
      player.speed < COMBAT.copBustSpeedFrac * maxSpeed
    ) {
      pressured = true;
    }
  }
  if (pressured) {
    state.bustPressure += dt / COMBAT.copBustTime;
  } else {
    state.bustPressure = Math.max(0, state.bustPressure - BUST_DECAY * dt);
  }
  if (state.bustPressure >= 1 && state.phase === "racing") {
    state.phase = "busted";
    state.events.push({ type: "busted", z: player.z, x: player.x, big: true });
    pushToast(state, "BUSTED!", true);
  }
}
