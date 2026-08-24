/**
 * Cross-cutting gameplay tuning constants — the single home for numbers the
 * resolver and effect layers share. Move-specific timing/damage lives in
 * moves.ts; anything referenced by name in multiple places belongs here
 * [global constraints: no magic numbers outside src/data/].
 *
 * Plain data only — no three/Rapier imports under src/data/.
 */

/** Mid-air flip stuns nearby attackers for this long [spec §3.1 footnote]. */
export const FLIP_STUN_MS = 1500;

/**
 * Crouch presses longer than this are held state (sneak), not a timed
 * reverse attempt [spec §3.2 "timed press = reverse"].
 */
export const REVERSE_PRESS_WINDOW_MS = 250;

/** Stealth kill needs |relAngle| at least this far behind the actor (rad). */
export const STEALTH_BEHIND_HALF_RAD = Math.PI - 0.6;

/** Leg cannon dive needs the target inside this front half-cone (rad). */
export const LEG_CANNON_AHEAD_HALF_RAD = 1.0;
