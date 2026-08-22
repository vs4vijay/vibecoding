import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  buildClosestTable,
  closestOnSpline,
  getPoint,
  getTangent,
  type ClosestTable,
  type Vec2,
} from "./spline";
import { applySpeedBoost, type TankState } from "./tank";

// ---------------------------------------------------------------------------
// Circuit definitions (Phase 6) — a circuit is data; buildTrack/createTrack
// turns a TrackDef into the runtime Track object the game consumes.
// ~10 control points per loop, fits within ±250. Travel direction: increasing
// t. Start/finish line is at t = 0 (control point 0).
// ---------------------------------------------------------------------------

/** Scatter config for off-track decoration (rocks / cacti / mesas). */
export interface TrackDressing {
  /** Deterministic RNG seed — same look every run. */
  seed: number;
  rocks: number;
  cacti: number;
  /** Flat-topped mesa slabs; 0 disables them. */
  mesas: number;
  rockColor: number;
  cactusColor: number;
  mesaColor: number;
  /** Phase 12 METRO RUSH: night-city props (0/undefined disables them). */
  buildings?: number;
  streetlights?: number;
}

export interface TrackDef {
  id: string;
  name: string;
  points: Vec2[];
  /** Boost pad t-values (should sit on straights). */
  padTs: number[];
  /** Power-up crate t-values (4 fixed spots on straights). */
  crateTs: number[];
  /** Checkpoint gate t-values per lap, crossed in order. */
  gates: number[];
  dressing: TrackDressing;
  /** Scene background/fog tint. */
  skyColor: number;
  groundColor: number;
  /** Hemisphere-light intensity override (night circuits boost readability). */
  hemiIntensity?: number;
  /** Directional sun/moon intensity override. */
  sunIntensity?: number;
  /** Road half-width in u (default ROAD_HALF_WIDTH = 7 → ~14u wide road). */
  roadHalfWidth?: number;
  /** Spline t-ranges surfaced with low-grip ice (Phase 11 GLACIER LOOP). */
  icePatches?: { from: number; to: number }[];
}

const DUST_BOWL: TrackDef = {
  id: "dust-bowl",
  name: "DUST BOWL",
  points: [
    { x: -120, z: -180 }, // 0: start/finish, bottom straight heading +X
    { x: 110, z: -190 }, // 1: end of long bottom straight
    { x: 195, z: -135 }, // 2: hairpin #1 entry (east)
    { x: 205, z: -45 }, // 3: hairpin #1 far point
    { x: 125, z: -5 }, // 4: exit heading back west
    { x: 20, z: -50 }, // 5: S-curve dip toward center
    { x: -70, z: 10 }, // 6: rises north-west
    { x: -190, z: 60 }, // 7: top-west approach
    { x: -235, z: -30 }, // 8: hairpin #2 far point
    { x: -165, z: -105 }, // 9: exit heading SE onto start straight
  ],
  padTs: [0.04, 0.62, 0.94], // on the three main straights
  crateTs: [0.1, 0.33, 0.55, 0.82],
  gates: [0, 0.25, 0.5, 0.75],
  dressing: {
    seed: 1337,
    rocks: 70,
    cacti: 26, // geometry-piece budget (trunk + arms), matches pre-Phase-6 look
    mesas: 0,
    rockColor: 0xb09468,
    cactusColor: 0x4e7c3a,
    mesaColor: 0xb08d5e,
  },
  skyColor: 0x7ec8f0, // bright desert sky
  groundColor: 0xd9b56e,
};

const CANYON_RUN: TrackDef = {
  id: "canyon-run",
  name: "CANYON RUN",
  points: [
    { x: -150, z: -195 }, // 0: start/finish, long bottom straight heading +X
    { x: 100, z: -200 }, // 1: end of the straight, sweeper entry
    { x: 215, z: -140 }, // 2: long right-hand sweeper (east rim)
    { x: 240, z: -10 }, // 3: sweeper far point
    { x: 150, z: 80 }, // 4: sweep out of the east rim toward center
    { x: 40, z: 30 }, // 5: chicane left
    { x: -40, z: 110 }, // 6: chicane right
    { x: -170, z: 175 }, // 7: top-west long sweeper
    { x: -245, z: 55 }, // 8: big west sweeper far point
    { x: -205, z: -95 }, // 9: sweeping down onto the start straight
  ],
  padTs: [0.05, 0.36, 0.78],
  crateTs: [0.12, 0.44, 0.62, 0.9],
  gates: [0, 0.25, 0.5, 0.75],
  dressing: {
    seed: 4242,
    rocks: 55,
    cacti: 110, // denser cholla fields in the canyon
    mesas: 12,
    rockColor: 0xa97b52,
    cactusColor: 0x5d8c3e,
    mesaColor: 0xb57f4f,
  },
  skyColor: 0xf0b478, // warm canyon dusk
  groundColor: 0xdfa96a,
};

const GLACIER_LOOP: TrackDef = {
  id: "glacier-loop",
  name: "GLACIER LOOP",
  points: [
    { x: -140, z: -190 }, // 0: start/finish, long bottom straight heading +X
    { x: 60, z: -200 }, // 1: end of the straight, sweeper entry
    { x: 180, z: -160 }, // 2: long right-hand east sweeper
    { x: 235, z: -40 }, // 3: east sweeper far point
    { x: 170, z: 90 }, // 4: sweep out of the east rim toward the top
    { x: 20, z: 150 }, // 5: top-left sweeper begins
    { x: -130, z: 185 }, // 6: top-west approach
    { x: -230, z: 110 }, // 7: big west sweeper entry
    { x: -255, z: -30 }, // 8: west sweeper far point
    { x: -210, z: -140 }, // 9: sweeping down onto the start straight
  ],
  padTs: [0.04, 0.46, 0.94], // on the three main straights/sweeper exits
  crateTs: [0.12, 0.4, 0.6, 0.88],
  gates: [0, 0.25, 0.5, 0.75],
  dressing: {
    seed: 9001,
    rocks: 60, // snow banks (same scatter budget, icy palette)
    cacti: 0,
    mesas: 10, // glacial ice mounds
    rockColor: 0xf0f6ff,
    cactusColor: 0xf0f6ff, // unused with 0 cacti
    mesaColor: 0xcfe8f7,
  },
  skyColor: 0xbfe0f5, // pale ice-blue sky + fog tint
  groundColor: 0xeef4fa, // snowfield
  roadHalfWidth: 8, // ~16u wide road — room to slide
  icePatches: [
    // Low-grip sections on the three big sweepers; visualized as lighter
    // blue overlay strips on the road.
    { from: 0.22, to: 0.32 },
    { from: 0.56, to: 0.66 },
    { from: 0.84, to: 0.94 },
  ],
};

const METRO_RUSH: TrackDef = {
  id: "metro-rush",
  name: "METRO RUSH",
  points: [
    { x: -60, z: -200 }, // 0: start/finish, short bottom straight heading +X
    { x: 50, z: -205 }, // 1: end of the bottom straight
    { x: 105, z: -160 }, // 2: quick right kink up
    { x: 70, z: -95 }, // 3: left hook back west
    { x: 130, z: -50 }, // 4: short NE dash
    { x: 210, z: -80 }, // 5: east hairpin entry
    { x: 240, z: -10 }, // 6: hairpin far point
    { x: 175, z: 40 }, // 7: exit heading WNW
    { x: 90, z: 15 }, // 8: chicane dip south
    { x: 55, z: 90 }, // 9: chicane rise north
    { x: -35, z: 145 }, // 10: top sweeper, east → west
    { x: -130, z: 190 }, // 11: top-west run
    { x: -205, z: 150 }, // 12: NW corner far point
    { x: -220, z: 60 }, // 13: down the west side
    { x: -150, z: 5 }, // 14: quick left toward center
    { x: -185, z: -85 }, // 15: right-left flick
    { x: -125, z: -165 }, // 16: final corner onto the start straight
  ],
  padTs: [0.03, 0.26, 0.64], // bottom straight, NE dash, top sweeper
  crateTs: [0.08, 0.31, 0.52, 0.83],
  gates: [0, 0.25, 0.5, 0.75],
  dressing: {
    seed: 7777,
    rocks: 0,
    cacti: 0,
    mesas: 0,
    rockColor: 0x000000, // unused on this track
    cactusColor: 0x000000,
    mesaColor: 0x000000,
    buildings: 42,
    streetlights: 30,
  },
  skyColor: 0x0a1230, // deep navy night sky + fog tint
  groundColor: 0x161a2b, // dark asphalt plaza
  hemiIntensity: 1.35, // boosted ambient so gameplay stays readable at night
  sunIntensity: 0.55, // dim "moon" — shadows still read, mood stays dark
};

/** All selectable circuits (Phase 6) — order = title-screen cycle order. */
export const TRACK_DEFS: TrackDef[] = [
  DUST_BOWL,
  CANYON_RUN,
  GLACIER_LOOP,
  METRO_RUSH,
];

export const ROAD_HALF_WIDTH = 7; // road is ~14 units wide (per-track default)
export const WALL_HEIGHT = 1.2;
/** Legacy default collide offset — runtime value is now per-track
 * (`track.halfWidth - 0.5`) to support the wider GLACIER LOOP road. */
export const WALL_COLLIDE_DIST = 6.5;

/** Default checkpoint gates per lap (t values) — tracks may override. */
export const DEFAULT_GATES = [0, 0.25, 0.5, 0.75];
export const TOTAL_LAPS = 3;

// ---------------------------------------------------------------------------
// Boost pads
// ---------------------------------------------------------------------------

export interface BoostPad {
  /** Center point on the spline. */
  cx: number;
  cz: number;
  /** Pad orientation (yaw from tangent). */
  angle: number;
  halfLen: number;
  halfWid: number;
  /** Visual group added to the track (base + stripes). */
  mesh: THREE.Group;
  baseMat: THREE.MeshBasicMaterial;
  stripeMat: THREE.MeshBasicMaterial;
  flash: number;
  cooldown: number;
}

const PAD_LEN = 12;
const PAD_WID = 8;
const BOOST_MULTIPLIER = 1.5;
const BOOST_DURATION = 2;
const FLASH_TIME = 0.35;
const PAD_BASE_COLOR = new THREE.Color(0xff8c00);
const PAD_STRIPE_COLOR = new THREE.Color(0xfff3c0);
const PAD_FLASH_COLOR = new THREE.Color(0xffffff);

// ---------------------------------------------------------------------------
// Race progress / laps (pure logic, no THREE imports needed)
// ---------------------------------------------------------------------------

export interface TankProgress {
  /** Current lap, 1-based. */
  lap: number;
  /** Index into GATES of the next gate that must be crossed in order. */
  nextGate: number;
  /** Last known parametric position along the spline. */
  lastT: number;
  /** t of the last gate passed in order — respawn anchor. */
  lastCheckpointT: number;
  /** Seconds elapsed in the current lap. */
  lapTime: number;
  bestLap: number | null;
  /** laps completed + fractional t — race positioning metric. */
  totalProgress: number;
}

export function createTankProgress(startT: number): TankProgress {
  return {
    lap: 1,
    nextGate: 1, // spawn at the start line; gate 0 already behind us
    lastT: startT,
    lastCheckpointT: startT,
    lapTime: 0,
    bestLap: null,
    totalProgress: startT,
  };
}

export type ProgressEvent = "none" | "gate" | "lap";

/**
 * Advance one tank's progress given its current spline parameter.
 * Returns "lap" exactly once per completed lap (all gates in order + start).
 * `gates` = the track's checkpoint gate t-values, crossed in order.
 */
export function updateTankProgress(
  prog: TankProgress,
  t: number,
  dt: number,
  gates: number[] = DEFAULT_GATES,
): ProgressEvent {
  const prev = prog.lastT;
  let delta = t - prev;
  if (delta > 0.5) delta -= 1; // moved backward across the wrap
  else if (delta < -0.5) delta += 1; // wrapped forward across the start line

  prog.lastT = t;
  prog.lapTime += dt;
  prog.totalProgress = prog.lap - 1 + t;

  if (delta <= 0) return "none"; // only forward motion crosses gates

  // Did we cross prog.nextGate moving forward this frame?
  const gate = gates[prog.nextGate];
  const traveled = ((gate - prev + 1) % 1 + 1) % 1;
  if (traveled > delta || traveled === 0) return "none";

  if (prog.nextGate === 0) {
    // Crossing the start line with all checkpoints hit → lap complete
    if (prog.bestLap === null || prog.lapTime < prog.bestLap) {
      prog.bestLap = prog.lapTime;
    }
    prog.lap += 1;
    prog.lapTime = 0;
    prog.nextGate = 1;
    return "lap";
  }
  prog.lastCheckpointT = gate;
  prog.nextGate = (prog.nextGate + 1) % gates.length;
  return "gate";
}

// ---------------------------------------------------------------------------
// Track object + mesh building
// ---------------------------------------------------------------------------

export interface Track {
  /** The data definition this track was built from. */
  def: TrackDef;
  points: Vec2[];
  table: ClosestTable;
  /** Road half-width in u — walls sit just outside, collision clamps inside. */
  halfWidth: number;
  /** Coarse polyline for the minimap. */
  outline: Vec2[];
  group: THREE.Group;
  pads: BoostPad[];
}

export function createTrack(def: TrackDef): Track {
  const points = def.points;
  const table = buildClosestTable(points, 1000);
  const halfWidth = def.roadHalfWidth ?? ROAD_HALF_WIDTH;

  // Coarse outline reused by the minimap
  const outline: Vec2[] = [];
  for (let s = 0; s < 120; s++) outline.push(getPoint(points, s / 120));

  const group = new THREE.Group();

  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
  const road = new THREE.Mesh(buildRoadGeometry(points, halfWidth), asphaltMat);
  road.receiveShadow = true;
  group.add(road);

  group.add(new THREE.Mesh(buildDashGeometry(points), DASH_MATERIAL));
  group.add(new THREE.Mesh(buildStartLine(points), START_LINE_MATERIAL));
  group.add(new THREE.Mesh(buildWallRibbon(points, 1, halfWidth), WALL_MATERIAL));
  group.add(new THREE.Mesh(buildWallRibbon(points, -1, halfWidth), WALL_MATERIAL));

  // Phase 11: low-grip ice patches render as lighter blue overlay strips
  if (def.icePatches && def.icePatches.length > 0) {
    const ice = new THREE.Mesh(
      buildIceOverlay(points, halfWidth, def.icePatches),
      ICE_MATERIAL,
    );
    group.add(ice);
  }

  for (const pt of buildDressing(table, def.dressing)) group.add(pt);

  // Phase 12: night-city dressing (buildings + streetlights), emissive-only
  if ((def.dressing.buildings ?? 0) > 0 || (def.dressing.streetlights ?? 0) > 0) {
    for (const mesh of buildCityDressing(points, table, halfWidth, def.dressing)) {
      group.add(mesh);
    }
  }

  const pads = def.padTs.map((t) => createPadMesh(points, t));
  for (const pad of pads) group.add(pad.mesh);

  return { def, points, table, halfWidth, outline, group, pads };
}

const DASH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
const WALL_MATERIAL = new THREE.MeshLambertMaterial({
  color: 0x9a9080,
  side: THREE.DoubleSide,
});
const START_LINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
// Phase 11: translucent light-blue film marking low-grip ice sections
const ICE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xa8d8f8,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

/**
 * Ice-patch overlay: a flat ribbon slightly above the road covering each
 * flagged t-range, merged into one geometry (one draw call per track).
 */
function buildIceOverlay(
  points: Vec2[],
  halfWidth: number,
  patches: { from: number; to: number }[],
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const inset = halfWidth - 0.3; // keep the strip inside the edge walls
  for (const patch of patches) {
    // ~1u spline resolution → sample count scales with patch length
    const span = ((patch.to - patch.from) % 1 + 1) % 1;
    const segs = Math.max(2, Math.ceil(span * 240));
    const pos: number[] = [];
    const idx: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const t = patch.from + (span * s) / segs;
      const p = getPoint(points, t);
      const tan = getTangent(points, t);
      const len = Math.hypot(tan.x, tan.z) || 1;
      const nx = tan.z / len;
      const nz = -tan.x / len;
      pos.push(p.x - nx * inset, 0.045, p.z - nz * inset);
      pos.push(p.x + nx * inset, 0.045, p.z + nz * inset);
      if (s < segs) {
        const a = s * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    parts.push(geo);
  }
  return mergeGeometries(parts)!;
}

/** Road surface as a triangle strip between left/right edge offsets. */
function buildRoadGeometry(points: Vec2[], halfWidth: number): THREE.BufferGeometry {
  const segs = 240;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const p = getPoint(points, t);
    const tan = getTangent(points, t);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const nx = tan.z / len; // right-hand normal in XZ
    const nz = -tan.x / len;
    pos.push(p.x - nx * halfWidth, 0.02, p.z - nz * halfWidth);
    pos.push(p.x + nx * halfWidth, 0.02, p.z + nz * halfWidth);
    if (s < segs) {
      const a = s * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Dashed white center line: thin boxes merged into one geometry. */
function buildDashGeometry(points: Vec2[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const step = 14; // spline samples between dashes
  for (let s = 0; s < 1000; s += step) {
    const t = s / 1000;
    const p = getPoint(points, t);
    const tan = getTangent(points, t);
    const angle = Math.atan2(tan.x, tan.z);
    const dash = new THREE.BoxGeometry(0.35, 0.04, 3.2);
    dash.rotateY(angle);
    dash.translate(p.x, 0.06, p.z);
    parts.push(dash);
  }
  const merged = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return merged;
}

/** Checkered-ish start line: white squares across the road at t = 0. */
function buildStartLine(points: Vec2[]): THREE.BufferGeometry {
  const p = getPoint(points, 0);
  const tan = getTangent(points, 0);
  const angle = Math.atan2(tan.x, tan.z);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = -4; i <= 4; i += 2) {
    const sq = new THREE.BoxGeometry(1.6, 0.05, 1.8);
    sq.rotateY(angle);
    sq.translate(p.x + i * 1.7 * Math.cos(angle), 0.07, p.z - i * 1.7 * Math.sin(angle));
    parts.push(sq);
  }
  const merged = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return merged;
}

/** Vertical ribbon wall standing just off one edge of the road. */
function buildWallRibbon(points: Vec2[], side: 1 | -1, halfWidth: number): THREE.BufferGeometry {
  const segs = 160;
  const offset = (halfWidth + 0.6) * side;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const p = getPoint(points, t);
    const tan = getTangent(points, t);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const nx = tan.z / len;
    const nz = -tan.x / len;
    pos.push(p.x + nx * offset, 0, p.z + nz * offset);
    pos.push(p.x + nx * offset, WALL_HEIGHT, p.z + nz * offset);
    if (s < segs) {
      const a = s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Deterministic RNG so the desert looks identical every run
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatter rocks + cacti (+ optional mesas) off-track, merged to keep draw calls low. */
function buildDressing(table: ClosestTable, dressing: TrackDressing): THREE.Mesh[] {
  const rng = mulberry32(dressing.seed);
  const minDistSq = 18 * 18;
  const maxRadius = 340;

  const clearOfTrack = (x: number, z: number): boolean => {
    for (let s = 0; s < table.points.length; s += 10) {
      const dx = table.points[s].x - x;
      const dz = table.points[s].z - z;
      if (dx * dx + dz * dz < minDistSq) return false;
    }
    return true;
  };

  const rockGeos: THREE.BufferGeometry[] = [];
  const cactusGeos: THREE.BufferGeometry[] = [];
  const mesaGeos: THREE.BufferGeometry[] = [];

  for (let i = 0; i < 220 && rockGeos.length < dressing.rocks; i++) {
    const x = (rng() * 2 - 1) * maxRadius;
    const z = (rng() * 2 - 1) * maxRadius;
    if (!clearOfTrack(x, z)) continue;
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const s = 0.6 + rng() * 2.2;
    rock.scale(s, s * (0.6 + rng() * 0.5), s);
    rock.rotateY(rng() * Math.PI * 2);
    rock.translate(x, s * 0.35, z);
    rockGeos.push(rock);
  }

  for (let i = 0; i < 240 && cactusGeos.length < dressing.cacti; i++) {
    const x = (rng() * 2 - 1) * maxRadius;
    const z = (rng() * 2 - 1) * maxRadius;
    if (!clearOfTrack(x, z)) continue;
    const h = 2.4 + rng() * 1.8;
    const trunk = new THREE.CylinderGeometry(0.32, 0.38, h, 7);
    trunk.translate(x, h / 2, z);
    cactusGeos.push(trunk);
    const arms = 1 + Math.floor(rng() * 2);
    for (let a = 0; a < arms; a++) {
      const armH = 1 + rng() * 0.8;
      const sideX = x + (rng() > 0.5 ? 0.55 : -0.55);
      const armY = h * (0.45 + rng() * 0.25);
      const arm = new THREE.CylinderGeometry(0.2, 0.22, armH, 6);
      arm.translate(sideX, armY + armH / 2, z);
      cactusGeos.push(arm);
    }
  }

  // Mesa slabs: big flat-topped mesas for canyon-style circuits
  for (let i = 0; i < 80 && mesaGeos.length < dressing.mesas; i++) {
    const x = (rng() * 2 - 1) * maxRadius;
    const z = (rng() * 2 - 1) * maxRadius;
    if (!clearOfTrack(x, z)) continue;
    const r = 8 + rng() * 16;
    const h = 10 + rng() * 18;
    const mesa = new THREE.CylinderGeometry(r * (0.75 + rng() * 0.25), r, h, 7, 1);
    mesa.rotateY(rng() * Math.PI * 2);
    mesa.translate(x, h / 2, z);
    mesaGeos.push(mesa);
  }

  const meshes: THREE.Mesh[] = [];
  if (rockGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(rockGeos)!,
        new THREE.MeshLambertMaterial({ color: dressing.rockColor }),
      ),
    );
  }
  if (cactusGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(cactusGeos)!,
        new THREE.MeshLambertMaterial({ color: dressing.cactusColor }),
      ),
    );
  }
  if (mesaGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(mesaGeos)!,
        new THREE.MeshLambertMaterial({ color: dressing.mesaColor }),
      ),
    );
  }
  return meshes;
}

// ---------------------------------------------------------------------------
// Night-city dressing (Phase 12 METRO RUSH) — emissive-only lighting, merged
// geometry: one mesh per material ≈ 6 draw calls total. No dynamic lights.
// ---------------------------------------------------------------------------

const CITY_BUILDING_COLOR = 0x232a3d; // dark blue-gray tower bodies
const CITY_POLE_COLOR = 0x3a4256;
/** Unlit "emissive" materials — MeshBasicMaterial ignores scene lights. */
const CITY_WINDOW_COLORS = [0xffd27a, 0x8fd4ff]; // warm + cool windows
const CITY_LAMP_COLOR = 0xfff3c8;

function buildCityDressing(
  points: Vec2[],
  table: ClosestTable,
  halfWidth: number,
  dressing: TrackDressing,
): THREE.Mesh[] {
  const rng = mulberry32((dressing.seed ^ 0x5f3c) >>> 0);
  const maxRadius = 300;

  // Buildings need a wider berth than rocks: no overhang above the road.
  const clearOfTrack = (x: number, z: number, margin: number): boolean => {
    const minDistSq = margin * margin;
    for (let s = 0; s < table.points.length; s += 4) {
      const dx = table.points[s].x - x;
      const dz = table.points[s].z - z;
      if (dx * dx + dz * dz < minDistSq) return false;
    }
    return true;
  };

  const buildingGeos: THREE.BufferGeometry[] = [];
  const windowGeos: THREE.BufferGeometry[][] = CITY_WINDOW_COLORS.map(() => []);

  for (
    let i = 0;
    i < 400 && buildingGeos.length < (dressing.buildings ?? 0);
    i++
  ) {
    const x = (rng() * 2 - 1) * maxRadius;
    const z = (rng() * 2 - 1) * maxRadius;
    if (!clearOfTrack(x, z, 30)) continue;
    // Axis-aligned boxes read as a city grid and make window placement exact
    const w = 10 + rng() * 14;
    const d = 10 + rng() * 14;
    const h = 14 + rng() * 46;
    const box = new THREE.BoxGeometry(w, h, d);
    box.translate(x, h / 2, z);
    buildingGeos.push(box);

    // A few lit windows: thin slabs protruding from random faces
    const windows = 3 + Math.floor(rng() * 6);
    for (let wn = 0; wn < windows; wn++) {
      const face = Math.floor(rng() * 4);
      const fy = 2 + rng() * (h - 4);
      const along = (rng() * 2 - 1) * 0.32; // fraction across the chosen face
      let geo: THREE.BoxGeometry;
      if (face < 2) {
        // ±X faces — thin in x
        geo = new THREE.BoxGeometry(0.25, 1.8, 1.5);
        geo.translate(
          x + (face === 0 ? w / 2 + 0.15 : -(w / 2 + 0.15)),
          fy,
          z + along * d,
        );
      } else {
        // ±Z faces — thin in z
        geo = new THREE.BoxGeometry(1.5, 1.8, 0.25);
        geo.translate(
          x + along * w,
          fy,
          z + (face === 2 ? d / 2 + 0.15 : -(d / 2 + 0.15)),
        );
      }
      windowGeos[Math.floor(rng() * windowGeos.length)].push(geo);
    }
  }

  // Streetlights: evenly spaced along the spline, alternating sides, lamp arms
  // reaching over the wall with a soft glow pool on the ground.
  const poleGeos: THREE.BufferGeometry[] = [];
  const lampGeos: THREE.BufferGeometry[] = [];
  const glowGeos: THREE.BufferGeometry[] = [];
  const lightCount = dressing.streetlights ?? 0;
  for (let i = 0; i < lightCount; i++) {
    const t = i / lightCount;
    const p = getPoint(points, t);
    const tan = getTangent(points, t);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const side = i % 2 === 0 ? 1 : -1;
    const nx = (tan.z / len) * side;
    const nz = (-tan.x / len) * side;
    const px = p.x + nx * (halfWidth + 2.6);
    const pz = p.z + nz * (halfWidth + 2.6);
    const poleH = 5.2 + rng() * 0.8;
    const pole = new THREE.CylinderGeometry(0.14, 0.18, poleH, 6);
    pole.translate(px, poleH / 2, pz);
    poleGeos.push(pole);
    // Arm reaching from the pole toward the track
    const armLen = 1.4;
    const ax = px - nx * armLen;
    const az = pz - nz * armLen;
    const arm = new THREE.BoxGeometry(
      Math.abs(nx) > Math.abs(nz) ? armLen : 0.16,
      0.16,
      Math.abs(nz) >= Math.abs(nx) ? armLen : 0.16,
    );
    arm.translate((px + ax) / 2, poleH, (pz + az) / 2);
    poleGeos.push(arm);
    // Emissive head at the end of the arm
    const head = new THREE.BoxGeometry(0.7, 0.22, 0.7);
    head.translate(ax, poleH - 0.15, az);
    lampGeos.push(head);
    // Glow pool on the ground under the lamp (outside the wall)
    const disc = new THREE.CircleGeometry(2.6, 10);
    disc.rotateX(-Math.PI / 2);
    disc.translate(ax, 0.04, az);
    glowGeos.push(disc);
  }

  const meshes: THREE.Mesh[] = [];
  if (buildingGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(buildingGeos)!,
        new THREE.MeshLambertMaterial({ color: CITY_BUILDING_COLOR }),
      ),
    );
  }
  for (let c = 0; c < windowGeos.length; c++) {
    if (windowGeos[c].length === 0) continue;
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(windowGeos[c])!,
        new THREE.MeshBasicMaterial({ color: CITY_WINDOW_COLORS[c] }),
      ),
    );
  }
  if (poleGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(poleGeos)!,
        new THREE.MeshLambertMaterial({ color: CITY_POLE_COLOR }),
      ),
    );
  }
  if (lampGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(lampGeos)!,
        new THREE.MeshBasicMaterial({ color: CITY_LAMP_COLOR }),
      ),
    );
  }
  if (glowGeos.length > 0) {
    meshes.push(
      new THREE.Mesh(
        mergeGeometries(glowGeos)!,
        new THREE.MeshBasicMaterial({
          color: CITY_LAMP_COLOR,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      ),
    );
  }
  // Free the temp geometries that made it into the merged buffers
  for (const g of [
    ...buildingGeos,
    ...windowGeos.flat(),
    ...poleGeos,
    ...lampGeos,
    ...glowGeos,
  ]) {
    g.dispose();
  }
  return meshes;
}

function createPadMesh(points: Vec2[], t: number): BoostPad {
  const p = getPoint(points, t);
  const tan = getTangent(points, t);
  const angle = Math.atan2(tan.x, tan.z);

  const baseMat = new THREE.MeshBasicMaterial({
    color: PAD_BASE_COLOR.clone(),
  });
  const stripeMat = new THREE.MeshBasicMaterial({
    color: PAD_STRIPE_COLOR.clone(),
  });

  const mesh = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(PAD_WID, PAD_LEN), baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.05;
  mesh.add(base);

  for (const off of [-PAD_WID / 2 + 0.5, PAD_WID / 2 - 0.5]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1, PAD_LEN), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(off, 0.06, 0);
    mesh.add(stripe);
  }

  mesh.position.set(p.x, 0, p.z);
  mesh.rotation.y = angle;

  return {
    cx: p.x,
    cz: p.z,
    angle,
    halfLen: PAD_LEN / 2,
    halfWid: PAD_WID / 2,
    mesh,
    baseMat,
    stripeMat,
    flash: 0,
    cooldown: 0,
  };
}

/** Fade pad flash colors back to normal; run once per frame. */
export function updateBoostPads(track: Track, dt: number): void {
  for (const pad of track.pads) {
    if (pad.flash > 0) {
      pad.flash = Math.max(0, pad.flash - dt);
      const k = pad.flash / FLASH_TIME;
      pad.baseMat.color.copy(PAD_BASE_COLOR).lerp(PAD_FLASH_COLOR, k);
      pad.stripeMat.color.copy(PAD_STRIPE_COLOR).lerp(PAD_FLASH_COLOR, k);
    }
    if (pad.cooldown > 0) pad.cooldown -= dt;
  }
}

/**
 * Returns true if the tank just triggered a boost pad this frame
 * (applies the ×1.5 / 2s speed boost and flashes the pad).
 */
export function checkBoostPads(track: Track, tank: TankState): boolean {
  for (const pad of track.pads) {
    if (pad.cooldown > 0) continue;
    // Transform tank position into the pad's local frame
    const dx = tank.position.x - pad.cx;
    const dz = tank.position.z - pad.cz;
    const cos = Math.cos(-pad.angle);
    const sin = Math.sin(-pad.angle);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) <= pad.halfWid && Math.abs(lz) <= pad.halfLen) {
      applySpeedBoost(tank, BOOST_MULTIPLIER, BOOST_DURATION);
      pad.flash = FLASH_TIME;
      pad.cooldown = 0.75;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wall collision (soft bounce)
// ---------------------------------------------------------------------------

/**
 * If the tank center is outside the collision radius around the spline,
 * push it back inside and remove the outward velocity component.
 */
export function collideWithWalls(track: Track, tank: TankState): void {
  const collideDist = track.halfWidth - 0.5; // clamp just inside the edge
  const cp = closestOnSpline(track.table, tank.position.x, tank.position.z);
  if (cp.distSq <= collideDist * collideDist) return;

  const center = getPoint(track.points, cp.t);
  let ox = tank.position.x - center.x;
  let oz = tank.position.z - center.z;
  const d = Math.hypot(ox, oz) || 1;
  ox /= d;
  oz /= d;

  // Clamp position back to the boundary
  tank.position.x = center.x + ox * collideDist;
  tank.position.z = center.z + oz * collideDist;

  // Soft bounce: kill any outward velocity (keeps sliding along the wall)
  const vOut = tank.velocity.x * ox + tank.velocity.z * oz;
  if (vOut > 0) {
    tank.velocity.x -= ox * vOut;
    tank.velocity.z -= oz * vOut;
  }
}

// ---------------------------------------------------------------------------
// Surface grip (Phase 11 ice patches)
// ---------------------------------------------------------------------------

/** Grip multipliers consumed by the shared tank physics (see src/tank.ts). */
export interface SurfaceGrip {
  /** Multiplier on lateral grip rate (lower = more slide). */
  lateral: number;
  /** Multiplier on engine acceleration. */
  accel: number;
}

/** Default surface — identical to pre-Phase-11 behavior on every track. */
export const NORMAL_GRIP: SurfaceGrip = { lateral: 1, accel: 1 };
const ICE_GRIP: SurfaceGrip = { lateral: 0.35, accel: 0.6 };

/** True if spline parameter t lies inside a patch range (wrap-safe). */
function inIcePatch(
  patches: { from: number; to: number }[],
  t: number,
): boolean {
  for (const p of patches) {
    if (p.from <= p.to) {
      if (t >= p.from && t <= p.to) return true;
    } else if (t >= p.from || t <= p.to) {
      return true; // wraps across the start line
    }
  }
  return false;
}

/** Surface grip under a tank at spline parameter t. */
export function gripAt(track: Track, t: number): SurfaceGrip {
  const patches = track.def.icePatches;
  if (!patches || patches.length === 0) return NORMAL_GRIP;
  return inIcePatch(patches, ((t % 1) + 1) % 1) ? ICE_GRIP : NORMAL_GRIP;
}

/**
 * Stage this frame's grip multipliers onto the tank before physics runs.
 * Called once per tank per frame by the game loop and scripts/sim-ai.ts;
 * neutral on tracks without ice patches.
 */
export function applySurfaceGrip(track: Track, tank: TankState, t: number): void {
  const g = gripAt(track, t);
  tank.gripLateral = g.lateral;
  tank.gripAccel = g.accel;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

/** Place a tank on the spline at parameter t, facing forward, at rest. */
export function placeTankAtProgress(tank: TankState, track: Track, t: number): void {
  const p = getPoint(track.points, t);
  const tan = getTangent(track.points, t);
  tank.position.set(p.x, 0, p.z);
  tank.heading = Math.atan2(tan.x, tan.z);
  tank.velocity.set(0, 0, 0);
  tank.mesh.root.position.copy(tank.position);
  tank.mesh.root.rotation.y = tank.heading;
}

/**
 * Like placeTankAtProgress but offset laterally across the road (for a start
 * grid): positive `lateral` is toward the track's right-hand normal.
 */
export function placeTankAtGridSlot(
  tank: TankState,
  track: Track,
  t: number,
  lateral: number,
): void {
  placeTankAtProgress(tank, track, t);
  if (lateral !== 0) {
    const tan = getTangent(track.points, t);
    const len = Math.hypot(tan.x, tan.z) || 1;
    tank.position.x += (tan.z / len) * lateral;
    tank.position.z += (-tan.x / len) * lateral;
    tank.mesh.root.position.copy(tank.position);
  }
}
