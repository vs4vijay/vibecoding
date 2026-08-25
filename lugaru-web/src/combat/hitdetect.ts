/**
 * Analytic hit detection and hit application.
 *
 * Pure functions over plain FighterState snapshots — no sim class, no
 * three/Rapier. findHit answers "who does this active swing connect with"
 * (range + cone test); applyHit answers "what changes on the fighters touched"
 * (species-scaled damage, knockdown/stagger rules, bleed) and returns the
 * deltas. FighterSim owns swing identity (no-double-hit); these functions
 * stay stateless so tests can drive them directly.
 */

import { SPECIES } from '../data/species';
import { DOWNED_GROUND_MS, HITSTUN_MS, KNOCKDOWN_VELY } from '../data/tuning';
import type { FighterState, HitEvent } from './stateMachine';
import { MOVES } from '../data/moves';

/** Blade weapon tiers whose hits cause bleeding [spec §3.4]. */
const BLADE_CLASSES: ReadonlySet<string> = new Set(['knife', 'sword']);

/** Unit facing vector for a heading: (−sin h, −cos h) — the one definition
 *  shared by hitdetect, FighterSim lunge/locomotion, and target views. */
export function forwardXZ(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}

/**
 * Absolute shortest-arc distance between two headings, in radians [0..π].
 * The one angular-comparison primitive: reversal facing cones, stealth
 * checks and future AI vision all read from here instead of re-rolling
 * their own trig.
 */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d < 0 ? -d : d;
}

/**
 * Every victim inside this active swing's reach: ground-plane distance
 * ≤ rangeM AND |angle from heading| ≤ arcRad/2 (both bounds inclusive).
 */
export function findHit(attacker: FighterState, victims: FighterState[]): HitEvent[] {
  if (attacker.phase.t !== 'active') return [];
  const moveId = attacker.phase.moveId;
  if (moveId === undefined) return [];
  const def = MOVES[moveId];
  if (def === undefined) return [];

  const f = forwardXZ(attacker.heading);
  const fdx = f.x;
  const fdz = f.z;
  // Tiny slack so a victim placed mathematically ON the cone edge connects
  // despite floating-point error.
  const halfArc = def.arcRad / 2 + 1e-9;
  const events: HitEvent[] = [];
  for (let i = 0; i < victims.length; i++) {
    const v = victims[i];
    const dx = v.pos.x - attacker.pos.x;
    const dz = v.pos.z - attacker.pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > (def.rangeM + 1e-9) * (def.rangeM + 1e-9)) continue; // out of reach
    // Signed angle between heading and target direction via cross/dot.
    const cross = fdx * dz - fdz * dx;
    const dot = fdx * dx + fdz * dz;
    if (Math.abs(Math.atan2(cross, dot)) > halfArc) continue; // outside cone
    const dist = Math.sqrt(distSq);
    const invDist = dist > 1e-9 ? 1 / dist : 0;
    events.push({
      attackerId: attacker.id,
      victimId: v.id,
      moveId,
      dirVector:
        invDist > 0 ? { x: dx * invDist, z: dz * invDist } : { x: fdx, z: fdz },
    });
  }
  return events;
}

/**
 * Apply one hit event to its victim (and read the attacker for scaling):
 *
 * - damage × attacker species punchDmgMult, hp clamped at 0;
 * - lethal → phase 'ko' + unconscious flag;
 * - knockdown move vs standing victim → phase 'downed', stance 'downed',
 *   velY impulse KNOCKDOWN_VELY, grounded timer DOWNED_GROUND_MS;
 * - knockdown move vs crouched victim (or non-knockdown hit) → stagger:
 *   phase 'hitstun' for HITSTUN_MS, no impulse [plan Task 7 rule];
 * - blade-class weapon on the attacker flags the victim `bleeding` (checked
 *   before the lethal early-return, so bleeding persists through death).
 *
 * Over-the-ground (OTG) rules — v1 intent, pinned by tests, fix round F5:
 * a knockdown hit on an already-downed victim REFRESHES its ground timer
 * (phaseMsLeft resets to DOWNED_GROUND_MS) and re-applies the velY impulse
 * (juggle); a NON-knockdown hit on a downed victim flips it back up into
 * standing hitstun with zero impulse. Revisit only if Task 14 breaks it.
 *
 * Returns one delta per fighter touched, in application order.
 */
export function applyHit(hit: HitEvent, fighters: FighterState[]): FighterDelta[] {
  let attacker: FighterState | undefined;
  let victim: FighterState | undefined;
  for (let i = 0; i < fighters.length && (attacker === undefined || victim === undefined); i++) {
    const f = fighters[i];
    if (f.id === hit.attackerId) attacker = f;
    else if (f.id === hit.victimId) victim = f;
  }
  if (attacker === undefined || victim === undefined) return [];

  const mult = SPECIES[attacker.species].punchDmgMult;
  const def = MOVES[hit.moveId];
  const dmg = Math.round((def?.damage ?? 0) * mult);

  const deltas: FighterDelta[] = [
    { id: victim.id, hp: -dmg, velY: 0, pushVelX: 0, pushVelZ: 0 },
  ];

  victim.hp -= dmg;

  // Bleed comes from the blade itself, not the move row [spec §3.4] — and
  // applies BEFORE the lethal early-return so bleeding persists through
  // death (fix round F4).
  if (attacker.weapon !== null && BLADE_CLASSES.has(attacker.weapon)) {
    victim.flags.bleeding = true;
  }

  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.flags.unconscious = true;
    victim.stance = 'downed';
    victim.currentMove = undefined;
    victim.moveElapsedMs = 0;
    victim.phase.t = 'ko';
    victim.phase.moveId = undefined;
    victim.phase.phaseMsLeft = Infinity;
    return deltas;
  }

  const downs = (def?.knockdown ?? false) && victim.stance !== 'crouched';
  victim.currentMove = undefined; // getting hit interrupts whatever ran
  victim.moveElapsedMs = 0;
  victim.phase.moveId = undefined;
  if (downs) {
    victim.phase.t = 'downed';
    victim.phase.phaseMsLeft = DOWNED_GROUND_MS;
    victim.velY = KNOCKDOWN_VELY;
    victim.stance = 'downed';
    deltas[0].velY = KNOCKDOWN_VELY;
  } else {
    victim.phase.t = 'hitstun';
    victim.phase.phaseMsLeft = HITSTUN_MS;
    if (victim.stance !== 'airborne') victim.stance = 'standing';
  }

  return deltas;
}

/** What one fighter gained/lost from an applied hit. */
export interface FighterDelta {
  id: string;
  /** HP change (negative). */
  hp: number;
  /** Vertical impulse granted by a knockdown, else 0. */
  velY: number;
  /** Reserved horizontal push along dirVector (Task 14 effect layer). */
  pushVelX: number;
  pushVelZ: number;
}
