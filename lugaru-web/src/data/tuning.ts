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

/**
 * Stealth kill geometry [Task 18]: the attacker must sit within this
 * half-angle of the victim's TAIL [brief: "behind within ±60° of the
 * victim's heading"] — i.e. at least π − this far from the victim's front.
 * (Supersedes the old π−0.6 behind test: the rear cone is the spec'd one.)
 */
export const STEALTH_REAR_HALF_RAD = Math.PI / 3;

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

// --- Stealth kills [Task 18] -------------------------------------------------

/**
 * HP a spineCrusher (unarmed/staff stealth kill) removes from a surviving
 * victim [brief Task 18: "else 35"].
 */
export const STEALTH_SPINE_CRUSHER_DAMAGE = 35;
/**
 * A spineCrusher KOs outright below this victim hp [brief Task 18:
 * "down+KO if hp<30"]. (Kill attribution catches the overlap band anyway —
 * 35 damage from exactly 30..35 hp also lands a KO — but the flag is the
 * pure result's honest answer for the weak-victim branch.)
 */
export const STEALTH_SPINE_CRUSHER_KO_HP = 30;


// --- Render feedback thresholds [Task 14] ---

/** Fall speed (m/s) at ground contact that kicks up a dust ring. */
export const HEAVY_LAND_MIN_FALL_MPS = 3;


// --- Perception [Task 15] — sight, hearing, wind, scent field --------------

/** Square arena side length (m); terrain plane is 120×120 centered on origin. */
export const ARENA_SIZE_M = 120;
/** ScentField grid is this many cells per side; cell edge = ARENA/Cells. */
export const SCENT_GRID_CELLS = 48;
/** Constant-hold scalar diffusion coefficient for scent (m²/s). */
export const SCENT_DIFFUSION_D = 0.1;
/** Emission rate (intensity units/s) of an ordinary (unbloodied) emitter. */
export const SCENT_EMIT_RATE_BASE = 0.3;
/** Emission rate (intensity units/s) of a bloodied emitter. */
export const SCENT_EMIT_RATE_BLOODIED = 1.0;
/** Scent intensity a hunting wolf needs to start investigating. */
export const SCENT_DETECT_THRESHOLD = 0.15;

/** Clear-sky visual range (m) for a wolf observer. */
export const SIGHT_RANGE_WOLF_M = 18;
/** Clear-sky visual range (m) for a rabbit observer. */
export const SIGHT_RANGE_RABBIT_M = 14;
/** Total horizontal field of view (rad) shared by all species. */
export const SIGHT_FOV_RAD = (120 * Math.PI) / 180;
/** A crouched target's effective sight range is range × this factor. */
export const CROUCH_SIGHT_MULT = 0.5;
/** A bush's blocking radius (m) for the sight segment test. */
export const BUSH_RADIUS_M = 1;
/** Sight segment must intersect at least this many bushes to be blocked. */
export const BUSHES_BLOCK_COUNT = 2;

/** Hearing reach (m) of a wolf listener (radius = loudness × this). */
export const HEARING_BASE_WOLF_M = 14;
/** Hearing reach (m) of a rabbit listener (radius = loudness × this). */
export const HEARING_BASE_RABBIT_M = 18;

/** How long between wind direction/strength random-walk steps (ms). */
export const WIND_TURN_MS = 20000;
/** Max direction drift per wind step, half-amplitude (rad, ±30°). */
export const WIND_MAX_TURN_RAD = (30 * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Enemy brain [Task 16] — FSM thresholds, difficulty presets, engagement.
// ---------------------------------------------------------------------------

/** Brain enters `engage` once the target is within this range (m). */
export const AI_ENGAGE_RANGE_M = 2.2;
/** `circle` orbit band: the brain keeps the target between these radii (m). */
export const AI_CIRCLE_MIN_M = 4;
export const AI_CIRCLE_MAX_M = 6;
/** The brain flees below this fraction of maxHp. */
export const AI_FLEE_HP_FRACTION = 0.25;
/** `circle` strafe direction flips at random intervals in this window (ms). */
export const AI_STRAFE_FLIP_MIN_MS = 1000;
export const AI_STRAFE_FLIP_MAX_MS = 3000;
/** Hard anti-repetition cap: a move used this many times consecutively is banned. */
export const AI_MOVE_HARD_CAP = 3;
/** `patrol` waypoints are picked within this radius of the spawn point (m). */
export const AI_PATROL_RADIUS_M = 6;
/** `patrol` pauses this long at each waypoint before wandering on (ms). */
export const AI_PATROL_PAUSE_MS = 800;
/** Min gap between brain attack presses (ms) — avoids frame-0 spam. */
export const AI_ATTACK_COOLDOWN_MS = 250;
/** A heard/seen target stays "known" for at most this long before re-sneaking (ms). */
export const AI_MEMORY_TIMEOUT_MS = 4000;
/** Brains beyond this range from a visible target engage directly (chase, m). */
export const AI_CHASE_RANGE_M = 12;

/**
 * Per-difficulty tuning [Task 16 brief]. House of truth for the difficulty
 * numbers — difficulty.ts re-exports these as the `DIFFICULTY` record.
 */
export const DIFFICULTY_PRESETS = {
  // engageLimit: how many packmates may be in 'engage' at once [Task 18
  // group gate] — extra brains stay in 'circle'.
  easy: { reactionMs: 550, reversalChance: 0.15, aggression: 0.5, memoryLen: 2, engageLimit: 1 },
  normal: { reactionMs: 320, reversalChance: 0.35, aggression: 0.75, memoryLen: 4, engageLimit: 2 },
  hard: { reactionMs: 170, reversalChance: 0.6, aggression: 1.0, memoryLen: 6, engageLimit: 3 },
} as const;

// --- AI brain steering + utility scales [Task 16 review] ---

/** Utility falloff per metre beyond a move's reach (hitProbability). */
export const AI_HIT_PROB_FALLOFF = 0.5;
/** hitProbability multipliers by target stance. */
export const AI_PROB_SCALE_DOWNED = 1.2;
export const AI_PROB_SCALE_STANDING = 1;
export const AI_PROB_SCALE_CROUCHED = 0.75;
export const AI_PROB_SCALE_RUNNING = 0.6;
/** hitProbability multipliers when the target is mid-move. */
export const AI_PROB_SCALE_TARGET_STARTUP = 0.5;
export const AI_PROB_SCALE_TARGET_ACTIVE = 0.4;
/** Loudness of the flee scream event. */
export const AI_SCREAM_LOUDNESS = 1.5;
/** Waypoint-reached radius (m) for patrol wander. */
export const AI_WAYPOINT_REACHED_M = 0.5;
/**
 * Scent-probe distance (m): with no seen/heard memory, a strong local scent
 * sends the brain investigating this far upwind of its position.
 */
export const AI_SCENT_PROBE_M = 4;



// ---------------------------------------------------------------------------
// Arena dressing [Task 17] — bushes, boulder walls, pickups.
// ---------------------------------------------------------------------------

/**
 * Seed for every arena-scatter RNG stream (bushes, grass, brain). Derive
 * per-consumer streams by offsetting this (seed, seed+1, …) so adding a
 * consumer never reshuffles the existing ones.
 */
export const WORLD_RNG_SEED = 20260823;
/** Bush count in the arena scatter [brief Task 17: ~40]. */
export const BUSH_COUNT = 40;
/**
 * Rustle trigger radius (m) [brief Task 17: 0.8]. Sight blocking uses the
 * larger BUSH_RADIUS_M; the rustle circle sits inside the visible canopy.
 */
export const BUSH_RUSTLE_RADIUS_M = 0.8;
/** Min clearance (m) between a bush and every fighter spawn [brief: 3]. */
export const BUSH_MIN_SPAWN_CLEARANCE_M = 3;
/** Min spacing (m) between two bushes so the scatter never clumps. */
export const BUSH_MIN_SPACING_M = 1.5;
/** Keep-off-edge margin (m) applied to the arena bounds when scattering. */
export const BUSH_SCATTER_MARGIN_M = 4;
/** Loudness of a bush crossed WITHOUT running (crouch-walk) [brief: 0.15]. */
export const BUSH_RUSTLE_CROUCH_LOUDNESS = 0.15;
/**
 * A boulder only counts as a wall-kick wall when it stands at least this
 * tall [brief Task 17: ≥1.6m].
 */
export const WALL_KICK_MIN_HEIGHT_M = 1.6;
/** Crouch-pickup reach (m): a drop within this of a crouching fighter reads weaponOnGroundNearby. */
export const PICKUP_REACH_M = 1.5;
/**
 * Sneak-hold duration (ms) after which the game layer injects the crouch
 * context press that resolves pickupOrContext. Past REVERSE_PRESS_WINDOW_MS
 * so a hold can never read as a reverse attempt, and once per hold episode.
 */
export const CONTEXT_CROUCH_PICKUP_MS = 250;
