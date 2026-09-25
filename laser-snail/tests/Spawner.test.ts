import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEntity, type Entity } from '../src/entities/Entity';
import { TrackCurve } from '../src/track/TrackCurve';
import type { LevelDefinition, LevelFeature } from '../src/track/LevelLoader';
import { expandFeature, Spawner } from '../src/systems/Spawner';

const CONTROL_POINTS: [number, number, number][] = [
  [0, 0, 0],
  [0, 0, -3000],
];

function makeLevel(features: LevelFeature[]): LevelDefinition {
  return {
    id: 1,
    name: 'Spawner Test',
    length: 3000,
    cruiseSpeed: 30,
    controlPoints: CONTROL_POINTS,
    features,
  };
}

const feature = (type: string, at: number, params: Record<string, unknown> = {}): LevelFeature => ({
  type,
  at,
  params,
});

describe('Spawner.expandFeature', () => {
  it('expands packageArc into a smoothstep lane sweep of packages', () => {
    const entities = expandFeature(feature('packageArc', 100, { lane: -2, toLane: 2, count: 5, span: 80 }), 3000);
    expect(entities).not.toBeNull();
    expect(entities).toHaveLength(5);

    const first = entities![0];
    const last = entities![entities!.length - 1];
    expect(first.s).toBeCloseTo(100, 6);
    expect(first.x).toBeCloseTo(-2, 6);
    expect(last.s).toBeCloseTo(180, 6);
    expect(last.x).toBeCloseTo(2, 6);

    // Smoothstep midpoint holds the center lane; ends spread at s 100..180.
    const mid = entities![2];
    expect(mid.s).toBeCloseTo(140, 6);
    expect(mid.x).toBeCloseTo(0, 6);
    expect(entities!.every((entity) => entity.sourceType === 'packageArc')).toBe(true);
    expect(entities!.every((entity) => entity.type === 'package')).toBe(true);
  });

  it('defaults packageArc to 5 packages over a 12 s-unit spacing', () => {
    const entities = expandFeature(feature('packageArc', 200, { lane: 1 }), 3000);
    expect(entities).toHaveLength(5);
    expect(entities![0].s).toBe(200);
    expect(entities![4].s).toBe(200 + 4 * 12);
    expect(entities![4].x).toBeCloseTo(1, 6); // toLane defaults to lane
  });

  it('maps single features to their entity types with the authored lane', () => {
    expect(expandFeature(feature('package', 50, { lane: 2 }), 3000)).toMatchObject([
      { type: 'package', s: 50, x: 2, sourceType: 'package' },
    ]);
    expect(expandFeature(feature('heart', 60), 3000)).toMatchObject([{ type: 'heart', s: 60, x: 0 }]);
    expect(expandFeature(feature('slug', 70, { lane: -3 }), 3000)).toMatchObject([
      { type: 'slug', s: 70, x: -3 },
    ]);
  });

  it('expands the Phase 4 roster: pods from gaps, standalone pods, red trap rings', () => {
    // A jumpPod:true gap contributes the road-spanning launch entity at its
    // leading edge (the hole itself is TrackGaps/TrackMesh structure).
    const gapPod = expandFeature(feature('gap', 500, { width: 44, jumpPod: true }), 3000);
    expect(gapPod).toHaveLength(1);
    expect(gapPod![0]).toMatchObject({ type: 'jumpPod', sourceType: 'gap', x: 0 });
    expect(gapPod![0].s).toBe(500 - 2); // POD_EDGE_OFFSET before the hole
    expect(gapPod![0].radius).toBeGreaterThan(7); // spans the road

    // A podless gap contributes no entities — it is pure track structure.
    expect(expandFeature(feature('gap', 600, { width: 40 }), 3000)).toEqual([]);
    // Standalone jumpPod features spawn the same entity type.
    expect(expandFeature(feature('jumpPod', 700), 3000)).toMatchObject([
      { type: 'jumpPod', sourceType: 'jumpPod', s: 700, x: 0 },
    ]);
    // The red trap ring is lane-placed and dodgeable (smaller radius).
    const redRing = expandFeature(feature('redRing', 800, { lane: -3.5 }), 3000);
    expect(redRing).toMatchObject([{ type: 'redRing', s: 800, x: -3.5 }]);
    expect(redRing![0].radius).toBeGreaterThan(3);
    expect(redRing![0].radius).toBeLessThan(6);
  });

  it('turboPad is still registry-known but has no factory (later phase)', () => {
    expect(expandFeature(feature('turboPad', 100), 3000)).toBeNull();
  });

  it('expands the Phase 3 combat roster', () => {
    // Asteroids take an authored lane; rings sit at the lane-less center.
    expect(expandFeature(feature('asteroid', 100, { lane: -3.5 }), 3000)).toMatchObject([
      { type: 'asteroid', s: 100, x: -3.5 },
    ]);
    expect(expandFeature(feature('whiteRing', 200), 3000)).toMatchObject([
      { type: 'whiteRing', s: 200, x: 0 },
    ]);
    expect(expandFeature(feature('yellowRing', 300), 3000)).toMatchObject([
      { type: 'yellowRing', s: 300, x: 0 },
    ]);
    // Ring gameplay radius spans the road (pass-through anywhere across it).
    const ring = expandFeature(feature('whiteRing', 200), 3000)![0];
    expect(ring.radius).toBeGreaterThan(7);
  });

  it('throws on malformed packageArc params', () => {
    expect(() => expandFeature(feature('packageArc', 100, { count: 0 }), 3000)).toThrow(RangeError);
    expect(() => expandFeature(feature('packageArc', 100, { count: 2.5 }), 3000)).toThrow(RangeError);
    expect(() => expandFeature(feature('packageArc', 100, { lane: 'left' }), 3000)).toThrow(RangeError);
    expect(() => expandFeature(feature('packageArc', 100, { span: Number.NaN }), 3000)).toThrow(RangeError);
  });
});

describe('Spawner streaming window', () => {
  it('activates entities ahead of the player and recycles them behind', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const spawner = new Spawner(track);
    spawner.load(
      makeLevel([
        feature('packageArc', 100, { lane: 0, count: 5, span: 48 }), // s 100..148
        feature('slug', 300, { lane: 1 }),
        feature('heart', 600, { lane: -2 }),
      ]),
    );

    expect(spawner.entityCount).toBe(7);
    expect(spawner.entities.map((entity) => entity.s)).toEqual([...spawner.entities.map((e) => e.s)].sort((a, b) => a - b));

    const step = 1 / 60;
    spawner.update(0, step);
    // Window ahead: [0, 250) → the whole arc is live, slug/heart are not.
    expect(spawner.activeCount).toBe(5);
    const arc = spawner.entities.filter((entity) => entity.s < 200);
    expect(arc.every((entity) => entity.active && entity.visual?.object.visible)).toBe(true);
    expect(spawner.entities.find((entity) => entity.type === 'slug')?.active).toBe(false);

    // Past the slug, the arc has recycled behind (s < 320 − 50).
    spawner.update(320, step);
    expect(spawner.activeCount).toBe(1);
    expect(arc.every((entity) => !entity.active && !entity.visual!.object.visible)).toBe(true);
    const slug = spawner.entities.find((entity) => entity.type === 'slug')!;
    expect(slug.active).toBe(true);
    expect(slug.visual!.object.visible).toBe(true);

    // Far ahead: everything (including the heart) has recycled.
    spawner.update(1000, step);
    expect(spawner.activeCount).toBe(0);
    expect(spawner.entities.every((entity) => !entity.active && !entity.visual!.object.visible)).toBe(true);
  });

  it('places activated visuals on the road at their (s, x)', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const spawner = new Spawner(track);
    spawner.load(makeLevel([feature('slug', 100, { lane: 2 })]));

    spawner.update(0, 1 / 60);
    const slug = spawner.entities[0];
    const expected = track.sToWorld(slug.s, slug.x);
    expect(slug.visual!.object.position.distanceTo(expected.position)).toBeLessThan(1e-6);
    expect(slug.visual!.object.quaternion.angleTo(expected.quaternion)).toBeLessThan(1e-9);
  });

  it('skips dead entities during window advance and revives them on reset', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const spawner = new Spawner(track);
    spawner.load(makeLevel([feature('package', 100, { lane: 0 }), feature('package', 140, { lane: 0 })]));

    spawner.update(0, 1 / 60);
    const first = spawner.entities[0];
    spawner.kill(first);
    expect(first.alive).toBe(false);
    expect(first.visual!.object.visible).toBe(false);

    // Dead entity stays inactive/hidden even though it is in the window.
    spawner.update(0, 1 / 60);
    expect(first.active).toBe(false);
    expect(spawner.entities[1].active).toBe(true);

    // Collision ignores dead entities (reuse-wrap rule).
    spawner.reset(0);
    expect(spawner.entities.every((entity) => entity.alive)).toBe(true);
    // Exactly the prewarmed window is active and visible again.
    expect(spawner.entities.every((entity) => entity.visual!.object.visible === entity.active)).toBe(true);
    expect(spawner.activeCount).toBe(2); // prewarmed window at s=0
  });

  it('rebuilds the pool on load and warns once per unknown-to-factory type', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const track = new TrackCurve(CONTROL_POINTS);
    const spawner = new Spawner(track);

    // turboPad has no factory yet (later phase); pods spawn for real.
    spawner.load(
      makeLevel([
        feature('package', 100),
        feature('turboPad', 200),
        feature('turboPad', 400),
      ]),
    );
    expect(spawner.entityCount).toBe(1); // turboPads skipped
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('turboPad');

    spawner.load(makeLevel([feature('heart', 100), feature('asteroid', 200, { lane: 0 })]));
    expect(spawner.entityCount).toBe(2);
    expect(spawner.entities[1].type).toBe('asteroid');
    expect(spawner.group.children).toHaveLength(2);
    warnSpy.mockRestore();
  });

  it('animates only entities inside the window', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const spawner = new Spawner(track);
    spawner.load(makeLevel([feature('slug', 100), feature('slug', 3000, { lane: 3 })]));

    // object.children[0] is the visual's inner pivot (the animation target).
    const nearPivot = spawner.entities[0].visual!.object.children[0];
    const farPivot = spawner.entities[1].visual!.object.children[0];
    const nearBefore = nearPivot.rotation.y;
    const farBefore = farPivot.rotation.y;

    spawner.update(0, 1 / 60);
    spawner.update(0, 1 / 60);

    expect(spawner.entities[0].active).toBe(true);
    expect(nearPivot.rotation.y).not.toBe(nearBefore);

    // Far slug (s=3000 > 250 ahead) is outside the window: never animated.
    expect(spawner.entities[1].active).toBe(false);
    expect(farPivot.rotation.y).toBe(farBefore);
  });
});

describe('Spawner entity reuse across a full level cycle', () => {
  it('reset revives every record and rewinds the window', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const spawner = new Spawner(track);
    spawner.load(
      makeLevel([
        feature('packageArc', 100, { count: 4 }),
        feature('slug', 500),
        feature('heart', 900),
      ]),
    );

    spawner.update(0, 1 / 60);
    for (const entity of spawner.entities.slice(0, 4)) spawner.kill(entity);
    spawner.update(520, 1 / 60); // slug activates, arc recycles

    spawner.reset(0);
    // All alive again; the prewarm pass re-activated exactly the window set.
    expect(spawner.entities.every((entity) => entity.alive)).toBe(true);
    expect(spawner.entities.filter((entity) => entity.s <= 250).every((entity) => entity.active)).toBe(true);
    expect(spawner.entities.filter((entity) => entity.s > 250).every((entity) => !entity.active)).toBe(true);
    expect(spawner.entities.every((entity) => !entity.visual!.object.visible || entity.active)).toBe(true);
    expect(spawner.activeCount).toBe(4); // prewarmed at s=0: just the arc
  });
});

describe('Entity records', () => {
  it('default radii come from the per-type gameplay table', () => {
    const entity: Entity = createEntity('slug', 10, 1);
    expect(entity.radius).toBeGreaterThan(0);
    expect(entity.alive).toBe(true);
    expect(entity.active).toBe(false);
    expect(entity.visual).toBeNull();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
