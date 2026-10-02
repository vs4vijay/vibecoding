/**
 * @file world/corridor.js
 * Wave-2 track furniture + street context, all in GLOBAL world-locked ring
 * buffers (see world/ring.js): exactly N draw calls regardless of chunk
 * count, every slot a pure function of (runSeed, worldIndex).
 *
 * Contents:
 *  - Streets beyond the walls: sidewalk + curb + painted road strip on both
 *    sides (so the ?cam=side rig sees a street, not bare dirt). Road paint is
 *    a canvas texture, world-locked by uv offset (same trick as the ground).
 *  - Catenary: dark-green steel poles on the wall caps + portal cross beams
 *    every 20 m (beam underside 6.33 m, above every camera rig apex).
 *  - Overhead contact wires: one merged 6-wire mesh (3 lanes x contact +
 *    messenger) with baked 20 m-period sag dipping to 4.58 m (> 4.5 m floor
 *    over the play corridor), snapped to the 20 m grid so the sag pattern is
 *    world-aligned and motion-stable.
 *  - Signal masts with red/green lenses (bright instanced color), cable
 *    conduits, wall pipes, kilometer posts, and a poster ring (atlas + 
 *    per-instance quadrant offset).
 *
 * Corridor safety (god-mode QA captures):
 *  - nothing inside |x| < 3.3 below 4.5 m (wires bottom out at 4.58)
 *  - wall-face props (posters/pipes/conduits/signals) sit at |x| ~ 5.6-5.9,
 *    entirely outside the 3-lane corridor; pipes start at y 1.25 so they
 *    never clip station platforms (top 1.1 m)
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../core/config.js";
import { rngFor } from "../core/rng.js";
import {
  fitBoxUVs,
  makePosterAtlasTexture,
  makeRoadTexture,
} from "../core/assets.js";
import { refreshRing, ringCell } from "./ring.js";

const BACK = 40;
const AHEAD = 340;
const VIEW = BACK + AHEAD; // 380 m dressing window

const STREET_LEN = 520;
const ROAD_W = 5.15; // strip width; paint tile designed for 5.55 m across
const ROAD_TILE_U = 5.55; // design width of one road-paint tile (u)
const ROAD_METERS_PER_TILE = 12; // metres per tile along the street (v)
const CONCRETE_METERS_PER_TILE = 100 / 36; // fitBoxUVs density 36 -> 2.78 m

// Catenary geometry constants (config.WORLD holds the canonical values).
const CAT_SPACING = CONFIG.WORLD.CATENARY_SPAN; // 20 m
const WIRE_BASE = CONFIG.WORLD.WIRE_HEIGHT; // 4.72 m at poles
const WIRE_SAG = 0.14; // mid-span dip -> 4.58 m minimum (> 4.5)
const MESSENGER_BASE = 4.98;
const MESSENGER_RISE = 0.16;
const BEAM_Y = CONFIG.WORLD.BEAM_HEIGHT; // 6.35 portal truss centre

const WALL_X = 5.9; // wall centreline (walls span 5.65..6.15)
const WALL_CAP_Y = 4.18; // top of the steel wall cap
const CORRIDOR_HALF = 3.3; // play corridor half width

/** Box helper with UVs fitted to world size. */
function boxGeo(sx, sy, sz, density = 36) {
  return fitBoxUVs(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, density);
}

/**
 * World-locked long plane (road / sidewalk top): uv offset follows the mesh z
 * so the paint pattern stays pinned to the world. Plane +x/-pi/2 rotation
 * maps local +v to world -z, hence offset.y = -centerZ / metersPerTile.
 */
function makeLockedPlaneMaterial(tex, widthU, tileU, metersPerTile, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.clone(),
    roughness: opts.roughness ?? 0.94,
    metalness: 0.0,
    envMapIntensity: 0.1,
  });
  mat.map.needsUpdate = true;
  mat.map.repeat.set(widthU / tileU, STREET_LEN / metersPerTile);
  return mat;
}

/** Sag-baked wire geometry (contact or messenger) along local z. */
function makeWireGeometry(baseY, amp) {
  const LEN = VIEW + 40;
  const geo = new THREE.CylinderGeometry(0.021, 0.021, LEN, 5, 220, true);
  geo.rotateX(Math.PI / 2); // axis -> +z
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = (((z % CAT_SPACING) + CAT_SPACING) % CAT_SPACING) / CAT_SPACING;
    pos.setY(i, pos.getY(i) + baseY + amp * Math.sin(Math.PI * t));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Wire material: brushedMetal clone with a NEAR-FIELD FADE.
 *
 * Artifact fix (judge round, chase shot seed 7): the chase rig flies at
 * 4.35 m — only 0.2-0.7 m below the centre contact/messenger wires — so the
 * first metres of those wires subtend up to ~2 deg at the top of frame and
 * taper into the vanishing point, reading as a huge pale-blue "cone beam"
 * (metalness 1 mirrors the pale sky env, hence the flat pale-blue shading).
 * Fix: fade the wire out when it passes very close to the camera AND slightly
 * ABOVE it (the pathological geometry). Gating on "above the camera" keeps
 * the side rig (6.2 m, wires below) and the close rig (2.2 m, wires >2.3 m
 * up) untouched; from ~8 m out the wires render normally as thin lines.
 * Deterministic under ?freeze: the fade depends only on the (pinned) camera.
 */
function makeWireMaterial(lib) {
  const mat = lib.brushedMetal.clone();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying float vWireWorldY;\n" +
      shader.vertexShader.replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
        vWireWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;`,
      );
    shader.fragmentShader =
      "varying float vWireWorldY;\n" +
      shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        {
          float dh = vWireWorldY - cameraPosition.y;
          float above = step( 0.0, dh ) * ( 1.0 - smoothstep( 1.1, 1.9, dh ) );
          float nearCam = 1.0 - smoothstep( 2.0, 8.0, length( vViewPosition ) );
          gl_FragColor.a *= 1.0 - nearCam * above;
        }`,
      );
  };
  mat.customProgramCacheKey = () => "wire-nearfade";
  return mat;
}

/** All six wires (3 lanes x contact+messenger) merged into one mesh. */
function makeWireMesh(lib) {
  const parts = [];
  for (const lane of [-1, 0, 1]) {
    const x = lane * 2.2;
    const contact = makeWireGeometry(WIRE_BASE, -WIRE_SAG);
    contact.translate(x, 0, 0);
    parts.push(contact);
    const messenger = makeWireGeometry(MESSENGER_BASE, MESSENGER_RISE);
    messenger.translate(x, 0, 0);
    parts.push(messenger);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), makeWireMaterial(lib));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Catenary pole: column on the wall cap + cantilever arm + brace (merged). */
function makePoleGeometry() {
  const parts = [];
  const column = new THREE.BoxGeometry(0.16, 2.72, 0.16);
  column.translate(0, WALL_CAP_Y + 1.36, 0);
  parts.push(column);
  const arm = new THREE.BoxGeometry(2.95, 0.09, 0.09);
  arm.translate(-1.475, 6.18, 0); // reaches in over the outer lanes
  parts.push(arm);
  const brace = new THREE.BoxGeometry(1.5, 0.07, 0.07);
  brace.rotateZ(0.45);
  brace.translate(-0.78, 5.6, 0);
  parts.push(brace);
  return mergeGeometries(parts);
}

/** Portal beam across the corridor + three wire hangers (merged). */
function makeBeamGeometry() {
  const parts = [];
  const beam = new THREE.BoxGeometry(WALL_X * 2, 0.22, 0.16);
  beam.translate(0, BEAM_Y, 0);
  parts.push(beam);
  for (const x of [-2.2, 0, 2.2]) {
    const hanger = new THREE.BoxGeometry(0.055, 1.42, 0.055);
    hanger.translate(x, BEAM_Y - 0.11 - 0.71, 0);
    parts.push(hanger);
  }
  return mergeGeometries(parts);
}

/** Signal mast: base post + head (merged); lenses are a separate instancing. */
function makeSignalGeometry() {
  const parts = [];
  const post = new THREE.BoxGeometry(0.06, 0.44, 0.06);
  post.translate(0, WALL_CAP_Y + 0.22, 0);
  parts.push(post);
  const head = new THREE.BoxGeometry(0.22, 0.6, 0.14);
  head.translate(0, WALL_CAP_Y + 0.46, 0);
  parts.push(head);
  return mergeGeometries(parts);
}

/** Kilometer post: white post + number plate (merged). */
function makeKmPostGeometry() {
  const parts = [];
  const post = new THREE.BoxGeometry(0.1, 0.52, 0.1);
  post.translate(0, WALL_CAP_Y + 0.26, 0);
  parts.push(post);
  const plate = new THREE.BoxGeometry(0.34, 0.24, 0.05);
  plate.translate(0, WALL_CAP_Y + 0.38, 0.055);
  parts.push(plate);
  return mergeGeometries(parts);
}

/**
 * Poster ring material: atlas map + per-instance quadrant offset. Posters
 * never repeat (uv 0..1 -> quadrant), so a plain affine remap is seam-free.
 */
function makePosterMaterial(lib, cap) {
  const mat = new THREE.MeshStandardMaterial({
    map: makePosterAtlasTexture(lib.factory),
    roughness: 0.5,
    metalness: 0.0,
    envMapIntensity: 0.25,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute vec2 aUvOff;\n" + shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = vMapUv * 0.5 + aUvOff;
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => "poster-atlas";
  const geo = new THREE.PlaneGeometry(1.9, 1.05);
  geo.setAttribute("aUvOff", new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
  return { mat, geo };
}

export class CorridorDressing {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").MaterialLibrary} lib
   * @param {number} seed
   */
  constructor(scene, lib, seed) {
    this.seed = seed;
    const slots20 = Math.ceil(VIEW / CAT_SPACING) + 1;
    this._slots20 = slots20;

    // ---- Streets -----------------------------------------------------------
    const roadMat = makeLockedPlaneMaterial(
      makeRoadTexture(lib.factory), ROAD_W, ROAD_TILE_U, ROAD_METERS_PER_TILE,
    );
    this._roadMat = roadMat;
    const roadGeo = new THREE.PlaneGeometry(ROAD_W, STREET_LEN);
    roadGeo.rotateX(-Math.PI / 2);
    this._roads = new THREE.InstancedMesh(roadGeo, roadMat, 2);
    this._roads.frustumCulled = false;
    this._roads.receiveShadow = true;
    scene.add(this._roads);

    const sidewalkMat = makeLockedPlaneMaterial(
      lib.textureSet("concrete").map, 2.2, CONCRETE_METERS_PER_TILE,
      CONCRETE_METERS_PER_TILE, { roughness: 0.92 },
    );
    this._sidewalkMat = sidewalkMat;
    const walkGeo = new THREE.PlaneGeometry(2.2, STREET_LEN);
    walkGeo.rotateX(-Math.PI / 2);
    this._walks = new THREE.InstancedMesh(walkGeo, sidewalkMat, 2);
    this._walks.frustumCulled = false;
    this._walks.receiveShadow = true;
    scene.add(this._walks);

    const curbSet = lib.textureSet("concrete");
    const curbMat = new THREE.MeshStandardMaterial({
      map: curbSet.map.clone(),
      normalMap: curbSet.normalMap.clone(),
      roughnessMap: curbSet.roughnessMap.clone(),
      metalness: 0.0,
      roughness: 1.0,
      envMapIntensity: 0.15,
    });
    for (const key of ["map", "normalMap", "roughnessMap"]) curbMat[key].needsUpdate = true;
    this._curbMat = curbMat;
    const curbGeo = boxGeo(0.26, 0.22, STREET_LEN, 36);
    this._curbs = new THREE.InstancedMesh(curbGeo, curbMat, 2);
    this._curbs.frustumCulled = false;
    this._curbs.receiveShadow = true;
    scene.add(this._curbs);

    const dummy = new THREE.Object3D();
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? -1 : 1;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(sx * 10.925, -0.545, 0); // road 8.35..13.5
      dummy.updateMatrix();
      this._roads.setMatrixAt(side, dummy.matrix);
      dummy.position.set(sx * 7.25, -0.4, 0); // sidewalk 6.15..8.35
      dummy.updateMatrix();
      this._walks.setMatrixAt(side, dummy.matrix);
      dummy.position.set(sx * 8.48, -0.51, 0); // curb face at the road edge
      dummy.updateMatrix();
      this._curbs.setMatrixAt(side, dummy.matrix);
    }

    // ---- Catenary poles + beams -------------------------------------------
    this._poles = new THREE.InstancedMesh(makePoleGeometry(), lib.catSteel, slots20 * 2);
    this._poles.frustumCulled = false;
    this._poles.castShadow = true;
    scene.add(this._poles);
    this._beams = new THREE.InstancedMesh(makeBeamGeometry(), lib.catSteel, slots20);
    this._beams.frustumCulled = false;
    this._beams.castShadow = true;
    scene.add(this._beams);
    this._dummy = new THREE.Object3D();

    // ---- Wires + conduits --------------------------------------------------
    this._wires = makeWireMesh(lib);
    scene.add(this._wires);
    const conduitGeo = boxGeo(0.1, 0.14, VIEW + 40, 48);
    this._conduits = new THREE.InstancedMesh(conduitGeo, lib.steelDark, 2);
    this._conduits.frustumCulled = false;
    scene.add(this._conduits);
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? -1 : 1;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(sx * (WALL_X - 0.28), 3.78, 0);
      dummy.updateMatrix();
      this._conduits.setMatrixAt(side, dummy.matrix);
    }

    // ---- Signals -----------------------------------------------------------
    const sigSlots = Math.ceil(VIEW / 60) + 1;
    this._sigSlots = sigSlots;
    this._signalHousing = new THREE.InstancedMesh(makeSignalGeometry(), lib.plasticDark, sigSlots);
    this._signalHousing.frustumCulled = false;
    scene.add(this._signalHousing);
    this._lens = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.052, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      sigSlots * 2,
    );
    this._lens.frustumCulled = false;
    scene.add(this._lens);

    // ---- Kilometer posts ---------------------------------------------------
    const kmSlots = Math.ceil(VIEW / 200) + 1;
    this._km = new THREE.InstancedMesh(makeKmPostGeometry(), lib.concrete, kmSlots);
    this._km.frustumCulled = false;
    scene.add(this._km);

    // ---- Wall pipes --------------------------------------------------------
    const pipeSlots = Math.ceil(VIEW / 13) + 1;
    this._pipeSlots = pipeSlots;
    this._pipes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.075, 0.075, 2.45, 6),
      lib.steelDark,
      pipeSlots,
    );
    this._pipes.frustumCulled = false;
    scene.add(this._pipes);

    // ---- Posters -----------------------------------------------------------
    const posterSlots = Math.ceil(VIEW / 20) + 1;
    this._posterSlots = posterSlots;
    const { mat: posterMat, geo: posterGeo } = makePosterMaterial(lib, posterSlots);
    this._posters = new THREE.InstancedMesh(posterGeo, posterMat, posterSlots);
    this._posters.frustumCulled = false;
    scene.add(this._posters);

    /** Ring states (first = null until built). */
    this._rings = {
      cat: { first: null }, // poles + beams share the 20 m grid
      signals: { first: null },
      km: { first: null },
      pipes: { first: null },
      posters: { first: null },
    };
    this._color = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._hideAllDynamic();
  }

  /** Zero-scale every ring slot until its world index is assigned. */
  _hideAllDynamic() {
    for (let i = 0; i < this._poles.count; i++) this._poles.setMatrixAt(i, this._zero);
    for (let i = 0; i < this._beams.count; i++) this._beams.setMatrixAt(i, this._zero);
    for (let i = 0; i < this._signalHousing.count; i++) {
      this._signalHousing.setMatrixAt(i, this._zero);
    }
    for (let i = 0; i < this._lens.count; i++) {
      this._lens.setMatrixAt(i, this._zero);
      this._lens.setColorAt(i, this._color.setRGB(1, 1, 1));
    }
    for (let i = 0; i < this._km.count; i++) this._km.setMatrixAt(i, this._zero);
    for (let i = 0; i < this._pipes.count; i++) this._pipes.setMatrixAt(i, this._zero);
    for (let i = 0; i < this._posters.count; i++) this._posters.setMatrixAt(i, this._zero);
    this._flushAll();
  }

  /** @private */
  _place(mesh, cell, px, py, pz, ry = 0, tint = null) {
    const d = this._dummy;
    d.position.set(px, py, pz);
    d.rotation.set(0, ry, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    mesh.setMatrixAt(cell, d.matrix);
    if (tint) mesh.setColorAt(cell, tint);
  }

  /** @private One catenary slot: poles on both walls + the portal beam. */
  _assignCatenary(wi) {
    const z = wi * CAT_SPACING;
    const cell = ringCell(wi, this._slots20);
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      this._place(
        this._poles,
        cell * 2 + s,
        side * WALL_X,
        0,
        z,
        side > 0 ? 0 : Math.PI, // arm points toward the track centre
      );
    }
    this._place(this._beams, cell, 0, 0, z);
  }

  /** @private */
  _assignSignal(wi) {
    const rng = rngFor(this.seed, 0x51a1, wi);
    const z = wi * 60 + 30;
    const cell = ringCell(wi, this._sigSlots);
    const side = rng.chance(0.5) ? -1 : 1;
    this._place(this._signalHousing, cell, side * (WALL_X - 0.12), 0, z);
    const lensGeo = this._lens;
    const green = rng.chance(0.6);
    this._color.setRGB(...(green ? [0.15, 2.6, 0.4] : [2.8, 0.2, 0.16]));
    for (let k = 0; k < 2; k++) {
      this._place(
        lensGeo,
        cell * 2 + k,
        side * (WALL_X - 0.12),
        WALL_CAP_Y + 0.6 - k * 0.26,
        z - 0.075,
        Math.PI, // face oncoming traffic (-z)
        this._color,
      );
    }
  }

  /** @private */
  _assignKm(wi) {
    const cell = ringCell(wi, this._km.count);
    this._color.setRGB(0.94, 0.93, 0.88);
    this._place(this._km, cell, WALL_X, 0, wi * 200, 0, this._color);
  }

  /** @private */
  _assignPipe(wi) {
    const rng = rngFor(this.seed, 0x9be2, wi);
    const cell = ringCell(wi, this._pipeSlots);
    const side = rng.chance(0.5) ? -1 : 1;
    const z = wi * 13 + rng.range(-3.5, 3.5);
    this._color.setScalar(rng.range(0.6, 1.0));
    this._place(this._pipes, cell, side * (WALL_X - 0.32), 2.475, z, 0, this._color);
  }

  /** @private */
  _assignPoster(wi) {
    const rng = rngFor(this.seed, 0xa97e, wi);
    const cell = ringCell(wi, this._posterSlots);
    if (rng.chance(0.35)) {
      this._posters.setMatrixAt(cell, this._zero); // bare wall slot
      return;
    }
    const side = rng.chance(0.5) ? -1 : 1;
    const z = wi * 20 + 10 + rng.range(-4, 4);
    // Plane normal is +z; the poster must face the corridor centre, i.e.
    // -x on the +x wall (rotation.y = -PI/2) and +x on the -x wall.
    this._place(this._posters, cell, side * (WALL_X - 0.27), 2.6, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    const off = this._posters.geometry.getAttribute("aUvOff");
    const q = rng.int(0, 3);
    off.setXY(cell, (q % 2) * 0.5, Math.floor(q / 2) * 0.5);
    off.needsUpdate = true;
    const b = rng.range(0.72, 0.95);
    this._color.setRGB(b, b, b);
    this._posters.setColorAt(cell, this._color);
  }

  /**
   * Refresh all rings + world-lock the streets/wires around playerZ.
   * @param {number} playerZ
   */
  update(playerZ) {
    refreshRing(this._rings.cat, playerZ, CAT_SPACING, this._slots20, BACK, (wi) =>
      this._assignCatenary(wi),
    );
    refreshRing(this._rings.signals, playerZ, 60, this._sigSlots, BACK, (wi) =>
      this._assignSignal(wi),
    );
    refreshRing(this._rings.km, playerZ, 200, this._km.count, BACK, (wi) => this._assignKm(wi));
    refreshRing(this._rings.pipes, playerZ, 13, this._pipeSlots, BACK, (wi) =>
      this._assignPipe(wi),
    );
    refreshRing(this._rings.posters, playerZ, 20, this._posterSlots, BACK, (wi) =>
      this._assignPoster(wi),
    );

    // World-lock street strips + wires (streets recenter like the ground).
    const centerZ = playerZ + STREET_LEN * 0.3;
    const d = this._dummy;
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    for (let side = 0; side < 2; side++) {
      d.position.set(side === 0 ? -10.925 : 10.925, -0.545, centerZ);
      d.updateMatrix();
      this._roads.setMatrixAt(side, d.matrix);
      d.position.set(side === 0 ? -7.25 : 7.25, -0.4, centerZ);
      d.updateMatrix();
      this._walks.setMatrixAt(side, d.matrix);
      d.position.set(side === 0 ? -8.48 : 8.48, -0.51, centerZ);
      d.updateMatrix();
      this._curbs.setMatrixAt(side, d.matrix);
    }
    this._roadMat.map.offset.y = -centerZ / ROAD_METERS_PER_TILE;
    this._sidewalkMat.map.offset.y = -centerZ / CONCRETE_METERS_PER_TILE;
    this._curbMat.map.offset.y = centerZ / CONCRETE_METERS_PER_TILE;
    if (this._curbMat.normalMap) {
      this._curbMat.normalMap.offset.y = this._curbMat.map.offset.y;
      this._curbMat.roughnessMap.offset.y = this._curbMat.map.offset.y;
    }

    // Wires: snapped to the 20 m grid so the sag pattern is world-aligned;
    // biased 120 m ahead so the mesh spans the whole draw distance (back
    // coverage 90 m >> the 40 m ring back margin).
    this._wires.position.z = Math.round(playerZ / CAT_SPACING) * CAT_SPACING + 120;
    this._conduits.position.z = playerZ + 60;

    this._flushAll();
  }

  /** @private */
  _flushAll() {
    for (const m of [
      this._roads, this._walks, this._curbs, this._poles, this._beams,
      this._conduits, this._signalHousing, this._lens, this._km,
      this._pipes, this._posters,
    ]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Rewind all rings (run restart). */
  reset() {
    for (const key of Object.keys(this._rings)) {
      this._rings[key].first = null;
    }
    this._hideAllDynamic();
  }
}
