/**
 * Stealth kills [spec §3.7; Task 18] — the pure gate + weapon-shaped outcome.
 *
 * tryStealthKill is to stealth what bodymoves.applySpecial is to the
 * signature moves: one pure function that reads plain fighter states and
 * answers plain data (or null = no stealth window). It never mutates,
 * never reads the clock, never touches three/Rapier — FighterSim's
 * fireStealthKill consumes the result at the move's fire site and owns
 * every state change, the kill attribution and the STEALTH_KILL award.
 *
 * Gate (all required):
 * - attacker stands (a crouched/running/airborne press never backstabs);
 * - victim alive and not downed (grounded meat is soccerKick territory);
 * - victim unaware — its FSM has no awareness. Awareness is the game
 *   layer's annotation: `FighterState.alerted` is true while the victim's
 *   brain is in investigate/circle/engage/flee/downed (anything but
 *   'patrol'), so "unaware" ⇔ alert flag unset — the same semantics the
 *   resolver reads through TargetSnapshot.unaware;
 * - attacker within MOVES.stealthKill.rangeM (1.1 m);
 * - attacker inside the victim's REAR ±60° cone: the angle between the
 *   victim's facing and the (victim→attacker) direction is at least
 *   π − STEALTH_REAR_HALF_RAD, i.e. the victim faces away.
 *
 * Silence [spec §3.7]: a stealth kill generates NO HearingEvent and the
 * victim never screams — fireStealthKill pushes nothing onto any sound
 * bridge, so nearby patrols stay unaware.
 */

import type { FighterState } from './stateMachine';
import { forwardXZ } from './hitdetect';
import { MOVES } from '../data/moves';
import { STEALTH_REAR_HALF_RAD, STEALTH_SPINE_CRUSHER_DAMAGE, STEALTH_SPINE_CRUSHER_KO_HP } from '../data/tuning';

/** The weapon-shaped stealth move names. */
export type StealthMoveName = 'spineCrusher' | 'tracheotomy' | 'backstabber';

/** One stealth kill's outcome — plain data the sim applies. */
export interface StealthResult {
  moveName: StealthMoveName;
  /** HP removed from a surviving victim; 0 when the kill is instant. */
  damage: number;
  /** True: the victim dies outright regardless of remaining hp. */
  instantKill: boolean;
  /** True: a surviving victim is knocked prone (spineCrusher). */
  knockdown: boolean;
}

/**
 * Resolve one stealth-kill attempt, or null when the window is shut.
 * Pure: reads the two states, returns data.
 */
export function tryStealthKill(attacker: FighterState, victim: FighterState): StealthResult | null {
  if (attacker.stance !== 'standing') return null;
  if (victim.alerted === true) return null; // FSM alerted → no stealth window
  if (victim.stance === 'downed' || victim.phase.t === 'downed' || victim.phase.t === 'ko') {
    return null;
  }

  const dx = attacker.pos.x - victim.pos.x;
  const dz = attacker.pos.z - victim.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > MOVES.stealthKill.rangeM) return null;

  // Attacker in the victim's rear ±60° cone (degenerate same-spot → behind).
  if (dist > 1e-6) {
    const vf = forwardXZ(victim.heading);
    const dot = (vf.x * dx + vf.z * dz) / dist; // cos of the off-front angle
    if (dot > Math.cos(Math.PI - STEALTH_REAR_HALF_RAD)) return null;
  }

  switch (attacker.weapon) {
    case 'knife': // tracheotomy
      return { moveName: 'tracheotomy', damage: 0, instantKill: true, knockdown: false };
    case 'sword': // backstabber
      return { moveName: 'backstabber', damage: 0, instantKill: true, knockdown: false };
    default: // unarmed and staff (blunt pommel): spine crusher
      return {
        moveName: 'spineCrusher',
        damage: STEALTH_SPINE_CRUSHER_DAMAGE,
        instantKill: victim.hp < STEALTH_SPINE_CRUSHER_KO_HP,
        knockdown: true,
      };
  }
}
