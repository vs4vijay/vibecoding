import { describe, expect, it } from 'vitest';

import { TrackGaps } from '../src/track/TrackGaps';
import type { LevelFeature } from '../src/track/LevelLoader';

/**
 * TrackGaps is the gap owner: it parses `gap` features into merged s-spans
 * that the mesh punches, the fall check consults, and the jump pods launch
 * over. These tests pin the pure s-space logic the rest of Phase 4 builds on.
 */

const feature = (type: string, at: number, params: Record<string, unknown> = {}): LevelFeature => ({
  type,
  at,
  params,
});

describe('TrackGaps.fromFeatures', () => {
  it('parses gap features into spans, ignoring everything else', () => {
    const gaps = TrackGaps.fromFeatures(
      [
        feature('package', 100, { lane: 0 }),
        feature('gap', 500, { width: 40, jumpPod: true }),
        feature('gap', 900, { width: 60 }),
      ],
      2000,
    );
    expect(gaps.count).toBe(2);
    // A gap spans [at, at + width] — the spec's `{"at": 800, "width": 60}` reading.
    expect(gaps.spans[0]).toEqual({ sStart: 500, sEnd: 540, jumpPod: true });
    expect(gaps.spans[1]).toEqual({ sStart: 900, sEnd: 960, jumpPod: false });
  });

  it('merges overlapping gaps into one union of open air', () => {
    const gaps = TrackGaps.fromFeatures(
      [
        feature('gap', 500, { width: 60 }),
        feature('gap', 540, { width: 60, jumpPod: true }),
      ],
      2000,
    );
    expect(gaps.count).toBe(1);
    expect(gaps.spans[0]).toEqual({ sStart: 500, sEnd: 600, jumpPod: true });
  });

  it('clamps spans to the level length', () => {
    const gaps = TrackGaps.fromFeatures([feature('gap', 1950, { width: 200 })], 2000);
    expect(gaps.spans[0]).toMatchObject({ sStart: 1950, sEnd: 2000 });
  });

  it('throws on malformed authoring: bad width, non-boolean jumpPod', () => {
    expect(() => TrackGaps.fromFeatures([feature('gap', 100)], 1000)).toThrow(RangeError);
    expect(() => TrackGaps.fromFeatures([feature('gap', 100, { width: 0 })], 1000)).toThrow(RangeError);
    expect(() => TrackGaps.fromFeatures([feature('gap', 100, { width: -5 })], 1000)).toThrow(RangeError);
    expect(() => TrackGaps.fromFeatures([feature('gap', 100, { width: 40, jumpPod: 'yes' })], 1000)).toThrow(RangeError);
  });

  it('an empty feature list yields a gapless track', () => {
    const gaps = TrackGaps.fromFeatures([], 2000);
    expect(gaps.count).toBe(0);
    expect(gaps.isOverGap(500)).toBe(false);
    expect(gaps.spanForPod(500)).toBeNull();
  });
});

describe('TrackGaps queries', () => {
  const gaps = TrackGaps.fromFeatures(
    [
      feature('gap', 500, { width: 40 }),
      feature('gap', 900, { width: 50, jumpPod: true }),
    ],
    2000,
  );

  it('isOverGap is strictly inside the span', () => {
    expect(gaps.isOverGap(500)).toBe(false); // the lip itself is road
    expect(gaps.isOverGap(500.01)).toBe(true);
    expect(gaps.isOverGap(539.99)).toBe(true);
    expect(gaps.isOverGap(540)).toBe(false); // far lip
    expect(gaps.isOverGap(700)).toBe(false);
  });

  it('spanOverlapping sweeps the (from, to] interval a sim step crossed', () => {
    expect(gaps.spanOverlapping(499.5, 500.4)).not.toBeNull();
    expect(gaps.spanOverlapping(499.9, 500)).toBeNull(); // touches the edge: still road
    expect(gaps.spanOverlapping(539, 541)).not.toBeNull(); // crossed the far lip
    expect(gaps.spanOverlapping(600, 700)).toBeNull();
  });

  it('spanForPod pairs a pod just before a gap start, within the seek window', () => {
    expect(gaps.spanForPod(500 - 2)?.sStart).toBe(500);
    expect(gaps.spanForPod(900 - 2)?.sStart).toBe(900);
    // Within the window but not at the edge: still paired.
    expect(gaps.spanForPod(900 - 20)?.sStart).toBe(900);
    // Too far back, or inside/past the gap: no pairing.
    expect(gaps.spanForPod(900 - 40)).toBeNull();
    expect(gaps.spanForPod(920)).toBeNull();
  });
});
