/**
 * @file world/world.js
 * Chunk streaming manager + global world dressing.
 *
 * 40 m chunks generated from seeded RNG (per-chunk streams derived from the
 * run seed, so ?seed=N reproduces the world exactly), recycled behind the
 * camera. Chunk types: base track (everywhere), station platform segments
 * (every ~5th chunk) and road bridges crossing above (~every 4th, skipped on
 * station slots) — see world/chunks.js. Everything camera-facing but not
 * gameplay-relevant (buildings, streets, catenary, wires, posters, skyline)
 * lives in world-locked global ring buffers (world/buildings.js,
 * world/corridor.js) updated from playerZ: a fixed handful of draw calls no
 * matter how many chunks are alive.
 *
 *   world.registerChunkType(name, factory)  // factory(rng, ctx) -> chunk
 *   world.update(dt, playerZ)               // streaming + dressing + update
 *   world.metrics = window.__WORLD          // { chunks, buildings, drawCalls }
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";
import { rngFor } from "../core/rng.js";
import { fitBoxUVs } from "../core/assets.js";
import { BuildingBand, SkylineBand } from "./buildings.js";
import { CorridorDressing } from "./corridor.js";
import { createStationChunk, createBridgeChunk } from "./chunks.js";

export const CHUNK_LEN = 40;
const METERS_PER_GROUND_REPEAT = 10;
const GROUND_LEN = 520;
const GROUND_WIDTH = 160;

/** Cycle length of the chunk-type plan (LCM of the station/bridge periods). */
const PLAN_CYCLE = 20;

/**
 * Chunk instance produced by a factory.
 * @typedef {{group: THREE.Group, update?: (dt: number, playerZ: number) => void}} Chunk
 */

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").MaterialLibrary} lib
   * @param {number} seed Run seed.
   * @param {object} preset Quality preset (draw distance).
   */
  constructor(scene, lib, seed, preset) {
    this.scene = scene;
    this.lib = lib;
    this.seed = seed;
    this.drawDistance = preset.drawDistance;
    this.maxChunksAhead = preset.maxChunksAhead;
    /** @type {THREE.MeshStandardMaterial[]} Alternating ballast materials
     *  (offset texture variants) so the stamped stone motif does not tile
     *  visibly down the corridor. */
    this._ballastVariants = null;

    /** @type {Map<string, (rng: import("../core/rng.js").Rng, ctx: object) => Chunk>} */
    this._chunkTypes = new Map();
    /** @type {Map<number, Chunk & {type: string}>} */
    this._active = new Map();
    /** @type {Map<string, Array<Chunk & {type: string}>>} */
    this._pools = new Map();

    this._registerBuiltins();
    this._buildGround();

    // Global, world-locked dressing (fixed draw-call cost, zero chunk churn):
    // near building band + rooftop clutter + awnings, distant skyline
    // parallax, and the track furniture / street context.
    this._buildings = new BuildingBand(scene, lib, seed);
    this._skyline = new SkylineBand(scene, seed);
    this._corridor = new CorridorDressing(scene, lib, seed);

    /** QA metrics surface. */
    window.__WORLD = { chunks: 0, buildings: 0, drawCalls: 0 };
  }

  /**
   * Register a chunk type. Factory receives a per-chunk seeded RNG and a
   * context { index, zStart, lib, CHUNK_LEN } and returns a Chunk whose
   * group is positioned at z = zStart (children use local z in [0, CHUNK_LEN)).
   * @param {string} name
   * @param {(rng: import("../core/rng.js").Rng, ctx: object) => Chunk} factory
   */
  registerChunkType(name, factory) {
    this._chunkTypes.set(name, factory);
    if (!this._pools.has(name)) this._pools.set(name, []);
  }

  /** @private */
  _buildGround() {
    // Wide asphalt plane under everything, world-locked by texture offset.
    const lib = this.lib;
    const base = lib.textureSet("asphalt");
    const mat = new THREE.MeshStandardMaterial({
      map: base.map.clone(),
      normalMap: base.normalMap.clone(),
      roughnessMap: base.roughnessMap.clone(),
      metalness: 0.0,
      roughness: 1.0,
      envMapIntensity: 0.1, // neutral shadows (no blue env wash)
    });
    const repeatX = GROUND_WIDTH / METERS_PER_GROUND_REPEAT;
    const repeatY = GROUND_LEN / METERS_PER_GROUND_REPEAT;
    for (const tex of [mat.map, mat.normalMap, mat.roughnessMap]) {
      tex.repeat.set(repeatX, repeatY);
      tex.needsUpdate = true;
    }
    this._groundMat = mat;
    this._ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_LEN), mat);
    this._ground.rotation.x = -Math.PI / 2;
    this._ground.position.y = -0.58;
    this._ground.receiveShadow = true;
    this.scene.add(this._ground);
  }

  /** @private */
  _registerBuiltins() {
    const len = CHUNK_LEN;

    /**
     * Wave-1 track chunk: ballast bed, 3 rail pairs, sleepers (instanced),
     * concrete side walls, silhouette buildings (instanced).
     */
    this.registerChunkType("track", (rng, ctx) => {
      const lib = ctx.lib;
      const group = new THREE.Group();

      // Ballast bed. Density 80 -> ~1.25 m per texture tile so the rebuilt
      // clumped stones read at 2.5-6 cm world scale. Texture offset alternates
      // per chunk parity to break the stamped-motif repetition.
      if (!this._ballastVariants) {
        this._ballastVariants = [lib.ballast];
        for (const [ox, oy] of [[0.37, 0.53], [0.71, 0.19]]) {
          const m = lib.ballast.clone();
          for (const key of ["map", "normalMap", "roughnessMap", "aoMap"]) {
            if (m[key]) {
              m[key] = m[key].clone();
              m[key].offset.set(ox, oy);
              m[key].needsUpdate = true;
            }
          }
          this._ballastVariants.push(m);
        }
      }
      const ballastGeo = fitBoxUVs(new THREE.BoxGeometry(8.0, 0.3, len), 8.0, 0.3, len, 80);
      const ballast = new THREE.Mesh(ballastGeo, this._ballastVariants[ctx.index % 3]);
      ballast.position.set(0, -0.43, len / 2);
      ballast.receiveShadow = true;
      ballast.castShadow = false;
      group.add(ballast);

      // Sleepers: 50 rows x 3 lanes in a single InstancedMesh.
      const rows = Math.floor(len / 0.8);
      const sleeperGeo = new THREE.BoxGeometry(2.0, 0.12, 0.26);
      const sleepers = new THREE.InstancedMesh(sleeperGeo, lib.wood, rows * CONFIG.LANE_COUNT);
      sleepers.receiveShadow = true;
      sleepers.castShadow = false;
      const dummy = new THREE.Object3D();
      let si = 0;
      for (let r = 0; r < rows; r++) {
        for (let lane = -1; lane <= 1; lane++) {
          dummy.position.set(lane * CONFIG.LANE_WIDTH, -0.22, 0.4 + r * 0.8);
          dummy.rotation.y = (rng.next() - 0.5) * 0.02;
          dummy.updateMatrix();
          sleepers.setMatrixAt(si++, dummy.matrix);
        }
      }
      sleepers.instanceMatrix.needsUpdate = true;
      group.add(sleepers);

      // Rails: 6 steel segments (2 per lane) in one InstancedMesh.
      // receiveShadow so player/overhead shadows land on the rail heads.
      const railGeo = new THREE.BoxGeometry(0.09, 0.14, len);
      const rails = new THREE.InstancedMesh(railGeo, lib.railSteel, 6);
      rails.castShadow = true;
      rails.receiveShadow = true;
      let ri = 0;
      for (let lane = -1; lane <= 1; lane++) {
        for (const off of [-0.72, 0.72]) {
          dummy.rotation.y = 0;
          dummy.position.set(lane * CONFIG.LANE_WIDTH + off, -0.09, len / 2);
          dummy.updateMatrix();
          rails.setMatrixAt(ri++, dummy.matrix);
        }
      }
      rails.instanceMatrix.needsUpdate = true;
      group.add(rails);

      // Side walls + steel caps (instanced, 2 each). Density 36 -> ~2.8 m
      // per tile, matching the baked formwork panel joints (2 horizontal +
      // 1 vertical per tile) so repeats read as precast panels.
      const wallGeo = fitBoxUVs(new THREE.BoxGeometry(0.5, 4.6, len), 0.5, 4.6, len, 36);
      const walls = new THREE.InstancedMesh(wallGeo, lib.concrete, 2);
      walls.castShadow = true;
      walls.receiveShadow = true;
      const capGeo = new THREE.BoxGeometry(0.62, 0.16, len);
      const caps = new THREE.InstancedMesh(capGeo, lib.steelDark, 2);
      caps.castShadow = true;
      for (let side = 0; side < 2; side++) {
        const x = side === 0 ? -5.9 : 5.9;
        dummy.position.set(x, 1.72, len / 2);
        dummy.updateMatrix();
        walls.setMatrixAt(side, dummy.matrix);
        dummy.position.set(x, 4.1, len / 2);
        dummy.updateMatrix();
        caps.setMatrixAt(side, dummy.matrix);
      }
      walls.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
      group.add(walls);
      group.add(caps);

      // NOTE: silhouette buildings moved OUT of chunks in wave 2 — the
      // detailed instanced building band (world/buildings.js) is global and
      // world-locked, so it does not depend on chunk lifecycle at all.

      return { group };
    });

    // Wave-2 special chunks (pooled; see world/chunks.js for safety notes).
    this.registerChunkType("station", (rng, ctx) => createStationChunk(ctx));
    this.registerChunkType("bridge", (rng, ctx) => createBridgeChunk(ctx));
  }

  /**
   * Chunk type for a stream index: station every 5th slot (m % 5 === 4),
   * bridge every ~4th (m % 4 === 2, station slots win), else base track.
   * Pure function of the index, so the ?seed plan is fully deterministic.
   * @param {number} index
   * @returns {"station"|"bridge"|"track"}
   * @private
   */
  _typeFor(index) {
    const m = ((index % PLAN_CYCLE) + PLAN_CYCLE) % PLAN_CYCLE;
    if (m % CONFIG.WORLD.STATION_PERIOD === 4) return "station";
    if (m % CONFIG.WORLD.BRIDGE_PERIOD === 2) return "bridge";
    return "track";
  }

  /**
   * Acquire (from pool or factory) + position a chunk.
   * @param {number} index
   * @private
   */
  _spawnChunk(index) {
    const type = this._typeFor(index);
    const factory = this._chunkTypes.get(type);
    if (!factory) return;
    let chunk = this._pools.get(type).pop();
    if (!chunk) {
      const rng = rngFor(this.seed, 0x57ace, index);
      chunk = factory(rng, {
        index,
        zStart: index * CHUNK_LEN,
        lib: this.lib,
        CHUNK_LEN: CHUNK_LEN,
        seed: this.seed,
      });
      chunk.type = type;
      this.scene.add(chunk.group);
    }
    // Pooled chunks re-roll their index-dependent details so a recycled
    // station/bridge looks exactly like a freshly generated one.
    if (chunk.refresh) chunk.refresh(index, this.seed);
    chunk.group.visible = true;
    chunk.group.position.z = index * CHUNK_LEN;
    this._active.set(index, chunk);
  }

  /** @private */
  _despawnChunk(index) {
    const chunk = this._active.get(index);
    if (!chunk) return;
    chunk.group.visible = false;
    this._pools.get(chunk.type).push(chunk);
    this._active.delete(index);
  }

  /**
   * Per-frame streaming + updates. Keep calling with the player's sim Z.
   * @param {number} dt
   * @param {number} playerZ
   */
  update(dt, playerZ) {
    const current = Math.floor(playerZ / CHUNK_LEN);
    const minIndex = current - 1;
    const maxIndex = current + this.maxChunksAhead;

    for (const index of [...this._active.keys()]) {
      if (index < minIndex || index > maxIndex) this._despawnChunk(index);
    }
    for (let i = minIndex; i <= maxIndex; i++) {
      if (!this._active.has(i)) this._spawnChunk(i);
    }
    for (const chunk of this._active.values()) {
      if (chunk.update) chunk.update(dt, playerZ);
    }

    // Ground follows the player; texture offset keeps it world-locked.
    const groundZ = playerZ + GROUND_LEN * 0.3;
    this._ground.position.z = groundZ;
    this._groundMat.map.offset.y = -groundZ / METERS_PER_GROUND_REPEAT;
    if (this._groundMat.normalMap) {
      this._groundMat.normalMap.offset.y = this._groundMat.map.offset.y;
      this._groundMat.roughnessMap.offset.y = this._groundMat.map.offset.y;
    }

    // Global dressing rings (buildings / skyline / corridor furniture).
    this._buildings.update(playerZ);
    this._skyline.update(playerZ);
    this._corridor.update(playerZ);

    window.__WORLD.chunks = this._active.size;
    window.__WORLD.buildings = this._buildings.count;
  }

  /** QA hook: renderer draw-call count, set by main after each render. */
  setDrawCalls(n) {
    window.__WORLD.drawCalls = n;
  }

  /** Recycle everything and rewind the stream (run restart). */
  reset() {
    for (const index of [...this._active.keys()]) this._despawnChunk(index);
    this._buildings.reset();
    this._skyline.reset();
    this._corridor.reset();
  }
}
