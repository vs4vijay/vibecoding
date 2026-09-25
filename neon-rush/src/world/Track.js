// 12 recycled chunks × 60 m, scrolling toward +Z (player runs toward −Z and
// stays near z=0). Recycle → repopulate from pools via Patterns. Owns:
//   - coins (single InstancedMesh, world-space records)
//   - the floor via registerFloor(factory) hook — W1-VIS swaps the default
//     neon grid shader through it at any time
//   - Track.decorate(fn) dressing hook + per-phase decorate(chunk, rng)
// Determinism: every gen decision consumes exactly one shared run RNG stream.
import * as THREE from 'three';
import { Chunk, LANE_X } from './Chunk.js';
import { Obstacles } from './Obstacles.js';
import { runPattern, resetBoxGap } from './Patterns.js';
import { RNG } from '../core/RNG.js';
import { Pool } from '../core/Pool.js';
import { COL } from '../core/Palette.js';
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { makeFloor } from '../fx/Shaders.js'; // W1-VIS: real grid floor factory

const CHUNK_LEN = 60;
const CHUNK_COUNT = 12;
const RECYCLE_Z = 80;      // fully-behind-camera threshold
const COIN_MAX = 512;
const ENTRY_CLEAR = 14;    // must match Patterns.js corridor

export class Track {
  constructor(scene) {
    this.scene = scene;
    this.scroll = 0;
    this.chunks = [];
    this.rng = Math.random; // replaced per-run by reset(seed)
    this.lastSafe = 1;
    this.dressers = [];
    // config wired by Game: speed(), difficulty(), fever(), phaseRemain()
    this.config = { speed: () => 14, difficulty: () => 0, fever: () => false, phaseRemain: () => 99 };

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const c = new Chunk(i);
      this.chunks.push(c);
      scene.add(c.group);
    }

    this.floorFactory = null;
    this.floor = null;
    this.buildFloor();

    // --- coins: pooled records + one InstancedMesh ---
    this.coinPool = new Pool(
      () => ({ x: 0, y: 0, z: 0, phase: 0 }),
      () => {},
      'coins',
    );
    this.coins = [];
    // W1-VIS coin look: glowing gold octahedron gem with emissive pulse
    // (was a flat cylinder disc). Geometry only — hitbox/collect logic untouched.
    const coinGeo = new THREE.OctahedronGeometry(0.36);
    coinGeo.scale(1, 1.45, 1);
    this.coinMat = new THREE.MeshStandardMaterial({
      color: 0x3a2604, emissive: COL.gold, emissiveIntensity: 2.0,
      metalness: 0.35, roughness: 0.18, flatShading: true,
    });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, this.coinMat, COIN_MAX);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    scene.add(this.coinMesh);

    // reusable math temps — zero allocs in update loops
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._coinPayload = { x: 0, y: 0, z: 0, value: 1 };
    this._time = 0;
  }

  // --- registration hooks ----------------------------------------------------

  registerFloor(factory) {
    this.floorFactory = factory;
    this.buildFloor();
  }

  registerDresser(fn) { this.dressers.push(fn); }

  decorate(chunk, rng) {
    for (let i = 0; i < this.dressers.length; i++) this.dressers[i](chunk, rng);
  }

  buildFloor() {
    if (this.floor) {
      this.scene.remove(this.floor);
      if (this.floor.userData.isDefault) {
        this.floor.geometry.dispose();
        this.floor.material.dispose();
      }
      this.floor = null;
    }
    if (this.floorFactory) {
      this.floor = this.floorFactory();
      this.floor.userData.isDefault = false;
    } else {
      this.floor = this.makeDefaultFloor();
    }
    this.scene.add(this.floor);
  }

  // W1-VIS: default floor now comes from fx/Shaders.js (same factory contract:
  // mesh with uScroll/uTime uniforms + userData.isDefault → applyRender feeds it).
  makeDefaultFloor() {
    return makeFloor();
  }

  // --- lifecycle -------------------------------------------------------------

  reset(seed) {
    this.scroll = 0;
    this.rng = RNG(seed);
    resetBoxGap(); // [FX R3] gen state starts clean per run — stream = f(seed) only
    Obstacles.clear();
    this.clearCoins();
    this.lastSafe = 1;
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const c = this.chunks[i];
      c.baseZ = 60 - i * CHUNK_LEN;
      Obstacles.releaseAllFor(c);
      c.reset();
    }
    for (let i = 0; i < CHUNK_COUNT; i++) this.populate(this.chunks[i]);
    this.applyRender(this.scroll, 0);
  }

  teleport(m) {
    this.scroll = m;
    Obstacles.clear();
    this.clearCoins();
    this.lastSafe = 1;
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const c = this.chunks[i];
      c.baseZ = 60 - i * CHUNK_LEN - m;
      Obstacles.releaseAllFor(c);
      c.reset();
    }
    for (let i = 0; i < CHUNK_COUNT; i++) this.populate(this.chunks[i]);
    this.applyRender(this.scroll, 0);
  }

  update(dt, speed, player) {
    this._time += dt;
    const ds = speed * dt;
    this.scroll += ds;

    // coins: move +z, collect, despawn
    const coins = this.coins;
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.z += ds;
      if (c.z > 14) {
        coins[i] = coins[coins.length - 1]; coins.pop();
        this.coinPool.release(c);
        continue;
      }
      if (player && c.z > -1.1 && c.z < 1.1 &&
          Math.abs(c.x - player.x) < 0.95 &&
          Math.abs(c.y - (player.y + 0.8)) < 1.05) {
        coins[i] = coins[coins.length - 1]; coins.pop();
        this.coinPool.release(c);
        const p = this._coinPayload;
        p.x = c.x; p.y = c.y; p.z = 0; p.value = 1;
        bus.emit('coin', p);
        sound('coin');
      }
    }

    // chunk recycle
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const c = this.chunks[i];
      const top = c.baseZ + this.scroll;
      if (top - CHUNK_LEN > RECYCLE_Z) {
        c.baseZ -= CHUNK_COUNT * CHUNK_LEN;
        Obstacles.releaseAllFor(c);
        c.reset();
        this.populate(c);
      }
    }
  }

  populate(chunk) {
    Obstacles.releaseAllFor(chunk);
    chunk.reset();
    const rng = this.rng;
    const speed = this.config.speed();
    const diff = this.config.difficulty();
    const fever = this.config.fever();
    chunk.safeLane = this.lastSafe;

    // eta: seconds until the chunk's near edge reaches the player
    const eta = -(chunk.baseZ + this.scroll) / Math.max(speed, 0.001);
    // no obstacle spawns within 1.2 reaction-s of a phase boundary (§12.3)
    const remain = this.config.phaseRemain();
    const chunkSpan = CHUNK_LEN / Math.max(speed, 0.001);
    const nearBoundary = remain < 1.35 && eta < remain + 0.25 && eta + chunkSpan > remain - 1.25;
    const calm = eta < 2.4 || nearBoundary;

    const track = this;
    const ctx = {
      rng,
      safeIn: chunk.safeLane,
      safeOut: chunk.safeLane, // patterns overwrite this (or return it)
      patternId: '',
      chance: (p) => rng() < p,
      range: (a, b) => a + rng() * (b - a),
      place: (type, lane, z) => {
        Obstacles.spawn(type, chunk, lane, Math.max(-CHUNK_LEN + 2, Math.min(-2, z)));
      },
      coin: (lane, z, y = 0.55) => {
        if (track.coins.length >= COIN_MAX) return;
        const c = track.coinPool.get();
        c.x = LANE_X[lane];
        c.y = y;
        c.z = chunk.baseZ + track.scroll + Math.max(-CHUNK_LEN + 2, Math.min(-2, z));
        c.phase = rng() * Math.PI * 2;
        track.coins.push(c);
      },
    };
    runPattern(rng, diff, fever, calm, ctx); // sets ctx.patternId
    // continuity: the pattern's exit lane is the next chunk's guaranteed-clear entry
    this.lastSafe = Math.max(0, Math.min(2, ctx.safeOut | 0));
    chunk.pattern = ctx.patternId;

    this.decorate(chunk, rng);
  }

  clearCoins() {
    const coins = this.coins;
    for (let i = 0; i < coins.length; i++) this.coinPool.release(coins[i]);
    coins.length = 0;
  }

  // --- render-side (per frame) ------------------------------------------------

  // renderScroll = scroll + speed * time.acc  (contract: render interpolation)
  applyRender(renderScroll, time) {
    const frac = renderScroll - this.scroll;
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const c = this.chunks[i];
      c.group.position.z = c.baseZ + renderScroll;
    }
    // coins
    const coins = this.coins;
    this.coinMesh.count = coins.length;
    this.coinMesh.visible = coins.length > 0;
    // W1-VIS: emissive pulse — coins read as glowing gems (pre-bloom glow bake)
    this.coinMat.emissiveIntensity = 1.7 + Math.sin(this._time * 5.2) * 0.55;
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      e.set(0, this._time * 3.5 + c.phase, 0);
      q.setFromEuler(e);
      p.set(c.x, c.y, c.z + frac);
      m.compose(p, q, s);
      this.coinMesh.setMatrixAt(i, m);
    }
    if (coins.length) this.coinMesh.instanceMatrix.needsUpdate = true;
    // floor
    if (this.floor && this.floor.userData.isDefault) {
      const u = this.floor.material.uniforms;
      u.uScroll.value = renderScroll;
      u.uTime.value = time;
    }
  }
}
