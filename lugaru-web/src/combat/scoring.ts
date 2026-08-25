/**
 * Combo scoring ledger [spec §3.6; plan Task 9]. ScoreLedger accumulates
 * named bonus awards and combo-chain hits into per-label buckets for the
 * results screen breakdown; registerComboHit implements the ×2 ×4 ×8 ×16
 * chain (66→133→266→533→1066) with a COMBO_WINDOW_MS timeout — hits spaced
 * further apart restart the chain — decaying geometrically past the peak.
 *
 * Pure data: no DOM, no clock. Callers inject nowMs (sim time, not
 * Date.now) so replays and tests stay deterministic.
 */

import {
  COMBO_CHAIN_POINTS,
  COMBO_DECAY_NUMERATOR,
  COMBO_WINDOW_MS,
  SCORE_LEG_CANNON,
  SCORE_NICE_AIM,
  SCORE_NINJA_THROW,
  SCORE_REVERSAL,
  SCORE_REVERSAL_KO,
  SCORE_STEALTH_KILL,
  SCORE_STYLE_WALLKICK,
} from '../data/tuning';

/** Every named award the ledger accepts [spec §3.6 table]. */
export const SCORE_EVENTS = {
  REVERSAL: SCORE_REVERSAL,
  REVERSAL_KO: SCORE_REVERSAL_KO,
  STEALTH_KILL: SCORE_STEALTH_KILL,
  LEG_CANNON: SCORE_LEG_CANNON,
  NICE_AIM: SCORE_NICE_AIM,
  STYLE_WALLKICK: SCORE_STYLE_WALLKICK,
  NINJA_THROW: SCORE_NINJA_THROW,
} as const;

/** One named bonus award — plain data so any effect layer can emit it. */
export type ScoreEvent = { readonly [K in keyof typeof SCORE_EVENTS]: { type: K } }[keyof typeof SCORE_EVENTS];

/** Results-screen line: one bucket's label, accumulated points, hit count. */
export interface ScoreBreakdownRow {
  label: string;
  points: number;
  count: number;
}

/** Human-facing labels for the results screen, keyed like SCORE_EVENTS. */
const LABELS: Record<keyof typeof SCORE_EVENTS, string> = {
  REVERSAL: 'Reversal',
  REVERSAL_KO: 'Reversal KO',
  STEALTH_KILL: 'Stealth Kill',
  LEG_CANNON: 'Leg Cannon',
  NICE_AIM: 'Nice Aim',
  STYLE_WALLKICK: 'Style: Wallkick',
  NINJA_THROW: 'Ninja Throw',
};

const COMBO_LABEL = 'Combo';

interface Bucket {
  label: string;
  points: number;
  count: number;
}

export class ScoreLedger {
  private buckets = new Map<string, Bucket>();
  private score = 0;

  /** Combo-chain state: points the next chained hit is worth + last-hit ms. */
  private chainNextIdx = 0;
  private lastHitMs = Number.NEGATIVE_INFINITY;

  /**
   * Record a named bonus award; returns the points granted. Unknown types
   * throw — a typo'd emitter must fail loudly, not silently score zero.
   */
  award(event: ScoreEvent): number {
    const points = SCORE_EVENTS[event.type];
    if (points === undefined) {
      throw new Error(`unknown score event: ${String((event as { type?: unknown }).type)}`);
    }
    this.score += points;
    this.addBucket(LABELS[event.type], points);
    return points;
  }

  /**
   * Record one landed strike at sim-time nowMs; returns the points it
   * scores. Inside COMBO_WINDOW_MS of the previous hit the chain advances
   * (66→133→266→533→1066); past the window the chain restarts at 66.
   * Past the peak each extra chained hit is worth COMBO_DECAY_NUMERATOR /
   * (hits past peak + 1), rounded: 533, 355, 267, … — a hyperbolic decay
   * toward zero matching the brief's "533/355/…" pin. Counts toward the
   * Combo bucket either way.
   */
  registerComboHit(nowMs: number): number {
    const chained = nowMs - this.lastHitMs <= COMBO_WINDOW_MS && this.chainNextIdx > 0;
    let pts: number;
    if (!chained) {
      this.chainNextIdx = 1;
      pts = COMBO_CHAIN_POINTS[0];
    } else if (this.chainNextIdx < COMBO_CHAIN_POINTS.length) {
      pts = COMBO_CHAIN_POINTS[this.chainNextIdx++];
    } else {
      const pastPeak = this.chainNextIdx - COMBO_CHAIN_POINTS.length + 1;
      this.chainNextIdx++;
      pts = Math.max(1, Math.round(COMBO_DECAY_NUMERATOR / (pastPeak + 1)));
    }
    this.lastHitMs = nowMs;
    this.score += pts;
    this.addBucket(COMBO_LABEL, pts);
    return pts;
  }

  /** Total accumulated score across every award and combo hit. */
  total(): number {
    return this.score;
  }

  /** Per-label rows in first-award order, for the results screen. */
  breakdown(): ScoreBreakdownRow[] {
    return Array.from(this.buckets.values());
  }

  private addBucket(label: string, points: number): void {
    let b = this.buckets.get(label);
    if (b === undefined) {
      b = { label, points: 0, count: 0 };
      this.buckets.set(label, b);
    }
    b.points += points;
    b.count++;
  }
}

/**
 * Free-function form per the Task 9 interface: registerComboHit(ledger,
 * nowMs). The class method holds the implementation; this wrapper keeps
 * the brief's call shape available to callers that prefer it.
 */
export function registerComboHit(ledger: ScoreLedger, nowMs: number): number {
  return ledger.registerComboHit(nowMs);
}
