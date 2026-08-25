/**
 * Reversals and counter-reversals [spec §3.2] — the soul of Lugaru combat.
 * A defender who times a crouch press inside the incoming attack's
 * reversalWindow while facing the attacker converts the move into a
 * reversal; the original attacker then has a tighter counterWindow to
 * counter-reverse with a 15-damage throw that downs the reverser.
 *
 * Pure functions over plain FighterState — no sim class, no clock, no RNG.
 * Timing authority stays with the caller: the sim reads its own timers,
 * this module only answers "given elapsedMs / remaining hitstun, what
 * happens?"
 */

import type { FighterState, HitEvent } from './stateMachine';
import type { MoveDef } from './types';
import { angleDiff } from './hitdetect';
import {
  COUNTER_WINDOW_MS,
  REVERSE_DAMAGE,
  REVERSAL_HALF_ANGLE_RAD,
} from '../data/tuning';

/** Outcome of one reversal attempt. */
export type ReversalOutcome = 'success' | 'early' | 'late' | 'notFacing';

/**
 * Attempt a reversal of the attacker's in-flight move at `elapsedMs`
 * (absolute ms from attacker's move start).
 *
 * Window semantics are INCLUSIVE on both ends: success iff
 * window.from ≤ elapsed ≤ window.to; below from → 'early'; above to →
 * 'late'. Facing requires angleDiff strictly below the shared
 * REVERSAL_HALF_ANGLE_RAD cone (exactly at the edge → 'notFacing').
 * A move without a reversalWindow is never reversible ('late').
 */
export function tryReversal(
  defender: FighterState,
  incoming: { attacker: FighterState; def: MoveDef; elapsedMs: number },
): ReversalOutcome {
  const win = incoming.def.reversalWindow;
  if (win === undefined) return 'late';

  if (incoming.elapsedMs < win.from) return 'early';
  if (incoming.elapsedMs > win.to) return 'late';

  const dx = incoming.attacker.pos.x - defender.pos.x;
  const dz = incoming.attacker.pos.z - defender.pos.z;
  if (dx === 0 && dz === 0) return 'success'; // co-located: trivially facing

  const bearing = Math.atan2(-dx, -dz); // heading that would face the attacker
  if (angleDiff(defender.heading, bearing) >= REVERSAL_HALF_ANGLE_RAD) return 'notFacing';

  return 'success';
}

/**
 * What a granted counter-reversal does to the reverser.
 */
export interface CounterResult {
  /** true iff the counter window was still open. */
  granted: boolean;
  /**
   * applyHit-ready strike when granted (downs the reverser, REVERSE_DAMAGE).
   * Omitted when not granted.
   */
  effect?: HitEvent;
}

/**
 * Counter-reversal attempt by the ORIGINAL attacker, right after eating a
 * successful reversal.
 *
 * Timing contract: the sim cancels the reversed attacker into hitstun whose
 * duration IS the counter window (COUNTER_WINDOW_MS wide), so "called within
 * counterWindow of the reversal's own animation" ⇔ the attacker still sits
 * in that hitstun with time left. Boundary pinned inclusive:
 * phaseMsLeft > 0 grants; fully drained (≤ 0) or any non-hitstun phase does
 * not. On grant, returns an applyHit-ready throw effect (bodyThrow row
 * semantics: downs the reverser, REVERSE_DAMAGE).
 */
export function startCounter(originalAttacker: FighterState, reverserId: string): CounterResult {
  if (
    originalAttacker.phase.t !== 'hitstun' ||
    originalAttacker.phase.phaseMsLeft <= 0 ||
    originalAttacker.phase.phaseMsLeft > COUNTER_WINDOW_MS
  ) {
    return { granted: false };
  }
  return {
    granted: true,
    effect: {
      attackerId: originalAttacker.id,
      victimId: reverserId,
      moveId: 'counterThrow',
      dirVector: { x: 0, z: 0 }, // throw: direction resolved by applyHit's knockdown
    },
  };
}

// Re-exported so consumers import the whole reversal surface from one module;
// tuning.ts remains the owning declaration.
export { REVERSE_DAMAGE, COUNTER_WINDOW_MS, REVERSAL_HALF_ANGLE_RAD };
