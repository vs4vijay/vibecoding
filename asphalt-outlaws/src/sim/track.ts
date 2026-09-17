import type {
  LevelSpec,
  Palette,
  ProjPoint,
  RoadColors,
  SceneryItem,
  SceneryKind,
  Segment,
  TrackData,
} from "./types";
import type { RNG } from "../core/rng";
import { SIM } from "../config";
import { easeIn, easeInOut, easeOut, wrap } from "../core/math";

// OWNERSHIP: buildTrack / projectPoint / computeCamDepth => Agent A.
// findSegment / trackLength are implemented (orchestrator) — do not rewrite.

// Track authoring shape tunables (gameplay tunables live in config.ts).
const MAX_CURVE = 5; // curve strength at level.curves === 1
const MAX_HILL_SEGS = 55; // hill amplitude, in segment lengths, at hills === 1
const FINISH_FROM_END = 32; // finish line offset from the track end (< 40)

function projPoint(y: number, z: number): ProjPoint {
  return {
    world: { x: 0, y, z },
    camera: { x: 0, y: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

/** Light/dark striping with lane dashes on dark stretches only. */
function segmentColors(i: number, pal: Palette): RoadColors {
  const dark = Math.floor(i / SIM.rumbleLength) % 2 === 1;
  const startLine = i < 4; // start stripe right after the grid
  return {
    road: dark ? pal.roadDark : pal.roadLight,
    grass: dark ? pal.grassDark : pal.grassLight,
    rumble: dark ? pal.rumbleDark : pal.rumbleLight,
    lane: dark || startLine ? pal.lane : null,
  };
}

/** Roadside prop mix per level. Deterministic through rng. */
function pickKind(id: string, rng: RNG): SceneryKind {
  switch (id) {
    case "pacific-run":
      return rng.chance(0.6) ? "palm" : rng.chance(0.65) ? "bush" : "sign";
    case "dust-devils":
      return rng.chance(0.5) ? "cactus" : rng.chance(0.6) ? "rock" : "sign";
    case "sunset-strip":
      return rng.chance(0.4) ? "city" : rng.chance(0.5) ? "lamp" : "billboard";
    case "canyon-rush":
      return rng.chance(0.65) ? "rock" : "pine";
    case "frostbite-pass":
      return rng.chance(0.6) ? "pine" : "rock";
    default:
      return rng.chance(0.5) ? "bush" : "rock";
  }
}

/** Segment containing world z (wraps into [0, length)). */
export function findSegment(track: TrackData, z: number): Segment {
  const n = track.segments.length;
  const i = Math.floor(wrap(z, n * SIM.segmentLength) / SIM.segmentLength);
  const seg = track.segments[i];
  if (!seg) throw new Error(`findSegment: index ${i} out of range`);
  return seg;
}

/** Total track length in world units. */
export function trackLength(track: TrackData): number {
  return track.segments.length * SIM.segmentLength;
}

/** Build the full point-to-point track for a level (curves + hills + scenery). */
export function buildTrack(level: LevelSpec, rng: RNG): TrackData {
  const segments: Segment[] = [];
  const scenery = new Map<number, SceneryItem[]>();
  const total = level.lengthSegs;

  const lastY = (): number => {
    const last = segments[segments.length - 1];
    return last ? last.p2.world.y : 0;
  };

  const addSegment = (curve: number, y: number): void => {
    const n = segments.length;
    segments.push({
      index: n,
      p1: projPoint(lastY(), n * SIM.segmentLength),
      p2: projPoint(y, (n + 1) * SIM.segmentLength),
      curve,
      colors: segmentColors(n, level.palette),
      clip: 0,
    });
  };

  // Classic enter/hold/leave section: curve eases in and back out, elevation
  // eases over the whole section. hillSegs is in segment-length units.
  const addRoad = (
    enter: number,
    hold: number,
    leave: number,
    curve: number,
    hillSegs: number,
  ): void => {
    const startY = lastY();
    const endY = startY + hillSegs * SIM.segmentLength;
    const segCount = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      addSegment(
        easeIn(0, curve, n / enter),
        easeInOut(startY, endY, n / segCount),
      );
    }
    for (let n = 0; n < hold; n++) {
      addSegment(curve, easeInOut(startY, endY, (enter + n) / segCount));
    }
    for (let n = 0; n < leave; n++) {
      addSegment(
        easeOut(curve, 0, n / leave),
        easeInOut(startY, endY, (enter + hold + n) / segCount),
      );
    }
  };

  const addFlat = (count: number): void => {
    const y = lastY();
    for (let i = 0; i < count; i++) addSegment(0, y);
  };

  // Split a section length into enter/hold/leave parts (each >= 2).
  const addSection = (len: number, curve: number, hillSegs: number): void => {
    const enter = Math.max(2, Math.round(len * 0.3));
    const leave = Math.max(2, Math.round(len * 0.3));
    const hold = Math.max(1, len - enter - leave);
    addRoad(enter, hold, leave, curve, hillSegs);
  };

  // Grid area: long flat straight (~600 m at race speeds).
  const startStraight = Math.max(120, Math.round(total * 0.1));
  addFlat(startStraight);

  // Body: alternating curve/hill sections and breather straights, scaled by
  // the level's twistiness/hilliness. Elevation is biased back toward sea
  // level so it stays bounded over the whole run.
  const finishStraight = Math.max(60, Math.round(total * 0.05));
  const bodyEnd = total - finishStraight;
  const strength = 0.8 + (MAX_CURVE - 0.8) * level.curves;
  const elevCap = 2 * MAX_HILL_SEGS * SIM.segmentLength * Math.max(0.3, level.hills);
  while (segments.length < bodyEnd) {
    const remaining = bodyEnd - segments.length;
    if (remaining < 24) {
      addFlat(remaining);
      break;
    }
    if (rng.chance(0.22)) {
      const len = Math.min(remaining, rng.int(20, 60));
      const roll = rng.chance(0.5) ? rng.range(-1, 1) * MAX_HILL_SEGS * 0.3 * level.hills : 0;
      addSection(len, 0, roll);
    } else {
      const len = Math.min(remaining, rng.int(40, 120));
      const dir = rng.chance(0.5) ? 1 : -1;
      const curve = dir * rng.range(0.35, 1) * strength;
      let hill = 0;
      if (level.hills > 0 && rng.chance(0.7)) {
        hill = rng.range(-1, 1) * MAX_HILL_SEGS * level.hills;
        const y = lastY();
        if (y > elevCap) hill = -Math.abs(hill);
        else if (y < -elevCap) hill = Math.abs(hill);
      }
      addSection(len, curve, hill);
    }
  }

  // Finish straight tops the track up to the exact segment count.
  addFlat(total - segments.length);

  const finishIndex = Math.max(0, total - FINISH_FROM_END);

  // Roadside props: one roughly every 2-6 segments, occasionally paired on
  // the opposite shoulder. Kept off the first/last handful of segments.
  const addItem = (idx: number, item: SceneryItem): void => {
    let list = scenery.get(idx);
    if (!list) {
      list = [];
      scenery.set(idx, list);
    }
    list.push(item);
  };
  let i = 14;
  while (i < total - 10) {
    const side = rng.chance(0.5) ? 1 : -1;
    addItem(i, {
      kind: pickKind(level.id, rng),
      offset: side * rng.range(1.15, 3.5),
      scale: rng.range(0.7, 1.6),
      flip: rng.chance(0.5),
    });
    if (rng.chance(0.35)) {
      addItem(i, {
        kind: pickKind(level.id, rng),
        offset: -side * rng.range(1.15, 2.6),
        scale: rng.range(0.7, 1.4),
        flip: rng.chance(0.5),
      });
    }
    i += rng.int(2, 7);
  }

  return { segments, scenery, finishIndex };
}

/**
 * Project a world point into camera + screen space, filling p.camera and
 * p.screen (screen.w is the scaled road half-width in pixels, screen.scale
 * the projection scale). Jake-Gordon-style pseudo-3D projection.
 */
export function projectPoint(
  p: ProjPoint,
  camX: number,
  camY: number,
  camZ: number,
  camDepth: number,
  width: number,
  height: number,
  roadWidth: number,
): void {
  p.camera.x = p.world.x - camX;
  p.camera.y = p.world.y - camY;
  const scale = camDepth / (p.world.z - camZ);
  p.screen.scale = scale;
  p.screen.x = Math.round(width / 2 + (scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((scale * roadWidth * width) / 2);
}

/** Perspective depth from vertical FOV degrees: 1 / tan(fov/2). */
export function computeCamDepth(fovDeg: number): number {
  return 1 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
}
