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
  // engageLimit (per-plan) intentionally cut: group attack-coordination has
  // no consumer until Task 18's group AI — reintroduce there with a reader.
}

/** Canonical difficulty presets — easy / normal / hard. */
export const DIFFICULTY: Record<'easy' | 'normal' | 'hard', DifficultyDef> = {
  easy: DIFFICULTY_PRESETS.easy,
  normal: DIFFICULTY_PRESETS.normal,
  hard: DIFFICULTY_PRESETS.hard,
};
