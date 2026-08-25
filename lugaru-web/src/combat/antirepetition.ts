/**
 * Anti-repetition pressure [spec §3.2] — Lugaru's answer to move spamming.
 * Every fired attack is recorded; repeating the same move grows a damage
 * scale linearly from 1.0 (fresh use) to 1.6 (six-hit streak), pinned at the
 * cap beyond. Any different move resets the streak to zero. Pure counters
 * over plain state — no clock, no RNG; allocation only when the history
 * array restarts (amortized zero on hot paths).
 */

/** Streak length at which the penalty reaches its cap [brief: linear to 6]. */
export const ANTIREP_MAX_STREAK = 6;

/** Damage-multiplier ceiling for spammed moves [brief: 1.0 → 1.6]. */
export const ANTIREP_PENALTY_CAP = 1.6;

/**
 * Anti-repetition bookkeeping carried on FighterState. `lastMoveIds` holds
 * the current consecutive-same streak: every entry equals entry 0.
 */
export interface AntiRepState {
  lastMoveIds: string[];
}

/** Fresh, empty tracking state — FighterSim owns one per fighter. */
export function createAntiRepState(): AntiRepState {
  return { lastMoveIds: [] };
}

/**
 * Record one FIRED attack (call at move dispatch, not press). Same move as
 * the running streak extends it toward ANTIREP_MAX_STREAK; any different
 * move restarts the chain with just that id.
 */
export function recordAttack(s: AntiRepState, moveId: string): void {
  const n = s.lastMoveIds.length;
  if (n > 0 && s.lastMoveIds[0] === moveId) {
    // Same chain: grow toward the cap, then hold — a maxed streak is never
    // demoted back to a fresh one by more spamming.
    if (n < ANTIREP_MAX_STREAK) s.lastMoveIds[n] = moveId;
    return;
  }
  s.lastMoveIds.length = 0;
  s.lastMoveIds[0] = moveId;
}

/**
 * Damage scale for `moveId` given the recorded streak. Linear 1.0 →
 * ANTIREP_PENALTY_CAP in ANTIREP_MAX_STREAK−3 equal steps beginning at the
 * second consecutive use, so streak 3 sits exactly mid-ramp (1.4 — the
 * spec-pinned pressure point) and the cap lands at streak 5, holding
 * through the streak cap 6+. No history or a different move reads 1.0.
 * FighterSim multiplies strike damage by this before applying hits.
 */
 export function penaltyFor(s: AntiRepState, moveId: string): number {
  const n = s.lastMoveIds.length;
  const repeats =
    n > 0 && s.lastMoveIds[0] === moveId
      ? Math.min(n - 1, ANTIREP_MAX_STREAK - 3)
      : 0;
  const step = (ANTIREP_PENALTY_CAP - 1) / (ANTIREP_MAX_STREAK - 3);
  return 1 + step * repeats;
 }
