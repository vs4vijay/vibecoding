/**
 * City view builder — layout data to three.js meshes (Midtown Blitz game,
 * task 2.2).
 *
 * Consumes the pure-data layout from `src/game/city-gen.js` and builds the
 * whole visible city under one THREE.Group with a hard draw-call budget:
 * every repeated archetype is a single InstancedMesh with per-instance
 * matrices (unit geometry scaled into place — design Decision 5 boxes
 * only) and, where the archetype is colored per instance (buildings,
 * sidewalk/lot slabs, tree canopies), an `instanceColor` buffer — one
 * material per archetype, per design Decision 6. The city stays at ~10
 * draw calls regardless of the thousands of instances behind them.
 *
 * Pieces:
 *  - one ground plane (the asphalt — roads are the space between the
 *    raised block slabs) and one instanced mesh holding every lane
 *    marking: dashed center lines that skip intersections plus solid
 *    curb-edge lines along every block face,
 *  - one instanced mesh of raised slabs: the 4 sidewalk strips per block
 *    (curbs included — the slab side face is the curb), every built
 *    block's interior lot slab, the park lawn and its crossing paths
 *    (per-instance color tints lots/lawn/paths differently from walks),
 *  - instanced buildings with per-instance facade colors; the landmark
 *    tower's shaft is included so render and collision consumers can treat
 *    it uniformly, plus a dedicated spire + crown band for the landmark
 *    silhouette (its accent color comes from the layout),
 *  - instanced lamp poles + heads and tree trunks + canopies (canopy
 *    colors per instance),
 *  - daytime lighting: a hemisphere sky fill and one directional sun with
 *    a fixed city-sized shadow frustum. `applyTier()` reads the engine
 *    QUALITY_TIERS table and gates `sun.castShadow` (high tier only) plus
 *    the shadow map size; the renderer-level `shadowMap.enabled` flag and
 *    the material refresh on flips stay the engine's job (renderer.js), so
 *    the cast/receive flags set here simply light up at high tier.
 *
 * Sky + fog: this module exports {@link CITY_SKY_COLOR}; the app sets it
 * as both scene background and fog color so distance fog fades geometry
 * into exactly the sky, with near/far per tier copied in by the engine's
 * `applyTierFog` (never duplicated here).
 *
 * The city is static, so the handle has no update() — nothing runs per
 * frame and there are no allocations in any hot path. `dispose()` releases
 * every geometry/material created here (idempotent), and `stats` reports
 * the draw-call estimate and instance counts for the ?debug panel and the
 * plain-node harness (`scripts/city-view-test.mjs` constructs the real
 * meshes headless — no WebGL involved).
 */

import * as THREE from 'three';
import { QUALITY_TIERS, resolveTierName } from '../engine/renderer.js';

/**
 * Daytime sky color: the scene background AND fog color (geometry fades
 * into exactly the sky at the horizon — city-world spec "Sky, lighting,
 * and atmosphere").
 */
export const CITY_SKY_COLOR = 0x9fc0d8;

/** Ground/asphalt color (roads are the ground between raised slabs). */
const GROUND_COLOR = 0x39404a;
/** Lane-marking paint color (slightly warm white). */
const MARKING_COLOR = 0xd8d3c2;
/** Sidewalk strip color. */
const SIDEWALK_COLOR = 0x9ba1a8;
/** Interior lot slab color (darker than walks so blocks read from above). */
const LOT_COLOR = 0x74797f;
/** Lamp pole color. */
const LAMP_POLE_COLOR = 0x49505a;
/** Lamp head (lantern) color. */
const LAMP_HEAD_COLOR = 0xf0e3b8;
/** Tree trunk color (canopies are per-instance from the layout palette). */
const TRUNK_COLOR = 0x6a4e33;

// --- lane marking layout -----------------------------------------------------

/** Center-line dash length (m) along the road. */
const DASH_LENGTH_M = 3;
/** Dash period: one painted dash + one gap (m). */
const DASH_PERIOD_M = 6;
/** Dash width across the road (m). */
const DASH_WIDTH_M = 0.35;
/** Solid curb-edge line width (m). */
const EDGE_WIDTH_M = 0.3;
/** Edge line inset from the asphalt edge (m). */
const EDGE_INSET_M = 0.45;
/** Marking slab thickness (m). */
const MARKING_HEIGHT_M = 0.05;
/** Marking bottoms sit this far above the asphalt (no z-fighting). */
const MARKING_LIFT_M = 0.01;
/** Extra radius around crossings kept free of dashes (m). */
const INTERSECTION_CLEAR_M = 1.5;

/** Park path slab thickness (m) — sits on top of the lawn slab. */
const PATH_HEIGHT_M = 0.06;

/** Shadow frustum half-extent (m) around the city center (high tier). */
const SHADOW_HALF_EXTENT_M = 280;

// Scratch objects reused across every instance write (build time only).
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion(); // identity — everything is axis-aligned
const _scl = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * One marking slab placement on the unit box.
 *
 * @typedef {object} MarkingDef
 * @property {number} px Center x (m).
 * @property {number} pz Center z (m).
 * @property {number} sx Scale along x (m).
 * @property {number} sz Scale along z (m).
 */

/**
 * Collect every lane marking: dashed center lines per road (skipping a
 * clear zone around each crossing) plus solid curb-edge lines per block
 * face, for both road axes. Deterministic — pure function of the grid.
 * @param {import('./city-gen.js').CityLayout['grid']} grid Road grid data.
 * @returns {MarkingDef[]} Marking placements for the unit-box instancing.
 */
function collectMarkings(grid) {
  const markings = [];
  const clear = grid.roadM / 2 + INTERSECTION_CLEAR_M;
  const dashHalf = DASH_LENGTH_M / 2;

  /**
   * Add markings for one road line.
   * @param {number} line Centerline coordinate on the fixed axis.
   * @param {number[]} crossings Crossing centerline coordinates along the
   *   travel axis (ascending).
   * @param {boolean} alongX True if this road runs along x (z fixed).
   * @returns {void}
   */
  function addLine(line, crossings, alongX) {
    const end = crossings[crossings.length - 1];
    let crossIx = 0;
    for (let s = crossings[0]; s + DASH_LENGTH_M <= end + 1e-6; s += DASH_PERIOD_M) {
      const center = s + dashHalf;
      while (crossIx < crossings.length && crossings[crossIx] < center - clear) {
        crossIx += 1;
      }
      const next = crossIx < crossings.length ? Math.abs(crossings[crossIx] - center) : Infinity;
      const prev = crossIx > 0 ? Math.abs(crossings[crossIx - 1] - center) : Infinity;
      if (Math.min(next, prev) < clear) continue; // keep intersections clear
      markings.push(
        alongX
          ? { px: center, pz: line, sx: DASH_LENGTH_M, sz: DASH_WIDTH_M }
          : { px: line, pz: center, sx: DASH_WIDTH_M, sz: DASH_LENGTH_M }
      );
    }
    // Solid edge lines: one pair per block face between adjacent crossings.
    const edgeOffset = grid.roadM / 2 - EDGE_INSET_M;
    for (let i = 0; i < crossings.length - 1; i += 1) {
      const a = crossings[i] + grid.roadM / 2;
      const b = crossings[i + 1] - grid.roadM / 2;
      const len = b - a;
      if (len < 4) continue;
      const mid = (a + b) / 2;
      for (const side of [-1, 1]) {
        const off = line + side * edgeOffset;
        markings.push(
          alongX
            ? { px: mid, pz: off, sx: len, sz: EDGE_WIDTH_M }
            : { px: off, pz: mid, sx: EDGE_WIDTH_M, sz: len }
        );
      }
    }
  }

  for (const lx of grid.linesX) addLine(lx, grid.linesZ, false); // N-S roads
  for (const lz of grid.linesZ) addLine(lz, grid.linesX, true); // E-W roads
  return markings;
}

/**
 * One raised slab placement (unit box scaled into place) with its
 * per-instance color.
 *
 * @typedef {object} SlabDef
 * @property {number} x Center x (m).
 * @property {number} z Center z (m).
 * @property {number} w Full width along x (m).
 * @property {number} d Full depth along z (m).
 * @property {number} topY Top surface elevation (m).
 * @property {number} h Slab thickness (m).
 * @property {number} color Instance color (hex number).
 */

/**
 * Collect the raised slabs in a fixed deterministic order: per block its 4
 * sidewalk strips then its interior slab (a lot for built blocks, the lawn
 * for the park block), then the park's crossing paths appended last. The
 * harness spot-checks instance colors against this exact order.
 * @param {import('./city-gen.js').CityLayout} layout City layout data.
 * @returns {SlabDef[]} Slab placements for the unit-box instancing.
 */
function collectSlabs(layout) {
  /** @type {SlabDef[]} */
  const slabs = [];
  for (const block of layout.blocks) {
    for (const r of block.sidewalkRects) {
      slabs.push({
        x: r.x,
        z: r.z,
        w: r.w,
        d: r.d,
        topY: r.y,
        h: r.curbHeight,
        color: SIDEWALK_COLOR,
      });
    }
    if (block.type === 'park') {
      slabs.push({
        x: block.innerX,
        z: block.innerZ,
        w: block.innerW,
        d: block.innerD,
        topY: layout.park.lawnY,
        h: layout.park.lawnY,
        color: layout.park.lawnColor,
      });
    } else {
      slabs.push({
        x: block.innerX,
        z: block.innerZ,
        w: block.innerW,
        d: block.innerD,
        topY: block.surfaceY,
        h: block.surfaceY,
        color: LOT_COLOR,
      });
    }
  }
  for (const p of layout.park.pathRects) {
    slabs.push({
      x: p.x,
      z: p.z,
      w: p.w,
      d: p.d,
      topY: layout.park.lawnY + PATH_HEIGHT_M,
      h: PATH_HEIGHT_M,
      color: layout.park.pathColor,
    });
  }
  return slabs;
}

/**
 * Flatten every building across all blocks in traversal order (the order
 * the harness replays for color spot-checks), carrying each block's
 * surface elevation so bases start on their block surface.
 * @param {import('./city-gen.js').CityLayout} layout City layout data.
 * @returns {Array<{x: number, z: number, w: number, d: number, height: number, color: number, surfaceY: number}>}
 */
function flattenBuildings(layout) {
  const out = [];
  for (const block of layout.blocks) {
    for (const b of block.buildings) {
      out.push({
        x: b.x,
        z: b.z,
        w: b.w,
        d: b.d,
        height: b.height,
        color: b.color,
        surfaceY: block.surfaceY,
      });
    }
  }
  return out;
}

/**
 * Handle for the built city view.
 *
 * @typedef {object} CityView
 * @property {THREE.Group} group Root holding every city mesh + lights —
 *   add to the scene once. The city is static, so there is deliberately no
 *   update() (no per-frame work, no allocations).
 * @property {(tierName: string) => object} applyTier Adopt a quality
 *   tier's shadow wiring: sun castShadow (high tier only) and shadow map
 *   size from the engine QUALITY_TIERS table. Fog near/far and the camera
 *   far plane stay the app's job (gfx.applyTierFog). Returns the tier.
 * @property {() => void} dispose Release every geometry and material this
 *   view created (and the instanced buffers). Safe to call more than once.
 * @property {object} stats Diagnostics (also asserted by the harness).
 * @property {number} stats.drawCallsEstimate Visible mesh count == worst
 *   case draw calls for the whole city (~10 — instancing keeps this
 *   independent of the instance counts).
 * @property {object} stats.instances Per-archetype instance counts.
 * @property {number} stats.instances.markings Lane marking slabs.
 * @property {number} stats.instances.sidewalks Raised slabs (walks + lots
 *   + lawn + paths).
 * @property {number} stats.instances.buildings Building boxes.
 * @property {number} stats.instances.lampPoles Lamp poles.
 * @property {number} stats.instances.lampHeads Lamp heads.
 * @property {number} stats.instances.treeTrunks Tree trunks.
 * @property {number} stats.instances.treeCanopies Tree canopies.
 * @property {object} stats.layout The generating layout's counts summary.
 */

/**
 * Build the full city view from a generated layout. Pure construction over
 * the layout data — no DOM, no renderer, runnable headless in node.
 *
 * @param {import('./city-gen.js').CityLayout} layout City layout from
 *   `generateCity()`.
 * @returns {CityView} The city view handle.
 * @throws {TypeError} If the layout is missing required sections.
 */
export function createCityView(layout) {
  if (!layout || !layout.world || !layout.grid || !layout.blocks || !layout.props) {
    throw new TypeError('createCityView: expected a CityLayout from generateCity()');
  }

  const group = new THREE.Group();
  group.name = 'city';
  /** @type {THREE.Mesh[]} Visible meshes == draw-call budget. */
  const meshes = [];

  /**
   * Create an InstancedMesh, register it for draw-call bookkeeping.
   * @param {string} name Debug/harness name.
   * @param {THREE.BufferGeometry} geometry Unit geometry to instance.
   * @param {THREE.Material} material The archetype's single material.
   * @param {number} count Instance count (exact).
   * @returns {THREE.InstancedMesh} The mesh (cast/receive shadows on).
   */
  function makeInstanced(name, geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  /**
   * Finish an instanced mesh after its matrices/colors are filled: flag
   * the buffers for upload and compute the bounding sphere the frustum
   * culler (and the harness) reads.
   * @param {THREE.InstancedMesh} mesh Mesh to finalize.
   * @returns {void}
   */
  function finalizeInstanced(mesh) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  // --- ground (the asphalt: roads + the apron under everything) ------------
  const groundGeo = new THREE.PlaneGeometry(layout.world.sizeM, layout.world.sizeM);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ color: GROUND_COLOR })
  );
  ground.name = 'city-ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.geometry.computeBoundingSphere();
  group.add(ground);
  meshes.push(ground);

  // --- lane markings (one instanced mesh for dashes + edge lines) ----------
  const markingDefs = collectMarkings(layout.grid);
  const markings = makeInstanced(
    'city-markings',
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: MARKING_COLOR }),
    markingDefs.length
  );
  markings.castShadow = false; // flat paint: receives shadows, casts none
  for (let i = 0; i < markingDefs.length; i += 1) {
    const m = markingDefs[i];
    _pos.set(m.px, MARKING_LIFT_M + MARKING_HEIGHT_M / 2, m.pz);
    _scl.set(m.sx, MARKING_HEIGHT_M, m.sz);
    _matrix.compose(_pos, _quat, _scl);
    markings.setMatrixAt(i, _matrix);
  }
  finalizeInstanced(markings);

  // --- raised slabs: sidewalks + lots + park lawn/paths ---------------------
  const slabDefs = collectSlabs(layout);
  const slabs = makeInstanced(
    'city-sidewalks',
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), // color per instance
    slabDefs.length
  );
  for (let i = 0; i < slabDefs.length; i += 1) {
    const s = slabDefs[i];
    _pos.set(s.x, s.topY - s.h / 2, s.z);
    _scl.set(s.w, s.h, s.d);
    _matrix.compose(_pos, _quat, _scl);
    slabs.setMatrixAt(i, _matrix);
    slabs.setColorAt(i, _color.setHex(s.color));
  }
  finalizeInstanced(slabs);

  // --- buildings (per-instance facade color; includes the tower shaft) -----
  const buildingDefs = flattenBuildings(layout);
  const buildings = makeInstanced(
    'city-buildings',
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), // color per instance
    buildingDefs.length
  );
  for (let i = 0; i < buildingDefs.length; i += 1) {
    const b = buildingDefs[i];
    _pos.set(b.x, b.surfaceY + b.height / 2, b.z);
    _scl.set(b.w, b.height, b.d);
    _matrix.compose(_pos, _quat, _scl);
    buildings.setMatrixAt(i, _matrix);
    buildings.setColorAt(i, _color.setHex(b.color));
  }
  finalizeInstanced(buildings);

  // --- street props: lamps and trees (4 instanced meshes total) -------------
  const lamps = layout.props.filter((p) => p.kind === 'lamp');
  const trees = layout.props.filter((p) => p.kind === 'tree');

  const lampPoles = makeInstanced(
    'city-lamp-poles',
    new THREE.CylinderGeometry(0.07, 0.11, 1, 5),
    new THREE.MeshLambertMaterial({ color: LAMP_POLE_COLOR }),
    lamps.length
  );
  const lampHeads = makeInstanced(
    'city-lamp-heads',
    new THREE.BoxGeometry(0.85, 0.24, 0.5),
    new THREE.MeshLambertMaterial({ color: LAMP_HEAD_COLOR }),
    lamps.length
  );
  for (let i = 0; i < lamps.length; i += 1) {
    const p = lamps[i];
    _pos.set(p.x, p.y + p.height / 2, p.z);
    _scl.set(1, p.height, 1);
    _matrix.compose(_pos, _quat, _scl);
    lampPoles.setMatrixAt(i, _matrix);
    _pos.set(p.x, p.y + p.height + 0.06, p.z);
    _scl.set(1, 1, 1);
    _matrix.compose(_pos, _quat, _scl);
    lampHeads.setMatrixAt(i, _matrix);
  }
  finalizeInstanced(lampPoles);
  finalizeInstanced(lampHeads);

  const treeTrunks = makeInstanced(
    'city-tree-trunks',
    new THREE.CylinderGeometry(0.13, 0.19, 1, 5),
    new THREE.MeshLambertMaterial({ color: TRUNK_COLOR }),
    trees.length
  );
  const treeCanopies = makeInstanced(
    'city-tree-canopies',
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), // color per instance
    trees.length
  );
  for (let i = 0; i < trees.length; i += 1) {
    const p = trees[i];
    const trunk = p.trunkHeight ?? 2;
    const radius = p.canopyRadius ?? 2;
    _pos.set(p.x, p.y + trunk / 2, p.z);
    _scl.set(1, trunk, 1);
    _matrix.compose(_pos, _quat, _scl);
    treeTrunks.setMatrixAt(i, _matrix);
    _pos.set(p.x, p.y + trunk + radius * 0.72, p.z);
    _scl.set(radius * 1.2, radius, radius * 1.2);
    _matrix.compose(_pos, _quat, _scl);
    treeCanopies.setMatrixAt(i, _matrix);
    treeCanopies.setColorAt(i, _color.setHex(p.canopyColor ?? 0x4f7a3a));
  }
  finalizeInstanced(treeTrunks);
  finalizeInstanced(treeCanopies);

  // --- landmark tower silhouette: spire + crown band ------------------------
  // (The 150 m shaft itself is the tower block's building in the instanced
  // mesh above, with the landmark shaft color; these two meshes add the
  // distinctive top so the tower reads from anywhere in the city.)
  const lm = layout.landmark;
  const towerBlock = layout.blocks[lm.blockIndex];
  const towerB = towerBlock.buildings[lm.buildingIndex];

  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(lm.spireRadius, lm.spireHeight, 6),
    new THREE.MeshLambertMaterial({ color: lm.accentColor })
  );
  spire.name = 'city-tower-spire';
  spire.position.set(lm.x, towerBlock.surfaceY + lm.height + lm.spireHeight / 2, lm.z);
  spire.castShadow = true;
  group.add(spire);
  meshes.push(spire);

  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(towerB.w + 0.9, 1.6, towerB.d + 0.9),
    new THREE.MeshLambertMaterial({ color: lm.accentColor })
  );
  crown.name = 'city-tower-band';
  crown.position.set(lm.x, towerBlock.surfaceY + towerB.height - 1.8, lm.z);
  crown.castShadow = true;
  group.add(crown);
  meshes.push(crown);

  // --- daytime lighting: hemisphere fill + directional sun ------------------
  const hemi = new THREE.HemisphereLight(0xd6e6f4, 0x4a4436, 1.05);
  hemi.name = 'city-sky-fill';

  const sun = new THREE.DirectionalLight(0xfff1d4, 2.4);
  sun.name = 'city-sun';
  sun.position.set(170, 235, 115);
  sun.castShadow = false; // tier-gated; applyTier() adopts the engine table
  sun.shadow.camera.left = -SHADOW_HALF_EXTENT_M;
  sun.shadow.camera.right = SHADOW_HALF_EXTENT_M;
  sun.shadow.camera.top = SHADOW_HALF_EXTENT_M;
  sun.shadow.camera.bottom = -SHADOW_HALF_EXTENT_M;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 760;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  group.add(hemi, sun, sun.target);

  // --- bookkeeping + handles -------------------------------------------------

  let disposed = false;

  /**
   * Adopt a quality tier's shadow wiring (see {@link CityView.applyTier}).
   * @param {string} tierName 'low' | 'medium' | 'high'.
   * @returns {object} The applied tier definition.
   */
  function applyTier(tierName) {
    const tier = QUALITY_TIERS[resolveTierName(tierName)];
    sun.castShadow = tier.shadows;
    if (sun.shadow.mapSize.x !== tier.shadowMapSize || !tier.shadows) {
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null; // force reallocation at the new size/flag
      }
      sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
    }
    return tier;
  }

  /**
   * Release every geometry/material/instance buffer this view created
   * (see {@link CityView.dispose}).
   * @returns {void}
   */
  function dispose() {
    if (disposed) return;
    disposed = true;
    const materials = new Set();
    group.traverse((obj) => {
      if (obj.isInstancedMesh) obj.dispose(); // frees the instance buffers
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) materials.add(obj.material);
    });
    for (const material of materials) material.dispose();
    if (group.parent) group.parent.remove(group);
  }

  return {
    group,
    applyTier,
    dispose,
    stats: {
      drawCallsEstimate: meshes.length,
      instances: {
        markings: markingDefs.length,
        sidewalks: slabDefs.length,
        buildings: buildingDefs.length,
        lampPoles: lamps.length,
        lampHeads: lamps.length,
        treeTrunks: trees.length,
        treeCanopies: trees.length,
      },
      layout: { ...layout.counts },
    },
  };
}
