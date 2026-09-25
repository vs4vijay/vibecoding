import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  TrackCurve,
  createTrackFrame,
  type Vec3Tuple,
} from '../src/track/TrackCurve';

/** Inline control points: S-curves with elevation change, gentle radii. */
const WAVE_POINTS: Vec3Tuple[] = [
  [0, 0, 0],
  [0, 0, -150],
  [55, 6, -300],
  [140, 14, -440],
  [55, 20, -580],
  [-60, 8, -700],
  [-140, 2, -850],
  [-60, 10, -1000],
  [40, 18, -1140],
  [0, 12, -1300],
];

function makeCurve(): TrackCurve {
  return new TrackCurve(WAVE_POINTS);
}

describe('TrackCurve', () => {
  it('measures arc length longer than the control-point chord sum', () => {
    const track = makeCurve();
    const chordSum = WAVE_POINTS.slice(1).reduce((sum, [bx, by, bz], i) => {
      const [ax, ay, az] = WAVE_POINTS[i];
      return sum + Math.hypot(bx - ax, by - ay, bz - az);
    }, 0);

    expect(track.getCurveLength()).toBeGreaterThan(0);
    // A spline through the points is at least as long as the polyline chords.
    expect(track.getCurveLength()).toBeGreaterThanOrEqual(chordSum - 1e-6);
  });

  it('remaps s ↔ u consistently', () => {
    const track = makeCurve();
    const length = track.getCurveLength();

    expect(track.uToS(0)).toBe(0);
    expect(track.uToS(1)).toBeCloseTo(length, 6);
    expect(track.sToU(length)).toBeCloseTo(1, 9);
    expect(track.sToU(track.uToS(0.37))).toBeCloseTo(0.37, 9);
    // Out-of-range inputs clamp.
    expect(track.sToU(-5)).toBe(0);
    expect(track.uToS(2)).toBe(length);
  });

  it('round-trips s → world → s with x preserved (on-center)', () => {
    const track = makeCurve();
    const length = track.getCurveLength();
    const frame = createTrackFrame();
    const samples = 200;

    for (let i = 0; i <= samples; i += 1) {
      const s = (length * i) / samples;
      track.sToWorld(s, 0, frame);

      const roundTrip = track.worldToTrack(frame.position);
      expect(roundTrip.s).toBeCloseTo(s, 2); // within 0.02 s
      expect(roundTrip.x).toBeCloseTo(0, 3);
    }
  });

  it('round-trips s → world → s with lateral offset preserved', () => {
    const track = makeCurve();
    const length = track.getCurveLength();
    const frame = createTrackFrame();
    const samples = 100;
    const lateralOffsets = [-5, -2.5, 2.5, 5];

    for (const x of lateralOffsets) {
      for (let i = 0; i <= samples; i += 1) {
        const s = (length * i) / samples;
        track.sToWorld(s, x, frame);

        const roundTrip = track.worldToTrack(frame.position);
        // s drift is inherent to projecting an off-center point onto a curved
        // center line (≈ x²/2R near the inside of bends); tolerance accounts
        // for it at |x| = 5 on these radii.
        expect(Math.abs(roundTrip.s - s)).toBeLessThan(0.6);
        expect(Math.abs(roundTrip.x - x)).toBeLessThan(0.05);
      }
    }
  });

  it('produces a stable, orthonormal frame with a horizontal right axis', () => {
    const track = makeCurve();
    const length = track.getCurveLength();
    const frame = createTrackFrame();

    for (let i = 0; i <= 60; i += 1) {
      track.getFrame((length * i) / 60, frame);

      // right = tangent × world-up ⇒ exactly horizontal, even with slope.
      expect(frame.right.y).toBeCloseTo(0, 9);

      // Orthonormal basis.
      expect(frame.tangent.lengthSq()).toBeCloseTo(1, 6);
      expect(frame.right.lengthSq()).toBeCloseTo(1, 6);
      expect(frame.normal.lengthSq()).toBeCloseTo(1, 6);
      expect(frame.tangent.dot(frame.right)).toBeCloseTo(0, 9);
      expect(frame.tangent.dot(frame.normal)).toBeCloseTo(0, 6);
      expect(frame.right.dot(frame.normal)).toBeCloseTo(0, 9);

      // The quaternion's local -Z lands on the tangent (Three.js forward).
      const quatForward = new THREE.Vector3(0, 0, -1).applyQuaternion(frame.quaternion);
      expect(quatForward.dot(frame.tangent)).toBeCloseTo(1, 6);
    }
  });

  it('clamps out-of-range s to the track ends', () => {
    const track = makeCurve();
    const length = track.getCurveLength();
    const frame = createTrackFrame();

    track.getFrame(-10, frame);
    const atStart = frame.position.clone();
    track.getFrame(0, frame);
    expect(frame.position.distanceTo(atStart)).toBeCloseTo(0, 6);

    track.getFrame(length + 25, frame);
    const atEnd = frame.position.clone();
    track.getFrame(length, frame);
    expect(frame.position.distanceTo(atEnd)).toBeCloseTo(0, 6);
  });

  it('throws when constructed with fewer than two control points', () => {
    expect(() => new TrackCurve([[0, 0, 0]])).toThrow(RangeError);
    expect(() => new TrackCurve([] as unknown as Vec3Tuple[])).toThrow(RangeError);
  });

  it('throws on non-finite control point components', () => {
    expect(() =>
      new TrackCurve([
        [0, 0, 0],
        [Number.NaN, 0, -100],
      ]),
    ).toThrow(RangeError);
    expect(() =>
      new TrackCurve([
        [0, 0, 0],
        [10, 0],
      ] as unknown as Vec3Tuple[]),
    ).toThrow(RangeError);
  });

  it('throws when the built curve disagrees with the declared level length', () => {
    const track = makeCurve();
    const realLength = track.getCurveLength();
    expect(() => new TrackCurve(WAVE_POINTS, { expectedLength: realLength * 1.2 })).toThrow(/length mismatch/);
    // Within tolerance it passes.
    expect(() => new TrackCurve(WAVE_POINTS, { expectedLength: realLength * 1.01 })).not.toThrow();
  });
});
