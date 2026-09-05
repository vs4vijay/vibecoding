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

/** Defender's reversal facing cone half-angle (rad) [spec §3.2]. */
export const REVERSAL_HALF_ANGLE_RAD = (100 * Math.PI) / 180;

/**
 * Counter-reversal window width (ms) — how long the reversed original
 * attacker may answer with the 15-damage downing throw [spec §3.2].
 */
export const COUNTER_WINDOW_MS = 240;

/** Counter-reversal throw damage dealt to the reverser [spec §3.2: 15]. */
export const REVERSE_DAMAGE = 15;

/**
 * Defender's reversal animation length (ms) — a short committed window
 * during which the counter-reversal remains answerable. Tuned shorter than
 * COUNTER_WINDOW_MS so the attacker always keeps a beat to react.
 */
export const REVERSE_ATTEMPT_MS = 180;

/**
 * Anti-repetition pressure [spec §3.2]: repeating the same move grows its
 * damage scale linearly from 1.0 to ANTIREP_PENALTY_CAP, reaching the cap
 * at streak ANTIREP_MAX_STREAK. Any different move resets the streak.
 */
export const ANTIREP_MAX_STREAK = 6;
/** Damage-multiplier ceiling for spammed moves [brief: 1.0 → 1.6]. */
export const ANTIREP_PENALTY_CAP = 1.6;
/** Consecutive uses of one move before the penalty ramp begins. */
export const ANTIREP_RAMP_START = 2;

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
 * (late-recovery cancel window). Presses earlier in recovery are NOT
 * ignored — they fall into the input buffer and fire when the running
 * move ends iff their window is still alive. Sanctioned Lugaru-feel
 * choice — controller sign-off, Task 7 fix round F9
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

// ---------------------------------------------------------------------------
// Injury model [spec §3.4; Task 9] — the diegetic health layer.
// ---------------------------------------------------------------------------

/** Bleeding drains this many hp per second while flags.bleeding holds. */
export const BLEED_DPS = 2;
/**
 * Bleed can never take a fighter below this hp — wounds weaken, only a
 * real hit finishes. A fresh strike may still drop hp to ≤ 0 and KO.
 */
export const BLEED_HP_FLOOR = 1;
/** Fraction of maxHp below which the fighter limps [brief: 40%]. */
export const LIMP_HP_FRACTION = 0.4;

// ---------------------------------------------------------------------------
// Scoring [spec §3.6; Task 9] — combo chain + named bonus awards.
// ---------------------------------------------------------------------------

/** Hits inside this window since the last one keep the combo chain alive. */
export const COMBO_WINDOW_MS = 2500;
/** Combo chain points for hits 1–5 [spec: ×2 ×4 ×8 ×16, base 66]. */
export const COMBO_CHAIN_POINTS: readonly number[] = [66, 133, 266, 533, 1066];
/**
 * Past the chain peak, each extra hit is worth COMBO_DECAY_NUMERATOR /
 * (hits past peak + 1), rounded — 533, 355, 267, … decaying toward zero
 * [brief: "decay past 5th: 533/355/…"].
 */
export const COMBO_DECAY_NUMERATOR = 1066;
/** Reversal success award [spec §3.6: Reversal 30]. */
export const SCORE_REVERSAL = 30;
/** Reversal that ends in the victim's KO [spec §3.6: 100]. */
export const SCORE_REVERSAL_KO = 100;
/** Silent behind-kill on an unaware enemy [spec §3.7 → §3.6: 100]. */
export const SCORE_STEALTH_KILL = 100;
/** Running jump-kick cannon [spec §3.6: Leg cannon 100]. */
export const SCORE_LEG_CANNON = 100;
/** Body-thrown corpse connects with an enemy [spec §3.6: Nice Aim 150]. */
export const SCORE_NICE_AIM = 150;
/** Wall-kick kill style bonus [spec §3.6: Style bonus 150]. */
export const SCORE_STYLE_WALLKICK = 150;
/** Mid-air knife throw kill [spec §3.6: Ninja bonus 60]. */
export const SCORE_NINJA_THROW = 60;

// --- Thrown knife hit geometry [Task 12] ---

/** Minimum travel distance (m) before a knife's flight ray is cast. */
export const KNIFE_HIT_MIN_TRAVEL_M = 0.05;
/** Distance (m) from a fighter's chest point within which a knife impact hits. */
export const KNIFE_HIT_RADIUS_M = 0.7;
/** Chest offset (m) above a fighter's root position used for knife hits. */
export const KNIFE_HIT_CHEST_Y_M = 0.4;

// --- Render/sim integration timing [Task 11] ---

/** Hitstop freeze duration on landing a hit (ms). [spec §3.5] */
export const HITSTOP_MS = 90;
/** Slow-motion scale factor on KO. */
export const KO_SLOWMO_SCALE = 0.25;
/** Slow-motion duration on KO (ms). */
export const KO_SLOWMO_MS = 900;

// --- Weapons [Task 13] -----------------------------------------------------

/**
 * Per-clash chance (seeded rng) that a weapon involved in a clash is knocked
 * flying, independent of durability wear [brief Task 13: "random < 0.15"].
 */
export const CLASH_BREAK_CHANCE = 0.15;
/** Durability a weapon with a WEAPONS durability loses per clash survived. */
export const CLASH_WEAR_PER_CLASH = 1;
/** Launch speed (m/s) of a weapon knocked loose, away from the opponent. */
export const CLASH_KNOCK_SPEED_MPS = 4;
/** Launch speed (m/s) the game layer hands a thrown knife's Rapier body. */
export const THROWN_KNIFE_SPEED_MPS = 18;
/** Fixed seed for the combat rng the game layer feeds clash rolls. */
export const COMBAT_RNG_SEED = 20260823;

// --- Body mechanics [Task 14] -----------------------------------------------

/**
 * Knockback launch speed (m/s) a landed leg cannon fires the victim away
 * with, along the attacker's facing [brief Task 14: "massive knockback"].
 */
export const LEG_CANNON_KNOCK_SPEED_MPS = 12;
/** Launch speed (m/s) the attacker leaves a wallKick wall with. */
export const WALL_KICK_LAUNCH_MPS = 7;
/** Horizontal launch speed (m/s) of a corpse hurled by a body throw. */
export const BODY_THROW_SPEED_MPS = 8;
/**
 * Damage a thrown corpse deals when it connects with an enemy [spec §3.1:
 * body-as-projectile 40] — the bodyThrow row's own damage stays 0 because
 * the throw itself never hurts anyone.
 */
export const BODY_THROW_IMPACT_DAMAGE = 40;


// --- Render feedback thresholds [Task 14] ---

/** Fall speed (m/s) at ground contact that kicks up a dust ring. */
export const HEAVY_LAND_MIN_FALL_MPS = 3;
