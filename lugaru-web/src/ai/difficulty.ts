/**
 * Difficulty — behavior tuning for the enemy brain.
 *
 * Pure data: the numeric presets live in src/data/tuning.ts (the sanctioned
 * home for every gameplay number) and are surfaced here as the typed
 * `DIFFICULTY` record the brain consumes. No three/Rapier, no clock, no RNG.
 */

import { DIFFICULTY_PRESETS } from '../data/tuning';

/** How a difficulty reshapes brain behavior. */
export interface DifficultyDef {
  /** Reaction delay (ms) before the brain may answer an inbound startup. */
  reactionMs: number;
  /** Probability a reacted brain commits a reverse attempt (0..1). */
  reversalChance: number;
  /** Bias 0..1 pushing the brain into melee and attack cadence. */
  aggression: number;
  /** How many memory ticks the brain keeps of the target before forgetting
   *  (scales the base memory timeout; normal = 4 → the flat timeout). */
  memoryLen: number;
  /**
   * [Task 18] Group engagement gate: how many packmates (ally brains) may
   * be in 'engage' simultaneously. At the limit the brain stays in
   * 'circle' instead of engaging — easy 1, normal 2, hard 3.
   */
  engageLimit: number;
}

/** Canonical difficulty presets — easy / normal / hard. */
export const DIFFICULTY: Record<'easy' | 'normal' | 'hard', DifficultyDef> = {
  easy: DIFFICULTY_PRESETS.easy,
  normal: DIFFICULTY_PRESETS.normal,
  hard: DIFFICULTY_PRESETS.hard,
};
