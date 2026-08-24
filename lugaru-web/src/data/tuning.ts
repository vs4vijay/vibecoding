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
 * (late-recovery cancel window). Presses earlier in recovery are ignored.
 * Sanctioned Lugaru-feel choice — controller sign-off, Task 7 fix round F9
 * (ledger: task-7-report.md).
 */
export const RECOVERY_CHAIN_MIN_MS = 100;

/**
 * A press during startup/active/early-recovery is buffered for at most this
 * long (one queued action slot). The buffer decrements every update step;
 * when the running move ends (recovery→idle) the buffered move fires iff its
 * remaining window is still > 0. Example pinned by test: press during punch
 * active frames — the move still has ~213ms to run (< 250), so it fires on
 * completion; a press during startup of a long move would expire unspent.
 */
export const INPUT_BUFFER_MS = 250;

// ---------------------------------------------------------------------------
// Shared kinematics — single home for both actors/controller.ts and
// combat/stateMachine.ts (Task 7 fix round F2; controller behavior identical,
// pure refactor).
// ---------------------------------------------------------------------------

/** Downward acceleration (m/s²). */
export const GRAVITY = -14;
/** Instant vertical velocity granted by jump/hop (m/s). */
export const JUMP_SPEED = 5.4;
/** Ground acceleration toward wish velocity (m/s²). */
export const ACCEL = 40;
/** Ground deceleration toward zero velocity when no input (m/s²). */
export const FRICTION = 24;
/** Speed above which grounded stance reads as running (m/s). */
export const RUN_STANCE_SPEED = 4;
/** Heading/pitch/roll smoothing rate (exp-decay constant, 1/s). */
export const TURN_RATE = 12;

/** Nearest-target sense radius for resolver snapshots (m). */
export const TARGET_SENSE_RADIUS_M = 3;

