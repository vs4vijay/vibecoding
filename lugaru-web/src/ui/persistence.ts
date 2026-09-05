/**
 * localStorage-backed best-score persistence [spec §9].
 *
 * Guarded try/catch on every read/write: when localStorage is absent or
 * throws (private browsing, quota exceeded), the game continues; scores
 * simply don't persist. Pure UI-layer module — no three/Rapier, no sim.
 */

import type { Difficulty } from '../types';

const LS_KEY = 'lugaru-best-scores';
type BestScores = Record<Difficulty, number>;

/**
 * Load the per-difficulty best scores from localStorage.
 * Returns null when the key is absent, the JSON is invalid, or
 * localStorage itself is unavailable.
 */
export function loadBests(): BestScores | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as BestScores;
  } catch {
    return null;
  }
}

/**
 * Persist a score for the given difficulty.
 * Only overwrites when the new score exceeds the existing best.
 * Returns true on success or when no write was needed, false on error.
 */
export function saveBest(difficulty: Difficulty, score: number): boolean {
  try {
    const existing: BestScores = loadBests() ?? ({} as BestScores);
    const prev = existing[difficulty];
    if (prev !== undefined && prev >= score) return true; // no improvement
    existing[difficulty] = score;
    localStorage.setItem(LS_KEY, JSON.stringify(existing));
    return true;
  } catch {
    return false;
  }
}