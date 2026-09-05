/**
 * Engagement — utility-based attack pick for the enemy brain.
 *
 * Pure decision over (self, target, rng, antiRep, params). No FighterSim, no
 * clock, no RNG internals beyond the injected seeded `rng` closure. Reverse
 * attempts are gated on the target being mid-startup past the difficulty's
 * reaction delay; every other pick is a max of `damage × hitProbability ×
 * antiRep penalty`, with a hard cap so one move can never exceed 3× in a row.
 */

import { AI_MOVE_HARD_CAP } from '../data/tuning';
import { MOVES } from '../data/moves';
import type { MoveDef, MoveId, MovePhase, Stance, WeaponClass } from '../combat/types';
import { penaltyFor } from '../combat/antirepetition';
import type { AntiRepState } from '../combat/antirepetition';
import type { Rng } from '../core/rng';

/** A positioned, moving view of the target the brain is fighting. */
export interface AttackTarget {
  /** Ground-plane distance to the target (m). */
  dist: number;
  /** Target locomotion/combat stance; `downed` = on the ground. */
  stance: Stance | 'downed';
  /** The move the target is mid-executing, if any. */
  activeMove?: { id: MoveId; phase: MovePhase; phaseMsElapsed: number };
}

/** Difficulty-derived parameters that shape a single decision. */
export interface EngageParams {
  /** Delay (ms) before the brain may answer an inbound startup. */
  reactionMs: number;
  /** Probability a reacted brain commits the reverse attempt (0..1). */
  reversalChance: number;
}

/** A fighter's weapon reach — drives which attack rows are eligible. */
export interface AttackerView {
  hasWeapon: WeaponClass | null;
}

/** Strictly-ordered melee attack rows the brain may commit, pre-context. */
const BASE_CANDIDATES: MoveId[] = ['punch', 'runningKick', 'legSweep'];

/** Eligibility filter: which melee rows are usable against `target` now. */
function candidatesFor(self: AttackerView, target: AttackTarget): MoveId[] {
  const out: MoveId[] = BASE_CANDIDATES.slice();
  if (self.hasWeapon !== null) out.push('slash');
  if (target.stance === 'downed') out.push('soccerKick');
  return out;
}

/** Consecutive-use count of `move` in `antiRep` (0 when not the active chain). */
function currentStreak(s: AntiRepState, move: string): number {
  if (s.lastMoveIds.length === 0 || s.lastMoveIds[0] !== move) return 0;
  return s.lastMoveIds.length;
}

/**
 * Reach × stance × phase — how likely a move lands right now. A reach beyond
 * the move's range decays the score; a moving/countering target is riskier;
 * downed targets are the most exposed.
 */
function hitProbability(dist: number, move: MoveDef, target: AttackTarget): number {
  const reach =
    dist <= move.rangeM ? 1 : Math.max(0, 1 - (dist - move.rangeM) * 0.5);
  const stanceScale =
    target.stance === 'downed'
      ? 1.2
      : target.stance === 'standing'
        ? 1
        : target.stance === 'crouched'
          ? 0.75
          : 0.6;
  const phaseScale = !target.activeMove
    ? 1
    : target.activeMove.phase === 'startup'
      ? 0.5
      : 0.4;
  return reach * stanceScale * phaseScale;
}

/**
 * Choose the brain's next combat action: `'reverseAttempt'` when an in-window
 * startup arrives and the reaction fires, otherwise the highest-utility melee
 * move (hard cap bans any move already at 3 consecutive uses), or `null` when
 * nothing is worth committing.
 */
export function pickAttack(
  self: AttackerView,
  target: AttackTarget,
  rng: Rng,
  antiRep: AntiRepState,
  params: EngageParams,
): MoveId | 'reverseAttempt' | null {
  // Reversal gate: answer an inbound startup once the difficulty's reaction
  // delay has elapsed, with probability reversalChance.
  const move = target.activeMove;
  if (
    move &&
    move.phaseMsElapsed >= params.reactionMs &&
    (move.phase === 'startup' || move.phase === 'active') &&
    rng() < params.reversalChance
  ) {
    return 'reverseAttempt';
  }

  // Utility: maximize damage × hit chance × anti-repetition pressure.
  let best: MoveId | null = null;
  let bestScore = -1;
  for (const id of candidatesFor(self, target)) {
    const streak = currentStreak(antiRep, id);
    if (streak >= AI_MOVE_HARD_CAP) continue;
    const def = MOVES[id];
    const score =
      def.damage * hitProbability(target.dist, def, target) * penaltyFor(antiRep, id);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
