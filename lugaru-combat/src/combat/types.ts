/**
 * Combat domain types — plain data only.
 *
 * HARD RULE: nothing under src/combat/ or src/data/ may import three/Rapier.
 * Everything here is a pure snapshot the resolver reads; the controller and
 * renderer translate live class state into these snapshots each step.
 *
 * `Stance` is deliberately re-declared here instead of importing from
 * src/actors/controller.ts: combat stays decoupled from actors, and the two
 * unions are structurally identical so values flow across without casts.
 */

/** Locomotion stance snapshot (mirrors actors/controller.ts `Stance`). */
export type Stance = 'standing' | 'running' | 'crouched' | 'airborne';

export type ActionButton = 'attack' | 'jump' | 'crouch';

/**
 * Every move the resolver can emit. `counterThrow` is the Task 8
 * counter-reversal throw (never resolver-emitted — startCounter produces
 * it); `reverseAttempt` sits in the union for contract completeness but has
 * no MOVES row — a reversal attempt is an outcome ({kind:'reverse'}), not a
 * played clip.
 * Armed moves (`slash`, `stab`, `staffVert`, `staffHoriz`) are Task 13's
 * dispatch to add to this union and the table.
 */
export type MoveId =
  | 'punch'
  | 'doublePunch'
  | 'slash'
  | 'runningKick'
  | 'legSweep'
  | 'wallKick'
  | 'soccerKick'
  | 'airGrab'
  | 'legCannon'
  | 'jump'
  | 'hop'
  | 'flip'
  | 'tackle'
  | 'pickupOrContext'
  | 'slideStop'
  | 'stealthKill'
  | 'bodyThrow'
  | 'cleanBlade'
  | 'reverseAttempt'
  | 'counterThrow';

/** What resolveAction decides for one button press. */
export type ResolveResult = { kind: 'move'; id: MoveId } | { kind: 'reverse'; targetId: string };

/** Weapon tier a fighter holds; `null` = unarmed. */
export type WeaponClass = 'none' | 'knife' | 'sword' | 'staff';

/** Attack phase within startup → active → recovery. */
export type MovePhase = 'startup' | 'active' | 'recovery';

/** Inclusive ms sub-range of a move's timeline (0 = move start). */
export interface TimingWindow {
  /** ms from move start where the window opens. */
  from: number;
  /** ms from move start where the window closes. */
  to: number;
}

/**
 * One row of the move table. Every gameplay timing/damage number in the game
 * lives in instances of this shape (src/data/moves.ts) — magic numbers
 * elsewhere are review rejections [global constraints].
 */
export interface MoveDef {
  id: MoveId;
  /** Clip name played while the move runs (consumed by Task 7/8 wiring). */
  clip: string;
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
  /** Reach in meters — attacks whiff beyond this target distance. */
  rangeM: number;
  /** Half-angle of the hit cone in radians (π = all around). */
  arcRad: number;
  /** Base damage before the attacker's species punchDmgMult. */
  damage: number;
  /** True: on-hit knockdown puts the victim on the ground. */
  knockdown: boolean;
  /**
   * Forward dash velocity (m/s) applied along the attacker's heading for the
   * whole active phase; absent/0 = stationary attack.
   */
  lungeSpeed?: number;
  /**
   * Defender crouch-press window (ms from attacker's move start) for a
   * reversal [spec §3.2]. Sub-range of startup+active.
   */
  reversalWindow?: TimingWindow;
  /**
   * Original attacker's tighter counter-window, centered on the reversal
   * impact moment (±120ms) [spec §3.2].
   */
  counterWindow?: TimingWindow;
  /** Move only resolves vs a target in crouched stance (low kick). */
  requiresCrouchedTarget?: boolean;
  /** Move only resolves vs a downed target. */
  requiresDownedTarget?: boolean;
  /** Move only resolves vs an airborne target. */
  requiresAirborneTarget?: boolean;
  /** Wall must be within this distance (m) for the move to resolve. */
  requiresWallWithinM?: number;
  /** Move only resolves vs an unaware target we stand behind. */
  requiresBehindUnaware?: boolean;
  /**
   * Armed swing [Task 13]: damage and reach resolve from the wielder's
   * WEAPONS row (src/data/weapons.ts) at swing time; this row's own
   * rangeM/damage are the unarmed fallback (the shared `slash` row: 0 —
   * an empty hand whiffs harmlessly).
   */
  armedSwing?: boolean;
  /** Weapon class required to hold for this move (`'none'` = unarmed-only). */
  weaponClass?: WeaponClass;
}

// ---------------------------------------------------------------------------
// Resolver snapshots — plain objects, no class instances, no engine types.
// ---------------------------------------------------------------------------

/** World facts around the actor that gate context moves. */
export interface WorldContext {
  /** A downed/unconscious body lies within body-throw reach. */
  downedBodyNearby: boolean;
  /** A dropped weapon lies within pickup reach. */
  weaponOnGroundNearby: boolean;
  /** The actor itself is off the ground (mid-jump/fall). */
  airborneSelf: boolean;
}

/** One incoming attack directed at the actor (reversal opportunity). */
export interface IncomingAttack {
  /** Fighter performing the attack against us. */
  attackerId: string;
  moveId: MoveId;
  phase: MovePhase;
  /** Absolute ms elapsed since the attack's move started (not per-phase). */
  phaseMsElapsed: number;
}

/** Nearest valid melee target as seen by the actor. */
export interface TargetSnapshot {
  id: string;
  /** Straight-line distance in meters. */
  dist: number;
  /** Signed angle from actor heading to target (-π..π); 0 = dead ahead. */
  relAngle: number;
  stance: Stance;
  /** Target is on the ground (knocked down / unconscious). */
  isDowned: boolean;
  /** Target is mid-air. */
  airborne: boolean;
  /** Target faces back toward the actor (reversal facing requirement). */
  facingMe: boolean;
  /** Target's FSM has not engaged (stealth window open) [spec §3.7]. */
  unaware: boolean;
  /** Attack currently coming at us from this target, if any. */
  incomingAttack?: IncomingAttack;
}

/**
 * Plain-state view of one fighter at a sim instant — everything the resolver
 * may read. Built by the controller each step; never a class instance.
 */
export interface CombatantSnapshot {
  id: string;
  stance: Stance;
  /** Locomotion speed above run threshold (sprinting into attacks). */
  isRunning: boolean;
  /** How long crouch has been held (timed press = reverse attempt). */
  crouchHeldMs: number;
  pos: { x: number; y: number; z: number };
  heading: number;
  /** Weapon held right now; null = unarmed. */
  hasWeapon: WeaponClass | null;
  /** Distance to nearest wall in meters (Infinity = open field). */
  wallProximityM: number;
  nearestTarget: TargetSnapshot | null;
  /** Move this fighter is currently executing, if any. */
  currentMove?: { id: MoveId; phase: MovePhase; phaseMsElapsed: number };
  /** Held weapon is stained (crouch-context clean becomes available). */
  bladeBloody?: boolean;
}
