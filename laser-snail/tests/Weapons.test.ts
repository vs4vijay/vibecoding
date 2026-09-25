import { describe, expect, it } from 'vitest';

import { createEntity, type Entity } from '../src/entities/Entity';
import { SpeedModifiers } from '../src/systems/SpeedMods';
import {
  ASTEROID_KILL_POINTS,
  bombTargets,
  BOMB_WINDOW,
  hazardPoints,
  isDestructible,
  passesThrough,
  SLUG_KILL_POINTS,
  WEAPON_TIERS,
  WeaponLadder,
} from '../src/systems/Weapons';

/**
 * Weapon ladder transitions and combat rules — pure logic, no Three.js.
 * These pin the data-driven ladder contract: one rung per white ring, clamped
 * at the top, invincibility only on the final rung, and the shot-pattern
 * data the projectile system consumes.
 */

const LADDER_NAMES = [
  'Single',
  'Double',
  'Triple',
  'Laser',
  'Homing Rocket',
  'Fast Rocket',
  'Invincible',
];

describe('WeaponLadder transitions', () => {
  it('starts Turbo at the single cannon', () => {
    const ladder = new WeaponLadder();
    expect(ladder.tierIndex).toBe(0);
    expect(ladder.name).toBe('Single');
    expect(ladder.isInvincible()).toBe(false);
  });

  it('climbs exactly one rung per ladderUp and never beyond the top', () => {
    const ladder = new WeaponLadder();
    const visited: string[] = [ladder.name];
    for (let i = 0; i < 20; i += 1) {
      const changed = ladder.ladderUp();
      if (i < LADDER_NAMES.length - 1) {
        expect(changed).toBe(true);
        visited.push(ladder.name);
      } else {
        expect(changed).toBe(false); // top rung: a white ring does nothing
      }
    }
    expect(visited).toEqual(LADDER_NAMES);
    expect(ladder.tierIndex).toBe(LADDER_NAMES.length - 1);
  });

  it('reports invincibility only on the final rung', () => {
    const ladder = new WeaponLadder();
    for (let i = 0; i < WEAPON_TIERS.length - 2; i += 1) {
      ladder.ladderUp();
      expect(ladder.isInvincible()).toBe(false);
    }
    ladder.ladderUp(); // the final rung
    expect(ladder.isInvincible()).toBe(true);
    expect(ladder.isTopTier).toBe(true);
  });

  it('resets to the starting cannon for a retry', () => {
    const ladder = new WeaponLadder();
    ladder.ladderUp();
    ladder.ladderUp();
    ladder.reset();
    expect(ladder.name).toBe('Single');
    expect(ladder.isInvincible()).toBe(false);
  });

  it('the top tier stacks invincibility on the fast-rocket gun', () => {
    const fast = WEAPON_TIERS[5];
    const top = WEAPON_TIERS[6];
    expect(top.kind).toBe(fast.kind);
    expect(top.speed).toBe(fast.speed);
    expect(top.damage).toBe(fast.damage);
    expect(top.cooldown).toBe(fast.cooldown);
    expect(top.invincible).toBe(true);
    expect(fast.invincible).toBe(false);
  });
});

describe('tier effects on the shot pattern', () => {
  it('fires 1 / 2 / 3 bolts for single / double / triple', () => {
    expect(WEAPON_TIERS[0].count).toBe(1);
    expect(WEAPON_TIERS[1].count).toBe(2);
    expect(WEAPON_TIERS[2].count).toBe(3);
    expect(WEAPON_TIERS[1].spread).toBeGreaterThan(0); // parallel barrels
    expect(WEAPON_TIERS[2].drift).toBeGreaterThan(0); // outer bolts diverge
  });

  it('specializes the late tiers', () => {
    const [, , , laser, homing, fastRocket] = WEAPON_TIERS;
    expect(laser.kind).toBe('laser');
    expect(laser.pierce).toBeGreaterThanOrEqual(2); // piercing beam
    expect(laser.speed).toBeGreaterThan(WEAPON_TIERS[0].speed);
    expect(homing.homing).toBe(true);
    expect(homing.kind).toBe('rocket');
    expect(fastRocket.speed).toBeGreaterThan(homing.speed);
    expect(fastRocket.damage).toBeGreaterThan(homing.damage);
  });

  it('every tier carries a positive cooldown, speed, damage and radius', () => {
    for (const tier of WEAPON_TIERS) {
      expect(tier.cooldown).toBeGreaterThan(0);
      expect(tier.speed).toBeGreaterThan(0);
      expect(tier.damage).toBeGreaterThan(0);
      expect(tier.radius).toBeGreaterThan(0);
    }
  });
});

describe('invincibility pass-through rule', () => {
  it('slugs phase through only at the top tier', () => {
    const boltTier = WEAPON_TIERS[0];
    const topTier = WEAPON_TIERS[WEAPON_TIERS.length - 1];
    expect(passesThrough({ type: 'slug' }, topTier)).toBe(true);
    expect(passesThrough({ type: 'slug' }, boltTier)).toBe(false);
  });

  it('asteroids never phase through, even at the top tier', () => {
    const topTier = WEAPON_TIERS[WEAPON_TIERS.length - 1];
    expect(passesThrough({ type: 'asteroid' }, topTier)).toBe(false);
    expect(passesThrough({ type: 'asteroid' }, WEAPON_TIERS[0])).toBe(false);
  });
});

describe('destruction scoring', () => {
  it('asteroids are worth 150, slugs 100, pickups/rings nothing', () => {
    expect(ASTEROID_KILL_POINTS).toBe(150);
    expect(SLUG_KILL_POINTS).toBe(100);
    expect(hazardPoints('asteroid')).toBe(150);
    expect(hazardPoints('slug')).toBe(100);
    expect(hazardPoints('package')).toBe(0);
    expect(hazardPoints('heart')).toBe(0);
    expect(hazardPoints('whiteRing')).toBe(0);
  });

  it('only asteroids and slugs are destructible', () => {
    expect(isDestructible('asteroid')).toBe(true);
    expect(isDestructible('slug')).toBe(true);
    expect(isDestructible('package')).toBe(false);
    expect(isDestructible('heart')).toBe(false);
    expect(isDestructible('yellowRing')).toBe(false);
  });
});

describe('smart bomb targets', () => {
  const make = (type: Entity['type'], s: number, alive = true): Entity => {
    const entity = createEntity(type, s, 0);
    if (!alive) entity.alive = false;
    return entity;
  };

  const field = (): Entity[] => [
    make('package', 100),
    make('asteroid', 120),
    make('slug', 140),
    make('heart', 160),
    make('whiteRing', 180),
    make('asteroid', 240),
    make('asteroid', 300, false), // already dead — pooled record
    make('asteroid', 320),
  ];

  it('clears every destructible enemy ahead within the window', () => {
    const targets = bombTargets(field(), 100, BOMB_WINDOW);
    expect(targets.map((entity) => entity.s)).toEqual([120, 140, 240]); // 320 > 100 + 150
  });

  it('never touches pickups, rings, dead records, or anything behind', () => {
    const targets = bombTargets(field(), 130, BOMB_WINDOW);
    // Player at 130: the slug (140) and asteroid (240) are ahead within
    // 130 + 150 = 280; the package/heart/rings and the dead rock never count.
    expect(targets.map((entity) => entity.s)).toEqual([140, 240]);
    expect(targets.every((entity) => isDestructible(entity.type))).toBe(true);
  });

  it('returns nothing on an empty stretch', () => {
    expect(bombTargets([make('package', 500)], 100)).toEqual([]);
  });
});

describe('SpeedModifiers timing', () => {
  it('applies −40% and restores after exactly 2 s', () => {
    const mods = new SpeedModifiers();
    expect(mods.multiplier).toBe(1);

    mods.apply('asteroid', 0.6, 2);
    expect(mods.update(0)).toBe(0.6);
    expect(mods.update(1)).toBe(0.6); // t 0→1: slowed
    expect(mods.update(1)).toBe(0.6); // t 1→2: still slowed — full 2 s covered
    expect(mods.update(1)).toBe(1); // timer expired at t=2 → cruise
    expect(mods.multiplier).toBe(1);
  });

  it('the red-ring trap applies −60% for 3 s, then restores cruise', () => {
    const mods = new SpeedModifiers();
    mods.apply('redRing', 0.4, 3);
    expect(mods.isActive('redRing')).toBe(true);
    expect(mods.update(1)).toBe(0.4);
    expect(mods.update(1)).toBe(0.4);
    expect(mods.update(1)).toBe(0.4); // full 3 s of crawl
    expect(mods.update(0.001)).toBe(1); // expires exactly at t=3
    expect(mods.isActive('redRing')).toBe(false);
    expect(mods.multiplier).toBe(1);
  });

  it('refreshing the same key restarts the timer instead of stacking', () => {
    const mods = new SpeedModifiers();
    mods.apply('asteroid', 0.6, 2);
    mods.update(1.5);
    mods.apply('asteroid', 0.6, 2); // second asteroid graze mid-slowdown
    mods.update(1.5);
    expect(mods.multiplier).toBe(0.6); // 0.5 s left on the refreshed timer
    mods.update(0.5);
    expect(mods.multiplier).toBe(1);
  });

  it('distinct keys multiply and expire independently', () => {
    const mods = new SpeedModifiers();
    mods.apply('asteroid', 0.6, 2);
    mods.apply('redRing', 0.4, 1);
    expect(mods.multiplier).toBeCloseTo(0.24, 9);
    mods.update(1);
    expect(mods.multiplier).toBe(0.6); // red ring expired, asteroid remains
    mods.update(1);
    expect(mods.multiplier).toBe(1);
  });

  it('clear wipes everything and rejects invalid values', () => {
    const mods = new SpeedModifiers();
    mods.apply('asteroid', 0.6, 2);
    mods.clear();
    expect(mods.multiplier).toBe(1);
    expect(mods.count).toBe(0);

    expect(() => mods.apply('x', 1.5, 1)).toThrow(RangeError); // only slows
    expect(() => mods.apply('x', 0.6, 0)).toThrow(RangeError);
  });
});
