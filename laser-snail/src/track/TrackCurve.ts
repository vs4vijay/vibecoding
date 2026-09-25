import * as THREE from 'three';

/**
 * Track coordinates are the game's universal space: `s` = arc length along the
 * highway (0..length), `x` = lateral offset across the road (0 = center line,
 * positive = to the snail's right when facing forward). All gameplay —
 * spawning, collision, camera, placement — runs in (s, x); this class is the
 * only place that converts to and from world space.
 */

/** A control point as it appears in level JSON: `[x, y, z]` in world units. */
export type Vec3Tuple = readonly [number, number, number];

/**
 * A coordinate frame on the track at some arc length `s`.
 *
 * The frame is built from the curve tangent plus a world-up reference so the
 * lateral axis stays horizontal everywhere (no roll drift, unlike Frenet
 * frames): the road pitches with elevation but never banks on its own.
 */
export interface TrackFrame {
  /** Road-surface center point at `s`, before any lateral offset. */
  position: THREE.Vector3;
  /** Unit tangent: direction of travel (increasing `s`). */
  tangent: THREE.Vector3;
  /** Unit right vector: the `+x` lateral axis. Always horizontal. */
  right: THREE.Vector3;
  /** Unit road-surface normal, pointing up away from the road. */
  normal: THREE.Vector3;
  /**
   * Rotation aligning an object's local -Z (Three.js forward) with `tangent`
   * and local +Y with `normal`. Apply steering roll/yaw *after* this one.
   */
  quaternion: THREE.Quaternion;
}

/** Allocates a standalone frame target (for build-time or per-owner reuse). */
export function createTrackFrame(): TrackFrame {
  return {
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    normal: new THREE.Vector3(0, 1, 0),
    quaternion: new THREE.Quaternion(),
  };
}

/** Result of projecting a world point back into track coordinates. */
export interface TrackProjection {
  /** Arc length of the nearest point on the curve's center line. */
  s: number;
  /** Signed lateral offset from the center line (positive = right). */
  x: number;
}

/** Allocates a standalone projection target. */
export function createTrackProjection(): TrackProjection {
  return { s: 0, x: 0 };
}

export interface TrackCurveOptions {
  /**
   * Declared arc length from the level JSON. When given, the built curve's
   * real arc length must match within `lengthTolerance` or construction
   * throws — keeps authored feature placements (`at` values) meaningful.
   */
  expectedLength?: number;
  /** Relative tolerance for `expectedLength`. Defaults to 0.02 (2%). */
  lengthTolerance?: number;
}

const DEFAULT_LENGTH_TOLERANCE = 0.02;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Fallback step for the central-difference tangent, in arc-length units. */
const TANGENT_STEP_S = 0.5;
const MIN_CONTROL_POINTS = 2;
/** Resolution of the sampling polyline used by the world → s projection. */
const SAMPLE_SPACING = 1.5;
const MAX_SAMPLES = 4096;
const MAX_ARC_DIVISIONS = 8000;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class TrackCurve {
  /** The underlying spline. Exposed for exotic build-time needs only. */
  public readonly curve: THREE.CatmullRomCurve3;

  private readonly arcLength: number;
  /** Equally arc-spaced center-line samples for the world → s projection. */
  private readonly samplePoints: THREE.Vector3[];
  private readonly sampleSpacing: number;

  // Reusable scratch objects — TrackCurve methods are NOT reentrant.
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly frameScratch = createTrackFrame();
  private readonly projectionScratch = createTrackProjection();
  /** Last computed right vector, for the vertical-tangent fallback. */
  private readonly lastRight = new THREE.Vector3(1, 0, 0);

  constructor(controlPoints: readonly Vec3Tuple[], options: TrackCurveOptions = {}) {
    if (!Array.isArray(controlPoints) || controlPoints.length < MIN_CONTROL_POINTS) {
      throw new RangeError(
        `TrackCurve needs at least ${MIN_CONTROL_POINTS} control points, got ${String(controlPoints?.length)}`,
      );
    }

    const points = controlPoints.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 3) {
        throw new RangeError(`TrackCurve controlPoints[${index}] must be an [x, y, z] triple`);
      }
      const [x, y, z] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new RangeError(`TrackCurve controlPoints[${index}] contains a non-finite value`);
      }
      return new THREE.Vector3(x, y, z);
    });

    // Centripetal parameterization: no cusps or overshoot on uneven spacing.
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');

    // Estimate length from control-point chords to size the arc-length cache,
    // then build the cache once via getLength().
    let estimate = 0;
    for (let i = 1; i < points.length; i += 1) estimate += points[i].distanceTo(points[i - 1]);
    curve.arcLengthDivisions = clamp(Math.ceil(estimate / SAMPLE_SPACING), 400, MAX_ARC_DIVISIONS);
    this.arcLength = curve.getLength();

    const expectedLength = options.expectedLength;
    if (expectedLength !== undefined) {
      if (!Number.isFinite(expectedLength) || expectedLength <= 0) {
        throw new RangeError(`TrackCurve expectedLength must be a positive finite number, got ${String(expectedLength)}`);
      }
      const tolerance = options.lengthTolerance ?? DEFAULT_LENGTH_TOLERANCE;
      const drift = Math.abs(this.arcLength - expectedLength) / expectedLength;
      if (drift > tolerance) {
        throw new RangeError(
          `Track length mismatch: curve arc length ${this.arcLength.toFixed(2)} differs from declared length ` +
            `${expectedLength} by ${(drift * 100).toFixed(2)}% (tolerance ${(tolerance * 100).toFixed(1)}%)`,
        );
      }
    }

    const sampleCount = clamp(Math.ceil(this.arcLength / SAMPLE_SPACING), 64, MAX_SAMPLES);
    this.samplePoints = curve.getSpacedPoints(sampleCount); // sampleCount + 1 points
    this.sampleSpacing = this.arcLength / sampleCount;
    this.curve = curve;
  }

  /** Total arc length of the highway in world units. */
  public getCurveLength(): number {
    return this.arcLength;
  }

  /** Remaps arc length `s` (clamped to [0, length]) to curve parameter `u` ∈ [0, 1]. */
  public sToU(s: number): number {
    const sc = clamp(s, 0, this.arcLength);
    return this.arcLength > 1e-9 ? sc / this.arcLength : 0;
  }

  /** Remaps curve parameter `u` (clamped to [0, 1]) to arc length `s`. */
  public uToS(u: number): number {
    const uc = clamp(u, 0, 1);
    return uc * this.arcLength;
  }

  /**
   * Fills `target` with the road frame at arc length `s` (clamped to
   * [0, length]). Pass a reused frame in hot paths; allocating a fresh one
   * each call is supported only for one-off/build-time use.
   */
  public getFrame(s: number, target: TrackFrame = createTrackFrame()): TrackFrame {
    const sc = clamp(s, 0, this.arcLength);
    const inverseLength = this.arcLength > 1e-9 ? 1 / this.arcLength : 0;
    const u = sc * inverseLength;
    const du = Math.min(TANGENT_STEP_S * inverseLength, 0.02);
    const curve = this.curve;

    curve.getPointAt(u, target.position);
    // Central difference for the tangent: two point evaluations, no allocation.
    curve.getPointAt(clamp(u - du, 0, 1), this.tmpA);
    curve.getPointAt(clamp(u + du, 0, 1), this.tmpB);
    target.tangent.subVectors(this.tmpB, this.tmpA);
    if (target.tangent.lengthSq() < 1e-12) target.tangent.set(0, 0, -1);
    else target.tangent.normalize();

    // Right = tangent × world-up: horizontal by construction, so the road
    // surface never rolls. Falls back to the previous right (re-orthogonalized)
    // only if the tangent is ever near-vertical.
    target.right.crossVectors(target.tangent, WORLD_UP);
    if (target.right.lengthSq() < 1e-8) {
      target.right.copy(this.lastRight);
      target.right.addScaledVector(target.tangent, -target.right.dot(target.tangent));
      if (target.right.lengthSq() < 1e-8) target.right.set(1, 0, 0);
    }
    target.right.normalize();
    this.lastRight.copy(target.right);

    // Road-surface up, tilted with the slope: normal = right × tangent.
    target.normal.crossVectors(target.right, target.tangent).normalize();

    // Basis (right, normal, -tangent): a proper right-handed rotation that
    // maps local -Z (forward) onto the tangent.
    this.tmpB.copy(target.tangent).negate();
    this.tmpMatrix.makeBasis(target.right, target.normal, this.tmpB);
    target.quaternion.setFromRotationMatrix(this.tmpMatrix);

    return target;
  }

  /**
   * Frame at `s` with `position` offset laterally by `x` along the road's
   * right axis — the full (s, x) → world transform for any gameplay object.
   */
  public sToWorld(s: number, x: number, target: TrackFrame = createTrackFrame()): TrackFrame {
    this.getFrame(s, target);
    if (x !== 0) target.position.addScaledVector(target.right, x);
    return target;
  }

  /**
   * Projects a world point back to track coordinates by finding the nearest
   * point on a fine arc-spaced polyline of the curve (coarse-to-fine scan,
   * then exact projection onto the adjacent segments).
   */
  public worldToTrack(world: THREE.Vector3, target: TrackProjection = createTrackProjection()): TrackProjection {
    const points = this.samplePoints;
    const lastIndex = points.length - 1;
    const COARSE_STEP = 8;

    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i <= lastIndex; i += COARSE_STEP) {
      const distance = world.distanceToSquared(points[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const low = Math.max(0, bestIndex - COARSE_STEP);
    const high = Math.min(lastIndex, bestIndex + COARSE_STEP);
    for (let i = low; i <= high; i += 1) {
      const distance = world.distanceToSquared(points[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    // Exact projection onto the two polyline segments around the best sample.
    let bestS = bestIndex * this.sampleSpacing;
    let bestSegmentDistance = world.distanceToSquared(points[bestIndex]);
    const segmentFrom = Math.max(0, bestIndex - 1);
    const segmentTo = Math.min(lastIndex - 1, bestIndex);
    for (let j = segmentFrom; j <= segmentTo; j += 1) {
      const p0 = points[j];
      const p1 = points[j + 1];
      this.tmpA.subVectors(p1, p0);
      const lengthSq = this.tmpA.lengthSq();
      if (lengthSq < 1e-12) continue;
      this.tmpB.subVectors(world, p0);
      const t = clamp(this.tmpB.dot(this.tmpA) / lengthSq, 0, 1);
      const distanceSq = this.tmpB.addScaledVector(this.tmpA, -t).lengthSq();
      if (distanceSq < bestSegmentDistance) {
        bestSegmentDistance = distanceSq;
        bestS = (j + t) * this.sampleSpacing;
      }
    }

    target.s = clamp(bestS, 0, this.arcLength);

    // Lateral offset: signed distance along the right axis at the projected s.
    this.getFrame(target.s, this.frameScratch);
    this.tmpA.subVectors(world, this.frameScratch.position);
    target.x = this.tmpA.dot(this.frameScratch.right);

    return target;
  }

  /** Convenience: world point → arc length only. */
  public worldToS(world: THREE.Vector3): number {
    return this.worldToTrack(world, this.projectionScratch).s;
  }
}
