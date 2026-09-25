import type { LevelFeature } from './LevelLoader';

/**
 * Gap ownership — the single source of truth for where the highway is missing.
 *
 * Levels declare `gap` features (`{ at, width, jumpPod? }`); this module turns
 * them into plain s-ranges ("spans") that every other system consumes:
 *
 * - `TrackMesh` takes `gaps.spans` as a build option and punches the exact
 *   holes into the ribbon (plus the chasm geometry below), so what the player
 *   sees is *exactly* what the gameplay logic treats as open air.
 * - `Collision.checkFall` consults a span reader for the fall check — a pure
 *   structural query, so the collision module stays free of track code.
 * - `Spawner.expandFeature` turns a `jumpPod: true` gap (or a standalone
 *   `jumpPod` feature) into a road-spanning jumpPod entity.
 *
 * Everything here is pure data over track coordinates — no THREE, fully
 * unit-testable against level JSON.
 *
 * Pod flight model (the level-design invariant):
 *   A pod launch is a **fixed-duration** parabola (`POD_FLIGHT_TIME`), during
 *   which the snail keeps advancing at its current speed. At cruise speed the
 *   arc therefore covers `cruiseSpeed × POD_FLIGHT_TIME` s-units from the pod,
 *   and the invariant test in `tests/Levels.test.ts` requires that distance to
 *   clear the gap plus `POD_LANDING_MARGIN`. Speed modifiers stack on top: a
 *   red ring eaten close before a pod shortens the arc — the cruelty — while
 *   dodging it keeps the arc intact. There is no podless jump mechanic, so a
 *   gap without pod coverage is never survivable (`maxPodlessClearance = 0`).
 */

/** One open stretch of track: open air for `s ∈ [sStart, sEnd)`. */
export interface GapSpan {
  readonly sStart: number;
  readonly sEnd: number;
  /** The gap declares (or has) a jump pod at its leading edge. */
  readonly jumpPod: boolean;
}

/** A minimal reader — `Collision.checkFall` consumes this shape, not the class. */
export interface GapReader {
  /** First span overlapping the half-open interval `(from, to]`, or null. */
  spanOverlapping(from: number, to: number): GapSpan | null;
}

/** Jump-pod flight duration in seconds (fixed at launch). */
export const POD_FLIGHT_TIME = 1.4;
/** Parabola peak height above the road, in world units. */
export const POD_PEAK_HEIGHT = 7;
/** Extra clearance the pod arc must leave past the gap's far edge. */
export const POD_LANDING_MARGIN = 6;
/** A gap's auto pod sits this many s-units before the hole starts. */
export const POD_EDGE_OFFSET = 2;
/** How far before a gap's start a standalone `jumpPod` feature may sit. */
export const POD_SEEK_WINDOW = 25;
/** Largest gap crossable without pod coverage (no podless jump exists). */
export const MAX_PODLESS_CLEARANCE = 0;

export class TrackGaps {
  private readonly spansInternal: readonly GapSpan[];

  private constructor(spans: readonly GapSpan[]) {
    this.spansInternal = spans;
  }

  /** Sorted, merged, clamped spans — exactly what `TrackMesh` should punch. */
  public get spans(): readonly GapSpan[] {
    return this.spansInternal;
  }

  public get count(): number {
    return this.spansInternal.length;
  }

  /** True when `s` is strictly inside open air. */
  public isOverGap(s: number): boolean {
    return this.spanAt(s) !== null;
  }

  /** The span containing `s` (strictly inside), or null. */
  public spanAt(s: number): GapSpan | null {
    for (const span of this.spansInternal) {
      if (s > span.sStart && s < span.sEnd) return span;
    }
    return null;
  }

  /**
   * First span overlapping the half-open interval `(from, to]` — the swept
   * region the player crossed in one sim step. Null when the whole step ran
   * over solid road.
   */
  public spanOverlapping(from: number, to: number): GapSpan | null {
    for (const span of this.spansInternal) {
      if (span.sStart < to && span.sEnd > from) return span;
    }
    return null;
  }

  /**
   * The gap a jump pod launches over: the span whose start the pod sits just
   * before (within `POD_SEEK_WINDOW`). Null when the pod floats free of any
   * gap (it still pops when crossed, it just launches nothing).
   */
  public spanForPod(podS: number): GapSpan | null {
    for (const span of this.spansInternal) {
      if (podS <= span.sStart && podS >= span.sStart - POD_SEEK_WINDOW) return span;
    }
    return null;
  }

  /**
   * Parses `gap` features out of a validated level. Widths must be positive
   * numbers and `jumpPod` a boolean — authoring mistakes throw RangeError
   * instead of silently producing an uncrossable or invisible gap. Overlapping
   * gaps merge (a union of open air), and spans clamp to `[0, levelLength]`.
   */
  public static fromFeatures(features: readonly LevelFeature[], levelLength: number): TrackGaps {
    const raw: GapSpan[] = [];
    for (const feature of features) {
      if (feature.type !== 'gap') continue;
      const width = feature.params['width'];
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        throw new RangeError(`gap at ${feature.at}: "width" must be a positive finite number, got ${String(width)}`);
      }
      const jumpPodRaw = feature.params['jumpPod'] ?? false;
      if (typeof jumpPodRaw !== 'boolean') {
        throw new RangeError(`gap at ${feature.at}: "jumpPod" must be a boolean, got ${String(jumpPodRaw)}`);
      }
      raw.push({
        sStart: Math.max(0, feature.at),
        sEnd: Math.min(levelLength, feature.at + width),
        jumpPod: jumpPodRaw,
      });
    }

    raw.sort((a, b) => a.sStart - b.sStart || a.sEnd - b.sEnd);

    // Merge overlaps so the mesh and the fall check see one clean union.
    const merged: GapSpan[] = [];
    for (const span of raw) {
      const last = merged[merged.length - 1];
      if (last && span.sStart <= last.sEnd) {
        merged[merged.length - 1] = {
          sStart: last.sStart,
          sEnd: Math.max(last.sEnd, span.sEnd),
          jumpPod: last.jumpPod || span.jumpPod,
        };
      } else {
        merged.push(span);
      }
    }

    return new TrackGaps(merged);
  }
}
