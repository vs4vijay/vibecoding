import type { LevelFeature } from '../track/LevelLoader';

/**
 * Medal rules for the results screen — pure logic, no DOM, no THREE.
 *
 * The documented rule (Phase 5): a finish is scored on three axes out of 100
 * points, then mapped to a medal tier by fixed thresholds.
 *
 * - **Packages — up to 45 pts**: `45 × packagesCollected / packagesAvailable`
 *   (full credit when the level carries no packages at all).
 * - **Postal meter — up to 30 pts**: `10 × pips` (capped at `maxPips`).
 * - **Time — up to 25 pts**: full 25 at or under the par time, then decaying
 *   linearly to 0 at twice par: `25 × max(0, 1 − (time − par) / par)`.
 *
 * **Par** is the level's straight cruise time with a small slack factor
 * (`PAR_SLACK`): `par = length / cruiseSpeed × 1.1` — a clean run with a
 * grazed trap or one asteroid still lands under par; sloppy driving does not.
 *
 * **Tiers**: Gold ≥ 90, Silver ≥ 75, Bronze ≥ 60, otherwise none. The
 * boundaries are exact: a full-package, full-health run that crosses the line
 * at exactly 2× par scores exactly 75 (Silver); drop one pip or a package
 * below that and it falls to Bronze — the thresholds are what the unit tests
 * pin.
 */

export type MedalTier = 'gold' | 'silver' | 'bronze' | 'none';

export const GOLD_THRESHOLD = 90;
export const SILVER_THRESHOLD = 75;
export const BRONZE_THRESHOLD = 60;

/** Par slack over a perfect cruise run (steering loss, one grazed trap). */
export const PAR_SLACK = 1.1;

/** Point weights of the three axes (45 + 30 + 25 = 100). */
export const PACKAGE_WEIGHT = 45;
export const PIP_WEIGHT = 10;
export const TIME_WEIGHT = 25;

/** The par time for a level: straight cruise run with `PAR_SLACK` slack. */
export function parSeconds(length: number, cruiseSpeed: number): number {
  if (!(length > 0) || !(cruiseSpeed > 0)) return 0;
  return (length / cruiseSpeed) * PAR_SLACK;
}

/** Inputs to `medalPoints` — all the results screen already has at the gate. */
export interface MedalInput {
  readonly packagesCollected: number;
  readonly packagesAvailable: number;
  readonly pips: number;
  readonly maxPips: number;
  readonly timeSeconds: number;
  readonly parSeconds: number;
}

/**
 * The 0–100 medal score. Time past par decays linearly to 0 at 2× par, so a
 * painfully slow finish still keeps its package and health points but loses
 * the whole time axis.
 */
export function medalPoints(input: MedalInput): number {
  const packagePct =
    input.packagesAvailable > 0
      ? Math.min(1, Math.max(0, input.packagesCollected / input.packagesAvailable))
      : 1; // nothing to collect — full credit for the axis
  const packagePoints = PACKAGE_WEIGHT * packagePct;

  const maxPips = Math.max(1, input.maxPips);
  const pipPoints = PIP_WEIGHT * Math.min(maxPips, Math.max(0, input.pips));

  let timePoints = 0;
  if (input.parSeconds > 0) {
    if (input.timeSeconds <= input.parSeconds) {
      timePoints = TIME_WEIGHT;
    } else {
      const over = (input.timeSeconds - input.parSeconds) / input.parSeconds;
      timePoints = TIME_WEIGHT * Math.max(0, 1 - over);
    }
  }

  return packagePoints + pipPoints + timePoints;
}

/** Maps a medal score to its tier; thresholds are inclusive (≥). */
export function medalFor(points: number): MedalTier {
  if (points >= GOLD_THRESHOLD) return 'gold';
  if (points >= SILVER_THRESHOLD) return 'silver';
  if (points >= BRONZE_THRESHOLD) return 'bronze';
  return 'none';
}

/** Convenience: tier straight from the results data. */
export function medalForRun(input: MedalInput): MedalTier {
  return medalFor(medalPoints(input));
}

/**
 * Total packages a level offers, mirroring the Spawner's expansion exactly:
 * a `package` feature is one pickup, a `packageArc` expands to `count`
 * (default 5, the Spawner's `readCount` default).
 */
export function countLevelPackages(features: readonly LevelFeature[]): number {
  let total = 0;
  for (const feature of features) {
    if (feature.type === 'package') total += 1;
    else if (feature.type === 'packageArc') {
      const count = feature.params['count'];
      total += typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 5;
    }
  }
  return total;
}
