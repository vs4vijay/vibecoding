/**
 * @file game/vfx.js
 * WAVE 5 — game-feel particle layer. All particles are THREE.Points driven by
 * a custom ShaderMaterial (soft-disc point sprites computed in the fragment
 * shader) — NO THREE.Sprite/billboard objects anywhere (the QA GPU corrupts
 * the sprite renderer). Everything else is plain geometry (ring meshes,
 * LineSegments speed streaks).
 *
 * Systems:
 *  - spark pool  (additive Points): coin pickup bursts, coin trail glints,
 *    powerup sparks, crash debris glints.
 *  - dust pool   (alpha-blended Points): footstep puffs, landing bursts,
 *    crash dust.
 *  - powerup ring pulses: 2 pooled RingGeometry meshes (world-locked,
 *    expand + fade).
 *  - speed lines: 1 LineSegments mesh of world-locked streaks near the
 *    corridor edges; opacity ramps in above ~30 m/s (alpha <= 0.35).
 *
 * DETERMINISM: advanceFixed(dt) is called ONLY from the fixed sim step (the
 * same call sites as RunController.fixedUpdate — game frame loop and QA
 * fast-forward), so particle state at ?freeze is a pure function of
 * (seed, sim steps). All spawn randomness comes from rngFor(seed ^ salt,
 * emissionCounter): identical runs produce identical frozen frames.
 * No wall-clock time is read anywhere.
 *
 * Draw calls: +2 (Points pools, always present) +1 (speed lines) +<=2
 * (ring meshes, hidden when idle). Nothing else.
 */
import * as THREE from "three";
import { rngFor } from "../core/rng.js";

// --- Tunables ---------------------------------------------------------------
const TUNE = {
  sparkPool: 224,
  dustPool: 160,
  coinBurstCount: 10,
  coinBurstSpeed: [2.2, 4.6],
  coinBurstLife: [0.4, 0.65],
  coinBurstGravity: -7.5,
  coinColor: [1.0, 0.83, 0.35],
  glintInterval: 0.22, // s between trail sparkles (when coins are near)
  glintLife: 0.38,
  glintSize: 0.16,
  footPuffCount: 3,
  footPuffLife: [0.3, 0.5],
  footPuffSize: [0.14, 0.24],
  footPuffAlpha: 0.34,
  dustColor: [0.42, 0.36, 0.29], // ballast brown
  landBurstCount: 12,
  landBurstLife: [0.4, 0.7],
  crashCount: 26,
  ringLife: 0.5,
  ringMaxScale: 2.4,
  speedLineStart: 26, // m/s where streaks begin (ramp reaches ~29 at t=35)
  speedLineFull: 40, // m/s where they reach full alpha
  speedLineAlpha: 0.32, // perceptible at gameplay distance, still subtle
  speedLineCount: 52, // segments total (both sides)
  speedLineSpacing: 9, // m between streak slots along z
  speedLineColor: 0xf5efe2,
};

/** Soft round point-sprite fragment shader shared by both pools. */
const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = aSize * 620.0 / max( 0.6, -mv.z );
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot( d, d );
    if ( r2 > 0.25 ) discard;
    float a = smoothstep( 0.25, 0.03, r2 );
    gl_FragColor = vec4( vColor.rgb, vColor.a * a );
  }
`;

/**
 * One pooled Points cloud. Simulation is CPU-side over plain typed arrays;
 * attributes are rewritten each fixed step (needsUpdate once per step).
 */
class PointPool {
  /**
   * @param {THREE.Scene} scene
   * @param {number} cap
   * @param {THREE.Blending} blending
   */
  constructor(scene, cap, blending) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.baseAlpha = new Float32Array(cap);
    this.life = new Float32Array(cap); // remaining
    this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.twinkle = new Uint8Array(cap);
    this.cursor = 0;
    this.simTime = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never culled
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.castShadow = false;
    scene.add(this.points);
  }

  /**
   * Spawn one particle (round-robin overwrite = bounded, allocation-free).
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, alpha, size, life, grav, twinkle) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const i4 = i * 4;
    this.col[i4] = r;
    this.col[i4 + 1] = g;
    this.col[i4 + 2] = b;
    this.col[i4 + 3] = alpha;
    this.size[i] = size;
    this.baseAlpha[i] = alpha;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.twinkle[i] = twinkle ? 1 : 0;
  }

  /**
   * Advance the whole pool by a fixed dt and rewrite the attributes.
   * dt === 0 (QA freeze warmup) leaves everything bit-identical.
   * @param {number} dt
   */
  advance(dt) {
    if (dt > 0) this.simTime += dt;
    const t = this.simTime;
    for (let i = 0; i < this.cap; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      if (this.life[i] <= 0) {
        if (this.col[i4 + 3] !== 0 || this.size[i] !== 0) {
          this.col[i4 + 3] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      if (dt > 0) {
        this.life[i] -= dt;
        this.vel[i3 + 1] += this.grav[i] * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        if (this.pos[i3 + 1] < 0.02) {
          this.pos[i3 + 1] = 0.02;
          this.vel[i3 + 1] *= -0.25;
          this.vel[i3] *= 0.82;
          this.vel[i3 + 2] *= 0.82;
        }
        // Died this step: retire immediately so the buffer state after every
        // advanceFixed is final (advanceFixed(0) freeze warmup is then a
        // true no-op and warmup frames stay bit-identical).
        if (this.life[i] <= 0) {
          this.col[i4 + 3] = 0;
          this.size[i] = 0;
          continue;
        }
      }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      // Ease-out fade: holds near-full brightness then falls away.
      let a = this.baseAlpha[i] * (k < 0.6 ? k / 0.6 : 1) * (0.35 + 0.65 * k);
      if (this.twinkle[i]) a *= 0.55 + 0.45 * Math.sin(t * 42 + i * 1.7);
      this.col[i4 + 3] = a;
      // Dust grows slightly as it dissipates; sparks shrink.
      if (this.grav[i] > -2) this.size[i] *= dt > 0 ? 1 + 0.9 * dt : 1;
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }
}

export class VfxSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {number} seed Run seed (deterministic spawn streams).
   * @param {import("../core/events.js").Emitter} events Run event bus.
   */
  constructor(scene, seed, events) {
    this.scene = scene;
    this.seed = seed;
    this.sparks = new PointPool(scene, TUNE.sparkPool, THREE.AdditiveBlending);
    this.dust = new PointPool(scene, TUNE.dustPool, THREE.NormalBlending);

    // --- Powerup ring pulses (2 pooled world-locked ring meshes) ----------
    this._rings = [];
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.55, 28),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -100;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this._rings.push({ mesh, life: 0, maxLife: TUNE.ringLife });
    }
    this._ringCursor = 0;

    // --- Speed lines: world-locked streak segments near the corridor edges --
    const sl = TUNE.speedLineCount;
    const slPos = new Float32Array(sl * 2 * 3);
    const slGeo = new THREE.BufferGeometry();
    slGeo.setAttribute("position", new THREE.BufferAttribute(slPos, 3).setUsage(THREE.DynamicDrawUsage));
    slGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this._speedLineMat = new THREE.LineBasicMaterial({
      color: TUNE.speedLineColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._speedLines = new THREE.LineSegments(slGeo, this._speedLineMat);
    this._speedLines.frustumCulled = false;
    this._speedLines.renderOrder = 1;
    scene.add(this._speedLines);
    this._speedLineBand = -1; // which 1-slot band of playerZ the window is built for

    // --- Event wiring + ambient state --------------------------------------
    this._rngCounter = 0;
    this._glintTimer = 0;
    this._player = { x: 0, y: 0, z: 0, speed: 0, phase: "idle" };
    if (events) {
      events.on("coin", (x, y, z) => this.coinBurst(x, y, z));
      events.on("powerup", (type, x, y, z) => this.powerupRing(type, x, y, z));
      events.on("jump", () => this.footPuffs(4, 1.15));
      events.on("land", (impact) => this.landBurst(impact));
      events.on("roll", () => this.footPuffs(5, 1.3));
      events.on("step", (x, z) => this.footPuffs(TUNE.footPuffCount, 1, x, z));
      events.on("crash", (x, y, z) => this.crashBurst(x, y, z));
      events.on("reset", () => this.reset());
    }
  }

  /** Next seeded rng for spawn jitter (deterministic per emission order). */
  _rng() {
    return rngFor(this.seed ^ 0x5f4c, this._rngCounter++, 0x9e37);
  }

  // -------------------------------------------------------------------------
  // Public effects (also callable directly; events wire the common ones)
  // -------------------------------------------------------------------------

  /** Gold burst at a collected coin. */
  coinBurst(x, y, z) {
    const n = TUNE.coinBurstCount;
    const [r, g, b] = TUNE.coinColor;
    for (let i = 0; i < n; i++) {
      const rng = this._rng();
      const a = rng.next() * Math.PI * 2;
      const up = 0.35 + rng.next() * 0.9;
      const sp = TUNE.coinBurstSpeed[0] + rng.next() * (TUNE.coinBurstSpeed[1] - TUNE.coinBurstSpeed[0]);
      this.sparks.spawn(
        x, y, z,
        Math.cos(a) * sp * (1 - up * 0.55), up * sp * 0.85, Math.sin(a) * sp * (1 - up * 0.55),
        r, g, b, 0.95,
        0.055 + rng.next() * 0.05,
        TUNE.coinBurstLife[0] + rng.next() * (TUNE.coinBurstLife[1] - TUNE.coinBurstLife[0]),
        TUNE.coinBurstGravity, false,
      );
    }
  }

  /** Expanding tinted ring + a few sparks at a powerup pickup. */
  powerupRing(type, x, y, z) {
    const ring = this._rings[this._ringCursor];
    this._ringCursor = (this._ringCursor + 1) % this._rings.length;
    ring.life = TUNE.ringLife;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, Math.max(0.06, y - 0.5), z);
    ring.mesh.scale.setScalar(0.5);
    const color = type === "magnet" ? 0xe05038 : type === "jetpack" ? 0xffa03a : 0xffd05a;
    ring.mesh.material.color.setHex(color);
    // A short spark fountain in the pickup color.
    const c = new THREE.Color(color);
    for (let i = 0; i < 8; i++) {
      const rng = this._rng();
      const a = rng.next() * Math.PI * 2;
      this.sparks.spawn(
        x, y, z,
        Math.cos(a) * 1.6, 1.8 + rng.next() * 1.8, Math.sin(a) * 1.6,
        c.r, c.g, c.b, 0.9, 0.06 + rng.next() * 0.04, 0.45, -6, false,
      );
    }
  }

  /** Small soft brown puffs near a foot contact (defaults to the player). */
  footPuffs(count, strength = 1, x = null, z = null) {
    const px = x === null ? this._player.x : x;
    const pz = z === null ? this._player.z : z;
    const py = 0.06;
    const [dr, dg, db] = TUNE.dustColor;
    for (let i = 0; i < count; i++) {
      const rng = this._rng();
      const a = rng.next() * Math.PI * 2;
      const sp = (0.5 + rng.next() * 1.1) * strength;
      this.dust.spawn(
        px + Math.cos(a) * 0.12, py, pz + Math.sin(a) * 0.12,
        Math.cos(a) * sp, 0.35 + rng.next() * 0.75 * strength, Math.sin(a) * sp - 0.4,
        dr, dg, db, TUNE.footPuffAlpha,
        TUNE.footPuffSize[0] + rng.next() * (TUNE.footPuffSize[1] - TUNE.footPuffSize[0]),
        TUNE.footPuffLife[0] + rng.next() * (TUNE.footPuffLife[1] - TUNE.footPuffLife[0]),
        -1.2, false,
      );
    }
  }

  /** Dust ring on landing, scaled by impact speed. */
  landBurst(impact) {
    const n = Math.round(TUNE.landBurstCount * Math.min(1.3, 0.6 + impact / 14));
    const [dr, dg, db] = TUNE.dustColor;
    for (let i = 0; i < n; i++) {
      const rng = this._rng();
      const a = rng.next() * Math.PI * 2;
      const sp = 1.4 + rng.next() * 2.4;
      this.dust.spawn(
        this._player.x + Math.cos(a) * 0.2, 0.08, this._player.z + Math.sin(a) * 0.2,
        Math.cos(a) * sp, 0.5 + rng.next() * 1.2, Math.sin(a) * sp,
        dr, dg, db, 0.42,
        0.16 + rng.next() * 0.14,
        TUNE.landBurstLife[0] + rng.next() * (TUNE.landBurstLife[1] - TUNE.landBurstLife[0]),
        -2.2, false,
      );
    }
  }

  /** Crash: brown dust + a few gold glints flying off the runner. */
  crashBurst(x, y, z) {
    const [dr, dg, db] = TUNE.dustColor;
    for (let i = 0; i < TUNE.crashCount; i++) {
      const rng = this._rng();
      const gold = rng.chance(0.28);
      const a = rng.next() * Math.PI * 2;
      const sp = 2 + rng.next() * 4;
      const pool = gold ? this.sparks : this.dust;
      pool.spawn(
        x, y + 0.5 + rng.next() * 0.8, z,
        Math.cos(a) * sp, 1.5 + rng.next() * 3.4, Math.sin(a) * sp * 0.6 - 1.5,
        gold ? 1 : dr, gold ? 0.83 : dg, gold ? 0.35 : db,
        gold ? 0.95 : 0.5,
        gold ? 0.06 + rng.next() * 0.05 : 0.16 + rng.next() * 0.16,
        0.5 + rng.next() * 0.5,
        gold ? -9 : -3.5, false,
      );
    }
  }

  /**
   * Fixed-step advance. ALSO drives the two ambient systems:
   *  - coin trail glints (occasional sparkle on a nearby coin)
   *  - speed-line band rebuild + opacity (sim-speed driven)
   * @param {number} dt Fixed delta (0 during QA freeze warmup).
   * @param {{x: number, y: number, z: number, speed: number, phase: string, coinNear?: {x: number, y: number, z: number} | null}} info Player sim snapshot.
   */
  advanceFixed(dt, info) {
    this._player.x = info.x;
    this._player.y = info.y;
    this._player.z = info.z;
    this._player.speed = info.speed;
    this._player.phase = info.phase;

    // Ambient: coin trail sparkle.
    if (dt > 0 && info.phase === "running" && info.coinNear) {
      this._glintTimer -= dt;
      if (this._glintTimer <= 0) {
        this._glintTimer = TUNE.glintInterval * 0.7;
        // Larger, warmer, longer-lived: at dot scale the trail read as
        // scattered debris (judge final gauntlet). Coin-glint scale.
        this.sparks.spawn(
          info.coinNear.x, info.coinNear.y, info.coinNear.z,
          0, 0.22, 0,
          1, 0.82, 0.32, 1.0, TUNE.glintSize * 2.6, TUNE.glintLife * 1.5, 0, true,
        );
      }
    }

    // Ambient: speed lines (opacity from sim speed, band rebuild from z).
    this._updateSpeedLines(dt, info);

    this.sparks.advance(dt);
    this.dust.advance(dt);

    // Ring pulses.
    for (const ring of this._rings) {
      if (ring.life <= 0) continue;
      if (dt > 0) ring.life -= dt;
      const k = Math.max(0, ring.life / ring.maxLife); // 1 -> 0
      ring.mesh.scale.setScalar(0.5 + (1 - k) * TUNE.ringMaxScale);
      ring.mesh.material.opacity = k * k * 0.85;
      if (ring.life <= 0) ring.mesh.visible = false;
    }
  }

  /**
   * Rebuild the speed-line window around the player. Every segment is a PURE
   * function of its world slot index k (x/y/length/z jitter all derive from
   * rngFor(seed, k)), so sliding the window rewrites unchanged slots
   * bit-identically — streaks are world-locked, recycling never pops, and
   * rewind (?seed replay) reproduces the exact same field.
   * @private
   */
  _updateSpeedLines(dt, info) {
    const k = THREE.MathUtils.clamp(
      (info.speed - TUNE.speedLineStart) / (TUNE.speedLineFull - TUNE.speedLineStart),
      0,
      1,
    );
    const playing = info.phase === "running";
    this._speedLineMat.opacity = k * k * TUNE.speedLineAlpha * (playing ? 1 : 0);
    const band = Math.round(info.z / TUNE.speedLineSpacing);
    if (band !== this._speedLineBand) {
      this._speedLineBand = band;
      const attr = this._speedLines.geometry.attributes.position;
      const arr = attr.array;
      const half = TUNE.speedLineCount / 2;
      for (let i = 0; i < TUNE.speedLineCount; i++) {
        const slot = band - half + i; // world slot index (world-locked)
        const rng = rngFor(this.seed ^ 0x5eed, slot, 0x9e37);
        const side = rng.chance(0.5) ? -1 : 1;
        const x = side * (3.05 + rng.next() * 1.5); // just inside the wall face
        const y = 0.5 + rng.next() * 3.4;
        const len = 1.7 + rng.next() * 1.7;
        const z0 = slot * TUNE.speedLineSpacing + rng.next() * TUNE.speedLineSpacing;
        const o = i * 6;
        arr[o] = x;
        arr[o + 1] = y;
        arr[o + 2] = z0;
        arr[o + 3] = x;
        arr[o + 4] = y;
        arr[o + 5] = z0 + len;
      }
      attr.needsUpdate = true;
    }
    void dt;
  }

  /** Restart cleanliness: kill every particle, ring, streak band. */
  reset() {
    this.sparks.life.fill(0);
    this.dust.life.fill(0);
    this.sparks.advance(0);
    this.dust.advance(0);
    for (const ring of this._rings) {
      ring.life = 0;
      ring.mesh.visible = false;
      ring.mesh.material.opacity = 0;
    }
    this._speedLineBand = -1;
    this._glintTimer = 0;
    this._rngCounter = 0;
  }
}

// Tunables exported for QA/tuning reference (see .qa/wave5-notes.md).
export const VFX_TUNE = TUNE;
