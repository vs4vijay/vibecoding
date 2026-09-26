/**
 * Deterministic city generation data (Midtown Blitz game, task 2.1).
 *
 * Produces the pure-data layout of the open city from a fixed, versioned
 * seed: the road grid (10x10 blocks, ~64 m blocks, ~14 m roads, ~780 m
 * across — design Decision 5), per-block contents (building footprints,
 * heights, colors), sidewalks with low curbs, street props, one park block
 * and one tower landmark.
 *
 * NO three.js here and no DOM — {@link generateCity} returns plain data
 * (hex numbers for colors, meters for distances, world x/z axes) so node
 * harnesses can test it byte-for-byte; rendering is task 2.2, the collision
 * world task 2.3, and the lane graph task 4.1.
 *
 * Coordinate system: x/z world axes, y is elevation. Roads sit at y = 0;
 * every block surface (sidewalk ring, lot interior, park lawn) sits at
 * y = CURB_M (one low, bump-over step — city-world spec "Curbs are
 * bump-over"). Buildings' bases start at their block's surface. All rects
 * are axis-aligned and described by center + full width/depth
 * (`{x, z, w, d}`), matching the AABB collision world.
 *
 * Determinism: the only randomness source is the engine PRNG
 * (`src/engine/rng.js`), seeded from {@link CITY_SEED} (string, versioned —
 * bump the suffix to regenerate the city). Each generation phase draws from
 * its own forked stream ('blocks', 'park', 'landmark', 'props') so phases
 * can evolve independently; draw order within a phase is fixed. There is no
 * Math.random/Date anywhere, so a fresh process yields a byte-identical
 * JSON dump (verified by scripts/city-gen-test.mjs).
 *
 * Seams for later tasks:
 *  - Task 2.2 (rendering) consumes `grid` (ground/roads), `blocks[].sidewalkRects`
 *    (curbs), `blocks[].buildings` + `props` (instanced, per-instance color),
 *    `park` + `landmark` (set pieces); fog/draw distance comes from
 *    `QUALITY_TIERS` in src/engine/renderer.js.
 *  - Task 2.3 (collision world) registers `blocks[].buildings` as AABBs
 *    (x/z/w/d, y from block surface to `height`) and every `props` entry
 *    with `collisionRadius > 0` as a thin AABB; sidewalk/curb stepping uses
 *    the y = 0 roads vs y = CURB_M block-surface rule in this header.
 *  - Task 4.1 (lane graph) consumes `grid.linesX` / `grid.linesZ`
 *    (centerlines, ascending), `grid.roadM` (full asphalt width) and
 *    `grid.laneOffsetM` (centerline -> lane center, two lanes per road,
 *    right-hand traffic per design Decision 7).
 */

import { createRng } from '../engine/rng.js';

/** Layout format version, bumped when the output shape changes. */
export const CITY_GEN_VERSION = 1;

/**
 * Fixed, versioned city seed (city-world spec: "generated procedurally from
 * a fixed, versioned seed"). Bump the suffix to produce a new city.
 */
export const CITY_SEED = 'midtown-blitz-v1';

/** Number of blocks per axis (10x10 blocks, 11 road lines per axis). */
export const GRID_N = 10;

/** Block size in meters (road centerline to centerline minus road width). */
export const BLOCK_M = 64;

/** Full road (asphalt) width in meters, either side of a centerline. */
export const ROAD_M = 14;

/** Grid pitch in meters: block + road (design Decision 5: ~78 m). */
export const PITCH_M = BLOCK_M + ROAD_M;

/** Sidewalk width in meters (the outer ring of every block). */
export const SIDEWALK_M = 3;

/** Curb height in meters: elevation of every block surface above the road. */
export const CURB_M = 0.15;

/**
 * Lane center offset from a road centerline in meters (two lanes per road,
 * right-hand traffic) — the seam task 4.1 consumes.
 */
export const LANE_OFFSET_M = ROAD_M / 4;

/** Margin of flat ground added beyond the outermost asphalt edge. */
export const WORLD_MARGIN_M = 3;

/** Road centerline coordinate for grid line i on either axis. */
function gridLine(i) {
  return (i - GRID_N / 2) * PITCH_M;
}

/** Block center coordinate for block index i (0..GRID_N-1) on either axis. */
function blockCenter(i) {
  return (i - (GRID_N - 1) / 2) * PITCH_M;
}

/** Round to 2 decimals so JSON dumps stay compact (still deterministic). */
function round2(v) {
  return Math.round(v * 100) / 100;
}

/** Building facade palette (hex numbers; task 2.2 maps them to materials). */
const BUILDING_PALETTE = Object.freeze([
  0xb0b4bc, // concrete
  0x8f9aa8, // blue-grey
  0xc9c2b4, // sand stone
  0xa67f5e, // brick
  0x7d8471, // sage
  0x6e7f8d, // slate
  0xd0cabb, // limestone
  0x5f6b76, // dark slate
]);

/** Street-tree canopy palette. */
const TREE_PALETTE = Object.freeze([0x4f7a3a, 0x5d8a42, 0x6f9a4d, 0x456e34]);

/** Tower landmark colors (light steel + a readable-in-fog accent). */
const TOWER_COLOR = 0xd7dee6;
const ACCENT_PALETTE = Object.freeze([0xffd452, 0xff8a3d]);
const TOWER_FOOTPRINT_M = 30;
const TOWER_HEIGHT_M = 150;
const TOWER_SPIRE_HEIGHT_M = 22;
const TOWER_SPIRE_RADIUS_M = 1.6;

/** Park colors + path width. */
const PARK_LAWN_COLOR = 0x5a7d46;
const PARK_PATH_COLOR = 0xb8ab90;
const PARK_PATH_M = 4;

/** Lamp post archetype (2.2 owns the material; data keeps the sizes). */
const LAMP_HEIGHT_M = 6.5;
const LAMP_COLLISION_RADIUS_M = 0.3;
const TREE_COLLISION_RADIUS_M = 0.4;

/**
 * One axis-aligned rectangle in the x/z plane.
 *
 * @typedef {object} CityRect
 * @property {number} x Center x (m).
 * @property {number} z Center z (m).
 * @property {number} w Full width along x (m).
 * @property {number} d Full depth along z (m).
 */

/**
 * A sidewalk strip with its walking surface elevation and curb step.
 *
 * @typedef {CityRect} CitySidewalkRect
 * @property {number} y Top surface elevation (m; = CURB_M).
 * @property {number} curbHeight Step from the road surface to `y` (m).
 */

/**
 * One building: an axis-aligned box footprint + height + facade color.
 * The box spans y from the block surface (CURB_M) up to CURB_M + height.
 *
 * @typedef {CityRect} CityBuilding
 * @property {number} height Height above the block surface (m).
 * @property {number} color Facade color as a hex number.
 */

/**
 * A street or park prop. Everything with `collisionRadius > 0` (all of
 * them) is a static collider for task 2.3; `kind` is the render archetype
 * for task 2.2. Tree-only fields describe the canopy; lamps have none.
 *
 * @typedef {object} CityProp
 * @property {'lamp' | 'tree'} kind Render archetype.
 * @property {'street' | 'park'} source Where it was placed from.
 * @property {number} x Center x (m).
 * @property {number} z Center z (m).
 * @property {number} y Base elevation (m; block surface = CURB_M).
 * @property {number} height Total height above base (m).
 * @property {number} collisionRadius Trunk/pole collision radius (m).
 * @property {number} blockIx Block index (x) whose sidewalk/lawn it stands on.
 * @property {number} blockIz Block index (z) it belongs to.
 * @property {number} [canopyRadius] Tree canopy radius (m).
 * @property {number} [trunkHeight] Tree trunk height (m).
 * @property {number} [canopyColor] Tree canopy color (hex number).
 */

/**
 * One city block: a PITCH_M x PITCH_M cell minus the surrounding road,
 * always with a sidewalk ring on its perimeter at CURB_M elevation.
 *
 * @typedef {object} CityBlock
 * @property {number} ix Block index along x (0..GRID_N-1).
 * @property {number} iz Block index along z (0..GRID_N-1).
 * @property {number} index Row-major index into `layout.blocks` (ix + iz * GRID_N).
 * @property {number} x Block center x (m).
 * @property {number} z Block center z (m).
 * @property {'buildings' | 'park' | 'tower'} type Block content type.
 * @property {number} innerX Center x of the lot region inside the sidewalks (m).
 * @property {number} innerZ Center z of the lot region (m).
 * @property {number} innerW Lot region width (m) = BLOCK_M - 2 * SIDEWALK_M.
 * @property {number} innerD Lot region depth (m).
 * @property {number} surfaceY Elevation of the block surface (m; = CURB_M).
 * @property {CitySidewalkRect[]} sidewalkRects Perimeter sidewalk strips
 *   (4 per block, order [W, E, N, S]; W/E span the full block length and
 *   include the corners, N/S the inner width between them).
 * @property {CityBuilding[]} buildings Buildings on this block ('park' blocks
 *   have none; 'tower' blocks exactly one — the landmark tower).
 */

/**
 * The park set piece (exactly one block, type 'park').
 *
 * @typedef {object} CityPark
 * @property {number} blockIndex Index into `layout.blocks`.
 * @property {number} ix Block index along x.
 * @property {number} iz Block index along z.
 * @property {number} x Block center x (m).
 * @property {number} z Block center z (m).
 * @property {number} lawnY Lawn elevation (m; = CURB_M, same step as sidewalks).
 * @property {number} lawnColor Lawn color (hex number).
 * @property {number} pathColor Path color (hex number).
 * @property {CityRect[]} pathRects Crossing footpaths (2, at lawn level).
 * @property {number[]} propIndices Indices into `layout.props` for the park
 *   trees (each also carries blockIx/blockIz of this block).
 */

/**
 * The tower landmark (exactly one block, type 'tower'). Its single building
 * is `blocks[blockIndex].buildings[buildingIndex]`, so collision/render
 * consumers can treat it uniformly; the extra fields describe the spire.
 *
 * @typedef {object} CityLandmark
 * @property {'tower'} kind Landmark kind.
 * @property {number} blockIndex Index into `layout.blocks`.
 * @property {number} ix Block index along x.
 * @property {number} iz Block index along z.
 * @property {number} x Tower center x (m).
 * @property {number} z Tower center z (m).
 * @property {number} buildingIndex Index into that block's `buildings`.
 * @property {number} height Shaft height above the block surface (m).
 * @property {number} spireHeight Spire height above the shaft (m).
 * @property {number} spireRadius Spire radius (m).
 * @property {number} color Shaft color (hex number).
 * @property {number} accentColor Accent/spire trim color (hex number).
 */

/**
 * The generated city layout. Plain data only — see the module header for
 * the elevation model and the per-task seams.
 *
 * @typedef {object} CityLayout
 * @property {number} version CITY_GEN_VERSION of the producing module.
 * @property {string} seed Seed string the layout was generated from.
 * @property {number} seedHash Uint32 hash of the seed (debug/telemetry).
 * @property {object} world World extents (everything generated lies inside).
 * @property {number} world.minX Minimum x (m).
 * @property {number} world.maxX Maximum x (m).
 * @property {number} world.minZ Minimum z (m).
 * @property {number} world.maxZ Maximum z (m).
 * @property {number} world.halfSizeM Half extent along either axis (m).
 * @property {number} world.sizeM Full extent along either axis (m).
 * @property {number} world.roadSpanM Centerline-to-centerline span (m).
 * @property {number} world.groundY Elevation of roads (m; always 0).
 * @property {object} grid Road grid description (seam for task 4.1).
 * @property {number} grid.n Blocks per axis (= GRID_N).
 * @property {number} grid.blockM Block size (m).
 * @property {number} grid.roadM Road width (m).
 * @property {number} grid.pitchM Block + road pitch (m).
 * @property {number} grid.sidewalkM Sidewalk width (m).
 * @property {number} grid.curbM Curb step height (m).
 * @property {number} grid.laneOffsetM Centerline -> lane center offset (m).
 * @property {number[]} grid.linesX Road centerline x coordinates, ascending
 *   (n + 1 entries; line i spans z over the full city).
 * @property {number[]} grid.linesZ Road centerline z coordinates, ascending.
 * @property {CityPark} park The single park block's set-piece data.
 * @property {CityLandmark} landmark The single tower landmark.
 * @property {CityBlock[]} blocks All n*n blocks, row-major (index = ix + iz * n).
 * @property {CityProp[]} props All props (street + park), placement order.
 * @property {object} counts Convenience tallies (asserted by the test harness).
 * @property {number} counts.blocks Number of blocks.
 * @property {number} counts.buildings Total buildings across all blocks.
 * @property {number} counts.props Total props.
 * @property {number} counts.lamps Lamp posts among props.
 * @property {number} counts.trees Trees among props (street + park).
 */

/**
 * Subdivide a lot rect into building cells via deterministic binary splits
 * (longest axis first, random ratio, alley gap between siblings), pushing
 * leaf cells into `out`. Stops on depth/size limits or by chance so blocks
 * end up with one to four buildings of varied sizes.
 *
 * @param {CityRect} rect Lot/cell rect to split (mutated never).
 * @param {number} depth Current recursion depth (0-based).
 * @param {import('../engine/rng.js').Rng} rng Stream to draw from.
 * @param {CityRect[]} out Leaf cell accumulator.
 * @returns {void}
 */
function subdivideLot(rect, depth, rng, out) {
  const minSide = Math.min(rect.w, rect.d);
  const stop =
    (depth === 0 && rng.chance(0.15)) || // occasional single-building block
    depth >= 2 ||
    (depth >= 1 && rng.chance(0.35)) ||
    minSide < 26;
  if (stop) {
    out.push(rect);
    return;
  }
  const GAP = 3; // alley between sibling cells
  if (rect.w >= rect.d) {
    const wA = Math.max(10, Math.round(rect.w * rng.float(0.38, 0.62) - GAP / 2));
    const wB = rect.w - wA - GAP;
    if (wB < 10) {
      out.push(rect);
      return;
    }
    subdivideLot({ x: rect.x - rect.w / 2 + wA / 2, z: rect.z, w: wA, d: rect.d }, depth + 1, rng, out);
    subdivideLot({ x: rect.x + rect.w / 2 - wB / 2, z: rect.z, w: wB, d: rect.d }, depth + 1, rng, out);
  } else {
    const dA = Math.max(10, Math.round(rect.d * rng.float(0.38, 0.62) - GAP / 2));
    const dB = rect.d - dA - GAP;
    if (dB < 10) {
      out.push(rect);
      return;
    }
    subdivideLot({ x: rect.x, z: rect.z - rect.d / 2 + dA / 2, w: rect.w, d: dA }, depth + 1, rng, out);
    subdivideLot({ x: rect.x, z: rect.z + rect.d / 2 - dB / 2, w: rect.w, d: dB }, depth + 1, rng, out);
  }
}

/**
 * Build the sidewalk ring for a block: four strips at CURB_M elevation.
 * W/E strips run the full block length (covering the corners); N/S strips
 * span the inner width between them. Fixed [W, E, N, S] order.
 *
 * @param {number} cx Block center x (m).
 * @param {number} cz Block center z (m).
 * @returns {CitySidewalkRect[]} The four sidewalk strips.
 */
function buildSidewalks(cx, cz) {
  const half = BLOCK_M / 2;
  const inset = SIDEWALK_M / 2;
  const inner = BLOCK_M - 2 * SIDEWALK_M;
  /** @type {CitySidewalkRect[]} */
  const rects = [
    { x: cx - half + inset, z: cz, w: SIDEWALK_M, d: BLOCK_M, y: CURB_M, curbHeight: CURB_M },
    { x: cx + half - inset, z: cz, w: SIDEWALK_M, d: BLOCK_M, y: CURB_M, curbHeight: CURB_M },
    { x: cx, z: cz - half + inset, w: inner, d: SIDEWALK_M, y: CURB_M, curbHeight: CURB_M },
    { x: cx, z: cz + half - inset, w: inner, d: SIDEWALK_M, y: CURB_M, curbHeight: CURB_M },
  ];
  return rects;
}

/**
 * Generate the deterministic city layout. Pure: reads nothing but its
 * arguments, writes nothing, and depends only on the seeded PRNG — so the
 * same seed always yields a byte-identical result (task 2.1 verification).
 * Runs in well under a second (~100 blocks, a few hundred buildings).
 *
 * @param {number | string} [seed=CITY_SEED] Seed to generate from (the
 *   shipped city uses the fixed CITY_SEED; tests vary it).
 * @returns {CityLayout} The pure-data city layout.
 */
export function generateCity(seed = CITY_SEED) {
  const seedStr = typeof seed === 'string' ? seed : String(seed);
  const rngRoot = createRng(seedStr);
  const seedHash = createRng(seedStr).state();

  // Per-phase streams: fixed fork order, one label each, so phases can add
  // draws without shifting each other's sequences (see rng.js stream
  // discipline). These names are the natural loading-bar phases for task 6.2.
  const rngBlocks = rngRoot.fork('blocks');
  const rngPark = rngRoot.fork('park');
  const rngLandmark = rngRoot.fork('landmark');
  const rngProps = rngRoot.fork('props');

  // --- world extents + road grid -------------------------------------------
  const linesX = [];
  const linesZ = [];
  for (let i = 0; i <= GRID_N; i += 1) {
    linesX.push(gridLine(i));
    linesZ.push(gridLine(i));
  }
  const halfSize = GRID_N * PITCH_M * 0.5 + ROAD_M / 2 + WORLD_MARGIN_M;
  const roadSpan = GRID_N * PITCH_M;

  // --- landmark + park block selection (near-center-ish, distinct) ---------
  const parkIx = rngBlocks.int(2, 7);
  const parkIz = rngBlocks.int(2, 7);
  let towerIx = rngBlocks.int(2, 7);
  let towerIz = rngBlocks.int(2, 7);
  while (towerIx === parkIx && towerIz === parkIz) {
    towerIx = rngBlocks.int(2, 7);
    towerIz = rngBlocks.int(2, 7);
  }

  // --- blocks (sidewalks + buildings) --------------------------------------
  const innerHalf = (BLOCK_M - 2 * SIDEWALK_M) / 2;
  const centerI = (GRID_N - 1) / 2;
  /** @type {CityBlock[]} */
  const blocks = [];
  for (let iz = 0; iz < GRID_N; iz += 1) {
    for (let ix = 0; ix < GRID_N; ix += 1) {
      const cx = blockCenter(ix);
      const cz = blockCenter(iz);
      const isPark = ix === parkIx && iz === parkIz;
      const isTower = ix === towerIx && iz === towerIz;
      const type = isPark ? 'park' : isTower ? 'tower' : 'buildings';

      /** @type {CityBuilding[]} */
      const buildings = [];
      if (type === 'buildings') {
        /** @type {CityRect[]} */
        const cells = [];
        subdivideLot({ x: cx, z: cz, w: innerHalf * 2, d: innerHalf * 2 }, 0, rngBlocks, cells);
        // Downtown factor: 1 at the center of town, 0 at the ring road —
        // taller cores, low edges, so the skyline reads from anywhere.
        const cheb = Math.max(Math.abs(ix - centerI), Math.abs(iz - centerI));
        const downtown = 1 - cheb / centerI;
        for (const cell of cells) {
          const inset = rngBlocks.float(0.4, 1.8);
          const w = round2(cell.w - inset * 2);
          const d = round2(cell.d - inset * 2);
          if (w < 8 || d < 8) continue; // cell too small to build on
          const height = Math.round(
            Math.min(64, Math.max(8, rngBlocks.float(8, 20) + downtown * rngBlocks.float(6, 44)))
          );
          buildings.push({
            x: round2(cell.x),
            z: round2(cell.z),
            w,
            d,
            height,
            color: rngBlocks.pick(BUILDING_PALETTE),
          });
        }
      } else if (type === 'tower') {
        buildings.push({
          x: cx,
          z: cz,
          w: TOWER_FOOTPRINT_M,
          d: TOWER_FOOTPRINT_M,
          height: TOWER_HEIGHT_M,
          color: TOWER_COLOR,
        });
      } // park blocks stay clear of buildings

      blocks.push({
        ix,
        iz,
        index: ix + iz * GRID_N,
        x: cx,
        z: cz,
        type,
        innerX: cx,
        innerZ: cz,
        innerW: innerHalf * 2,
        innerD: innerHalf * 2,
        surfaceY: CURB_M,
        sidewalkRects: buildSidewalks(cx, cz),
        buildings,
      });
    }
  }

  // --- street props along the sidewalks ------------------------------------
  // Per block, four slots per side at fixed tangential offsets (kept away
  // from corners), inset to the middle of the sidewalk. ~30% of slots stay
  // empty and the rest split lamps/trees — enough furniture to pace the
  // streets without flooding the instance budget (task 2.2).
  const PROP_OFFSETS = [-19.5, -6.5, 6.5, 19.5];
  const half = BLOCK_M / 2;
  const inset = SIDEWALK_M / 2;
  /** @type {CityProp[]} */
  const props = [];
  for (const block of blocks) {
    const sides = [
      { x: block.x - half + inset, z: block.z, alongX: false }, // west
      { x: block.x + half - inset, z: block.z, alongX: false }, // east
      { x: block.x, z: block.z - half + inset, alongX: true }, // north
      { x: block.x, z: block.z + half - inset, alongX: true }, // south
    ];
    for (const side of sides) {
      for (const off of PROP_OFFSETS) {
        if (rngProps.chance(0.28)) continue; // leave a gap
        const x = round2(side.alongX ? side.x + off : side.x);
        const z = round2(side.alongX ? side.z : side.z + off);
        if (rngProps.chance(0.34)) {
          props.push({
            kind: 'lamp',
            source: 'street',
            x,
            z,
            y: CURB_M,
            height: LAMP_HEIGHT_M,
            collisionRadius: LAMP_COLLISION_RADIUS_M,
            blockIx: block.ix,
            blockIz: block.iz,
          });
        } else {
          const trunkHeight = round2(rngProps.float(1.8, 2.6));
          const canopyRadius = round2(rngProps.float(1.8, 3.0));
          props.push({
            kind: 'tree',
            source: 'street',
            x,
            z,
            y: CURB_M,
            height: round2(trunkHeight + canopyRadius * 1.8),
            collisionRadius: TREE_COLLISION_RADIUS_M,
            blockIx: block.ix,
            blockIz: block.iz,
            canopyRadius,
            trunkHeight,
            canopyColor: rngProps.pick(TREE_PALETTE),
          });
        }
      }
    }
  }

  // --- park set piece (paths + trees) --------------------------------------
  const parkBlock = blocks[parkIx + parkIz * GRID_N];
  const parkPathRects = [
    { x: parkBlock.x, z: parkBlock.z, w: parkBlock.innerW, d: PARK_PATH_M },
    { x: parkBlock.x, z: parkBlock.z, w: PARK_PATH_M, d: parkBlock.innerD },
  ];
  const parkPropIndices = [];
  const treeCount = rngPark.int(9, 14);
  /** @type {{x: number, z: number}[]} */
  const placed = [];
  for (let i = 0; i < treeCount; i += 1) {
    // Rejection-sample a lawn spot clear of the crossing paths and spread
    // from already-placed trees; the retry cap keeps the draw count fixed.
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      x = round2(rngPark.float(parkBlock.innerX - innerHalf + 2, parkBlock.innerX + innerHalf - 2));
      z = round2(rngPark.float(parkBlock.innerZ - innerHalf + 2, parkBlock.innerZ + innerHalf - 2));
      const offPath = Math.abs(x - parkBlock.x) > PARK_PATH_M || Math.abs(z - parkBlock.z) > PARK_PATH_M;
      const spread = placed.every((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) >= 25);
      if (offPath && spread) break;
    }
    placed.push({ x, z });
    const trunkHeight = round2(rngPark.float(2.0, 3.0));
    const canopyRadius = round2(rngPark.float(2.2, 3.4));
    parkPropIndices.push(props.length);
    props.push({
      kind: 'tree',
      source: 'park',
      x,
      z,
      y: CURB_M,
      height: round2(trunkHeight + canopyRadius * 1.8),
      collisionRadius: TREE_COLLISION_RADIUS_M,
      blockIx: parkBlock.ix,
      blockIz: parkBlock.iz,
      canopyRadius,
      trunkHeight,
      canopyColor: rngPark.pick(TREE_PALETTE),
    });
  }

  // --- tower landmark detail ----------------------------------------------
  const towerBlock = blocks[towerIx + towerIz * GRID_N];
  const landmark = {
    kind: 'tower',
    blockIndex: towerBlock.index,
    ix: towerBlock.ix,
    iz: towerBlock.iz,
    x: towerBlock.x,
    z: towerBlock.z,
    buildingIndex: 0,
    height: TOWER_HEIGHT_M,
    spireHeight: TOWER_SPIRE_HEIGHT_M,
    spireRadius: TOWER_SPIRE_RADIUS_M,
    color: TOWER_COLOR,
    accentColor: rngLandmark.pick(ACCENT_PALETTE),
  };

  // --- summary counts -------------------------------------------------------
  const counts = {
    blocks: blocks.length,
    buildings: blocks.reduce((sum, b) => sum + b.buildings.length, 0),
    props: props.length,
    lamps: props.filter((p) => p.kind === 'lamp').length,
    trees: props.filter((p) => p.kind === 'tree').length,
  };

  return {
    version: CITY_GEN_VERSION,
    seed: seedStr,
    seedHash,
    world: {
      minX: -halfSize,
      maxX: halfSize,
      minZ: -halfSize,
      maxZ: halfSize,
      halfSizeM: halfSize,
      sizeM: halfSize * 2,
      roadSpanM: roadSpan,
      groundY: 0,
    },
    grid: {
      n: GRID_N,
      blockM: BLOCK_M,
      roadM: ROAD_M,
      pitchM: PITCH_M,
      sidewalkM: SIDEWALK_M,
      curbM: CURB_M,
      laneOffsetM: LANE_OFFSET_M,
      linesX,
      linesZ,
    },
    park: {
      blockIndex: parkBlock.index,
      ix: parkBlock.ix,
      iz: parkBlock.iz,
      x: parkBlock.x,
      z: parkBlock.z,
      lawnY: CURB_M,
      lawnColor: PARK_LAWN_COLOR,
      pathColor: PARK_PATH_COLOR,
      pathRects: parkPathRects,
      propIndices: parkPropIndices,
    },
    landmark,
    blocks,
    props,
    counts,
  };
}
