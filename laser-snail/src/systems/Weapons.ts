import type { Entity } from '../entities/Entity';

/**
 * The weapon ladder — the data-driven escalation from the design spec
 * (section 4): single → double → triple → laser → homing rocket → fast
 * rocket → invincibility. Turbo starts at single (the original started at
 * double — intentional simplification, kept).
 *
 * Pure logic, no Three.js dependency: tiers are plain data, the ladder is a
 * cursor over the tiers array, and the helpers (`passesThrough`,
 * `bombTargets`, `hazardPoints`) are the single source of truth for the
 * combat rules the gameplay loop and the tests share.
 */

/** Projectile visual/behavior family — drives mesh, SFX class, steering. */
export type WeaponKind = 'bolt' | 'laser' | 'rocket';

/** One rung of the ladder. Everything the firing code needs, as data. */
export interface WeaponTier {
  /** HUD name, e.g. "Triple". */
  readonly name: string;
  /** Projectile family (mesh + sound class). */
  readonly kind: WeaponKind;
  /** Projectiles per shot (1 = straight, 2 = parallel, 3 = spread). */
  readonly count: 1 | 2 | 3;
  /** Lateral offset of the outer barrels, in x world units. */
  readonly spread: number;
  /** Lateral drift of the outer bolts (the triple's divergence), x units/s. */
  readonly drift: number;
  /** Seconds between shots. */
  readonly cooldown: number;
  /** Forward speed in s-units per second. */
  readonly speed: number;
  /** Damage per projectile (rocks currently die to any hit; rockets overkill). */
  readonly damage: number;
  /** Enemies a laser pierces before dying (1 = stops on first hit). */
  readonly pierce: number;
  /** Steers toward the nearest enemy ahead (homing rocket). */
  readonly homing: boolean;
  /** Top tier: slugs pass through harmlessly. */
  readonly invincible: boolean;
  /** Projectile collision radius in (s, x) space. */
  readonly radius: number;
}

/**
 * The full ladder. Tier 7 keeps the fast-rocket stats — invincibility is the
 * payoff stacked on top of the best gun, exactly like the original's top rung.
 */
export const WEAPON_TIERS: readonly WeaponTier[] = [
  {
    name: 'Single',
    kind: 'bolt',
    count: 1,
    spread: 0,
    drift: 0,
    cooldown: 0.24,
    speed: 80,
    damage: 1,
    pierce: 1,
    homing: false,
    invincible: false,
    radius: 0.5,
  },
  {
    name: 'Double',
    kind: 'bolt',
    count: 2,
    spread: 0.7,
    drift: 0,
    cooldown: 0.22,
    speed: 80,
    damage: 1,
    pierce: 1,
    homing: false,
    invincible: false,
    radius: 0.5,
  },
  {
    name: 'Triple',
    kind: 'bolt',
    count: 3,
    spread: 1.1,
    drift: 7,
    cooldown: 0.26,
    speed: 80,
    damage: 1,
    pierce: 1,
    homing: false,
    invincible: false,
    radius: 0.5,
  },
  {
    name: 'Laser',
    kind: 'laser',
    count: 1,
    spread: 0,
    drift: 0,
    cooldown: 0.5,
    speed: 160,
    damage: 3,
    pierce: 3,
    homing: false,
    invincible: false,
    radius: 0.7,
  },
  {
    name: 'Homing Rocket',
    kind: 'rocket',
    count: 1,
    spread: 0,
    drift: 0,
    cooldown: 0.55,
    speed: 62,
    damage: 3,
    pierce: 1,
    homing: true,
    invincible: false,
    radius: 0.9,
  },
  {
    name: 'Fast Rocket',
    kind: 'rocket',
    count: 1,
    spread: 0,
    drift: 0,
    cooldown: 0.42,
    speed: 100,
    damage: 5,
    pierce: 1,
    homing: false,
    invincible: false,
    radius: 0.9,
  },
  {
    name: 'Invincible',
    kind: 'rocket',
    count: 1,
    spread: 0,
    drift: 0,
    cooldown: 0.42,
    speed: 100,
    damage: 5,
    pierce: 1,
    homing: false,
    invincible: true,
    radius: 0.9,
  },
] as const;

/** Points for destroying an asteroid by cannon or smart bomb. */
export const ASTEROID_KILL_POINTS = 150;
/** Points for destroying a slug by cannon or smart bomb. */
export const SLUG_KILL_POINTS = 100;

/** Smart-bomb clearing window ahead of the player, in s units. */
export const BOMB_WINDOW = 150;

/** Score value for destroying `type` (0 for anything indestructible). */
export function hazardPoints(type: Entity['type']): number {
  switch (type) {
    case 'asteroid':
      return ASTEROID_KILL_POINTS;
    case 'slug':
      return SLUG_KILL_POINTS;
    default:
      return 0;
  }
}

/** Types projectiles and the smart bomb can destroy. */
export function isDestructible(type: Entity['type']): boolean {
  return type === 'asteroid' || type === 'slug';
}

/**
 * The ladder cursor. `ladderUp` advances one rung per white ring and clamps
 * at the top — the transition behavior the unit tests pin down.
 */
export class WeaponLadder {
  private readonly tiers: readonly WeaponTier[];
  private index = 0;

  public constructor(tiers: readonly WeaponTier[] = WEAPON_TIERS) {
    if (tiers.length === 0) throw new RangeError('WeaponLadder needs at least one tier');
    this.tiers = tiers;
  }

  /** Current tier descriptor (name, shot pattern, cooldown, speed, damage). */
  public get tier(): WeaponTier {
    return this.tiers[this.index];
  }

  /** Zero-based rung (0 = single). */
  public get tierIndex(): number {
    return this.index;
  }

  public get tierCount(): number {
    return this.tiers.length;
  }

  /** HUD-ready current weapon name. */
  public get name(): string {
    return this.tier.name;
  }

  /** True only while standing on the top rung. */
  public isInvincible(): boolean {
    return this.tier.invincible;
  }

  /** True when no further rung exists. */
  public get isTopTier(): boolean {
    return this.index >= this.tiers.length - 1;
  }

  /**
   * Climbs one rung (white ring). Returns true when the tier changed —
   * the HUD flash and chime fire only on an actual transition.
   */
  public ladderUp(): boolean {
    if (this.isTopTier) return false;
    this.index += 1;
    return true;
  }

  /** Back to the starting cannon (retry / new run). */
  public reset(): void {
    this.index = 0;
  }
}

/**
 * Invincibility rule (spec: slugs are passable at the top tier, deadly
 * otherwise). The one predicate both the gameplay loop and the tests use.
 */
export function passesThrough(entity: Pick<Entity, 'type'>, tier: WeaponTier): boolean {
  return tier.invincible && entity.type === 'slug';
}

/**
 * Smart bomb: every destructible enemy strictly ahead of `playerS` within
 * `window` s-units. `entities` must be sorted by `s` (the Spawner guarantee);
 * dead entities are skipped — the pooled-record rule. Packages, hearts and
 * rings are never bomb targets. Allocates only on the event itself.
 */
export function bombTargets(
  entities: readonly Entity[],
  playerS: number,
  window: number = BOMB_WINDOW,
): Entity[] {
  const targets: Entity[] = [];
  const limit = playerS + window;
  for (const entity of entities) {
    if (entity.s > limit) break; // sorted by s: nothing further can qualify
    if (entity.s <= playerS) continue;
    if (!entity.alive) continue;
    if (isDestructible(entity.type)) targets.push(entity);
  }
  return targets;
}
