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

/** Any non-downing hit staggers the victim for this long [spec §3.2 "too late"]. */
export const HITSTUN_MS = 350;

/** Vertical impulse applied when a knockdown lands the victim on the ground. */
export const KNOCKDOWN_VELY = 3.5;

/** Time a downed fighter stays grounded before standing back up. */
export const DOWNED_GROUND_MS = 900;

/**
 * A move may be chained from recovery once at most this much of it is left
 * (late-recovery cancel window; earlier presses are ignored, active-phase
 * presses are buffered into it).
 */
export const RECOVERY_CHAIN_MIN_MS = 100;

/**
 * Presses during startup/active fire as soon as the current move finishes —
 * buffered input for exactly one queued action.
 */
export const INPUT_BUFFER_MS = 200;

