import { describe, expect, it } from 'vitest';

import {
  BRONZE_THRESHOLD,
  GOLD_THRESHOLD,
  SILVER_THRESHOLD,
  countLevelPackages,
  medalFor,
  medalForRun,
  medalPoints,
  parSeconds,
} from '../src/systems/Medal';
import type { LevelFeature } from '../src/track/LevelLoader';

/**
 * Medal boundaries (Phase 5): the documented rule is 45 package pts +
 * 10/pip (max 30) + 25 time pts (linear decay to 0 at 2× par), with inclusive
 * thresholds Gold ≥ 90, Silver ≥ 75, Bronze ≥ 60. These tests pin every
 * threshold edge and the time-axis shape.
 */

const PERFECT = {
  packagesCollected: 10,
  packagesAvailable: 10,
  pips: 3,
  maxPips: 3,
  timeSeconds: 80,
  parSeconds: 80,
};

describe('medal scoring', () => {
  it('a perfect run scores exactly 100 and takes gold', () => {
    expect(medalPoints(PERFECT)).toBe(100);
    expect(medalForRun(PERFECT)).toBe('gold');
  });

  it('par time derivation: cruise time with the 1.1 slack factor', () => {
    expect(parSeconds(2300, 30)).toBeCloseTo((2300 / 30) * 1.1, 10);
    expect(parSeconds(0, 30)).toBe(0);
    expect(parSeconds(100, 0)).toBe(0); // degenerate level — no time axis
  });

  it('time at or under par keeps the full 25 pts; exactly 2× par scores 0', () => {
    const base = { ...PERFECT };
    expect(medalPoints({ ...base, timeSeconds: base.parSeconds - 0.001 })).toBe(100);
    expect(medalPoints({ ...base, timeSeconds: base.parSeconds })).toBe(100);
    // 1.5× par → half the time axis: 45 + 30 + 12.5
    expect(medalPoints({ ...base, timeSeconds: base.parSeconds * 1.5 })).toBe(87.5);
    // 2× par → time axis dead: 45 + 30 + 0 = 75 exactly (Silver boundary)
    expect(medalPoints({ ...base, timeSeconds: base.parSeconds * 2 })).toBe(75);
    expect(medalPoints({ ...base, timeSeconds: base.parSeconds * 3 })).toBe(75); // clamped
  });

  it('package axis is proportional, capped, and full-credit with nothing to collect', () => {
    const base = { ...PERFECT };
    expect(medalPoints({ ...base, packagesCollected: 5 })).toBe(45 * 0.5 + 30 + 25);
    expect(medalPoints({ ...base, packagesCollected: 11 })).toBe(100); // capped at 100%
    expect(medalPoints({ ...base, packagesCollected: 0 })).toBe(30 + 25);
    expect(medalPoints({ ...base, packagesAvailable: 0, packagesCollected: 0 })).toBe(100);
  });

  it('pip axis pays 10 per remaining pip up to maxPips', () => {
    const base = { ...PERFECT };
    expect(medalPoints({ ...base, pips: 2 })).toBe(45 + 20 + 25);
    expect(medalPoints({ ...base, pips: 1 })).toBe(45 + 10 + 25);
    expect(medalPoints({ ...base, pips: 0 })).toBe(45 + 0 + 25);
    expect(medalPoints({ ...base, pips: 5 })).toBe(100); // clamped to maxPips
  });

  it('tier thresholds are inclusive at exactly 90 / 75 / 60', () => {
    expect(medalFor(GOLD_THRESHOLD)).toBe('gold');
    expect(medalFor(GOLD_THRESHOLD - 0.5)).toBe('silver');
    expect(medalFor(SILVER_THRESHOLD)).toBe('silver');
    expect(medalFor(SILVER_THRESHOLD - 0.5)).toBe('bronze');
    expect(medalFor(BRONZE_THRESHOLD)).toBe('bronze');
    expect(medalFor(BRONZE_THRESHOLD - 0.5)).toBe('none');
    expect(medalFor(0)).toBe('none');
    expect(medalFor(100)).toBe('gold');
  });

  it('the golden boundary is reachable: full packages + 3 pips + 2× par = exactly Silver', () => {
    // The documented example boundary: sloppy time still medals on pickups.
    const slow = { ...PERFECT, timeSeconds: PERFECT.parSeconds * 2 };
    expect(medalPoints(slow)).toBe(75);
    expect(medalForRun(slow)).toBe('silver');
    // One pip less drops it to Bronze; one package less as well (70.5 pts).
    expect(medalForRun({ ...slow, pips: 2 })).toBe('bronze');
    expect(medalPoints({ ...slow, packagesCollected: 9 })).toBeCloseTo(70.5, 10);
    expect(medalForRun({ ...slow, packagesCollected: 9 })).toBe('bronze');
  });
});

describe('countLevelPackages', () => {
  it('mirrors the Spawner expansion: packages ×1, arcs ×count (default 5)', () => {
    const features: LevelFeature[] = [
      { type: 'package', at: 100, params: { lane: 0 } },
      { type: 'packageArc', at: 200, params: { lane: -2, toLane: 2, count: 7, span: 90 } },
      { type: 'packageArc', at: 400, params: { lane: 0 } }, // count omitted → 5
      { type: 'slug', at: 500, params: { lane: 1 } },
      { type: 'gap', at: 600, params: { width: 40, jumpPod: true } },
    ];
    expect(countLevelPackages(features)).toBe(1 + 7 + 5);
  });

  it('counts nothing on hazard-only feature lists', () => {
    expect(countLevelPackages([{ type: 'slug', at: 10, params: { lane: 0 } }])).toBe(0);
  });
});
