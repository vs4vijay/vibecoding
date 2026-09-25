import { describe, expect, it } from 'vitest';

import { TrackCurve } from '../src/track/TrackCurve';
import type { LevelDefinition, LevelFeature } from '../src/track/LevelLoader';
import type { Entity } from '../src/entities/Entity';
import { Spawner } from '../src/systems/Spawner';
import { ProjectileSystem, shotPattern } from '../src/systems/Projectiles';
import { WEAPON_TIERS } from '../src/systems/Weapons';

/**
 * Projectile system: pooled (s, x)-space shots, per-tier fire patterns,
 * sorted-by-s hit detection against destructibles, laser piercing, homing
 * steering and pool recycling. Rendering is Three.js but the contracts tested
 * here are the gameplay ones.
 */

const CONTROL_POINTS: [number, number, number][] = [
  [0, 0, 0],
  [0, 0, -600],
];

const STEP = 1 / 60;

function makeSpawner(features: LevelFeature[]): { spawner: Spawner; track: TrackCurve } {
  const track = new TrackCurve(CONTROL_POINTS);
  const level: LevelDefinition = {
    id: 1,
    name: 'Projectile Test',
    length: track.getCurveLength(),
    cruiseSpeed: 30,
    controlPoints: CONTROL_POINTS,
    features,
  };
  const spawner = new Spawner(track);
  spawner.load(level);
  spawner.reset(0);
  return { spawner, track };
}

/** Steps the projectile sim until it hits something or times out. */
function runUntilHit(
  system: ProjectileSystem,
  entities: readonly Entity[],
  maxSteps = 400,
): ReturnType<ProjectileSystem['update']> {
  let hits: ReturnType<ProjectileSystem['update']> = [];
  for (let i = 0; i < maxSteps && hits.length === 0; i += 1) {
    hits = system.update(STEP, entities, 0);
  }
  return hits;
}

describe('shot patterns per tier', () => {
  it('single: one centered bolt', () => {
    expect(shotPattern(WEAPON_TIERS[0])).toEqual([{ offset: 0, drift: 0 }]);
  });

  it('double: two parallel barrels, no drift', () => {
    const pattern = shotPattern(WEAPON_TIERS[1]);
    expect(pattern).toHaveLength(2);
    expect(pattern[0].offset).toBe(-WEAPON_TIERS[1].spread);
    expect(pattern[1].offset).toBe(WEAPON_TIERS[1].spread);
    expect(pattern.every((barrel) => barrel.drift === 0)).toBe(true);
  });

  it('triple: three bolts, outer ones diverging', () => {
    const pattern = shotPattern(WEAPON_TIERS[2]);
    expect(pattern).toHaveLength(3);
    expect(pattern[0].offset).toBe(0);
    expect(pattern[1].drift).toBe(-WEAPON_TIERS[2].drift);
    expect(pattern[2].drift).toBe(WEAPON_TIERS[2].drift);
  });
});

describe('ProjectileSystem firing', () => {
  it('fires and advances projectiles in (s, x) space', () => {
    const { track } = makeSpawner([]);
    const system = new ProjectileSystem(track);
    expect(system.activeCount).toBe(0);

    expect(system.fire(WEAPON_TIERS[0], 100, 0)).toBe(1);
    expect(system.activeCount).toBe(1);

    const bolt = system.all.find((projectile) => projectile.alive)!;
    expect(bolt.s).toBe(100);
    expect(bolt.x).toBe(0);

    system.update(STEP, [], 0);
    expect(bolt.s).toBeCloseTo(100 + WEAPON_TIERS[0].speed * STEP, 9);
    expect(bolt.x).toBe(0); // no drift on a single
  });

  it('double fires two parallel bolts at the barrel offsets', () => {
    const { track } = makeSpawner([]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[1], 100, 1.5);
    const bolts = system.all.filter((projectile) => projectile.alive);
    expect(bolts).toHaveLength(2);
    expect(bolts.map((bolt) => bolt.x).sort((a, b) => a - b)).toEqual([
      1.5 - WEAPON_TIERS[1].spread,
      1.5 + WEAPON_TIERS[1].spread,
    ]);
  });

  it('triple bolts diverge via their lateral drift', () => {
    const { track } = makeSpawner([]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[2], 100, 0);
    const bolts = system.all.filter((projectile) => projectile.alive);
    expect(bolts).toHaveLength(3);

    const outer = bolts.find((bolt) => bolt.vx > 0)!;
    system.update(STEP, [], 0);
    // Starts at the barrel offset, then integrates its drift.
    expect(outer.x).toBeCloseTo(WEAPON_TIERS[2].spread + outer.vx * STEP, 9);
  });

  it('recycles pool slots and refuses to over-fire', () => {
    const { track } = makeSpawner([]);
    const system = new ProjectileSystem(track, { max: 4 });

    expect(system.fire(WEAPON_TIERS[2], 0, 0)).toBe(3);
    expect(system.fire(WEAPON_TIERS[0], 0, 0)).toBe(1);
    expect(system.fire(WEAPON_TIERS[0], 0, 0)).toBe(0); // pool exhausted
    expect(system.activeCount).toBe(4);

    system.clear();
    expect(system.activeCount).toBe(0);
    expect(system.fire(WEAPON_TIERS[2], 0, 0)).toBe(3); // slots reused
  });
});

describe('projectile-enemy destruction', () => {
  it('a bolt destroys an asteroid ahead via the sorted-by-s window', () => {
    const { spawner, track } = makeSpawner([{ type: 'asteroid', at: 200, params: { lane: 0 } }]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[0], 150, 0);

    const hits = runUntilHit(system, spawner.entities);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity.type).toBe('asteroid');
    expect(hits[0].entity.alive).toBe(true); // caller decides the kill
    expect(hits[0].projectile.alive).toBe(false); // bolt spent

    spawner.kill(hits[0].entity);
    expect(hits[0].entity.alive).toBe(false);
  });

  it('a bolt aimed off-lane misses the rock entirely', () => {
    const { spawner, track } = makeSpawner([{ type: 'asteroid', at: 200, params: { lane: 0 } }]);
    const system = new ProjectileSystem(track);
    // dx = 3.6 > bolt radius 0.5 + asteroid radius 3.0 → clean miss.
    system.fire(WEAPON_TIERS[0], 150, 3.6);
    const hits = runUntilHit(system, spawner.entities, 200);
    expect(hits).toHaveLength(0);
    expect(spawner.entities[0].alive).toBe(true);
  });

  it('destroyed records stay dead — the pooled-reuse rule', () => {
    const { spawner, track } = makeSpawner([{ type: 'asteroid', at: 200, params: { lane: 0 } }]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[0], 150, 0);
    const hits = runUntilHit(system, spawner.entities);
    spawner.kill(hits[0].entity);

    // The dead rock can never be hit again by later shots.
    system.fire(WEAPON_TIERS[0], 180, 0);
    const second = runUntilHit(system, spawner.entities, 100);
    expect(second).toHaveLength(0);
  });

  it('a laser pierces a line of asteroids with one beam', () => {
    const { spawner, track } = makeSpawner([
      { type: 'asteroid', at: 200, params: { lane: 0 } },
      { type: 'asteroid', at: 215, params: { lane: 0 } },
    ]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[3], 150, 0); // laser: pierce 3

    const first = runUntilHit(system, spawner.entities);
    expect(first).toHaveLength(1);
    expect(first[0].entity.s).toBe(200);
    const beam = first[0].projectile;
    expect(beam.alive).toBe(true); // pierce remaining — it flies on

    // The caller applies the kill (main.ts wiring), then the beam reaches
    // the next rock in line.
    spawner.kill(first[0].entity);
    const second = runUntilHit(system, spawner.entities);
    expect(second).toHaveLength(1);
    expect(second[0].entity.s).toBe(215);
    expect(second[0].projectile).toBe(beam);
  });

  it('slugs are destructible too; pickups are not hittable', () => {
    const { spawner, track } = makeSpawner([
      { type: 'slug', at: 200, params: { lane: 0 } },
      { type: 'package', at: 260, params: { lane: 0 } },
    ]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[0], 150, 0);

    const hits = runUntilHit(system, spawner.entities);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity.type).toBe('slug');

    spawner.kill(hits[0].entity);
    // The package at 260 is in the line of fire but indestructible.
    const rest = runUntilHit(system, spawner.entities, 200);
    expect(rest).toHaveLength(0);
  });

  it('a homing rocket bends toward an enemy ahead of it', () => {
    const { spawner, track } = makeSpawner([{ type: 'asteroid', at: 280, params: { lane: 1.5 } }]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[4], 150, -3); // aimed well off the rock's lane

    const rocket = system.all.find((projectile) => projectile.alive)!;
    const initialX = rocket.x;
    system.update(STEP, spawner.entities, 0);
    // Steering began pulling it toward the rock's lane (target x = 1.5).
    expect(rocket.vx).toBeGreaterThan(0);
    expect(rocket.x).toBeGreaterThan(initialX);

    const hits = runUntilHit(system, spawner.entities);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity.type).toBe('asteroid');
  });

  it('two projectiles reaching the same rock in one step count one hit', () => {
    const { spawner, track } = makeSpawner([{ type: 'asteroid', at: 200, params: { lane: 0 } }]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[0], 190, 0);
    system.fire(WEAPON_TIERS[0], 190, 0);
    expect(system.activeCount).toBe(2);

    let hits: ReturnType<ProjectileSystem['update']> = [];
    for (let i = 0; i < 40 && hits.length === 0; i += 1) {
      hits = system.update(STEP, spawner.entities, 0);
    }
    // Both bolts arrive together, but the rock dies once.
    expect(hits).toHaveLength(1);
    spawner.kill(hits[0].entity);
  });

  it('projectiles past their trail distance are recycled, meshes follow the road', () => {
    const { spawner, track } = makeSpawner([]);
    const system = new ProjectileSystem(track);
    system.fire(WEAPON_TIERS[0], 10, 0);

    const bolt = system.all.find((projectile) => projectile.alive)!;
    // Far past the trail horizon relative to a stationary player.
    for (let i = 0; i < 400; i += 1) system.update(STEP, spawner.entities, 0);
    expect(bolt.alive).toBe(false);
    expect(bolt.mesh.visible).toBe(false);

    // Live projectiles ride the (s, x) → world transform.
    system.fire(WEAPON_TIERS[0], 100, 2);
    const live = system.all.find((projectile) => projectile.alive)!;
    system.update(STEP, spawner.entities, 0);
    const expected = track.sToWorld(live.s, live.x);
    expect(live.mesh.position.distanceTo(expected.position)).toBeLessThan(2);
  });
});
