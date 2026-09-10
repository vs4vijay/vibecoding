export type Team = "independent" | "red" | "blue";

/** Refinement 1: Dir = {x,z} intents. */
export interface Dir { x: -1 | 0 | 1; z: -1 | 0 | 1 }

/** One controller snapshot per slot per tick. */
export interface InputFrame {
  a: boolean;          // attack pressed this tick (rising edge handled by buffer)
  j: boolean;          // jump pressed this tick
  dHeld: boolean;      // defend held
  dir: Dir;
}

export interface Knockback { vx: number; vy: number; vz?: number }

export interface HitboxDef {
  x: number; y: number; z: number;      // center offset from fighter origin
  w: number; h: number; d: number;      // extents (d = z-depth plane)
  damage: number;
  knockback: Knockback;
  hitstunTicks: number;
  type: "light" | "heavy" | "projectile" | "grab";
  priority: number;
  status?: "freeze" | "burn";           // Refinement 4
}

export interface ProjectileSpawn { projectileId: string; offsetX: number; offsetY: number }

export interface MoveFrame {
  sprite: string;
  durationTicks: number;
  vx: number; vy: number; vz: number;
  hitbox?: HitboxDef;
  hurtbox?: HitboxDef;
  mpCost?: number;
  cancelInto?: string[];
  nextFrameLink?: { moveId: string; frameIndex: number };
  spawnProjectile?: ProjectileSpawn;
}

export interface MoveDef { frames: MoveFrame[]; sequence?: string }

export interface ProjectileSheetEntry {
  sprite: string;
  size: { w: number; h: number; d: number };
  velocityVx: number;
  gravity: number;
  ttlTicks: number;
  pierce: boolean;
  damage: number;
  knockback: Knockback;
  hitstunTicks: number;
  type: "projectile" | "light" | "heavy";
  priority: number;
  /** Status rider copied onto spawned hits (freeze/burn, Refinement 4). */
  status?: "freeze" | "burn";
  /** Heals teammates on overlap instead of damaging (support-mage heal bolt). */
  healsAllies?: boolean;
}

export interface CharacterSheet {
  id: string;
  maxHp: number; maxMp: number; mpRegenPerTick: number;
  walkSpeed: number; runSpeed: number; jumpImpulse: number;
  moves: Record<string, MoveDef>;
  grabMoveId?: string;
  roles?: Record<string, string>;       // e.g. { dashAttack: "flyingKnee" }
  projectiles?: Record<string, ProjectileSheetEntry>;
}

export type FighterState =
  | "idle" | "walk" | "dash" | "jump" | "attack"
  | "hitstun" | "knockdown" | "getup"
  | "grabAttempt" | "grabbing" | "grabbed" | "thrown"
  | "blockstun" | "frozen" | "burned" | "drinking" | "dead";

export interface Fighter {
  id: number; slot: number; team: Team; isBot: boolean;
  charId: string;                       // resolves into ContentCache
  x: number; y: number; z: number;      // y=0 ground, negative up (vy impulse)
  vx: number; vy: number; vz: number;
  facing: 1 | -1;
  state: FighterState;
  stateTick: number;                    // ticks elapsed in current state
  moveId?: string; frameIdx?: number; frameTick?: number;
  hp: number; mp: number;
  invulnUntilTick: number;
  hitIds: Set<number>;                  // victims hit by current swing
  comboCount: number; comboLastTick: number;
  holdingWeapon?: string;               // weapon def id
  weaponDurability?: number;
  burnUntilTick?: number; frozenUntilTick?: number;
  cooldownUntilTick?: number;           // bot decision lock
  buffer: ReturnType<typeof import("./inputBuffer").createBuffer>;
}

export interface Projectile {
  id: number; ownerId: number; spriteKey: string; projectileId: string;
  x: number; y: number; z: number; vx: number; vy: number;
  ttl: number; pierce: boolean;
  box: {
    damage: number; knockback: Knockback; hitstunTicks: number;
    type: ProjectileSheetEntry["type"]; priority: number;
    status?: "freeze" | "burn" | undefined;           // Refinement 4 rider
    healsAllies?: boolean | undefined;                // support-mage heal bolt
  };
  size: { w: number; h: number; d: number };
  gravity: number;
  hitIds: Set<number>;
  /** Sim-internal: a thrown weapon (spec §3.3). Consumed on fighter contact. */
  thrownWeapon?: { defId: string; breakOnThrowImpact: boolean };
}

/** Structural mirror of the loader's WeaponDef (src/sim/world.ts) for the
 *  fighter FSM's TickWorld slice — keeps fighter.ts decoupled from world.ts. */
export interface WeaponLike {
  kind: string;
  meleeDamage: number;
  throwDamage: number;
  throwVy: number;
  durability: number;
  breakOnThrowImpact: boolean;
  carrierSpeedMul: number;
  repickupDelayTicks: number;
}

export interface Pickup {
  id: number; kind: "weapon" | "item"; defId: string;
  x: number; y: number; z: number;
  vy: number;
  spawnedTick: number; shelfLifeTicks: number;
  /** §3.3: blocks instant re-grab after a drop until this world tick. */
  noPickupUntilTick?: number;
}

export type SimEvent =
  | { type: "hit"; attacker: number; victim: number; damage: number; heavy: boolean; blocked: boolean }
  | { type: "ko"; victim: number }
  | { type: "landed"; who: number }
  | { type: "jump"; who: number }
  | { type: "dash"; who: number }
  | { type: "grab"; who: number; victim: number }
  | { type: "thrown"; victim: number }
  | { type: "castFire" | "castIce"; who: number }
  | { type: "weaponPickup"; who: number; defId: string }
  | { type: "weaponBreak"; defId: string }
  | { type: "itemDrop"; defId: string; x: number }
  | { type: "itemConsumed"; who: number; defId: string }
  | { type: "matchEnd"; winnerTeam: Team | "draw" };

export interface SlotConfig { isHuman: boolean; charId: string; team: Team }

export interface StageRuntime {
  id: string;
  walls: { left: number; right: number; restitution: number };
  bounds: { w: number; h: number; d: number };
  drops: { firstDropTick: number; intervalTicks: number; intervalJitterTicks: number; table: Record<string, number> };
}

/** Parallax backdrop layer (spec §3.5); composited back-to-front by the renderer. */
export interface Layer {
  atlasKey: string;
  parallax: number;
  baselineY: number;
}

export interface WorldState {
  tick: number;
  seed: number;
  rngState: number;                     // current PRNG state, advanced in place
  stage: StageRuntime;
  fighters: Fighter[];                  // fixed slots[0..MAX_FIGHTERS-1]
  projectiles: Projectile[];
  pickups: Pickup[];
  nextEntityId: number;
  over: boolean;
  nextDropTick?: number;                // lazy sky-drop schedule (src/sim/items.ts)
}
