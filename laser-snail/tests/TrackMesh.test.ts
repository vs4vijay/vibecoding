import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { TrackCurve } from '../src/track/TrackCurve';
import { createTrackMesh } from '../src/track/TrackMesh';
import type { GapSpan } from '../src/track/TrackGaps';
import type { Vec3Tuple } from '../src/track/TrackCurve';

const CONTROL_POINTS: Vec3Tuple[] = [
  [0, 0, 0],
  [0, 0, -200],
  [60, 8, -400],
  [0, 14, -600],
  [-60, 4, -800],
];

describe('TrackMesh', () => {
  it('builds one independently visible segment per ~segmentLength of track', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const length = track.getCurveLength();
    const mesh = createTrackMesh(track, { segmentLength: 40, withFinishGate: false });

    const expectedCount = Math.ceil(length / 40);
    expect(mesh.segmentCount).toBe(expectedCount);
    expect(mesh.segments).toHaveLength(expectedCount);

    // Segments tile [0, length] with no gaps or overlaps.
    expect(mesh.segments[0].sStart).toBe(0);
    expect(mesh.segments.at(-1)?.sEnd).toBeCloseTo(length, 6);
    for (let i = 1; i < mesh.segments.length; i += 1) {
      expect(mesh.segments[i].sStart).toBeCloseTo(mesh.segments[i - 1].sEnd, 6);
    }

    // Every segment mesh exists in the scene graph, named and addressable.
    const roadMeshes = mesh.group.children.filter((child) => child.name.startsWith('track-segment-'));
    expect(roadMeshes).toHaveLength(expectedCount);
  });

  it('can hide and show individual segments (Phase 4 gap punching)', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const mesh = createTrackMesh(track, { segmentLength: 40, withFinishGate: false });

    expect(mesh.group.children.every((child) => child.visible)).toBe(true);

    mesh.setSegmentVisible(0, false);
    expect(mesh.segments[0].setVisible).toBeDefined();
    const first = mesh.group.children.find((child) => child.name === 'track-segment-0');
    expect(first?.visible).toBe(false);

    mesh.setSegmentVisible(0, true);
    expect(first?.visible).toBe(true);
  });

  it('throws for an out-of-range segment index', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const mesh = createTrackMesh(track, { withFinishGate: false });
    expect(() => mesh.setSegmentVisible(mesh.segmentCount, true)).toThrow(RangeError);
    expect(() => mesh.setSegmentVisible(-1, true)).toThrow(RangeError);
  });
});

describe('TrackMesh gap punching (Phase 4)', () => {
  /** Straight track along −z, where world z = −s exactly. */
  const STRAIGHT: Vec3Tuple[] = [
    [0, 0, 0],
    [0, 0, -400],
  ];

  /**
   * Collects the world z of every road-surface vertex of a segment's
   * sub-meshes. On the straight flat test track y = 0 marks road verts (rail
   * bottoms share those exact positions; raised rail tops and lifted dashes
   * are filtered out), and z = −s.
   */
  function segmentRoadZ(mesh: ReturnType<typeof createTrackMesh>, index: number): number[] {
    const node = mesh.group.children.find((child) => child.name === `track-segment-${index}`)!;
    const zValues: number[] = [];
    node.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const position = object.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 1) {
          if (Math.abs(position.getY(i)) < 1e-6) zValues.push(position.getZ(i));
        }
      }
    });
    return zValues;
  }

  it('punches exact holes: no road geometry inside the gap span, road on both lips', () => {
    const track = new TrackCurve(STRAIGHT);
    const gap: GapSpan = { sStart: 100, sEnd: 140, jumpPod: true };
    const mesh = createTrackMesh(track, { segmentLength: 40, withFinishGate: false, gaps: [gap] });

    // Segment 2 spans [80, 120] — half road, half hole. Segment 3 spans
    // [120, 160] — half hole, half road. Both become sub-mesh groups.
    for (const index of [2, 3]) {
      const zValues = segmentRoadZ(mesh, index);
      expect(zValues.length).toBeGreaterThan(0);
      // s = −z: road verts must avoid the open interior (100, 140).
      for (const z of zValues) {
        const s = -z;
        if (s > 100.01 && s < 139.99) {
          throw new Error(`road vertex found inside the gap at s=${s}`);
        }
      }
    }

    // Lips survive: geometry right at both edges of the hole.
    const lower = segmentRoadZ(mesh, 2);
    expect(lower.some((z) => Math.abs(-z - 100) < 0.01)).toBe(true);
    const upper = segmentRoadZ(mesh, 3);
    expect(upper.some((z) => Math.abs(-z - 140) < 0.01)).toBe(true);
  });

  it('keeps segments addressable and tiles intact around the holes', () => {
    const track = new TrackCurve(STRAIGHT);
    const mesh = createTrackMesh(track, {
      segmentLength: 40,
      withFinishGate: false,
      gaps: [{ sStart: 100, sEnd: 140, jumpPod: true }],
    });

    expect(mesh.segmentCount).toBe(Math.ceil(track.getCurveLength() / 40));
    expect(mesh.segments[0].sStart).toBe(0);
    expect(mesh.segments.at(-1)?.sEnd).toBeCloseTo(track.getCurveLength(), 6);

    // Ungapped segments stay plain single meshes; gapped ones are groups.
    const plain = mesh.group.children.find((child) => child.name === 'track-segment-0')!;
    expect(plain instanceof THREE.Mesh).toBe(true);
    const gapped = mesh.group.children.find((child) => child.name === 'track-segment-2')!;
    expect(gapped instanceof THREE.Group).toBe(true);

    // Visibility still toggles the whole segment object.
    mesh.setSegmentVisible(2, false);
    expect(gapped.visible).toBe(false);
    mesh.setSegmentVisible(2, true);
    expect(gapped.visible).toBe(true);
  });

  it('dresses each gap with lip strips and a chasm shaft beneath the road', () => {
    const track = new TrackCurve(STRAIGHT);
    const mesh = createTrackMesh(track, {
      segmentLength: 40,
      withFinishGate: false,
      gaps: [{ sStart: 100, sEnd: 140, jumpPod: true }],
    });

    const strips = mesh.group.children.filter((child) => child.name === 'gap-lip-strip');
    expect(strips).toHaveLength(2); // one per lip
    const chasms = mesh.group.children.filter((child) => child.name === 'gap-chasm');
    expect(chasms).toHaveLength(1);
    const walls = chasms[0].children.find((child) => child.name === 'gap-chasm-walls')!;
    // The shaft sinks well below the road surface.
    expect(walls.position.y).toBeLessThan(-10);
  });
});
