import { describe, expect, it } from 'vitest';

import { Health, MAX_PIPS } from '../src/systems/Health';
import {
  finishBonus,
  healthBonus,
  PACKAGE_POINTS,
  Score,
} from '../src/systems/Score';

describe('Score rules', () => {
  it('packages are worth exactly 100 each', () => {
    expect(PACKAGE_POINTS).toBe(100);

    const score = new Score();
    expect(score.packageCount).toBe(0);
    expect(score.packagePoints).toBe(0);

    score.collectPackage();
    score.collectPackage();
    score.collectPackage();
    expect(score.packageCount).toBe(3);
    expect(score.packagePoints).toBe(300);
  });

  it('finish bonus is 1000 × level id', () => {
    expect(finishBonus(1)).toBe(1000);
    expect(finishBonus(2)).toBe(2000);
    expect(finishBonus(10)).toBe(10000);
  });

  it('health bonus is 250 × remaining pips and never negative', () => {
    expect(healthBonus(0)).toBe(0);
    expect(healthBonus(3)).toBe(750);
    expect(healthBonus(-1)).toBe(0);
  });

  it('breakdown produces the exact design-spec total', () => {
    const score = new Score();
    score.collectPackage();
    score.collectPackage();

    // 2 packages on level 2 with 2 pips left:
    // 200 + (1000 × 2) + (250 × 2) = 2700.
    const breakdown = score.breakdown(2, 2);
    expect(breakdown.packagesCollected).toBe(2);
    expect(breakdown.packagePoints).toBe(200);
    expect(breakdown.finish).toBe(2000);
    expect(breakdown.health).toBe(500);
    expect(breakdown.total).toBe(2700);
  });

  it('resets to zero for a retry', () => {
    const score = new Score();
    score.collectPackage();
    score.reset();
    expect(score.packageCount).toBe(0);
    expect(score.packagePoints).toBe(0);
    expect(score.breakdown(1, 3).total).toBe(1000 + 750);
  });
});

describe('Health (postal meter)', () => {
  it('starts at 3 pips', () => {
    expect(new Health().pips).toBe(MAX_PIPS);
    expect(MAX_PIPS).toBe(3);
  });

  it('restores one pip at a time, capped at 3', () => {
    const health = new Health();
    health.damage(2);
    expect(health.pips).toBe(1);

    expect(health.restore(1)).toBe(1);
    expect(health.pips).toBe(2);

    expect(health.restore(5)).toBe(1); // only 1 missing — cap at 3
    expect(health.pips).toBe(3);
    expect(health.restore(1)).toBe(0); // already full
  });

  it('damages down to zero and reports depletion', () => {
    const health = new Health();
    expect(health.damage(2)).toBe(1);
    expect(health.damage(5)).toBe(0); // floors at 0
    expect(health.isDepleted).toBe(true);
  });

  it('resets to full for a retry', () => {
    const health = new Health();
    health.damage(3);
    health.reset();
    expect(health.pips).toBe(3);
  });
});
