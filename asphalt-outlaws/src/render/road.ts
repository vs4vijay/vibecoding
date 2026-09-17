import type { RaceState, Segment } from "../sim/types";
import { SIM } from "../config";
import { computeCamDepth, findSegment, projectPoint } from "../sim/track";
import { clamp, lerp, wrap } from "../core/math";
import { renderSky } from "./sky";
import { drawSceneryItem } from "./scenery";

// OWNER: Agent A. Contract per .plan.md §5. Do not change signatures.

export interface CameraView {
  width: number;
  height: number;
  camDepth: number;
  camX: number;
  camY: number;
  camZ: number;
  /** Segment index under the camera. */
  baseSegment: number;
  /** World-space Y under the player (used for horizon placement / bounce). */
  playerY: number;
}

// Frame scratch so projectForSprite can tell whether segment projections are
// fresh from this frame's renderWorld pass (scalars only, no allocation).
let freshCamX = NaN;
let freshCamY = NaN;
let freshCamZ = NaN;
let freshCamDepth = NaN;
let freshW = 0;
let freshH = 0;
let drawnMax = 0; // segments projected this frame, offset from base

/** Derive the camera for the current race state and viewport size. */
export function updateCamera(
  state: RaceState,
  width: number,
  height: number,
): CameraView {
  const camDepth = computeCamDepth(SIM.fov);
  const player = state.player;
  const playerSeg = findSegment(state.track, player.z);
  const pct = wrap(player.z, SIM.segmentLength) / SIM.segmentLength;
  const playerY = lerp(
    playerSeg.p1.world.y,
    playerSeg.p2.world.y,
    pct,
  );
  // Pull the camera back so the bike sits low on screen; clamp at the track
  // start (point-to-point: nothing to wrap around to).
  const camZ = Math.max(0, player.z - SIM.cameraHeight * camDepth);
  const base = findSegment(state.track, camZ);
  return {
    width,
    height,
    camDepth,
    camX: player.x * SIM.roadWidth,
    camY: playerY + SIM.cameraHeight,
    camZ,
    baseSegment: base.index,
    playerY,
  };
}

/** Exponential fog factor: 1 at the camera, fading with squared distance. */
export function fogStep(n: number, drawDistance: number, density: number): number {
  const d = n / drawDistance;
  return Math.exp(-d * d * density);
}

/**
 * Draw everything behind the sprites: sky + parallax backdrop, then road
 * segments from the base segment forward over SIM.drawDistance (grass,
 * rumble, lanes, fog toward the palette haze), then roadside scenery far to
 * near. Never mutates race state (segment camera/screen/clip fields are the
 * per-frame render caches the types are designed for).
 */
export function renderWorld(
  g: CanvasRenderingContext2D,
  state: RaceState,
  cam: CameraView,
): void {
  renderSky(g, state, cam);
  const segs = state.track.segments;
  const n = segs.length;
  if (n === 0) return;
  const baseIdx = clamp(cam.baseSegment, 0, n - 1);
  const base = segs[baseIdx];
  if (!base) return;
  const width = cam.width;
  const height = cam.height;
  const pal = state.cfg.level.palette;

  // Pass 1: project the draw range, tracking the hill-occlusion clip line.
  // Point-to-point: stop at the track end, no wrap. The accumulated curve
  // offset x bends the road; dx accumulates per-segment curve.
  const basePct = wrap(cam.camZ, SIM.segmentLength) / SIM.segmentLength;
  let x = 0;
  let dx = -(base.curve * basePct);
  let maxy = height;
  let count = 0;
  while (count < SIM.drawDistance) {
    const seg = segs[baseIdx + count];
    if (!seg) break;
    projectPoint(seg.p1, cam.camX - x, cam.camY, cam.camZ, cam.camDepth, width, height, SIM.roadWidth);
    x += dx;
    dx += seg.curve;
    projectPoint(seg.p2, cam.camX - x, cam.camY, cam.camZ, cam.camDepth, width, height, SIM.roadWidth);
    seg.clip = maxy;
    if (
      seg.p1.world.z - cam.camZ > cam.camDepth &&
      seg.p2.screen.y < maxy &&
      seg.p2.screen.y < seg.p1.screen.y
    ) {
      maxy = seg.p2.screen.y;
    }
    count++;
  }
  drawnMax = count;
  freshCamX = cam.camX;
  freshCamY = cam.camY;
  freshCamZ = cam.camZ;
  freshCamDepth = cam.camDepth;
  freshW = width;
  freshH = height;

  // Pass 2: near-to-far strips, fog blended toward the palette haze (alpha
  // compositing haze over a strip == blending every strip color toward it).
  const fogDensity = 3 * state.cfg.level.fog;
  const finishIdx = state.track.finishIndex;
  for (let i = 0; i < drawnMax; i++) {
    const seg = segs[baseIdx + i];
    if (!seg) break;
    if (seg.p1.world.z - cam.camZ <= cam.camDepth) continue; // behind the camera plane
    if (seg.p2.screen.y >= seg.clip) continue; // hidden behind a crest
    if (seg.p2.screen.y >= seg.p1.screen.y) continue; // back face
    drawSegmentStrip(g, width, seg);
    if (seg.index === finishIdx) drawCheckerBand(g, seg);
    const fog = fogStep(i, SIM.drawDistance, fogDensity);
    if (fog < 0.98) {
      g.globalAlpha = 1 - fog;
      g.fillStyle = pal.haze;
      g.fillRect(0, seg.p2.screen.y, width, seg.p1.screen.y - seg.p2.screen.y);
      g.globalAlpha = 1;
    }
  }

  // Scenery far to near so close props overlap distant ones. Items on crest-
  // culled segments still draw (their tops peek over the hill); bases below
  // the clip line are skipped.
  for (let i = drawnMax - 1; i >= 0; i--) {
    const seg = segs[baseIdx + i];
    if (!seg) continue;
    if (seg.p1.world.z - cam.camZ <= cam.camDepth) continue;
    if (seg.p2.screen.y >= seg.p1.screen.y) continue;
    if (seg.p1.screen.y > seg.clip + 1) continue;
    const items = state.track.scenery.get(seg.index);
    if (!items || items.length === 0) continue;
    const p1 = seg.p1.screen;
    if (p1.w < 1) continue;
    const fog = clamp(fogStep(i, SIM.drawDistance, fogDensity) * 1.6, 0, 1);
    if (fog < 0.05) continue;
    g.globalAlpha = fog;
    for (const item of items) {
      drawSceneryItem(
        g,
        item.kind,
        p1.x + item.offset * p1.w,
        p1.y,
        p1.w * 0.2 * item.scale,
        pal,
        item.flip,
      );
    }
    g.globalAlpha = 1;
  }
}

/**
 * Project a sprite anchor sitting on the road at track position `z` and
 * lateral offset `offsetX` (road-half-width fractions) to screen space.
 * Returns null when behind the camera or beyond the draw distance.
 * `scale` is relative: multiply a sprite's base pixel size by it.
 */
export function projectForSprite(
  state: RaceState,
  cam: CameraView,
  z: number,
  offsetX: number,
): { x: number; y: number; scale: number } | null {
  const segs = state.track.segments;
  if (segs.length === 0) return null;
  const seg = findSegment(state.track, z);
  const rel = seg.index - cam.baseSegment;
  if (rel < 0 || rel >= SIM.drawDistance) return null;
  if (z - cam.camZ <= cam.camDepth * 4) return null; // at/behind the camera plane
  const fresh =
    rel < drawnMax &&
    cam.camX === freshCamX &&
    cam.camY === freshCamY &&
    cam.camZ === freshCamZ &&
    cam.camDepth === freshCamDepth &&
    cam.width === freshW &&
    cam.height === freshH;
  if (!fresh) {
    // renderWorld hasn't projected with this camera (standalone/test use):
    // re-project the segment in place. Ignores the accumulated curve offset,
    // so it is only exact on straights.
    projectPoint(seg.p1, cam.camX, cam.camY, cam.camZ, cam.camDepth, cam.width, cam.height, SIM.roadWidth);
    projectPoint(seg.p2, cam.camX, cam.camY, cam.camZ, cam.camDepth, cam.width, cam.height, SIM.roadWidth);
  }
  const pct = clamp(wrap(z, SIM.segmentLength) / SIM.segmentLength, 0, 1);
  const s = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pct);
  const x = lerp(seg.p1.screen.x, seg.p2.screen.x, pct);
  const y = lerp(seg.p1.screen.y, seg.p2.screen.y, pct);
  const w = lerp(seg.p1.screen.w, seg.p2.screen.w, pct);
  return { x: x + offsetX * w, y, scale: s };
}

function quad(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
  color: string,
): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.lineTo(x4, y4);
  g.closePath();
  g.fill();
}

/** Grass full-width strip, rumble edges, road polygon, lane dashes. */
function drawSegmentStrip(
  g: CanvasRenderingContext2D,
  width: number,
  seg: Segment,
): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;
  const c = seg.colors;
  g.fillStyle = c.grass;
  g.fillRect(0, p2.y, width, p1.y - p2.y);
  const r1 = p1.w / 6;
  const r2 = p2.w / 6;
  quad(g, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, c.rumble);
  quad(g, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, c.rumble);
  quad(g, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, c.road);
  if (c.lane !== null) {
    const l1 = p1.w / 28;
    const l2 = p2.w / 28;
    const lw1 = (p1.w * 2) / SIM.lanes;
    const lw2 = (p2.w * 2) / SIM.lanes;
    let lx1 = p1.x - p1.w + lw1;
    let lx2 = p2.x - p2.w + lw2;
    for (let l = 1; l < SIM.lanes; l++) {
      quad(g, lx1 - l1, p1.y, lx1 + l1, p1.y, lx2 + l2, p2.y, lx2 - l2, p2.y, c.lane);
      lx1 += lw1;
      lx2 += lw2;
    }
  }
}

const CHECKER_LIGHT = "#f2f2ec";
const CHECKER_DARK = "#1e1e26";

/** Finish line: checkered band across the road between p1 and p2. */
function drawCheckerBand(g: CanvasRenderingContext2D, seg: Segment): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;
  const cols = 8;
  const rows = 2;
  for (let r = 0; r < rows; r++) {
    const t0 = r / rows;
    const t1 = (r + 1) / rows;
    const ya = lerp(p1.y, p2.y, t0);
    const yb = lerp(p1.y, p2.y, t1);
    const wa = lerp(p1.w, p2.w, t0);
    const wb = lerp(p1.w, p2.w, t1);
    const xa = lerp(p1.x, p2.x, t0);
    const xb = lerp(p1.x, p2.x, t1);
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols;
      const u1 = (c + 1) / cols;
      quad(
        g,
        xa - wa + 2 * wa * u0,
        ya,
        xa - wa + 2 * wa * u1,
        ya,
        xb - wb + 2 * wb * u1,
        yb,
        xb - wb + 2 * wb * u0,
        yb,
        (r + c) % 2 === 0 ? CHECKER_LIGHT : CHECKER_DARK,
      );
    }
  }
}
