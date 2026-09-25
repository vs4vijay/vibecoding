import { describe, expect, it } from 'vitest';

import { createEntity, ENTITY_RADII, type Entity } from '../src/entities/Entity';
import {
  checkFall,
  COLLISION_WINDOW,
  findHit,
  findRingPass,
  isContactType,
  isGroundHazard,
  isPassThroughType,
  lowerBound,
} from '../src/systems/Collision';
import { TrackGaps } from '../src/track/TrackGaps';

/** Builds a sorted entity list at the given (s, x) spots. */
function makeEntities(spots: Array<{ s: number; x?: number; type?: Entity['type']; alive?: boolean }>): Entity[] {
  return spots.map((spot) => {
    const entity = createEntity(spot.type ?? 'package', spot.s, spot.x ?? 0);
    if (spot.alive === false) entity.alive = false;
    return entity;
  });
}

describe('Collision.findHit', () => {
  it('detects a hit inside the window via the circle test', () => {
    const entities = makeEntities([{ s: 100, x: 0 }]);
    const hit = findHit(entities, 100.6, 0.4);
    expect(hit).not.toBeNull();
    expect(hit?.type).toBe('package');
  });

  it('respects the summed per-type radii', () => {
    const entities = makeEntities([{ s: 100, x: 2.0 }]); // radius sum 0.9 + 1.7 = 2.6
    expect(findHit(entities, 100, 0)).not.toBeNull();

    const far = makeEntities([{ s: 100, x: 2.7 }]); // just outside the sum
    expect(findHit(far, 100, 0)).toBeNull();
  });

  it('misses laterally outside the radius even in the s-window', () => {
    const entities = makeEntities([{ s: 100, x: 5 }]);
    expect(findHit(entities, 100, 0)).toBeNull();
  });

  it('misses entities outside the s-window entirely', () => {
    const entities = makeEntities([{ s: 100 + COLLISION_WINDOW + 1, x: 0 }]);
    expect(findHit(entities, 100, 0)).toBeNull();

    const behind = makeEntities([{ s: 100 - COLLISION_WINDOW - 1, x: 0 }]);
    expect(findHit(behind, 100, 0)).toBeNull();
  });

  it('returns the nearest of several overlapping candidates', () => {
    const entities = makeEntities([
      { s: 100, x: 0 },
      { s: 101.4, x: 0 },
      { s: 102.2, x: 0 },
    ]);
    const hit = findHit(entities, 100, 0);
    expect(hit?.s).toBe(100);
  });

  it('skips dead entities — the reuse-wrap rule for pooled records', () => {
    const entities = makeEntities([{ s: 100, x: 0, alive: false }]);
    expect(findHit(entities, 100, 0)).toBeNull();

    // Mixed: dead entity at the nearer s must not shadow the living one.
    const mixed = makeEntities([
      { s: 100, x: 0, alive: false },
      { s: 101, x: 0, alive: true },
    ]);
    const hit = findHit(mixed, 100, 0);
    expect(hit?.s).toBe(101);
  });

  it('uses per-type radii — slugs are tighter than pickups', () => {
    // radius sums: slug 0.9 + 1.35 = 2.25, package 0.9 + 1.7 = 2.6
    const offset = makeEntities([{ s: 100, x: 2.4, type: 'slug' }]);
    expect(findHit(offset, 100, 0)).toBeNull();

    const sameSpotAsPackage = makeEntities([{ s: 100, x: 2.4, type: 'package' }]);
    expect(findHit(sameSpotAsPackage, 100, 0)).not.toBeNull();
    expect(ENTITY_RADII.slug).toBeLessThan(ENTITY_RADII.package);
  });

  it('honors a custom player radius and window', () => {
    const entities = makeEntities([{ s: 100, x: 0 }]);
    // Player offset 2.0 laterally: a tiny player misses, a big one touches.
    expect(findHit(entities, 100, 2.0, 0.1)).toBeNull();
    expect(findHit(entities, 100, 2.0, 3)).not.toBeNull();

    // The window widens the *scan*, not the circle test: a ds=12 entity is
    // invisible to the default scan but reachable with window 40.
    const distant = makeEntities([{ s: 100 + 12, x: 0 }]);
    expect(findHit(distant, 100, 0, 15)).toBeNull();
    expect(findHit(distant, 100, 0, 15, 40)).not.toBeNull();
  });

  it('returns null for an empty field', () => {
    expect(findHit([], 50, 0)).toBeNull();
  });
});

describe('Collision.support', () => {
  it('binary-searches the lower bound of the sorted entity list', () => {
    const entities = makeEntities([
      { s: 10 },
      { s: 20 },
      { s: 30 },
      { s: 40 },
    ]);
    expect(lowerBound(entities, -5)).toBe(0);
    expect(lowerBound(entities, 10)).toBe(0);
    expect(lowerBound(entities, 11)).toBe(1);
    expect(lowerBound(entities, 40)).toBe(3);
    expect(lowerBound(entities, 41)).toBe(4);
  });
});

describe('pass-through classification (Phase 4)', () => {
  it('reward rings, the red trap ring and jump pods are pass-through, not contacts', () => {
    const types: Entity['type'][] = ['whiteRing', 'yellowRing', 'redRing', 'jumpPod'];
    for (const type of types) {
      const entity = createEntity(type, 100, 0);
      expect(isPassThroughType(entity)).toBe(true);
      expect(isContactType(entity)).toBe(false);
    }
    // Contacts stay contacts.
    const slug = createEntity('slug', 100, 0);
    expect(isContactType(slug)).toBe(true);
    expect(isPassThroughType(slug)).toBe(false);
  });

  it('slugs and asteroids are the ground hazards (immune while airborne)', () => {
    expect(isGroundHazard(createEntity('slug', 10, 0))).toBe(true);
    expect(isGroundHazard(createEntity('asteroid', 10, 0))).toBe(true);
    expect(isGroundHazard(createEntity('package', 10, 0))).toBe(false);
    expect(isGroundHazard(createEntity('heart', 10, 0))).toBe(false);
  });

  it('findRingPass detects the red ring only within its dodge radius', () => {
    // Red ring at lane 3.5, gameplay radius 4.2.
    const entities = makeEntities([{ s: 100, x: 3.5, type: 'redRing' }]);
    // Dead-center lane crossing: trapped.
    expect(findRingPass(entities, 99, 101, 3.5)?.type).toBe('redRing');
    // Within the radius on the far side: trapped.
    expect(findRingPass(entities, 99, 101, -0.5)?.type).toBe('redRing');
    // Steering wide around it: no trap.
    expect(findRingPass(entities, 99, 101, -1.0)).toBeNull();
    expect(findRingPass(entities, 99, 101, -5.5)).toBeNull();
  });

  it('findRingPass detects jump pods at any lane (road-spanning launch strips)', () => {
    const entities = makeEntities([{ s: 200, x: 0, type: 'jumpPod' }]);
    expect(findRingPass(entities, 199, 201, 0)?.type).toBe('jumpPod');
    expect(findRingPass(entities, 199, 201, 5.5)?.type).toBe('jumpPod');
    expect(findRingPass(entities, 199, 201, -5.5)?.type).toBe('jumpPod');
  });
});

describe('Collision.checkFall (gap falls)', () => {
  const gaps = TrackGaps.fromFeatures(
    [
      { type: 'gap', at: 100, params: { width: 40 } },
      { type: 'gap', at: 300, params: { width: 30, jumpPod: true } },
    ],
    1000,
  );

  it('falls when a grounded step crosses into a gap', () => {
    expect(checkFall(gaps, 99.5, 100.4, false)).toBe(true);
    // Already inside the open air (landing short of a pod arc): falls.
    expect(checkFall(gaps, 110, 110.7, false)).toBe(true);
  });

  it('is safe on solid road, on the far lip, and outside the swept step', () => {
    expect(checkFall(gaps, 50, 50.7, false)).toBe(false);
    expect(checkFall(gaps, 99.4, 100, false)).toBe(false); // exactly at the edge is still road
    expect(checkFall(gaps, 141, 141.7, false)).toBe(false); // past the 40-wide first gap
    expect(checkFall(gaps, 230, 231, false)).toBe(false);
  });

  it('an airborne flight never falls — the pod arc immune rule', () => {
    expect(checkFall(gaps, 99.5, 110, true)).toBe(false);
    expect(checkFall(gaps, 110, 130, true)).toBe(false);
  });

  it('levels without gap data never fall', () => {
    expect(checkFall(null, 99, 101, false)).toBe(false);
    expect(checkFall(undefined, 99, 101, false)).toBe(false);
    expect(checkFall(TrackGaps.fromFeatures([], 1000), 99, 101, false)).toBe(false);
  });
});
