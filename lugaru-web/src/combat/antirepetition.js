/**
 * Anti-repetition pressure [spec §3.2] — Lugaru's answer to move spamming.
 * Every FIRED attack is recorded (at the fire site, never at press time);
 * repeating the same move grows a damage scale linearly from 1.0 to
 * ANTIREP_PENALTY_CAP, reaching the cap by streak ANTIREP_MAX_STREAK. Any
 * different move resets the streak. Pure counters over plain state — no
 * clock, no RNG; allocation only when a chain restarts (amortized zero).
 */
import { ANTIREP_MAX_STREAK, ANTIREP_PENALTY_CAP, ANTIREP_RAMP_START, } from '../data/tuning';
/** Fresh, empty tracking state — FighterSim owns one per fighter. */
export function createAntiRepState() {
    return { lastMoveIds: [] };
}
/**
 * Record one attack that ACTUALLY FIRED (immediate start, recovery-chain
 * fire, or buffer fire — never a buffered-but-expired press). Same move as
 * the running streak extends it toward ANTIREP_MAX_STREAK; any different
 * move restarts the chain with just that id.
 */
export function recordAttack(s, moveId) {
    const n = s.lastMoveIds.length;
    if (n > 0 && s.lastMoveIds[0] === moveId) {
        // Same chain: grow toward the cap, then hold — a maxed streak is never
        // demoted back to a fresh one by more spamming.
        if (n < ANTIREP_MAX_STREAK)
            s.lastMoveIds[n] = moveId;
        return;
    }
    s.lastMoveIds.length = 0;
    s.lastMoveIds[0] = moveId;
}
/**
 * Damage scale for `moveId` given the recorded streak: one free use, then
 * ANTIREP_MAX_STREAK − ANTIREP_RAMP_START − 1 equal linear steps from 1.0
 * up to ANTIREP_PENALTY_CAP (so streak 3 sits exactly mid-ramp at 1.4 —
 * the brief's pinned pressure point — and the cap lands well inside the
 * streak cap, holding through it). No history or a different move reads
 * 1.0. FighterSim multiplies strike damage by this when hits are applied.
 */
export function penaltyFor(s, moveId) {
    const n = s.lastMoveIds.length;
    const steps = ANTIREP_MAX_STREAK - ANTIREP_RAMP_START - 1;
    const repeats = n > 0 && s.lastMoveIds[0] === moveId
        ? Math.min(n - ANTIREP_RAMP_START + 1, steps)
        : 0;
    return 1 + ((ANTIREP_PENALTY_CAP - 1) / steps) * repeats;
}
