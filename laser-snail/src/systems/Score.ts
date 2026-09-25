/**
 * Scoring rules from the design spec (section 5): packages are worth 100,
 * the finish bonus is 1,000 × level id, and the health bonus is 250 per
 * remaining postal pip. Phase 3 adds the destruction bonus (asteroids 150,
 * slugs 100 — see Weapons.ts) as a per-run accumulator on the same total.
 * Pure rules + a tiny per-run accumulator; the breakdown is what the results
 * screen renders.
 */

export const PACKAGE_POINTS = 100;
export const FINISH_BONUS_PER_LEVEL = 1000;
export const HEALTH_BONUS_PER_PIP = 250;

/** Finish bonus for reaching the end of `levelId`. */
export function finishBonus(levelId: number): number {
  return FINISH_BONUS_PER_LEVEL * levelId;
}

/** Health bonus for finishing with `pips` postal pips remaining. */
export function healthBonus(pips: number): number {
  return HEALTH_BONUS_PER_PIP * Math.max(0, pips);
}

/** Exact score lines the results screen shows. */
export interface ScoreBreakdown {
  readonly packagesCollected: number;
  readonly packagePoints: number;
  readonly bonus: number;
  readonly finish: number;
  readonly health: number;
  readonly total: number;
}

/** Per-run score accumulator (finish/health bonuses are computed at the gate). */
export class Score {
  private packages = 0;
  private bonusPoints = 0;

  public get packageCount(): number {
    return this.packages;
  }

  public get packagePoints(): number {
    return this.packages * PACKAGE_POINTS;
  }

  /** Destruction points (asteroid breakup, slug kills, smart bomb). */
  public get bonus(): number {
    return this.bonusPoints;
  }

  public collectPackage(): void {
    this.packages += 1;
  }

  public addBonus(points: number): void {
    if (points > 0) this.bonusPoints += points;
  }

  public reset(): void {
    this.packages = 0;
    this.bonusPoints = 0;
  }

  /** Full breakdown including finish and health bonuses, with the exact total. */
  public breakdown(levelId: number, pips: number): ScoreBreakdown {
    const packagePoints = this.packagePoints;
    const bonus = this.bonusPoints;
    const finish = finishBonus(levelId);
    const health = healthBonus(pips);
    return {
      packagesCollected: this.packages,
      packagePoints,
      bonus,
      finish,
      health,
      total: packagePoints + bonus + finish + health,
    };
  }
}
