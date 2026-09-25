import * as THREE from 'three';

import { ACCENTS, NON_ACCENT_COLORS } from '../render/tuning';
import { createTrackFrame, type TrackCurve, type TrackFrame } from './TrackCurve';
import type { GapSpan } from './TrackGaps';

/**
 * Ribbon road swept along the track curve: a dark road surface, overdriven
 * emissive cyan edge rails (picked up by bloom), a dashed center line for
 * speed readability, and a finish banner/gate at `s = length`.
 *
 * The road is built as **independently addressable segments** (default ~40 s
 * of track each): every segment is one self-contained object with its own
 * visibility flag, and adjacent segments share the exact frame at the
 * boundary `s`, so they always join seamlessly.
 *
 * Phase 4 gaps: the `gaps` option carries plain s-ranges (from `TrackGaps`)
 * that are punched *exactly* into the affected segments — each gapped segment
 * becomes a group of sub-meshes for the surviving road on either side of the
 * hole, plus magenta warning strips on the lips and a dark chasm shaft with a
 * deep hazard glow underneath, so the drop reads well ahead at speed.
 */

export interface TrackMeshOptions {
  /** Half width of the road in world units. Defaults to 7 (14-wide road). */
  halfWidth?: number;
  /** Arc-length span of one separately addressable segment. Defaults to 40. */
  segmentLength?: number;
  /** Arc-length spacing between cross-section slices inside a segment. Defaults to 4. */
  sliceSpacing?: number;
  /** Rail height above the road surface. Defaults to 0.45. */
  railHeight?: number;
  /** Whether to build the finish banner/gate at `s = length`. Defaults to true. */
  withFinishGate?: boolean;
  /** Open-air s-ranges to punch out of the ribbon (TrackGaps.spans). */
  gaps?: readonly GapSpan[];
}

/** One independently visible stretch of road between `sStart` and `sEnd`. */
export interface TrackSegment {
  readonly index: number;
  readonly sStart: number;
  readonly sEnd: number;
  setVisible(visible: boolean): void;
}

export interface TrackMesh {
  /** Root group containing all segments and the finish gate; add to the scene. */
  readonly group: THREE.Group;
  readonly halfWidth: number;
  readonly segmentLength: number;
  readonly segmentCount: number;
  readonly segments: readonly TrackSegment[];
  /** Visibility shorthand for Phase 4 gap punching. */
  setSegmentVisible(index: number, visible: boolean): void;
}

// -- Visual constants: neon cyan on dark indigo, matching the art spec. -----
// Values come from the shared render-tuning envelope (src/render/tuning.ts);
// sRGB-sourced tuples declare their color space so the Color ends up exactly
// as the hex literals it replaces.
const ROAD_COLOR = new THREE.Color().setRGB(...NON_ACCENT_COLORS.road, THREE.SRGBColorSpace);
const ROAD_EMISSIVE = new THREE.Color().setRGB(...NON_ACCENT_COLORS.roadEmissive, THREE.SRGBColorSpace);
/** Overdriven (>1 channels) cyan so the rails feed the bloom pass hard. */
const RAIL_GLOW = new THREE.Color(...ACCENTS.rail.color);
const DASH_GLOW = new THREE.Color(...ACCENTS.dash.color);
const DASH_PERIOD_S = 8; // dash pattern phase-locks to absolute s, not segments
const DASH_LENGTH_S = 4.5;
const DASH_HALF_WIDTH = 0.09;
const DASH_LIFT = 0.03; // above the road surface to avoid z-fighting
const GATE_POST_HEIGHT = 7.5;
const GATE_BANNER_HEIGHT = 2.6;

// -- Gap dressing: warning strips on the lips + the chasm shaft. -------------
const CHASM_DEPTH = 26;
const CHASM_WALL_COLOR = new THREE.Color().setRGB(...NON_ACCENT_COLORS.chasmWall, THREE.SRGBColorSpace);
/** Deep, dim hazard glow at the shaft floor — "drop" reads against the neon road. */
const CHASM_GLOW = new THREE.Color(...ACCENTS.chasmGlow.color);
/** Magenta lip strips — the hazard color language marks every cliff edge. */
const LIP_STRIP_COLOR = new THREE.Color(...ACCENTS.lipStrip.color);
const LIP_STRIP_HALF_LENGTH = 0.45;
const LIP_STRIP_LIFT = 0.06;

/** Builds a flat-on-the-road plane geometry (local X across, local Z along s). */
function createRoadPlane(width: number, length: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2); // plane XY → XZ, normal +Y
  return geometry;
}

/**
 * Builds the complete road for `track`. All geometry is generated once at
 * load time; nothing allocates per frame afterwards.
 */
export function createTrackMesh(track: TrackCurve, options: TrackMeshOptions = {}): TrackMesh {
  const halfWidth = options.halfWidth ?? 7;
  const segmentLength = options.segmentLength ?? 40;
  const sliceSpacing = options.sliceSpacing ?? 4;
  const railHeight = options.railHeight ?? 0.45;
  const withFinishGate = options.withFinishGate ?? true;

  if (!(halfWidth > 0) || !(segmentLength > 0) || !(sliceSpacing > 0) || !(railHeight > 0)) {
    throw new RangeError('TrackMesh options halfWidth, segmentLength, sliceSpacing and railHeight must be positive');
  }

  const length = track.getCurveLength();
  const group = new THREE.Group();
  group.name = 'track';

  // Shared materials: one instance across every segment keeps state changes cheap.
  const materials = [
    new THREE.MeshStandardMaterial({
      color: ROAD_COLOR,
      emissive: ROAD_EMISSIVE,
      roughness: 0.88,
      metalness: 0.1,
    }),
    new THREE.MeshBasicMaterial({ color: RAIL_GLOW, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: DASH_GLOW, side: THREE.DoubleSide }),
  ] as const;

  const segmentCount = Math.max(1, Math.ceil(length / segmentLength));
  const frame = createTrackFrame(); // reused across every slice during the build
  const segments: TrackSegment[] = [];

  // Per-build gap dressing resources: created fresh so level teardown can
  // dispose them with the rest of the track geometry.
  const lipGeometry = createRoadPlane(halfWidth * 2, LIP_STRIP_HALF_LENGTH * 2);
  const lipMaterial = new THREE.MeshBasicMaterial({ color: LIP_STRIP_COLOR, side: THREE.DoubleSide });
  const chasmWallMaterial = new THREE.MeshStandardMaterial({
    color: CHASM_WALL_COLOR,
    emissive: CHASM_WALL_COLOR,
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide, // seen from inside the shaft
  });
  const chasmGlowMaterial = new THREE.MeshBasicMaterial({ color: CHASM_GLOW, side: THREE.DoubleSide });

  const gaps = options.gaps ?? [];

  for (let index = 0; index < segmentCount; index += 1) {
    const sStart = index * segmentLength;
    const sEnd = Math.min(length, sStart + segmentLength);
    const pieces = survivingRoadSpans(sStart, sEnd, gaps);

    if (pieces.length === 1 && pieces[0].from === sStart && pieces[0].to === sEnd) {
      // Ungapped fast path: one mesh, exactly as before gaps existed.
      const mesh = buildSegmentMesh(track, frame, sStart, sEnd, {
        halfWidth,
        sliceSpacing,
        railHeight,
        materials,
        index,
      });
      group.add(mesh);
      segments.push({
        index,
        sStart,
        sEnd,
        setVisible(visible: boolean): void {
          mesh.visible = visible;
        },
      });
      continue;
    }

    // Gapped segment: a group of sub-meshes for the surviving road, so the
    // hole is punched exactly at the authored span edges.
    const pieceGroup = new THREE.Group();
    pieceGroup.name = `track-segment-${index}`;
    for (const piece of pieces) {
      pieceGroup.add(
        buildSegmentMesh(track, frame, piece.from, piece.to, {
          halfWidth,
          sliceSpacing,
          railHeight,
          materials,
          index,
        }),
      );
    }
    group.add(pieceGroup);
    segments.push({
      index,
      sStart,
      sEnd,
      setVisible(visible: boolean): void {
        pieceGroup.visible = visible;
      },
    });
  }

  // Chasm shafts + lip warning strips under every open-air span.
  for (const gap of gaps) {
    group.add(buildChasm(track, frame, gap, halfWidth, chasmWallMaterial, chasmGlowMaterial));
    for (const lipS of gapLipPositions(gap, length)) {
      group.add(buildLipStrip(track, frame, lipS, lipGeometry, lipMaterial));
    }
  }

  if (withFinishGate) {
    group.add(buildFinishGate(track, halfWidth, createFinishBannerTexture()));
  }

  return {
    group,
    halfWidth,
    segmentLength,
    segmentCount,
    segments,
    setSegmentVisible(index: number, visible: boolean): void {
      const segment = segments[index];
      if (!segment) throw new RangeError(`TrackMesh segment ${index} does not exist (0..${segmentCount - 1})`);
      segment.setVisible(visible);
    },
  };
}

interface SegmentBuildOptions {
  halfWidth: number;
  sliceSpacing: number;
  railHeight: number;
  materials: readonly [THREE.Material, THREE.Material, THREE.Material]; // road, rail, dash
  index: number;
}

/** One surviving stretch of road inside a segment: `s ∈ [from, to]`. */
interface RoadPiece {
  from: number;
  to: number;
}

/**
 * Complement of the gap spans inside `[sStart, sEnd]` — the road that
 * survives the punching. Assumes (TrackGaps guarantees) spans are sorted and
 * non-overlapping.
 */
function survivingRoadSpans(sStart: number, sEnd: number, gaps: readonly GapSpan[]): RoadPiece[] {
  const pieces: RoadPiece[] = [];
  let cursor = sStart;
  for (const gap of gaps) {
    if (gap.sEnd <= cursor) continue; // entirely before this segment's road
    if (gap.sStart >= sEnd) break; // sorted: nothing further can overlap
    const holeStart = Math.max(cursor, gap.sStart);
    if (holeStart > cursor) pieces.push({ from: cursor, to: Math.min(holeStart, sEnd) });
    cursor = Math.max(cursor, gap.sEnd);
    if (cursor >= sEnd) break;
  }
  if (cursor < sEnd) pieces.push({ from: cursor, to: sEnd });
  return pieces;
}

/** Lip strip positions: just outside each edge of the hole, on surviving road. */
function gapLipPositions(gap: GapSpan, length: number): number[] {
  const positions: number[] = [];
  if (gap.sStart - LIP_STRIP_HALF_LENGTH > 0) positions.push(gap.sStart - LIP_STRIP_HALF_LENGTH);
  if (gap.sEnd + LIP_STRIP_HALF_LENGTH < length) positions.push(gap.sEnd + LIP_STRIP_HALF_LENGTH);
  return positions;
}

/** A glowing magenta strip laid across the road on a gap lip. */
function buildLipStrip(
  track: TrackCurve,
  frame: TrackFrame,
  s: number,
  geometry: THREE.PlaneGeometry,
  material: THREE.Material,
): THREE.Mesh {
  track.getFrame(s, frame);
  const strip = new THREE.Mesh(geometry, material);
  strip.name = 'gap-lip-strip';
  strip.position.copy(frame.position).addScaledVector(frame.normal, LIP_STRIP_LIFT);
  strip.quaternion.copy(frame.quaternion);
  return strip;
}

/**
 * The chasm under one gap: a dark open shaft (BackSide box interior) sunk
 * below the road, with a dim hazard glow on its floor so the depth reads at
 * speed. Aligned to the road frame at the gap's midpoint.
 */
function buildChasm(
  track: TrackCurve,
  frame: TrackFrame,
  gap: GapSpan,
  halfWidth: number,
  wallMaterial: THREE.Material,
  glowMaterial: THREE.Material,
): THREE.Group {
  track.getFrame((gap.sStart + gap.sEnd) / 2, frame);

  const shaft = new THREE.Group();
  shaft.name = 'gap-chasm';
  const span = Math.max(gap.sEnd - gap.sStart, 1);
  const width = halfWidth * 2 + 4;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, CHASM_DEPTH, span + 2), wallMaterial);
  walls.name = 'gap-chasm-walls';
  walls.position.copy(frame.position).addScaledVector(frame.normal, -CHASM_DEPTH / 2 - 0.35);
  walls.quaternion.copy(frame.quaternion);

  const glow = new THREE.Mesh(createRoadPlane(width, span), glowMaterial);
  glow.name = 'gap-chasm-glow';
  glow.position.copy(frame.position).addScaledVector(frame.normal, -CHASM_DEPTH + 0.4);
  glow.quaternion.copy(frame.quaternion);

  shaft.add(walls, glow);
  return shaft;
}

/**
 * Builds one segment as a single Mesh whose geometry carries three material
 * groups (0 = road surface, 1 = edge rails, 2 = center dashes).
 */
function buildSegmentMesh(
  track: TrackCurve,
  frame: TrackFrame,
  sStart: number,
  sEnd: number,
  options: SegmentBuildOptions,
): THREE.Mesh {
  const { halfWidth, sliceSpacing, railHeight, materials, index } = options;
  const span = Math.max(sEnd - sStart, 1e-4);
  const sliceCount = Math.max(2, Math.ceil(span / sliceSpacing) + 1);

  const positions: number[] = [];
  const normals: number[] = [];
  const roadIndices: number[] = [];
  const railIndices: number[] = [];
  const dashIndices: number[] = [];

  const edgeLeft = new THREE.Vector3();
  const edgeRight = new THREE.Vector3();
  const cornerA = new THREE.Vector3();
  const cornerB = new THREE.Vector3();

  const pushVertex = (position: THREE.Vector3, normal: THREE.Vector3): void => {
    positions.push(position.x, position.y, position.z);
    normals.push(normal.x, normal.y, normal.z);
  };

  // -- Slice vertices. Layout: road [0, 2n), rails [2n, 6n). ----------------
  for (let i = 0; i < sliceCount; i += 1) {
    const s = sStart + (span * i) / (sliceCount - 1);
    track.getFrame(s, frame);

    edgeLeft.copy(frame.position).addScaledVector(frame.right, -halfWidth);
    edgeRight.copy(frame.position).addScaledVector(frame.right, halfWidth);

    // Road surface: 2 verts (left, right edge).
    pushVertex(edgeLeft, frame.normal);
    pushVertex(edgeRight, frame.normal);

    // Rails: 4 verts (left bottom/top, right bottom/top), extruded along the
    // road normal so they pitch with the road.
    cornerA.copy(edgeLeft).addScaledVector(frame.normal, railHeight);
    cornerB.copy(edgeRight).addScaledVector(frame.normal, railHeight);
    pushVertex(edgeLeft, frame.normal);
    pushVertex(cornerA, frame.normal);
    pushVertex(edgeRight, frame.normal);
    pushVertex(cornerB, frame.normal);
  }

  // -- Indices. ---------------------------------------------------------------
  for (let i = 0; i < sliceCount - 1; i += 1) {
    const roadA = i * 2; // left edge, this slice
    const roadB = roadA + 1; // right edge, this slice
    const roadC = roadA + 2; // left edge, next slice
    const roadD = roadA + 3; // right edge, next slice
    // Winding CCW seen from the road-normal side (up on flat ground).
    roadIndices.push(roadA, roadB, roadC, roadB, roadD, roadC);

    const railBase = 2 * sliceCount;
    const lbA = railBase + i * 4; // left bottom, this slice
    const ltA = lbA + 1;
    const rbA = lbA + 2;
    const rtA = lbA + 3;
    const lbB = lbA + 4;
    const ltB = lbA + 5;
    const rbB = lbA + 6;
    const rtB = lbA + 7;
    // DoubleSide material: winding just needs to be consistent, not facing.
    railIndices.push(lbA, lbB, ltA, lbB, ltB, ltA, rbA, rbB, rtA, rbB, rtB, rtA);

    // Center dash across this slice interval, phase-locked to absolute s.
    const sA = sStart + (span * i) / (sliceCount - 1);
    const sB = sStart + (span * (i + 1)) / (sliceCount - 1);
    if ((sA + sB) * 0.5 % DASH_PERIOD_S < DASH_LENGTH_S) {
      const dashBase = positions.length / 3;
      for (const sEdge of [sA, sB]) {
        track.getFrame(sEdge, frame);
        cornerA.copy(frame.position).addScaledVector(frame.normal, DASH_LIFT);
        cornerB.copy(cornerA).addScaledVector(frame.right, DASH_HALF_WIDTH);
        cornerA.addScaledVector(frame.right, -DASH_HALF_WIDTH);
        pushVertex(cornerA, frame.normal); // left corner
        pushVertex(cornerB, frame.normal); // right corner
      }
      dashIndices.push(dashBase, dashBase + 1, dashBase + 2, dashBase + 1, dashBase + 3, dashBase + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  const roadIndexCount = roadIndices.length;
  geometry.setIndex([...roadIndices, ...railIndices, ...dashIndices]);
  // Material groups into the shared index buffer: road, rails, dashes.
  geometry.addGroup(0, roadIndexCount, 0);
  geometry.addGroup(roadIndexCount, railIndices.length, 1);
  geometry.addGroup(roadIndexCount + railIndices.length, dashIndices.length, 2);

  const mesh = new THREE.Mesh(geometry, materials as unknown as THREE.Material[]);
  mesh.name = `track-segment-${index}`;
  return mesh;
}

/**
 * Finish banner/gate at `s = length`: two posts on the road edges, a crossbar,
 * and a canvas-textured "FINISH" banner facing the approaching player.
 */
function buildFinishGate(track: TrackCurve, halfWidth: number, bannerTexture: THREE.CanvasTexture): THREE.Group {
  const gate = new THREE.Group();
  gate.name = 'finish-gate';

  const frame = track.getFrame(track.getCurveLength(), createTrackFrame());

  const postGeometry = new THREE.BoxGeometry(0.6, GATE_POST_HEIGHT, 0.6);
  const frameGeometry = new THREE.BoxGeometry(2 * halfWidth + 1.4, 0.55, 0.6);
  const structureMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...NON_ACCENT_COLORS.gateFrame, THREE.SRGBColorSpace),
    emissive: 0x101a44, // not in the tuning envelope — stays local
    roughness: 0.5,
    metalness: 0.4,
  });

  for (const side of [-1, 1] as const) {
    const post = new THREE.Mesh(postGeometry, structureMaterial);
    post.name = `finish-post-${side < 0 ? 'left' : 'right'}`;
    post.position.copy(frame.position).addScaledVector(frame.right, side * (halfWidth + 0.7));
    post.position.addScaledVector(frame.normal, GATE_POST_HEIGHT / 2);
    post.quaternion.copy(frame.quaternion);
    gate.add(post);
  }

  const crossbar = new THREE.Mesh(frameGeometry, structureMaterial);
  crossbar.name = 'finish-crossbar';
  crossbar.position.copy(frame.position).addScaledVector(frame.normal, GATE_POST_HEIGHT - 0.2);
  crossbar.quaternion.copy(frame.quaternion);
  gate.add(crossbar);

  const bannerMaterial = new THREE.MeshBasicMaterial({ map: bannerTexture, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * halfWidth, GATE_BANNER_HEIGHT), bannerMaterial);
  banner.name = 'finish-banner';
  // The frame quaternion maps local +Z onto -tangent, i.e. toward the
  // approaching player — exactly where the plane's front face should point.
  banner.position.copy(frame.position).addScaledVector(frame.normal, GATE_POST_HEIGHT - 0.5 - GATE_BANNER_HEIGHT / 2);
  banner.quaternion.copy(frame.quaternion);
  gate.add(banner);

  return gate;
}

/** Draws the "FINISH" banner (checker border + glowing text) onto a canvas. */
function createFinishBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for the finish banner texture');

  // Checker border, two rows of 32 px cells.
  const cell = 32;
  for (let row = 0; row < canvas.height / cell; row += 1) {
    for (let col = 0; col < canvas.width / cell; col += 1) {
      const isLight = (row + col) % 2 === 0;
      ctx.fillStyle = isLight ? '#dfeaff' : '#0b1026';
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }

  // Dark backing panel so the text pops against the checker.
  ctx.fillStyle = 'rgba(6, 10, 30, 0.88)';
  ctx.fillRect(72, 16, canvas.width - 144, canvas.height - 32);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px system-ui, "Segoe UI", sans-serif';
  ctx.shadowColor = '#3ff2ff';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#7df8ff';
  ctx.fillText('FINISH', canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
