/**
 * Task 17 — BushField: the arena's rustle bushes.
 *
 * Pure data + logic (no three/Rapier — hard sim-purity rule): a seeded
 * scatter of ~40 bushes that doubles as the perception layer's sight
 * blockers (Bush = {pos, radius} straight from ai/perception) and as a
 * movement tell — crossing a bush's rustle radius emits a bushRustle
 * HearingEvent the brain hears through senses.heard. Visuals (instanced
 * swaying canopies) live in render/scene.ts; this module never renders.
 *
 * Loudness encodes gait: crossing while moving fast (running) is a loud
 * 0.6 (HEARING_LOUDNESS.bushRustle); easing through (crouch-walk) is a
 * quiet 0.15. A fighter standing still inside a canopy never rustles.
 */
import type { Rng } from '../core/rng';
import type { Bush, HearingEvent } from '../ai/perception';
import { HEARING_LOUDNESS } from '../ai/perception';
import {
  ARENA_SIZE_M,
  BUSH_COUNT,
  BUSH_MIN_SPAWN_CLEARANCE_M,
  BUSH_MIN_SPACING_M,
  BUSH_RADIUS_M,
  BUSH_RUSTLE_CROUCH_LOUDNESS,
  BUSH_RUSTLE_RADIUS_M,
  BUSH_SCATTER_MARGIN_M,
} from '../data/tuning';

/** A fighter spawn point the scatter must keep clear of. */
export interface SpawnPoint {
  x: number;
  z: number;
}

export class BushField {
  /** Sight-blocking bushes (perception.Bush shape) — feeds canSee/BrainWorld. */
  readonly bushes: Bush[] = [];

  /**
   * Seed-reproducible scatter: rejection-sample uniform points inside the
   * arena (margin applied), each ≥BUSH_MIN_SPAWN_CLEARANCE_M from every
   * spawn and ≥BUSH_MIN_SPACING_M from every placed bush. A fixed attempt
   * budget keeps the pass deterministic; the arena is large enough that
   * the budget never truncates the count in practice.
   */
  constructor(rng: Rng, spawns: readonly SpawnPoint[]) {
    const half = ARENA_SIZE_M / 2 - BUSH_SCATTER_MARGIN_M;
    const clearance2 = BUSH_MIN_SPAWN_CLEARANCE_M * BUSH_MIN_SPAWN_CLEARANCE_M;
    const spacing2 = BUSH_MIN_SPACING_M * BUSH_MIN_SPACING_M;

    for (let attempt = 0; attempt < BUSH_COUNT * 60 && this.bushes.length < BUSH_COUNT; attempt++) {
      const x = (rng() * 2 - 1) * half;
      const z = (rng() * 2 - 1) * half;
      if (!this.clearOfSpawns(x, z, clearance2, spawns)) continue;
      if (!this.clearOfBushes(x, z, spacing2)) continue;
      this.bushes.push({ pos: { x, z }, radius: BUSH_RADIUS_M });
    }
  }

  private clearOfSpawns(x: number, z: number, clearance2: number, spawns: readonly SpawnPoint[]): boolean {
    for (const s of spawns) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz < clearance2) return false;
    }
    return true;
  }

  private clearOfBushes(x: number, z: number, spacing2: number): boolean {
    for (const b of this.bushes) {
      const dx = x - b.pos.x;
      const dz = z - b.pos.z;
      if (dx * dx + dz * dz < spacing2) return false;
    }
    return true;
  }

  /**
   * One step of movement (prevPos → pos) through the field. Returns a
   * bushRustle event sourced at the FIRST bush whose rustle circle the
   * segment ENTERS (previous position outside the circle), or null.
   *
   * Entry-only firing means a walk-through rustles once, not once per step;
   * standing still (pos === prevPos) never fires; stepping out and back in
   * fires again. `isRunning` picks the loud gait (0.6) vs the quiet ease
   * (0.15) — the caller derives it from displacement or stance.
   */
  rustleCheck(pos: { x: number; z: number }, prevPos: { x: number; z: number }, isRunning: boolean): HearingEvent | null {
    const dx = pos.x - prevPos.x;
    const dz = pos.z - prevPos.z;
    const segLen2 = dx * dx + dz * dz;
    if (segLen2 === 0) return null; // no movement, no rustle

    const r = BUSH_RUSTLE_RADIUS_M;
    const r2 = r * r;

    for (const bush of this.bushes) {
      // Segment (prevPos → pos) vs circle (bush, r) — closest approach of
      // the bush center to the segment (same test as perception's sight
      // segment, here relative to prevPos).
      const cx = bush.pos.x - prevPos.x;
      const cz = bush.pos.z - prevPos.z;
      const t = (cx * dx + cz * dz) / segLen2;
      const tt = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = tt * dx - cx;
      const pz = tt * dz - cz;
      if (px * px + pz * pz > r2) continue;

      // Entry only: the previous position must sit outside the circle.
      const prevDx = prevPos.x - bush.pos.x;
      const prevDz = prevPos.z - bush.pos.z;
      if (prevDx * prevDx + prevDz * prevDz <= r2) continue;

      return {
        kind: 'bushRustle',
        pos: { x: bush.pos.x, z: bush.pos.z },
        loudness: isRunning ? HEARING_LOUDNESS.bushRustle : BUSH_RUSTLE_CROUCH_LOUDNESS,
      };
    }
    return null;
  }
}
