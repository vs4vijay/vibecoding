/**
 * Instanced ambient-traffic view (Midtown Blitz, task 4.2).
 *
 * Renders the pooled traffic cars (src/game/traffic.js) as THREE
 * InstancedMeshes sharing the player-car body archetype (design Decision
 * 6: "Traffic cars share the player-car body archetype instanced per
 * color"). The archetype is the player car's silhouette reduced to three
 * boxes; wheels are baked into a dark underbody skirt (24 cars x 4 wheels
 * would cost geometry updates and draw calls for no readable gain at
 * ambient-traffic distance — the skirt reads as tires+shadow):
 *
 *   - body:  paint box (per-instance color, PALETTE 5 variants — one
 *     InstancedMesh with instanceColor, a single draw call);
 *   - cabin: glass box (one dark color, shared material);
 *   - skirt: underbody/tire strip (one dark color, shared material).
 *
 * => exactly 3 draw calls for the whole pool (box geometries are
 * pre-translated to their local offsets, so all three meshes share ONE
 * pose matrix per car: position + rotation.y = heading + yawOffset, the
 * shared heading convention plus the task 4.3 impact-spin offset).
 * Elevations stay at 0 — lanes are asphalt
 * (surfaceHeightAt === 0 by construction, verified in the harness).
 *
 * Interpolation choice: instance matrices are written ONCE PER RENDERED
 * FRAME directly from the current sim state — no prev/current pose buffers
 * and no alpha lerp (unlike the player car). At the 60 Hz sim rate the
 * 16 ms pose quantization is invisible for background traffic; if it ever
 * reads jittery, add a per-car prev pose pair and lerp here (the Traffic
 * car objects would need an xPrev/zPrev/headingPrev snapshot per tick).
 * `instanceMatrix.needsUpdate` is set every frame; per-instance colors are
 * static (assigned once at creation from each car's paint index).
 *
 * Like city-view/car-view, this module builds real three.js objects
 * without a renderer, so the plain-node harness can construct it.
 * `dispose()` releases every geometry and material (idempotent).
 */

import * as THREE from 'three';

/** Body paint variants mapped from TrafficCar.paint (indices 0..4). */
const PALETTE = Object.freeze([
  0xc9ccd2, // silver
  0x4a5a68, // steel blue
  0x8a2f23, // oxide red
  0xc7a43a, // taxi amber
  0x3e5a43, // forest green
]);

/** Cabin glass color (shared). */
const CABIN_COLOR = 0x223140;
/** Underbody/tire skirt color (shared). */
const SKIRT_COLOR = 0x1c1f24;

/**
 * Handle for a created traffic view.
 *
 * @typedef {object} TrafficView
 * @property {THREE.Group} group Root group (add to a scene; frustum culling
 *   is disabled on the instanced meshes — instances span the whole city).
 * @property {() => void} update Write every car's pose into the instance
 *   matrices (call once per rendered frame, after the sim tick).
 * @property {() => void} dispose Release every geometry/material this view
 *   created and detach the group (idempotent).
 */

/**
 * Build the instanced traffic view for a traffic pool.
 *
 * @param {import('./traffic.js').Traffic} traffic Traffic pool whose cars
 *   are rendered (read-only here; the sim mutates them).
 * @returns {TrafficView} The traffic view handle.
 * @throws {TypeError} If the traffic pool is missing or empty.
 */
export function createTrafficView(traffic) {
  if (!traffic || !Array.isArray(traffic.cars) || traffic.cars.length === 0) {
    throw new TypeError('createTrafficView: needs a traffic pool with cars');
  }
  const cars = traffic.cars;
  const count = cars.length;

  /** @type {(THREE.Material | THREE.BufferGeometry)[]} */
  const resources = [];
  /**
   * Track a resource for dispose().
   * @template {THREE.Material | THREE.BufferGeometry} T
   * @param {T} res Material or geometry to track.
   * @returns {T} The same resource.
   */
  function track(res) {
    resources.push(res);
    return res;
  }

  // --- shared geometry, pre-translated to local offsets ---------------------
  // Player-car archetype proportions (DEFAULT_CAR_CONFIG.body: 4.4 x 1.9,
  // chassis y 0.30-0.80, cabin atop, wheels below) reduced to boxes.
  const bodyGeo = track(new THREE.BoxGeometry(1.8, 0.5, 4.2));
  bodyGeo.translate(0, 0.55, 0);
  const cabinGeo = track(new THREE.BoxGeometry(1.5, 0.5, 2.0));
  cabinGeo.translate(0, 1.05, -0.3);
  const skirtGeo = track(new THREE.BoxGeometry(1.92, 0.36, 4.3));
  skirtGeo.translate(0, 0.18, 0);

  // --- materials -------------------------------------------------------------
  const bodyMat = track(new THREE.MeshLambertMaterial({ color: 0xffffff })); // instanceColor-multiplied
  const cabinMat = track(new THREE.MeshLambertMaterial({ color: CABIN_COLOR }));
  const skirtMat = track(new THREE.MeshLambertMaterial({ color: SKIRT_COLOR }));

  // --- instanced meshes (3 draw calls for the whole pool) --------------------
  const group = new THREE.Group();
  group.name = 'traffic';

  /**
   * Create one instanced part mesh with shared instance bookkeeping.
   * @param {THREE.BufferGeometry} geo Pre-translated part geometry.
   * @param {THREE.Material} mat Part material.
   * @param {boolean} shadows Cast into the high-tier sun.
   * @param {boolean} paintInstances Apply per-instance palette colors.
   * @returns {THREE.InstancedMesh} The mesh.
   */
  function makePart(geo, mat, shadows, paintInstances) {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false; // instances span the city; never batch-cull
    mesh.matrixAutoUpdate = false; // identity root; instances carry the pose
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    if (paintInstances) {
      for (let i = 0; i < count; i += 1) {
        const paint = Math.min(PALETTE.length - 1, Math.max(0, cars[i].paint | 0));
        mesh.setColorAt(i, new THREE.Color(PALETTE[paint]));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    group.add(mesh);
    return mesh;
  }

  const bodyMesh = makePart(bodyGeo, bodyMat, true, true);
  const cabinMesh = makePart(cabinGeo, cabinMat, true, false);
  const skirtMesh = makePart(skirtGeo, skirtMat, false, false);

  // --- per-frame scratch (no allocations in the hot path) --------------------
  const scratchMatrix = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);

  /**
   * Write every car's current sim pose into the instance matrices. The
   * rotation is `heading + yawOffset` (task 4.3): the yaw offset is the
   * car-car impact spin — it decays back to 0 as the car straightens out,
   * while `heading` keeps chasing the path tangent (see traffic.js).
   * @returns {void}
   */
  function update() {
    for (let i = 0; i < count; i += 1) {
      const car = cars[i];
      scratchPos.set(car.x, 0, car.z);
      scratchQuat.setFromAxisAngle(UP, car.heading + (car.yawOffset || 0));
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      bodyMesh.setMatrixAt(i, scratchMatrix);
      cabinMesh.setMatrixAt(i, scratchMatrix);
      skirtMesh.setMatrixAt(i, scratchMatrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    cabinMesh.instanceMatrix.needsUpdate = true;
    skirtMesh.instanceMatrix.needsUpdate = true;
  }

  // Pose the instances once at boot so the first render is never empty.
  update();

  /**
   * Release every geometry/material this view created and detach the group
   * from its parent (idempotent).
   * @returns {void}
   */
  function dispose() {
    for (let i = 0; i < resources.length; i += 1) resources[i].dispose();
    resources.length = 0;
    if (group.parent) group.parent.remove(group);
  }

  return { group, update, dispose };
}
