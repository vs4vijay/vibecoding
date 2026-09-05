/**
 * Shared types across game shell modules — plain data only.
 *
 * TutorialStep: one gated step of the interactive tutorial.
 * Difficulty: the three selectable difficulty presets.
 */

/** One step of the tutorial sequence. */
export interface TutorialStep {
  /** Stable identifier for branching logic in game.ts (e.g. 'movement', 'punch'). */
  id: string;
  /** Bottom-center hint text shown while this step is active. */
  hint: string;
}

/** Named difficulty preset matching DIFFICULTY_PRESETS keys in tuning.ts. */
export type Difficulty = 'easy' | 'normal' | 'hard';
