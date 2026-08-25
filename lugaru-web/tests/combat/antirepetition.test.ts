import { describe, expect, it } from 'vitest';
import {
  createAntiRepState,
  penaltyFor,
  recordAttack,
} from '../../src/combat/antirepetition';
import type { AntiRepState } from '../../src/combat/antirepetition';
import { ANTIREP_MAX_STREAK, ANTIREP_PENALTY_CAP } from '../../src/data/tuning';

/**
 * Anti-repetition pressure [spec §3.2] — pure counters over AntiRepState.
 * Hand-crafted plain states; no sim class, no clock, no RNG.
 */

function makeState(): AntiRepState {
  return createAntiRepState();
}

describe('recordAttack / penaltyFor', () => {
  it('first use of a move carries no penalty', () => {
    const s = makeState();
    recordAttack(s, 'punch');
    expect(penaltyFor(s, 'punch')).toBe(1);
  });

  it('second consecutive use begins the ramp (1 + one step)', () => {
    const s = makeState();
    recordAttack(s, 'punch');
    recordAttack(s, 'punch');
    expect(penaltyFor(s, 'punch')).toBeCloseTo(1.2, 5); // one linear step
  });

  it('three punches then penaltyFor(punch) ≈ 1.4±0.2 [brief Step-1 pin]', () => {
    const s = makeState();
    for (let i = 0; i < 3; i++) recordAttack(s, 'punch');
    expect(Math.abs(penaltyFor(s, 'punch') - 1.4)).toBeLessThanOrEqual(0.2);
    // Exact linear value: streak 3 → 1 + (3−1)·step = 1.4.
    expect(penaltyFor(s, 'punch')).toBeCloseTo(1.4, 5);
  });

  it('penalty ramps linearly and is capped from streak 5 through 8', () => {
    const s = makeState();
    const seen: number[] = [];
    for (let i = 1; i <= 8; i++) {
      recordAttack(s, 'punch');
      if (i >= 3) seen.push(penaltyFor(s, 'punch'));
    }
    // Streaks 3..8 → 1.4, cap 1.6 held (float noise absorbed by closeTo).
    const expected = [1.4, 1.6, 1.6, 1.6, 1.6, 1.6];
    for (let i = 0; i < expected.length; i++) {
      expect(seen[i]).toBeCloseTo(expected[i], 5);
    }
    expect(penaltyFor(s, 'punch')).toBeLessThanOrEqual(ANTIREP_PENALTY_CAP);
  });

  it('a different move resets the streak: punch punch legSweep → legSweep clean', () => {
    const s = makeState();
    recordAttack(s, 'punch');
    recordAttack(s, 'punch');
    recordAttack(s, 'legSweep');
    expect(penaltyFor(s, 'legSweep')).toBe(1);
    // …and re-opening the punch chain restarts from scratch, not from 2.
    recordAttack(s, 'punch');
    expect(penaltyFor(s, 'punch')).toBe(1);
  });

  it('A B A B A alternation never builds a streak ≥ 3 on either move', () => {
    const s = makeState();
    for (let i = 0; i < 5; i++) {
      recordAttack(s, i % 2 === 0 ? 'punch' : 'doublePunch');
      expect(penaltyFor(s, 'punch')).toBe(1);
      expect(penaltyFor(s, 'doublePunch')).toBe(1);
    }
  });

  it('unknown move id reads as no history: penalty 1', () => {
    const s = makeState();
    recordAttack(s, 'punch');
    recordAttack(s, 'punch');
    expect(penaltyFor(s, 'legSweep')).toBe(1);
  });

  it('streak cap constant is the documented 6 [global constraints]', () => {
    expect(ANTIREP_MAX_STREAK).toBe(6);
    expect(ANTIREP_PENALTY_CAP).toBe(1.6);
  });
});
