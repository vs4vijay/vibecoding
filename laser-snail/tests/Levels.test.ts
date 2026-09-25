import { describe, expect, it } from 'vitest';

import { parseLevel } from '../src/track/LevelLoader';
import { loadBundledLevels } from '../src/track/LevelLoader';
import { TrackCurve } from '../src/track/TrackCurve';
import {
  MAX_PODLESS_CLEARANCE,
  POD_EDGE_OFFSET,
  POD_FLIGHT_TIME,
  POD_LANDING_MARGIN,
  POD_SEEK_WINDOW,
} from '../src/track/TrackGaps';
import { SPAWNABLE_FEATURE_TYPES } from '../src/systems/Spawner';
import { VISUAL_FACTORIES } from '../src/entities/factories';
import { ENTITY_RADII, type SpawnType } from '../src/entities/Entity';
import { PLAYER_RADIUS } from '../src/systems/Collision';

/**
 * Validation harness for the handcrafted campaign levels: every bundled JSON
 * must parse, its declared length must match the real spline arc length
 * (TrackCurve enforces the 2% tolerance), and it may only reference features
 * the Spawner can actually build today. Phase 3 adds the level-design
 * invariant: every hazard arrangement leaves a dodgeable lane. Phase 4 adds
 * the gap invariant: every gap is pod'd and the pod arc clears it at cruise,
 * and red trap rings keep their recovery distance before any pod.
 */

/** Road half width and the Controller's edge margin — the player's x range. */
const ROAD_HALF_WIDTH = 7;
const EDGE_MARGIN = 1.2;
/** Hazard features within this many s-units act as one simultaneous wall. */
const CLUSTER_GAP = 30;
/**
 * Red-ring recovery: after eating the trap (−60% for 3 s) Turbo covers
 * cruiseSpeed × 0.4 × 3 = 1.2 × cruise before the slow expires. A ring this
 * close to a pod must leave at least SAFETY s-units so even a grazed ring
 * never dooms the pod arc (the trap stays fair: slow, never deadly).
 */
const RED_RING_SLOW_MULTIPLIER = 0.4;
const RED_RING_DURATION = 3;
const RED_RING_RECOVERY_SAFETY = 15;

interface Coverage {
  readonly s: number;
  readonly x: number;
  readonly radiusSum: number;
}

/** Feature count by type for one level definition. */
function byTypeCount(level: { features: ReadonlyArray<{ type: string }> }, type: string): number {
  return level.features.filter((f) => f.type === type).length;
}

/**
 * Total packages a level offers (mirrors the Spawner: `package` = 1,
 * `packageArc` = its `count`, default 5). Kept in sync with
 * `countLevelPackages` in systems/Medal.ts.
 */
function packagesAvailable(level: {
  features: ReadonlyArray<{ type: string; params: Readonly<Record<string, unknown>> }>;
}): number {
  let total = 0;
  for (const feature of level.features) {
    if (feature.type === 'package') total += 1;
    else if (feature.type === 'packageArc') {
      const count = feature.params['count'];
      total += typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 5;
    }
  }
  return total;
}

/**
 * The Phase 3 invariant: within any cluster of hazards (all lethal contacts
 * within CLUSTER_GAP s-units of each other), the merged (s-agnostic, lane)
 * coverage circles must not block every player x position. A path must exist.
 */
function clusterHasPath(cluster: Coverage[]): boolean {
  const minX = -(ROAD_HALF_WIDTH - EDGE_MARGIN);
  const maxX = ROAD_HALF_WIDTH - EDGE_MARGIN;
  const intervals = cluster
    .map((hazard) => [hazard.x - hazard.radiusSum, hazard.x + hazard.radiusSum] as const)
    .sort((a, b) => a[0] - b[0]);

  let reached = minX;
  for (const [from, to] of intervals) {
    if (from > reached) return true; // uncovered stretch — a dodgeable lane
    reached = Math.max(reached, to);
    if (reached >= maxX) return false; // whole road walled off
  }
  return reached < maxX;
}

/** Groups lethal features into clusters and checks every one is passable. */
function assertDodgeable(features: Array<{ type: string; at: number; lane: number }>): void {
  const hazards = features
    .filter((f) => f.type === 'asteroid' || f.type === 'slug')
    .sort((a, b) => a.at - b.at)
    .map((f) => ({
      s: f.at,
      x: f.lane,
      radiusSum: PLAYER_RADIUS + ENTITY_RADII[f.type as SpawnType],
    }));

  let cluster: Coverage[] = [];
  for (const hazard of hazards) {
    if (cluster.length > 0 && hazard.s - cluster[cluster.length - 1].s > CLUSTER_GAP) {
      expect(clusterHasPath(cluster), `hazard cluster at s=${cluster[0].s} blocks the whole road`).toBe(true);
      cluster = [];
    }
    cluster.push(hazard);
  }
  if (cluster.length > 0) {
    expect(clusterHasPath(cluster), `hazard cluster at s=${cluster[0].s} blocks the whole road`).toBe(true);
  }
}

/**
 * The Phase 4 gap invariant, mechanically checked against level JSON:
 *
 * A gap is survivable iff it has pod coverage and the pod arc clears it at
 * cruise speed. A pod covers `cruiseSpeed × POD_FLIGHT_TIME` s-units of
 * forward flight (fixed-duration catapult); the launch happens at the pod's
 * s, so the arc must reach the gap's far edge plus POD_LANDING_MARGIN. There
 * is no podless jump mechanic, so MAX_PODLESS_CLEARANCE = 0: a gap without a
 * pod (its own `jumpPod: true` or a standalone jumpPod feature at its edge)
 * fails validation — it would be an unavoidable death pit.
 */
function assertGapsJumpable(level: {
  id: number;
  name: string;
  cruiseSpeed: number;
  features: readonly ({ type: string; at: number; params: Readonly<Record<string, unknown>> })[];
}): void {
  const gaps = level.features
    .filter((f) => f.type === 'gap')
    .map((f) => ({
      at: f.at,
      width: f.params['width'],
      jumpPod: f.params['jumpPod'] === true,
    }));
  if (gaps.length === 0) return;

  const arcReach = level.cruiseSpeed * POD_FLIGHT_TIME;
  const standalonePods = level.features
    .filter((f) => f.type === 'jumpPod')
    .map((f) => f.at)
    .sort((a, b) => a - b);

  for (const gap of gaps) {
    expect(typeof gap.width, `gap at ${gap.at}: width must be a number`).toBe('number');
    expect(gap.width as number, `gap at ${gap.at}: width must be positive`).toBeGreaterThan(0);

    // Pod coverage: the gap's own pod, or a standalone pod at the edge.
    const podS = gap.jumpPod
      ? gap.at - POD_EDGE_OFFSET
      : [...standalonePods].reverse().find((pod) => pod <= gap.at && pod >= gap.at - POD_SEEK_WINDOW);
    if (podS === undefined) {
      expect(
        gap.width as number,
        `gap at ${gap.at} in ${level.name} (width ${gap.width}) has no jump pod — ` +
          `podless gaps are unjumpable (maxPodlessClearance = ${MAX_PODLESS_CLEARANCE}); ` +
          `set jumpPod: true or place a jumpPod feature within ${POD_SEEK_WINDOW} s-units before it`,
      ).toBeLessThanOrEqual(MAX_PODLESS_CLEARANCE);
      continue;
    }

    // Arc clearance at cruise: fixed-duration flight from the pod's s must
    // reach past the far edge with the landing margin.
    const required = gap.at + (gap.width as number) - podS + POD_LANDING_MARGIN;
    expect(
      arcReach,
      `pod at s=${podS} for gap at ${gap.at} (width ${gap.width}) in ${level.name}: ` +
        `arc covers ${arcReach.toFixed(1)} at cruise ${level.cruiseSpeed}, needs ${required.toFixed(1)} ` +
        `(gap + ${POD_LANDING_MARGIN} landing margin)`,
    ).toBeGreaterThanOrEqual(required);
  }
}

/**
 * Red trap rings must be dodgeable (a lane exists around the ring's coverage)
 * and fair before pods: a ring within the "approach window" of a pod must sit
 * at least the recovery distance away, so a grazed ring costs time — never
 * the pod arc.
 */
function assertRedRingsFair(level: {
  id: number;
  name: string;
  cruiseSpeed: number;
  features: readonly ({ type: string; at: number; params: Readonly<Record<string, unknown>> })[];
}): void {
  const maxX = ROAD_HALF_WIDTH - EDGE_MARGIN;
  const rings = level.features
    .filter((f) => f.type === 'redRing')
    .map((f) => ({ at: f.at, lane: typeof f.params['lane'] === 'number' ? f.params['lane'] : 0 }));
  if (rings.length === 0) return;

  const ringRadius = ENTITY_RADII['redRing'];
  const pods = level.features
    .filter((f) => f.type === 'gap' && f.params['jumpPod'] === true)
    .map((f) => f.at - POD_EDGE_OFFSET);

  for (const ring of rings) {
    // Dodgeable: the ring's coverage must not seal off the whole road.
    const openLeft = ring.lane - ringRadius > -maxX;
    const openRight = ring.lane + ringRadius < maxX;
    expect(
      openLeft || openRight,
      `red ring at ${ring.at} in ${level.name} (lane ${ring.lane}) spans the whole road — it must be dodgeable`,
    ).toBe(true);

    // Fair before pods: recovery distance (slow zone length) + safety.
    const recovery = level.cruiseSpeed * RED_RING_SLOW_MULTIPLIER * RED_RING_DURATION + RED_RING_RECOVERY_SAFETY;
    for (const podS of pods) {
      const distance = podS - ring.at;
      if (distance > 0 && distance <= 200) {
        expect(
          distance,
          `red ring at ${ring.at} in ${level.name} is ${distance} before the pod at ${podS}: ` +
            `needs ≥ ${recovery.toFixed(0)} so a grazed ring recovers before the launch`,
        ).toBeGreaterThanOrEqual(recovery);
      }
    }
  }
}

describe('handcrafted levels', () => {
  const levels = loadBundledLevels();

  it('bundles levels 1–10 (the full campaign)', () => {
    expect([...levels.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  const ordered = [...levels.values()].sort((a, b) => a.id - b.id);

  for (const level of ordered) {
    describe(`level ${level.id} (${level.name})`, () => {
      it('declares a length that matches the real spline arc length', () => {
        // Throws if the authored length drifts beyond the 2% tolerance —
        // this is what keeps every feature `at` value meaningful.
        expect(() => new TrackCurve(level.controlPoints, { expectedLength: level.length })).not.toThrow();
      });

      it('only uses spawnable feature types with sane params', () => {
        expect(level.features.length).toBeGreaterThan(0);
        for (const f of level.features) {
          expect(SPAWNABLE_FEATURE_TYPES).toContain(f.type);
          expect(f.at).toBeGreaterThanOrEqual(0);
          expect(f.at).toBeLessThanOrEqual(level.length);
          for (const [key, value] of Object.entries(f.params)) {
            if (['lane', 'toLane', 'span', 'width'].includes(key)) {
              expect(typeof value, `${f.type} at ${f.at} param ${key}`).toBe('number');
            }
            if (key === 'count') {
              expect(Number.isInteger(value)).toBe(true);
              expect(value as number).toBeGreaterThan(0);
            }
            if (key === 'jumpPod') {
              expect(typeof value, `gap at ${f.at} param jumpPod`).toBe('boolean');
            }
          }
          if (f.type === 'gap') {
            expect(typeof f.params['width'], `gap at ${f.at} needs a numeric width`).toBe('number');
          }
        }
      });

      it('builds a visual for every spawned entity', () => {
        const entities: Array<{ type: string }> = [];
        for (const f of level.features) {
          if (f.type === 'packageArc') {
            const count = typeof f.params['count'] === 'number' ? f.params['count'] : 5;
            for (let i = 0; i < count; i += 1) entities.push({ type: 'package' });
          } else if (f.type === 'gap') {
            if (f.params['jumpPod'] === true) entities.push({ type: 'jumpPod' });
          } else {
            entities.push({ type: f.type });
          }
        }
        expect(entities.length).toBeGreaterThan(0);
        for (const entity of entities) {
          expect(VISUAL_FACTORIES[entity.type as SpawnType]).toBeDefined();
        }
      });

      it('leaves a dodgeable lane through every hazard cluster (level-design invariant)', () => {
        assertDodgeable(
          level.features.map((f) => ({
            type: f.type,
            at: f.at,
            lane: typeof f.params['lane'] === 'number' ? (f.params['lane'] as number) : 0,
          })),
        );
      });

      it('every gap is jumpable at cruise via a pod (level-design invariant)', () => {
        assertGapsJumpable(level);
      });

      it('red rings are dodgeable and keep their recovery distance before pods', () => {
        assertRedRingsFair(level);
      });
    });
  }

  it('L1 is the gentle intro: sparse hazards, a late heart', () => {
    const l1 = ordered[0];
    const byType = (type: string) => l1.features.filter((f) => f.type === type);

    expect(l1.cruiseSpeed).toBe(30);
    expect(l1.length).toBeGreaterThanOrEqual(2000);
    expect(l1.length).toBeLessThanOrEqual(2500);
    expect(byType('slug')).toHaveLength(3); // obvious lanes, 2–3 slugs
    expect(byType('heart')).toHaveLength(1);
    expect(byType('heart')[0].at).toBeGreaterThan(l1.length * 0.75); // late
    expect(byType('packageArc').length).toBeGreaterThanOrEqual(2);
    expect(byType('package').length + byType('packageArc').length).toBeGreaterThanOrEqual(5);
  });

  it('L2 escalates: more slugs, arcs across lanes, higher cruise speed', () => {
    const l1 = ordered[0];
    const l2 = ordered[1];
    const slugs1 = l1.features.filter((f) => f.type === 'slug').length;
    const slugs2 = l2.features.filter((f) => f.type === 'slug').length;

    expect(l2.cruiseSpeed).toBeGreaterThan(l1.cruiseSpeed);
    expect(l2.cruiseSpeed).toBe(35);
    expect(l2.length).toBeGreaterThan(l1.length);
    expect(l2.length).toBeLessThanOrEqual(3000);
    expect(slugs2).toBeGreaterThan(slugs1);

    // Arcs that actually sweep across lanes (lane ≠ toLane).
    const sweepingArcs = l2.features.filter(
      (f) => f.type === 'packageArc' && f.params['lane'] !== f.params['toLane'],
    );
    expect(sweepingArcs.length).toBeGreaterThanOrEqual(2);
  });

  it('L3 introduces asteroids: lane blockers with gaps, white rings to climb the ladder, a late yellow ring', () => {
    const l3 = ordered[2];
    const byType = (type: string) => l3.features.filter((f) => f.type === type);

    expect(l3.cruiseSpeed).toBe(38);
    expect(l3.length).toBeGreaterThanOrEqual(2600);
    expect(l3.length).toBeLessThanOrEqual(3000);

    // Asteroid intro: blockers arrive with breathing room between them and a
    // warm-up free of hazards before the first rock.
    const asteroids = byType('asteroid');
    expect(asteroids.length).toBeGreaterThanOrEqual(8);
    const firstHazard = Math.min(
      ...l3.features.filter((f) => f.type === 'asteroid' || f.type === 'slug').map((f) => f.at),
    );
    expect(firstHazard).toBeGreaterThanOrEqual(400);

    // The ladder: enough white rings to climb several rungs, and the smart
    // bomb lands late as a payoff.
    expect(byType('whiteRing').length).toBeGreaterThanOrEqual(4);
    expect(byType('yellowRing')).toHaveLength(1);
    expect(byType('yellowRing')[0].at).toBeGreaterThan(l3.length * 0.9);

    // Pickups keep flowing per the escalation.
    expect(byType('heart').length).toBeGreaterThanOrEqual(1);
    expect(byType('package').length + byType('packageArc').length).toBeGreaterThanOrEqual(6);
  });

  it('L4 escalates: denser asteroids, slug+asteroid combos, both ring types', () => {
    const l3 = ordered[2];
    const l4 = ordered[3];
    const byType = (type: string) => l4.features.filter((f) => f.type === type);

    expect(l4.cruiseSpeed).toBe(42);
    expect(l4.cruiseSpeed).toBeGreaterThan(l3.cruiseSpeed);
    expect(l4.length).toBeGreaterThan(l3.length);
    expect(l4.length).toBeLessThanOrEqual(3400);

    // Denser belt than L3.
    expect(byType('asteroid').length).toBeGreaterThan(l3.features.filter((f) => f.type === 'asteroid').length);

    // Both ring types appear — ladder climbs continue and bombs matter.
    expect(byType('whiteRing').length).toBeGreaterThanOrEqual(2);
    expect(byType('yellowRing').length).toBeGreaterThanOrEqual(1);

    // Slug+asteroid combos: a slug pressed into an asteroid cluster
    // (shoot-or-dodge pressure the cannon is for).
    const asteroidS = byType('asteroid').map((f) => f.at);
    const combos = byType('slug').filter((slug) =>
      asteroidS.some((at) => Math.abs(at - slug.at) <= CLUSTER_GAP),
    );
    expect(combos.length).toBeGreaterThanOrEqual(2);

    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(byType('package').length + byType('packageArc').length).toBeGreaterThanOrEqual(6);
  });

  it('L5 introduces gaps: 4+ pod\u2019d chasms, gentle arcs, a teaching red ring away from any gap', () => {
    const l5 = ordered[4];
    const byType = (type: string) => l5.features.filter((f) => f.type === type);

    expect(l5.cruiseSpeed).toBe(40);
    expect(l5.length).toBeGreaterThanOrEqual(2800);
    expect(l5.length).toBeLessThanOrEqual(3200);

    const gaps = byType('gap');
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    // Every gap has its own pod (the gentle intro — nothing to miss).
    expect(gaps.every((g) => g.params['jumpPod'] === true)).toBe(true);
    // The first chasm waits past the warm-up.
    expect(gaps[0].at).toBeGreaterThanOrEqual(400);
    // Gentle widths: the shortest gap well under the arc reach.
    const widths = gaps.map((g) => g.params['width'] as number);
    expect(Math.min(...widths)).toBeLessThanOrEqual(38);

    // The red ring teaches the trap in the open, far from any launch.
    expect(byType('redRing')).toHaveLength(1);
    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(byType('whiteRing').length).toBeGreaterThanOrEqual(3);
    expect(byType('package').length + byType('packageArc').length).toBeGreaterThanOrEqual(8);
  });

  it('L6 escalates: more gaps, wider chasms, red-ring traps pressuring the approaches', () => {
    const l5 = ordered[4];
    const l6 = ordered[5];
    const byType = (type: string) => l6.features.filter((f) => f.type === type);

    expect(l6.cruiseSpeed).toBe(45);
    expect(l6.length).toBeGreaterThan(l5.length);
    expect(l6.length).toBeLessThanOrEqual(3600);

    const gaps = byType('gap');
    expect(gaps.length).toBeGreaterThan(l5.features.filter((f) => f.type === 'gap').length);
    expect(gaps.every((g) => g.params['jumpPod'] === true)).toBe(true);
    const widths = gaps.map((g) => g.params['width'] as number);
    expect(Math.max(...widths)).toBeGreaterThan(Math.max(...(l5.features.filter((f) => f.type === 'gap').map((g) => g.params['width'] as number))));

    // Cruelly seeded: rings before gaps, but the fairness invariant above
    // guarantees a grazed ring still recovers before the launch.
    expect(byType('redRing').length).toBeGreaterThanOrEqual(3);
    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(byType('yellowRing').length).toBeGreaterThanOrEqual(1);
    expect(byType('package').length + byType('packageArc').length).toBeGreaterThanOrEqual(10);
  });

  it('L7 is the trap weave: red rings pace the gaps, mixed combos throughout', () => {
    const l6 = ordered[5];
    const l7 = ordered[6];
    const byType = (type: string) => l7.features.filter((f) => f.type === type);

    expect(l7.cruiseSpeed).toBe(47);
    expect(l7.length).toBeGreaterThan(l6.length);
    expect(l7.length).toBeLessThanOrEqual(3600);

    expect(l7.cruiseSpeed).toBeGreaterThan(l6.cruiseSpeed);
    expect(byType('gap').length).toBe(6);
    expect(byType('redRing').length).toBe(5);
    expect(byType('redRing').length).toBeGreaterThan(l6.features.filter((f) => f.type === 'redRing').length);

    // The weave: red rings sit cruelly on gap approaches — at least 4
    // ring-then-pod sequences within the approach window (the fairness
    // invariant above guarantees each is still survivable when grazed).
    const podS = byType('gap').map((g) => g.at - POD_EDGE_OFFSET);
    const pairings = byType('redRing').filter((ring) =>
      podS.some((pod) => pod - ring.at > 0 && pod - ring.at <= 200),
    );
    expect(pairings.length).toBeGreaterThanOrEqual(4);

    // Mixed-field pressure: asteroid+slug combos and both ring types.
    expect(byType('asteroid').length).toBeGreaterThanOrEqual(6);
    expect(byType('slug').length).toBeGreaterThanOrEqual(8);
    expect(byType('whiteRing').length).toBeGreaterThanOrEqual(4);
    expect(byType('yellowRing').length).toBeGreaterThanOrEqual(1);
    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(packagesAvailable(l7)).toBeGreaterThanOrEqual(45);
  });

  it('L8 escalates: more gaps, rings and speed than L7, widest chasm yet', () => {
    const l7 = ordered[6];
    const l8 = ordered[7];
    const byType = (type: string) => l8.features.filter((f) => f.type === type);

    expect(l8.cruiseSpeed).toBe(50);
    expect(l8.cruiseSpeed).toBeGreaterThan(l7.cruiseSpeed);
    expect(l8.length).toBeGreaterThan(l7.length);
    expect(l8.length).toBeLessThanOrEqual(3800);

    expect(byType('gap').length).toBeGreaterThan(l7.features.filter((f) => f.type === 'gap').length);
    expect(byType('redRing').length).toBeGreaterThan(l7.features.filter((f) => f.type === 'redRing').length);
    const widths = byType('gap').map((g) => g.params['width'] as number);
    const l7Widths = l7.features.filter((f) => f.type === 'gap').map((g) => g.params['width'] as number);
    expect(Math.max(...widths)).toBeGreaterThan(Math.max(...l7Widths));

    expect(byType('asteroid').length).toBeGreaterThanOrEqual(8);
    expect(byType('slug').length).toBeGreaterThanOrEqual(8);
    expect(byType('yellowRing').length).toBeGreaterThanOrEqual(3);
    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(packagesAvailable(l8)).toBeGreaterThanOrEqual(35);
  });

  it('L9 is the gauntlet gate: densest mixed field of the campaign so far', () => {
    const l8 = ordered[7];
    const l9 = ordered[8];
    const byType = (type: string) => l9.features.filter((f) => f.type === type);

    expect(l9.cruiseSpeed).toBe(54);
    expect(l9.cruiseSpeed).toBeGreaterThan(l8.cruiseSpeed);
    expect(l9.length).toBeGreaterThan(l8.length);
    expect(l9.length).toBeLessThanOrEqual(4000);

    expect(byType('gap').length).toBeGreaterThanOrEqual(9);
    expect(byType('redRing').length).toBeGreaterThanOrEqual(7);
    expect(byType('asteroid').length).toBeGreaterThanOrEqual(13);
    expect(byType('asteroid').length).toBeGreaterThan(l8.features.filter((f) => f.type === 'asteroid').length);
    expect(byType('slug').length).toBeGreaterThanOrEqual(10);
    expect(byType('whiteRing').length).toBeGreaterThanOrEqual(3);
    expect(byType('yellowRing').length).toBeGreaterThanOrEqual(2);
    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(packagesAvailable(l9)).toBeGreaterThanOrEqual(35);
  });

  it('L10 is the postal apex: fastest cruise, every element at campaign maximum', () => {
    const l9 = ordered[8];
    const l10 = ordered[9];
    const byType = (type: string) => l10.features.filter((f) => f.type === type);

    expect(l10.cruiseSpeed).toBe(58);
    expect(l10.cruiseSpeed).toBeGreaterThan(l9.cruiseSpeed);
    expect(l10.length).toBeGreaterThan(l9.length);

    expect(byType('gap').length).toBeGreaterThanOrEqual(10);
    expect(byType('redRing').length).toBeGreaterThanOrEqual(8);
    expect(byType('asteroid').length).toBeGreaterThanOrEqual(15);
    expect(byType('slug').length).toBeGreaterThanOrEqual(12);
    expect(byType('whiteRing').length).toBeGreaterThanOrEqual(3);
    expect(byType('yellowRing').length).toBeGreaterThanOrEqual(2);
    expect(byType('heart').length).toBeGreaterThanOrEqual(2);
    expect(packagesAvailable(l10)).toBeGreaterThanOrEqual(35);

    // Widest chasm of the campaign, pod'd like every other gap.
    const widths = byType('gap').map((g) => g.params['width'] as number);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(60);
  });

  it('campaign curve: hazards wait, gap and red-ring density ramp, packages keep pace', () => {
    // 1. No level opens with an instant hazard: the first slug/asteroid sits
    // at least 250 s-units down the road everywhere.
    for (const level of ordered) {
      const hazards = level.features.filter((f) => f.type === 'slug' || f.type === 'asteroid').map((f) => f.at);
      expect(hazards.length, `${level.name} has hazards`).toBeGreaterThan(0);
      expect(Math.min(...hazards), `${level.name} first hazard`).toBeGreaterThanOrEqual(250);
    }

    // 2. Cruise speed escalates inside each act (L5 resets for the gap intro).
    for (let i = 1; i < 4; i += 1) expect(ordered[i].cruiseSpeed).toBeGreaterThan(ordered[i - 1].cruiseSpeed);
    for (let i = 5; i < ordered.length; i += 1) {
      expect(ordered[i].cruiseSpeed, `L${i + 1} cruise`).toBeGreaterThan(ordered[i - 1].cruiseSpeed);
    }

    // 3. Gap frequency rises L5→L10: density (gaps / 1000 s-units) never
    // drops meaningfully and finishes ≥ 1.5× the L5 intro.
    const gaps = ordered.slice(4).map((level) => byTypeCount(level, 'gap'));
    const gapDensity = ordered.slice(4).map((level) => (byTypeCount(level, 'gap') / level.length) * 1000);
    expect(gaps).toEqual([4, 6, 6, 7, 9, 10]);
    for (let i = 1; i < gapDensity.length; i += 1) {
      expect(gapDensity[i], `gap density L${i + 5} → L${i + 6}`).toBeGreaterThanOrEqual(gapDensity[i - 1] - 0.05);
    }
    expect(gapDensity[gapDensity.length - 1]).toBeGreaterThanOrEqual(gapDensity[0] * 1.5);

    // 4. Red-ring density (rings / 1000 s-units) ramps strictly L6→L10, from
    // the L5 teaching ring to the apex gauntlet.
    const redDensity = ordered.slice(4).map((level) => (byTypeCount(level, 'redRing') / level.length) * 1000);
    expect(redDensity[0]).toBeLessThan(redDensity[1]);
    for (let i = 2; i < redDensity.length; i += 1) {
      expect(redDensity[i], `red-ring density L${i + 5} → L${i + 6}`).toBeGreaterThan(redDensity[i - 1]);
    }

    // 5. Package supply keeps pace with threats: every level offers ≥ 25
    // pickups and holds a package-to-threat ratio ≥ 1.2, so score
    // opportunities scale with danger instead of collapsing.
    for (const level of ordered) {
      const packages = packagesAvailable(level);
      const threats = byTypeCount(level, 'slug') + byTypeCount(level, 'asteroid');
      expect(packages, `${level.name} packages`).toBeGreaterThanOrEqual(25);
      expect(packages / threats, `${level.name} package-to-threat ratio`).toBeGreaterThanOrEqual(1.2);
    }

    // 6. Threat density (slugs + asteroids / 1000 s-units) escalates inside
    // each act: the steering act L1–L4 and the everything act L5–L10.
    const threatDensity = (level: (typeof ordered)[number]) =>
      ((byTypeCount(level, 'slug') + byTypeCount(level, 'asteroid')) / level.length) * 1000;
    for (let i = 1; i < 4; i += 1) expect(threatDensity(ordered[i])).toBeGreaterThan(threatDensity(ordered[i - 1]));
    for (let i = 5; i < ordered.length; i += 1) {
      expect(threatDensity(ordered[i]), `threat density L${i + 1}`).toBeGreaterThan(threatDensity(ordered[i - 1]));
    }
  });

  it('every level re-parses cleanly through the pure validator', () => {
    for (const level of ordered) {
      expect(() => parseLevel(structuredClone(level))).not.toThrow();
    }
  });
});
