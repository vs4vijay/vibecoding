/**
 * @file world/world.js
 * 40 m chunk streaming + the continuous road/desert shells.
 *
 *   world.registerChunkType(name, factory)  // factory(rng, ctx) -> group
 *   world.setPlan([...names])               // chunk-type sequence (cycled)
 *   world.onChunkActive(fn)                 // fn(index, zStart) on spawn
 *   world.onChunkInactive(fn)               // fn(index) on despawn
 *   world.setGameplay(bool)                 // dressing flag -> factory ctx
 *   world.update(dt, camZ)                  // streaming + world-locked shells
 *   window.__WORLD = { chunks, drawCalls, pending }
 *
 * The asphalt road and desert floor are single long planes that ride just
 * ahead of the camera; their textures stay WORLD-LOCKED by feeding
 * offset.y = -centerZ / tileLength (verified sign derivation: local +Y maps
 * to world -Z after rotation.x = -PI/2), so the road never "swims" while
 * chunk geometry (guardrails, wrecks) sits at fixed world positions.
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";
import { rngFor } from "../core/rng.js";
import { registerWorldChunks } from "./chunks.js";
import { Dust } from "./dust.js";

// Chunk-type tags for per-chunk RNG derivation (numeric for hashSeed).
const TAG = { plain: 1, wreck: 2, convoy: 3 };

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../core/assets.js").materialLibrary} lib
   * @param {number} seed Run seed.
   * @param {object} preset Quality preset.
   * @param {"dusk"|"night"} timeOfDay
   */
  constructor(scene, lib, seed, preset, timeOfDay = "dusk") {
    this.scene = scene;
    this.lib = lib;
    this.seed = seed;
    this.maxChunksAhead = preset.maxChunksAhead;
    this._chunkTypes = new Map();
    this._pools = new Map();
    /** @type {Map<number, {group: THREE.Group, type: string}>} */
    this._active = new Map();
    this._plan = CONFIG.CHUNK_PLAN.slice();
    this._pending = 0;
    // Chunk-activation callbacks (design 3: the director pre-builds on
    // activation, releases on deactivation) + the gameplay dressing flag.
    this._activeCbs = [];
    this._inactiveCbs = [];
    this._gameplay = false;

    this._buildShells();
    // Chunk builders also return the world-owned dressing managers: the
    // shambler pool (one InstancedMesh posed per frame) and the static
    // dressing pool (one InstancedMesh per material group, rewritten only
    // when the streamed chunk set changes — see chunks.js createDressingPool).
    const { shamblers, dressing } = registerWorldChunks(this, lib, seed);
    this._shamblers = shamblers;
    this._dressing = dressing;
    this.scene.add(this._shamblers.mesh, this._dressing.group);
    this.dust = new Dust(scene, lib, preset.dust);

    window.__WORLD = { chunks: 0, drawCalls: 0, pending: 0 };
  }

  /** Continuous road + desert planes (world-locked via texture offset). */
  _buildShells() {
    const len = CONFIG.ROAD_AHEAD + CONFIG.ROAD_BEHIND;
    this._shellLen = len;

    // Road: u spans the paved width exactly; v repeats along the highway.
    const roadMat = this.lib.get("road");
    this._roadTile = CONFIG.ROAD_TILE_LEN;
    for (const key of ["map", "normalMap", "roughnessMap", "aoMap"]) {
      const tex = roadMat[key];
      if (tex) {
        tex.repeat.set(1, len / this._roadTile);
        tex.needsUpdate = true;
      }
    }
    this._roadMat = roadMat;
    this._road = new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.ROAD_WIDTH, len), roadMat);
    this._road.rotation.x = -Math.PI / 2;
    this._road.receiveShadow = true;
    this.scene.add(this._road);

    // Desert floor sits just below the asphalt lip.
    const sandMat = this.lib.get("sand");
    this._sandTile = CONFIG.SAND_TILE_LEN;
    for (const key of ["map", "normalMap", "roughnessMap", "aoMap"]) {
      const tex = sandMat[key];
      if (tex) {
        tex.repeat.set((CONFIG.DESERT_HALF_W * 2) / this._sandTile, len / this._sandTile);
        tex.needsUpdate = true;
      }
    }
    this._sandMat = sandMat;
    this._sand = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.DESERT_HALF_W * 2, len),
      sandMat,
    );
    this._sand.rotation.x = -Math.PI / 2;
    this._sand.position.y = -0.06;
    this._sand.receiveShadow = true;
    this.scene.add(this._sand);
  }

  registerChunkType(name, factory) {
    this._chunkTypes.set(name, factory);
    if (!this._pools.has(name)) this._pools.set(name, []);
  }

  setPlan(names) {
    if (names.length > 0) this._plan = names.slice();
  }

  /** Register a spawn callback: fn(index, zStart) fires per chunk entering
   *  the stream window (the director's pre-build hook, design 3). */
  onChunkActive(fn) {
    this._activeCbs.push(fn);
  }

  /** Register a despawn callback: fn(index) fires per chunk leaving the
   *  window (the director's release hook, design 3). */
  onChunkInactive(fn) {
    this._inactiveCbs.push(fn);
  }

  /** Gameplay dressing flag (design 4): flows into the factory ctx at
   *  (re)build time (chunks.js shifts on-road wreck slots to the shoulders).
   *  A flip INVALIDATES every built chunk — pooled chunks replay their
   *  build-time placement streams, so a stale pool would resurrect
   *  unshifted wrecks: live chunks despawn (inactive callbacks fire, same
   *  path as reset()) and the pools flush; the next update() re-streams.
   *  Only the small per-chunk vehicle meshes rebuild; shared geometry and
   *  the world-owned dressing pools are untouched. */
  setGameplay(on) {
    const next = !!on;
    if (next === this._gameplay) return;
    this._gameplay = next;
    this.reset();
    for (const pool of this._pools.values()) {
      for (const chunk of pool) {
        this.scene.remove(chunk.group);
        chunk.group.traverse((o) => {
          if (o.isInstancedMesh) o.dispose(); // frees per-chunk instance buffers
        });
      }
      pool.length = 0;
    }
  }

  get gameplay() {
    return this._gameplay;
  }

  /** Chunks spawned this frame (QA queue-drained check; sync = drains fast). */
  get pending() {
    return this._pending;
  }

  _spawnChunk(index) {
    const type = this._plan[((index % this._plan.length) + this._plan.length) % this._plan.length];
    const factory = this._chunkTypes.get(type);
    if (!factory) return;
    let chunk = this._pools.get(type).pop();
    if (!chunk) {
      const rng = rngFor(this.seed, TAG[type] || 7, index);
      chunk = {
        group: factory(rng, {
          index,
          zStart: index * CONFIG.CHUNK_LEN,
          lib: this.lib,
          gameplay: this._gameplay,
        }),
        type,
      };
      this.scene.add(chunk.group);
    }
    chunk.group.visible = true;
    chunk.group.position.z = index * CONFIG.CHUNK_LEN;
    this._active.set(index, chunk);
    this._pending++;
    for (let i = 0; i < this._activeCbs.length; i++) {
      this._activeCbs[i](index, index * CONFIG.CHUNK_LEN);
    }
  }

  _despawnChunk(index) {
    const chunk = this._active.get(index);
    if (!chunk) return;
    chunk.group.visible = false;
    this._pools.get(chunk.type).push(chunk);
    this._active.delete(index);
    for (let i = 0; i < this._inactiveCbs.length; i++) this._inactiveCbs[i](index);
  }

  /**
   * Per-frame streaming. Call with the camera/dolly's SIM z (not render z).
   * Callback order (design 3, deterministic): every inactive callback fires
   * before every active callback, each pass ascending by index (despawn
   * scans _active insertion order = spawn order). reset() fires inactives
   * only.
   * @param {number} dt Frame delta for the shambler dressing poses (chunks
   *   themselves stay static; frozen sims simply stop calling update).
   * @param {number} camZ
   */
  update(dt, camZ) {
    this._pending = 0;
    const current = Math.floor(camZ / CONFIG.CHUNK_LEN);
    const minIndex = current - CONFIG.STREAM.maxChunksBehind;
    const maxIndex = current + this.maxChunksAhead;
    for (const index of [...this._active.keys()]) {
      if (index < minIndex || index > maxIndex) this._despawnChunk(index);
    }
    for (let i = minIndex; i <= maxIndex; i++) {
      if (!this._active.has(i)) this._spawnChunk(i);
    }

    // Static dressing (chunks.js pool): re-emits instance buffers only when
    // the active chunk set changed; then shambler poses after streaming, so
    // freshly spawned chunks animate this frame; dt 0 writes the seeded t=0
    // poses.
    this._dressing.sync(this._active);
    this._shamblers.update(dt, this._active);

    // Shells ride ahead of the camera; offset keeps textures world-locked.
    const roadZ = camZ + CONFIG.ROAD_AHEAD - this._shellLen / 2;
    this._road.position.z = roadZ;
    const roadOffset = -roadZ / this._roadTile;
    this._roadMat.map.offset.y = roadOffset;
    if (this._roadMat.normalMap) {
      this._roadMat.normalMap.offset.y = roadOffset;
      this._roadMat.roughnessMap.offset.y = roadOffset;
      if (this._roadMat.aoMap) this._roadMat.aoMap.offset.y = roadOffset;
    }
    const sandZ = camZ + CONFIG.ROAD_AHEAD - this._shellLen / 2;
    this._sand.position.z = sandZ;
    const sandOffset = -sandZ / this._sandTile;
    this._sandMat.map.offset.y = sandOffset;
    if (this._sandMat.normalMap) {
      this._sandMat.normalMap.offset.y = sandOffset;
      this._sandMat.roughnessMap.offset.y = sandOffset;
      if (this._sandMat.aoMap) this._sandMat.aoMap.offset.y = sandOffset;
    }

    window.__WORLD.chunks = this._active.size;
    window.__WORLD.pending = 0; // synchronous spawn: queue always drained
  }

  setDrawCalls(n) {
    window.__WORLD.drawCalls = n;
  }

  /** Recycle everything (mode restart). */
  reset() {
    for (const index of [...this._active.keys()]) this._despawnChunk(index);
  }
}
