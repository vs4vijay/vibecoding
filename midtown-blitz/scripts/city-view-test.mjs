#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/city-view.js (task 2.2).
 *
 * Builds the real city view meshes headless (plain node + the real three
 * classes — geometry/InstancedMesh construction needs no WebGL) from the
 * real generated layout and checks:
 *
 *   1. Shape — the handle exposes group/applyTier/dispose/stats; every
 *      instanced archetype is present by name; stats.drawCallsEstimate
 *      matches the mesh count and stays far under the ~50-draw-call budget.
 *   2. Instance counts — buildings == layout counts.buildings, lamp
 *      poles/heads == counts.lamps, tree trunks/canopies == counts.trees,
 *      sidewalk/lot/lawn/path slabs == 4 strips + 1 interior per block +
 *      the park paths, markings run along both axes in a sane count.
 *   3. Per-instance colors — instanceColor buffers exist where expected
 *      (buildings, slabs, canopies), spot-checked against the layout data
 *      in traversal order (facades, canopies, park lawn + paths), and two
 *      independent builds produce byte-identical matrix + color buffers
 *      (determinism) plus identical stats.
 *   4. Matrices + bounds — every instanceMatrix is NaN-free; every
 *      instanced mesh has a finite bounding sphere whose center sits
 *      inside the world extents and whose radius covers the city
 *      (>= world.halfSizeM for the city-spanning meshes; the ground plane
 *      covers the full extent too).
 *   5. Lighting + tiers — hemisphere fill + directional sun present; the
 *      sun starts castShadow=false, applyTier('high') turns shadows on at
 *      the tier's map size, applyTier('low') turns them off; the shadow
 *      frustum covers the city core; shadow flags are pre-wired on meshes
 *      so the high tier needs no rebuild.
 *   6. Dispose — every geometry and material created by the view fires its
 *      dispose event exactly once on dispose(), and a second dispose() is
 *      a safe no-op.
 *
 * Run: node scripts/city-view-test.mjs   (plain node, no dependencies beyond three)
 */
import * as THREE from 'three';

import { generateCity } from '../src/game/city-gen.js';
import { createCityView } from '../src/game/city-view.js';
import { QUALITY_TIERS } from '../src/engine/renderer.js';

let checks = 0;
let failed = 0;

/**
 * Record a single assertion.
 * @param {boolean} cond Condition to assert.
 * @param {string} label Human-readable assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function check(cond, label) {
  checks += 1;
  if (!cond) {
    failed += 1;
    console.log(`    FAIL ${label}`);
  }
  return cond;
}

/**
 * Collect the view's instanced meshes by name and its total mesh count.
 * @param {import('../src/game/city-view.js').CityView} view City view handle.
 * @returns {{ byName: Record<string, THREE.InstancedMesh>, meshCount: number }}
 */
function catalog(view) {
  const byName = {};
  let meshCount = 0;
  view.group.traverse((obj) => {
    if (obj.isMesh || obj.isInstancedMesh) {
      meshCount += 1;
      if (obj.name) byName[obj.name] = obj;
    }
  });
  return { byName, meshCount };
}

/**
 * Snapshot every instanced mesh's buffers for a determinism comparison.
 * @param {import('../src/game/city-view.js').CityView} view City view handle.
 * @returns {Record<string, {count: number, matrices: Float32Array, colors: Float32Array | null}>}
 */
function snapshot(view) {
  const snap = {};
  view.group.traverse((obj) => {
    if (!obj.isInstancedMesh) return;
    snap[obj.name] = {
      count: obj.count,
      matrices: obj.instanceMatrix.array.slice(),
      colors: obj.instanceColor ? obj.instanceColor.array.slice() : null,
    };
  });
  return snap;
}

console.log('city-view-test: city view construction verification\n');

// --- shared fixture + a second build for determinism -------------------------
const layout = generateCity();
const view = createCityView(layout);
const layoutB = generateCity();
const viewB = createCityView(layoutB);
const { byName, meshCount } = catalog(view);
const { world, grid, blocks, props, park, counts } = layout;

// --- 1. Handle shape + budget -------------------------------------------------
{
  console.log('  handle shape + draw-call budget');
  check(typeof view === 'object' && view.group.isObject3D, 'createCityView returns a handle with a THREE.Group');
  check(view.group.name === 'city', 'the city group is named "city"');
  check(typeof view.applyTier === 'function' && typeof view.dispose === 'function', 'handle exposes applyTier() and dispose()');
  check(view.stats && typeof view.stats.drawCallsEstimate === 'number', 'stats.drawCallsEstimate is exposed');
  check(view.stats.drawCallsEstimate === meshCount, `stats.drawCallsEstimate matches the mesh count (${meshCount})`);
  check(meshCount <= 50, `whole city stays under the ~50 draw-call budget (${meshCount} meshes)`);
  for (const name of [
    'city-ground',
    'city-markings',
    'city-sidewalks',
    'city-buildings',
    'city-lamp-poles',
    'city-lamp-heads',
    'city-tree-trunks',
    'city-tree-canopies',
  ]) {
    check(Boolean(byName[name]), `archetype mesh "${name}" exists`);
  }
  let spire = null;
  let crown = null;
  view.group.traverse((obj) => {
    if (obj.name === 'city-tower-spire') spire = obj;
    if (obj.name === 'city-tower-band') crown = obj;
  });
  check(Boolean(spire && crown), 'landmark tower spire + crown band meshes exist');
}

// --- 2. Instance counts vs the layout data ------------------------------------
{
  console.log('  instance counts per archetype');
  check(byName['city-buildings'].count === counts.buildings, `buildings == counts.buildings (${counts.buildings})`);
  check(byName['city-lamp-poles'].count === counts.lamps, `lamp poles == counts.lamps (${counts.lamps})`);
  check(byName['city-lamp-heads'].count === counts.lamps, `lamp heads == counts.lamps (${counts.lamps})`);
  check(byName['city-tree-trunks'].count === counts.trees, `tree trunks == counts.trees (${counts.trees})`);
  check(byName['city-tree-canopies'].count === counts.trees, `tree canopies == counts.trees (${counts.trees})`);
  const expectedSlabs = blocks.length * 5 + park.pathRects.length; // 4 walks + 1 lot/lawn per block, paths last
  check(byName['city-sidewalks'].count === expectedSlabs, `slab count == 4 walks + 1 lot/lawn per block + paths (${expectedSlabs})`);
  const markings = byName['city-markings'];
  check(markings.count >= 1500 && markings.count <= 4000, `marking count in a sane band (${markings.count})`);
  check(view.stats.instances.markings === markings.count, 'stats.instances matches the markings mesh');
  // Both road axes carry markings (matrix basis vectors: exx vs ezz scale).
  let alongX = 0;
  let alongZ = 0;
  const marr = markings.instanceMatrix.array;
  for (let i = 0; i < markings.count; i += 1) {
    if (marr[i * 16] > marr[i * 16 + 10]) alongX += 1;
    else alongZ += 1;
  }
  check(alongX > 0 && alongZ > 0, `markings run along both axes (${alongX} x-running, ${alongZ} z-running)`);
}

// --- 3. Per-instance colors + determinism -------------------------------------
{
  console.log('  per-instance colors + determinism');
  const buildings = byName['city-buildings'];
  check(Boolean(buildings.instanceColor), 'buildings mesh has an instanceColor buffer');
  check(buildings.instanceColor.array.length === buildings.count * 3, 'building color buffer holds rgb per instance');

  const expectedColors = [];
  for (const block of blocks) for (const b of block.buildings) expectedColors.push(b.color);
  let colorSpotOk = true;
  for (const i of [0, Math.floor(buildings.count / 2), buildings.count - 1]) {
    const want = new THREE.Color().setHex(expectedColors[i]);
    const gotR = buildings.instanceColor.array[i * 3];
    const gotG = buildings.instanceColor.array[i * 3 + 1];
    const gotB = buildings.instanceColor.array[i * 3 + 2];
    if (Math.abs(gotR - want.r) > 1e-4 || Math.abs(gotG - want.g) > 1e-4 || Math.abs(gotB - want.b) > 1e-4) {
      colorSpotOk = false;
    }
  }
  check(colorSpotOk, 'building facade colors match the layout palette (spot checks at 0/mid/last)');

  const trees = props.filter((p) => p.kind === 'tree');
  const canopies = byName['city-tree-canopies'];
  check(Boolean(canopies.instanceColor), 'tree canopy mesh has an instanceColor buffer');
  let canopyOk = true;
  for (const i of [0, Math.floor(canopies.count / 2), canopies.count - 1]) {
    const want = new THREE.Color().setHex(trees[i].canopyColor);
    const gotR = canopies.instanceColor.array[i * 3];
    const gotG = canopies.instanceColor.array[i * 3 + 1];
    const gotB = canopies.instanceColor.array[i * 3 + 2];
    if (Math.abs(gotR - want.r) > 1e-4 || Math.abs(gotG - want.g) > 1e-4 || Math.abs(gotB - want.b) > 1e-4) {
      canopyOk = false;
    }
  }
  check(canopyOk, 'tree canopy colors match the layout palette (spot checks)');

  // Slabs fill 5-per-block in block order (4 walks then the interior
  // slab), so the park block's lawn instance is at blockIndex*5 + 4; the
  // park paths are appended last.
  const slabs = byName['city-sidewalks'];
  check(Boolean(slabs.instanceColor), 'slab mesh has an instanceColor buffer');
  const lawnIx = park.blockIndex * 5 + 4;
  const wantLawn = new THREE.Color().setHex(park.lawnColor);
  const lawn = slabs.instanceColor.array;
  check(
    Math.abs(lawn[lawnIx * 3] - wantLawn.r) < 1e-4 &&
      Math.abs(lawn[lawnIx * 3 + 1] - wantLawn.g) < 1e-4 &&
      Math.abs(lawn[lawnIx * 3 + 2] - wantLawn.b) < 1e-4,
    'park lawn slab is lawn-colored (per-instance color, not material gray)'
  );
  const wantPath = new THREE.Color().setHex(park.pathColor);
  const pathIx = slabs.count - park.pathRects.length;
  let pathOk = true;
  for (let k = 0; k < park.pathRects.length; k += 1) {
    const base = (pathIx + k) * 3;
    if (
      Math.abs(lawn[base] - wantPath.r) > 1e-4 ||
      Math.abs(lawn[base + 1] - wantPath.g) > 1e-4 ||
      Math.abs(lawn[base + 2] - wantPath.b) > 1e-4
    ) {
      pathOk = false;
    }
  }
  check(pathOk, 'park path slabs are path-colored');

  // Determinism: two independent builds are byte-identical and stats match.
  const snapA = snapshot(view);
  const snapB = snapshot(viewB);
  let identical = Object.keys(snapA).length === Object.keys(snapB).length;
  for (const [name, a] of Object.entries(snapA)) {
    const b = snapB[name];
    if (!b || a.count !== b.count) identical = false;
    for (let i = 0; i < a.matrices.length && identical; i += 1) {
      if (a.matrices[i] !== b.matrices[i]) identical = false;
    }
    if (a.colors && b.colors) {
      for (let i = 0; i < a.colors.length && identical; i += 1) {
        if (a.colors[i] !== b.colors[i]) identical = false;
      }
    } else if (a.colors !== b.colors) {
      identical = false;
    }
  }
  check(identical, 'two independent builds produce byte-identical instance matrices + colors');
  check(
    JSON.stringify(view.stats) === JSON.stringify(viewB.stats),
    'two independent builds report identical stats'
  );
}

// --- 4. Matrices NaN-free + bounding spheres cover the city --------------------
{
  console.log('  matrices + bounding coverage');
  let allFinite = true;
  let spheresOk = true;
  const centerLimit = world.halfSizeM + 50;
  for (const [name, mesh] of Object.entries(byName)) {
    if (!mesh.isInstancedMesh) continue; // e.g. the ground plane (plain Mesh)
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < arr.length; i += 1) {
      if (!Number.isFinite(arr[i])) allFinite = false;
    }
    const sphere = mesh.boundingSphere;
    if (!sphere || !Number.isFinite(sphere.radius)) spheresOk = false;
    else if (
      Math.abs(sphere.center.x) > centerLimit ||
      Math.abs(sphere.center.z) > centerLimit ||
      sphere.center.y < -10 ||
      sphere.center.y > world.halfSizeM * 2
    ) {
      spheresOk = false;
    }
  }
  check(allFinite, 'every instanceMatrix entry is finite (no NaN/Infinity)');
  check(spheresOk, 'every instanced mesh has a finite, city-centered bounding sphere');
  for (const name of ['city-buildings', 'city-sidewalks', 'city-markings']) {
    check(
      byName[name].boundingSphere.radius >= world.halfSizeM,
      `"${name}" bounding sphere spans the city (r ${byName[name].boundingSphere.radius.toFixed(1)} >= ${world.halfSizeM})`
    );
  }
  const ground = view.group.getObjectByName('city-ground');
  check(Boolean(ground && ground.geometry.boundingSphere), 'ground plane has a bounding sphere');
  check(
    ground.geometry.boundingSphere.radius >= world.halfSizeM,
    `ground plane covers the world extent (r ${ground.geometry.boundingSphere.radius.toFixed(1)})`
  );
}

// --- 5. Lighting + tier adoption ------------------------------------------------
{
  console.log('  lighting + quality-tier adoption');
  let sun = null;
  let hemi = null;
  view.group.traverse((obj) => {
    if (obj.isDirectionalLight) sun = obj;
    if (obj.isHemisphereLight) hemi = obj;
  });
  check(Boolean(sun), 'a directional sun light is part of the city group');
  check(Boolean(hemi), 'a hemisphere ambient fill light is part of the city group');
  check(sun.castShadow === false, 'sun starts with castShadow=false before any tier is applied');
  check(
    sun.shadow.camera.left <= -200 && sun.shadow.camera.right >= 200 && sun.shadow.camera.top >= 200 && sun.shadow.camera.bottom <= -200,
    `shadow frustum covers the city core (${sun.shadow.camera.left}..${sun.shadow.camera.right})`
  );
  check(sun.shadow.camera.far > 500, `shadow camera reaches the ground plane (far ${sun.shadow.camera.far})`);
  check(byName['city-buildings'].castShadow === true && byName['city-buildings'].receiveShadow === true, 'buildings cast + receive shadows (flags pre-wired for high tier)');
  check(byName['city-ground'].receiveShadow === true, 'ground receives shadows');

  const t = view.applyTier('high');
  check(t === QUALITY_TIERS.high, 'applyTier("high") returns the high tier definition');
  check(sun.castShadow === QUALITY_TIERS.high.shadows, 'high tier: sun.castShadow on');
  check(sun.shadow.mapSize.x === QUALITY_TIERS.high.shadowMapSize, `high tier: shadow map size ${QUALITY_TIERS.high.shadowMapSize}`);
  view.applyTier('low');
  check(sun.castShadow === QUALITY_TIERS.low.shadows, 'low tier: sun.castShadow off');
  view.applyTier('medium');
  check(sun.castShadow === QUALITY_TIERS.medium.shadows, 'medium tier: sun.castShadow off (default tier state)');
}

// --- 6. Dispose ------------------------------------------------------------------
{
  console.log('  dispose releases every resource');
  let geoTotal = 0;
  let matTotal = 0;
  let geoDisposed = 0;
  let matDisposed = 0;
  const geoSeen = new Set();
  const matSeen = new Set();
  viewB.group.traverse((obj) => {
    if (obj.geometry && !geoSeen.has(obj.geometry)) {
      geoSeen.add(obj.geometry);
      geoTotal += 1;
      obj.geometry.addEventListener('dispose', () => {
        geoDisposed += 1;
      });
    }
    const material = obj.material;
    if (material && !matSeen.has(material)) {
      matSeen.add(material);
      matTotal += 1;
      material.addEventListener('dispose', () => {
        matDisposed += 1;
      });
    }
  });
  viewB.dispose();
  check(geoDisposed === geoTotal, `every geometry fired dispose (${geoDisposed}/${geoTotal})`);
  check(matDisposed === matTotal, `every material fired dispose (${matDisposed}/${matTotal})`);
  let threw = false;
  try {
    viewB.dispose(); // second call must be a safe no-op
  } catch {
    threw = true;
  }
  check(!threw, 'dispose() is idempotent (second call does not throw)');
}

console.log(`\ncity-view-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`city-view-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('city-view-test: ALL PASS');
