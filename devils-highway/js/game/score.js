/**
 * @file game/score.js — per-run scoring ledger (run-core-loop design 9,
 * task 4.2). The mode sets distance (focus z minus run-start baseline) and
 * calls onPickup per tryCollect hit. Formula (CONFIG.SCORE):
 *   score    = floor(distance) + pickups x SCORE.pickupScore
 *   currency = pickups x SCORE.pickupValue
 * currency mirrors the 2.5 endRun credit EXACTLY (one write path; 4.3
 * replaces endRun's ad-hoc stats defaults with snapshot()); pickupScore is
 * the display-side bonus. snapshot() rewrites one reused object (read it
 * before the next call) — zero allocation otherwise.
 */

import { CONFIG } from "../core/config.js";

/** Run ledger; snapshot() is the endRun()/gameover stats shape. */
export function createScore() {
  let distance = 0;
  let pickups = 0;
  const snap = { distance: 0, pickups: 0, score: 0, currency: 0 };
  return {
    /** Fresh run (menu select / retry). */
    reset() {
      distance = 0;
      pickups = 0;
    },

    /** Collection hook (strand run-throughs collect one per step: n = 1). */
    onPickup(n = 1) {
      pickups += n;
    },

    /** Mode focus z minus the run-start baseline (metres covered). */
    set distance(m) {
      distance = m > 0 ? m : 0;
    },
    get distance() {
      return distance;
    },
    get pickups() {
      return pickups;
    },

    /** Death-time summary — the exact shape endRun()/gameover consume
     *  (currency informational: endRun credits it from pickups itself). */
    snapshot() {
      snap.distance = Math.floor(distance);
      snap.pickups = pickups;
      snap.score = snap.distance + pickups * CONFIG.SCORE.pickupScore;
      snap.currency = pickups * CONFIG.SCORE.pickupValue;
      return snap;
    },
  };
}
