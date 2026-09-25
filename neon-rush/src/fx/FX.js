// FX (W1-FX) — pooled, GPU-friendly particle systems. No per-particle meshes:
//   sparks   — one THREE.Points cloud (ring buffer, custom shader)
//   shards   — one InstancedMesh (crash debris / confetti, per-instance HDR color)
//   rings    — 6 recycled shockwave meshes (flat on ground | vertical wall)
//   streaks  — one InstancedMesh of stretched boxes (phaseWarp tunnel)
//   trail    — one ribbon mesh streaming behind the player (track-space)
//   popText  — 16 pooled canvas-texture sprites ("+25 CLOSE!" style popups)
// Idle cost: 1–2 draw calls; hard worst case ~12. All buffers pre-allocated,
// ring-buffer cursors instead of allocs, additive blending, HDR colors so the
// bloom pass picks them up. API per ARCHITECTURE.md: FX.init(scene),
// FX.update(dt), FX.burst(name, position, opts), FX.spawn(name, opts).
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { COL } from '../core/Palette.js';
import { quality } from '../core/Quality.js';
import { PostFX } from './PostFX.js';

const SPARK_N = 1024;
const SHARD_N = 96;
const RING_N = 6;
const STREAK_N = 72;
const TRAIL_N = 40;
const POP_N = 16;

// HDR tints (values >1 → hot cores that feed UnrealBloomPass). r2 audit:
// white tempered to 1.75 — full 2.4 white stacked with the crash flash and
// bloom used to clip a pure-white blob at the wreck center (the palette rule
// reserves pure white for the sun core).
const TINT = {
  gold: new THREE.Color(2.6, 1.75, 0.55),
  cyan: new THREE.Color(0.55, 2.4, 2.6),
  magenta: new THREE.Color(2.6, 0.55, 1.9),
  white: new THREE.Color(1.75, 1.75, 1.85),
  red: new THREE.Color(2.8, 0.5, 0.7),
  orange: new THREE.Color(2.7, 1.2, 0.35),
  dust: new THREE.Color(0.9, 1.7, 1.9),
};
const CONFETTI = [TINT.cyan, TINT.magenta, TINT.gold, TINT.orange];

// module scratch — zero allocation in update loops
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------
const SPARK_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aFade;
  attribute float aSize;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vFade = aFade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 300.0 / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const SPARK_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.22, d) * vFade;
    float core = smoothstep(0.5, 0.0, d) * 0.7;
    gl_FragColor = vec4(vColor * (0.8 + core), a);
  }`;

const RING_VERT = /* glsl */`
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const RING_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vP;
  void main() {
    float t = clamp((length(vP) - 0.82) / 0.18, 0.0, 1.0);
    float band = sin(t * 3.14159);
    float a = band * uAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }`;

const TRAIL_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // near-camera fade: ribbon quads compress toward the camera and would
    // additive-stack into a white beam at the frame bottom
    vAlpha = aAlpha * smoothstep(2.2, 5.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const TRAIL_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(vColor * vAlpha, vAlpha); }`;

// ---------------------------------------------------------------------------
// popText canvas variants (built lazily once per full key, cached forever)
// ---------------------------------------------------------------------------
const POP_STYLES = {
  near: { text: 'CLOSE!', color: '#ffd24a' },
  nearAlt: { text: 'NEAR MISS', color: '#00f0ff' },
  great: { text: 'GREAT!', color: '#ff2bd6' },
};
// r2 (critic #1): CLOSE! and NEAR MISS are copy VARIANTS of ONE 'near' family —
// two rapid near-misses must REPLACE the live popup at the anchor, never stack
// an illegible CLOSE!+NEAR MISS overprint. The variant is picked inside
// spawnPop, so call sites pass the stable family key.
const POP_FAMILY = { near: 'near', nearAlt: 'near' };
function popSpec(key) {
  if (POP_STYLES[key]) return POP_STYLES[key];
  // r2: keys may carry a numeric suffix ('gain25') — resolve the base family
  // first so a bad suffix can never fall through to the 'GREAT!' default
  // (the old 'near0' bug read as GREAT! magenta instead of CLOSE! gold).
  const base = key.replace(/\d+$/, '');
  if (POP_STYLES[base]) return POP_STYLES[base];
  if (base === 'combo') return { text: 'COMBO x' + key.slice(5), color: '#00f0ff' };
  if (base === 'gain') return { text: '+' + key.slice(4), color: '#ffd24a' };
  return POP_STYLES.great;
}
const popTexCache = new Map();
function popTexture(key) {
  let tex = popTexCache.get(key);
  if (tex) return tex;
  const spec = popSpec(key);
  const W = 320, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.font = '800 46px Rajdhani, Orbitron, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = spec.color;
  g.shadowBlur = 22;
  g.fillStyle = '#ffffff';
  g.fillText(spec.text, W / 2, H / 2 + 2);
  g.shadowBlur = 0;
  g.fillStyle = spec.color;
  g.globalAlpha = 0.35;
  g.fillText(spec.text, W / 2, H / 2 + 2);
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  popTexCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
class FXSystems {
  constructor() {
    this.scene = null;
    this.game = null;
    this.time = 0;
    this.warpEndGt = -1;   // [r2] logic-time deadline for transition FX (debt #6)
    this._lastGt = -1;     // last seen Time.gameTime (drives gtDt)
    this._gtDt = 0;        // logic-time delta this frame (clamped)
    this.slideTrickle = 0;
    this.emitAcc = 0;
    this._pg = { grounded: true, slide: false, fallV: 0 };
    this._lastPX = 0; this._lastPY = 0; this._lastPS = 0; // trail emit tracker
    this.frame = 0;         // r2: bumped once per FX.update tick
    this.nearPopFrame = -1; // r2 (critic #3): frame of the last near popup spawn

    this._initSparks();
    this._initShards();
    this._initRings();
    this._initStreaks();
    this._initTrail();
    this._initPops();
  }

  // ---- construction (all buffers pre-allocated here) ------------------------

  _initSparks() {
    const n = SPARK_N;
    this.sp = {
      cur: 0,
      px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
      vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
      life: new Float32Array(n), max: new Float32Array(n),
      grav: new Float32Array(n), drag: new Float32Array(n),
      baseSize: new Float32Array(n),
      cr: new Float32Array(n), cg: new Float32Array(n), cb: new Float32Array(n),
      pos: new Float32Array(n * 3),
      col: new Float32Array(n * 3),
      fade: new Float32Array(n),
      size: new Float32Array(n),
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.sp.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFade', new THREE.BufferAttribute(this.sp.fade, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sp.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.sparkMesh = new THREE.Points(geo, mat);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.renderOrder = 20;
    this.sparkMesh.visible = false;
  }

  _initShards() {
    const geo = new THREE.TetrahedronGeometry(0.11);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, SHARD_N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 19;
    // hide all instances until first spawn (scale-0 matrix)
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < SHARD_N; i++) {
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh = mesh;
    this.sh = {
      cur: 0,
      px: new Float32Array(SHARD_N), py: new Float32Array(SHARD_N), pz: new Float32Array(SHARD_N),
      vx: new Float32Array(SHARD_N), vy: new Float32Array(SHARD_N), vz: new Float32Array(SHARD_N),
      rx: new Float32Array(SHARD_N), ry: new Float32Array(SHARD_N), rz: new Float32Array(SHARD_N),
      rvx: new Float32Array(SHARD_N), rvy: new Float32Array(SHARD_N), rvz: new Float32Array(SHARD_N),
      life: new Float32Array(SHARD_N), max: new Float32Array(SHARD_N),
      size: new Float32Array(SHARD_N),
    };
  }

  _initRings() {
    const geo = new THREE.RingGeometry(0.82, 1.0, 48);
    this.rings = [];
    for (let i = 0; i < RING_N; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 21;
      this.rings.push({ mesh, t: 1, dur: 1, from: 1, to: 2, alpha: 1, gt0: -1 });
    }
    this.ringCur = 0;
  }

  _initStreaks() {
    const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
    geo.translate(0, 0, 0.5); // pivot at head so z-scale streams backward
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, STREAK_N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < STREAK_N; i++) {
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, i % 2 ? TINT.cyan : TINT.magenta);
    }
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.streakMesh = mesh;
    this.st = {
      cur: 0,
      px: new Float32Array(STREAK_N), py: new Float32Array(STREAK_N), pz: new Float32Array(STREAK_N),
      vz: new Float32Array(STREAK_N), len: new Float32Array(STREAK_N), on: new Uint8Array(STREAK_N),
    };
  }

  _initTrail() {
    const n = TRAIL_N;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const alp = new Float32Array(n * 2);
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    // r2 restyle (debt #5): the trail is the PLAYER'S wake — palette rule says
    // self = cyan. Hot cyan head easing into a deep blue-violet tail; the old
    // magenta tail read as a hazard-grade laser (worst in hopper's top-down).
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      _c.setRGB(0.42, 1.65, 1.85).lerp(_c2.setRGB(0.14, 0.36, 1.05), f * f);
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.trailMesh = new THREE.Mesh(geo, mat);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 17;
    this.trailMesh.visible = false;
    this.tr = {
      x: new Float32Array(n), y: new Float32Array(n), s: new Float32Array(n),
      age: new Float32Array(n),
      brk: new Uint8Array(n), // r2: joint i breaks the strip between i-1 and i
    };
    for (let i = 0; i < n; i++) this.tr.s[i] = -1e9; // far behind → alpha 0
    this.trailT = 0.65; // max age (s)
  }

  _initPops() {
    this.pops = [];
    this.popOrder = 30; // monotonic renderOrder base (pops layer)
    for (let i = 0; i < POP_N; i++) {
      const mat = new THREE.SpriteMaterial({
        map: popTexture('great'), transparent: true, depthWrite: false, depthTest: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 30;
      this.pops.push({ sp, t: 1, dur: 1, rise: 1.4, sx: 1, family: '', variant: '', level: 0 });
    }
    this.popCur = 0;
  }

  // ---- lifecycle -------------------------------------------------------------

  init(scene) {
    this.scene = scene;
    scene.add(this.sparkMesh, this.shardMesh, this.streakMesh, this.trailMesh);
    for (const r of this.rings) scene.add(r.mesh);
    for (const p of this.pops) scene.add(p.sp);

    bus.on('coin', (p) => { if (!this._warpGate()) this.burst('coin', p); });
    // 'coin:x' is in the ARCHITECTURE bus contract but W0 never emits it —
    // wired here so Economy (later wave) gets popups + a juiced burst free.
    bus.on('coin:x', (p) => {
      if (this._warpGate()) return;
      this.spawnPop('gain', (p && (p.tier || p.value)) || 25, rand(-0.4, 0.4), 2.2);
      if (p && p.position) this.burst('coin', p.position);
    });
    bus.on('death', (p) => { if (p && p.position) this.burst('crash', p.position); });
    // r2 debt #2: 'near-miss' AND 'style:near-miss' are both emitted by the
    // player/flight-gate code, so listening to both fired the juice twice.
    // 'near-miss' is the canonical gameplay event (Scoring/Feel/Missions/
    // Director all consume it) — FX hooks that one only, visuals single-fire.
    bus.on('near-miss', () => this.onNearMiss());
    bus.on('combo:change', (p) => {
      if (this._warpGate()) return; // r2: combo pops sparked mid-warp leak into photos
      if (p && p.tier >= 2) this.spawnPop('combo', p.tier, rand(-0.5, 0.5));
    });
    bus.on('phase:transition', () => this.burst('warp', _v.set(0, 1, 0)));
    bus.on('box:open', (p) => this.burst('confetti', p && p.position ? p.position : _v.set(0, 1, 0)));
    bus.on('run:start', () => this.clear());
    bus.on('ui:screen', (s) => { if (s === 'menu') this.clear(); });
  }

  // gameplay state reader for jump/land/slide dust (Player emits no bus events
  // for these — polled here so Player.js stays untouched; gap noted in report)
  watch(game) {
    this.game = game;
    this._pg.grounded = game.player ? game.player.grounded : true;
    // [W1-FX r2] hand the logic clock to the post stack too: transition pulses
    // must decay on game time or photo captures catch a live CA/flash kick.
    PostFX.attachTime(game.time);
  }

  clear() {
    this.sp.life.fill(0);
    this.sh.life.fill(0);
    for (const r of this.rings) { r.t = 1; r.gt0 = -1; r.mesh.visible = false; }
    this.st.on.fill(0);
    for (let i = 0; i < TRAIL_N; i++) { this.tr.s[i] = -1e9; this.tr.brk[i] = 0; }
    for (const p of this.pops) { p.t = 1; p.sp.visible = false; }
    this.warpEndGt = -1;
    this.emitAcc = 0;
    this._lastPX = 0; this._lastPY = 0; this._lastPS = 0;
  }

  // ---- logic-time surface (debt #6) -------------------------------------------
  // Transition FX must live on GAME time: __NR.warp() advances logic without
  // rendering, so realtime-countdown FX randomly leak into photo captures.
  _gameTime() { return this.game ? this.game.time.gameTime : this.time; }

  // r2: true while __NR.warp() is mid-flight — bus-driven pops/bursts sparked
  // during a warp would decay in REALTIME inside deterministic photo captures.
  _warpGate() { return !!(this.game && this.game.warping); }

  _advanceGt(dt) {
    const gt = this._gameTime();
    if (this._lastGt < 0) this._lastGt = gt;
    // clamp: a warp() jump must not fast-forward live FX more than one step
    this._gtDt = Math.min(Math.max(gt - this._lastGt, 0), 0.25);
    this._lastGt = gt;
  }

  // ---- low-level emitters ------------------------------------------------------

  spark(x, y, z, vx, vy, vz, life, size, c, grav = 8, drag = 1.6) {
    const sp = this.sp;
    const i = sp.cur; sp.cur = (sp.cur + 1) % SPARK_N;
    sp.px[i] = x; sp.py[i] = y; sp.pz[i] = z;
    sp.vx[i] = vx; sp.vy[i] = vy; sp.vz[i] = vz;
    sp.life[i] = life; sp.max[i] = life;
    sp.grav[i] = grav; sp.drag[i] = drag;
    sp.baseSize[i] = size;
    sp.cr[i] = c.r; sp.cg[i] = c.g; sp.cb[i] = c.b;
  }

  shard(x, y, z, vx, vy, vz, life, size, c) {
    const sh = this.sh;
    const i = sh.cur; sh.cur = (sh.cur + 1) % SHARD_N;
    sh.px[i] = x; sh.py[i] = y; sh.pz[i] = z;
    sh.vx[i] = vx; sh.vy[i] = vy; sh.vz[i] = vz;
    sh.rx[i] = rand(0, 6.28); sh.ry[i] = rand(0, 6.28); sh.rz[i] = rand(0, 6.28);
    sh.rvx[i] = rand(-9, 9); sh.rvy[i] = rand(-9, 9); sh.rvz[i] = rand(-9, 9);
    sh.life[i] = life; sh.max[i] = life;
    sh.size[i] = size;
    this.shardMesh.setColorAt(i, c);
    this.shardMesh.instanceColor.needsUpdate = true;
  }

  ring(pos, { from = 0.3, to = 2.4, dur = 0.5, color = TINT.gold, alpha = 1, mode = 'flat', gt = null } = {}) {
    const r = this.rings[this.ringCur];
    this.ringCur = (this.ringCur + 1) % RING_N;
    r.t = 0; r.dur = dur; r.from = from; r.to = to; r.alpha = alpha;
    // gt: absolute logic-time the ring starts at — lifetime then follows game
    // time (photo-deterministic; used by the phase-transition burst)
    r.gt0 = gt != null ? gt : -1;
    r.mesh.position.set(pos.x, pos.y, pos.z);
    r.mesh.rotation.set(mode === 'flat' ? -Math.PI / 2 : 0, 0, 0);
    r.mesh.material.uniforms.uColor.value.copy(color);
    r.mesh.visible = true;
  }

  spawnPop(key, n, xOff = 0, y = 1.9) {
    const base = key.replace(/\d+$/, '');
    const family = POP_FAMILY[base] || base;
    let fullKey = n ? key + n : key; // combo2..combo5 / gain25 variants; 0 = no suffix
    // r2 popup ordering (debt #4): a new popup of the SAME family (COMBO x2 →
    // x3, +10 → +10) REPLACES the live one instead of stacking a pile, and
    // every spawn takes a renderOrder above all existing pops so the latest
    // always reads on top.
    let p = null;
    for (let i = 0; i < POP_N; i++) {
      if (this.pops[i].sp.visible && this.pops[i].family === family) { p = this.pops[i]; break; }
    }
    // r2 (critic #1): the near copy variant is chosen HERE so the family key
    // call sites pass stays stable and same-family replacement still fires.
    // r3 (critic item 6): the variant is PINNED PER CHAIN — a replacement
    // reuses the live popup's copy, so a replaced CLOSE! never re-rolls to
    // NEAR MISS mid-combo. A fresh chain (nothing live) rolls a new variant.
    if (family === 'near' && !n) {
      fullKey = (p && p.variant) ? p.variant : (Math.random() < 0.5 ? 'near' : 'nearAlt');
    }
    if (!p) {
      p = this.pops[this.popCur];
      this.popCur = (this.popCur + 1) % POP_N;
      p.family = family;
    }
    p.variant = fullKey;
    p.sp.material.map = popTexture(fullKey);
    p.sp.material.opacity = 1;
    const pl = this.game && this.game.player;
    const px = pl ? pl.x + xOff : xOff;
    let py = (pl ? pl.y : 0) + y;
    // r2 (critic #2): ladder-offset — the new popup takes the lowest rung
    // (0.55 steps above its anchor) whose resulting y is ≥0.45 clear of every
    // live popup, so CLOSE! / +25 / COMBO xN coexist as a readable column even
    // when anchors differ (+25 sits at hazard height) and families replace
    // each other within the same frame.
    let level = 0;
    for (; level < POP_N; level++) {
      const cy = py + level * 0.55;
      let clash = false;
      for (let i = 0; i < POP_N; i++) {
        const q = this.pops[i];
        if (q === p || !q.sp.visible) continue;
        if (Math.abs(q.sp.position.y - cy) < 0.45) { clash = true; break; }
      }
      if (!clash) break;
    }
    p.level = level;
    p.sp.position.set(px, py + level * 0.55, 0.5);
    p.sp.scale.set(2.6, 0.78, 1);
    p.sp.renderOrder = ++this.popOrder; // monotonic → latest drawn last (on top)
    p.t = 0; p.dur = 1.05; p.rise = 1.5; p.sx = 2.6;
    p.sp.visible = true;
  }

  onNearMiss() {
    // r2: same guard Feel uses — near-miss FX sparked mid-warp would leak
    // realtime-faded popups/sparks into deterministic photo captures.
    if (this.game && this.game.warping) return;
    const d = quality.flags.particleDensity;
    // r2 (critic #1): ONE 'near' family — copy variant picked inside spawnPop.
    this.spawnPop('near', 0, rand(-0.5, 0.5));
    // r2 (critic #3): Feel reads this stamp to suppress its '+25' popup on the
    // same frame (handlers run in one synchronous bus emit before FX.update
    // bumps the counter).
    this.nearPopFrame = this.frame;
    PostFX.kick(0.14);
    const pl = this.game && this.game.player;
    const x = pl ? pl.x : 0, y = (pl ? pl.y : 0) + 1;
    for (let i = 0, n = Math.round(6 * d); i < n; i++) {
      const a = rand(0, 6.28);
      this.spark(x, y, 0.6, Math.cos(a) * rand(1, 3), Math.sin(a) * rand(1, 3), rand(0.5, 2),
        rand(0.25, 0.45), rand(0.22, 0.4), Math.random() < 0.5 ? TINT.gold : TINT.cyan, 2, 3);
    }
  }

  // ---- bursts (API) -------------------------------------------------------------

  burst(name, position, opts = {}) {
    const p = position || _v.set(0, 1, 0);
    const px = p.x, py = p.y, pz = p.z || 0;
    const d = quality.flags.particleDensity;
    switch (name) {
      case 'coin': {
        const n = Math.round(rand(9, 13) * d);
        for (let i = 0; i < n; i++) {
          const a = rand(0, 6.28), e = rand(-0.6, 1);
          const v = rand(2.2, 5.2);
          this.spark(px, py, pz, Math.cos(a) * v, e * v + 1.2, Math.sin(a) * v * 0.6,
            rand(0.35, 0.65), rand(0.3, 0.55), TINT.gold, 6, 2.2);
        }
        this.ring(p, { to: rand(1.7, 2.3), dur: 0.4, color: TINT.gold, alpha: 0.9 });
        break;
      }
      case 'crash': {
        const accent = this.accentColor();
        const nSh = Math.round(52 * Math.max(0.6, d));
        for (let i = 0; i < nSh; i++) {
          const a = rand(0, 6.28), e = rand(-0.35, 1);
          const v = rand(3.5, 9.5);
          this.shard(px, py + 0.7, pz,
            Math.cos(a) * v, e * v + 2.5, Math.sin(a) * v * 0.8,
            rand(1.0, 1.8), rand(1.1, 2.3), Math.random() < 0.62 ? accent : TINT.white);
        }
        const nSp = Math.round(80 * Math.max(0.6, d));
        for (let i = 0; i < nSp; i++) {
          const a = rand(0, 6.28), e = rand(-0.5, 1);
          const v = rand(2, 11);
          const w = Math.random();
          // r2 audit: accent-led with a white minority (was 50/50 at 2.4 white)
          this.spark(px, py + 0.7, pz,
            Math.cos(a) * v, e * v + 1.5, Math.sin(a) * v * 0.8,
            rand(0.5, 1.4), rand(0.25, 0.6),
            w < 0.62 ? accent : (w < 0.87 ? TINT.white : TINT.orange), 9, 1.3);
        }
        this.ring(p, { to: 6, dur: 0.9, color: accent, alpha: 1.15, mode: 'wall' });
        this.ring(p, { to: 7.5, dur: 1.25, color: TINT.white, alpha: 0.55 });
        break;
      }
      case 'jump': {
        const n = Math.round(8 * d);
        for (let i = 0; i < n; i++) {
          const a = rand(0, 6.28);
          this.spark(px, 0.08, pz, Math.cos(a) * rand(0.8, 2.2), rand(0.4, 1.6), Math.sin(a) * rand(0.6, 1.4),
            rand(0.3, 0.5), rand(0.35, 0.6), TINT.dust, 2.5, 2.5);
        }
        break;
      }
      case 'land': {
        const impact = opts.impact || 1;
        const n = Math.round((9 + 8 * Math.min(1, impact)) * d);
        for (let i = 0; i < n; i++) {
          const a = rand(0, 6.28);
          const v = rand(1.2, 2.6) * (0.7 + 0.5 * Math.min(1, impact));
          this.spark(px, 0.08, pz, Math.cos(a) * v, rand(0.3, 1.1), Math.sin(a) * v * 0.55,
            rand(0.3, 0.55), rand(0.35, 0.65), TINT.dust, 3.5, 2.6);
        }
        if (impact > 0.75) this.ring(p, { to: 1.8, dur: 0.35, color: TINT.dust, alpha: 0.5 });
        break;
      }
      case 'slide': {
        const n = Math.round(7 * d);
        for (let i = 0; i < n; i++) {
          this.spark(px + rand(-0.3, 0.3), 0.1, pz + rand(0.3, 0.9),
            rand(-0.6, 0.6), rand(0.5, 1.6), rand(1.5, 3.5),
            rand(0.25, 0.45), rand(0.3, 0.55), TINT.dust, 2, 3);
        }
        break;
      }
      case 'warp': {
        // r2 debt #6: transition FX live on GAME time. __NR.warp() advances
        // logic without rendering — a realtime countdown here kept raining
        // streaks into photo captures taken long after (game-time) the burst.
        this.warpEndGt = this._gameTime() + 1.5;
        this._prefillStreaks();
        this.ring(_v.set(0, 1.1, -6), { to: 7, dur: 1.1, color: TINT.magenta, alpha: 0.9, mode: 'wall', gt: this._gameTime() });
        this.ring(_v.set(0, 0.05, 0), { to: 6, dur: 1.3, color: TINT.cyan, alpha: 0.7, gt: this._gameTime() });
        break;
      }
      case 'confetti': {
        const n = Math.round(42 * Math.max(0.6, d));
        for (let i = 0; i < n; i++) {
          const a = rand(0, 6.28);
          const v = rand(2.5, 7.5);
          this.shard(px, py + 0.4, pz,
            Math.cos(a) * v * 0.55, rand(4.5, 9), Math.sin(a) * v * 0.4,
            rand(0.9, 1.5), rand(0.5, 1.1), CONFETTI[i % CONFETTI.length]);
        }
        this.ring(p, { to: 3.4, dur: 0.6, color: TINT.gold, alpha: 0.8 });
        break;
      }
      default:
        break;
    }
  }

  // player accent (Character trim emissive) with a safe fallback
  accentColor() {
    const ch = this.game && this.game.player && this.game.player.character;
    const mats = ch && ch._mats;
    if (mats && mats[1] && mats[1].emissive) return _c.copy(mats[1].emissive).multiplyScalar(2.2);
    return _c.copy(TINT.cyan);
  }

  spawn(name, opts = {}) {
    if (name === 'popText') {
      this.spawnPop(opts.style || 'great', 0, opts.x || 0, opts.y || 1.9);
    }
    // 'trail' is continuous — driven by FX.update (see updateTrail)
  }

  // ---- per-frame update ----------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.frame++; // r2: "same frame" stamp for Feel's '+25' suppression (critic #3)
    this._advanceGt(dt); // logic-time delta for transition FX (debt #6)
    this.updateSparks(dt);
    this.updateShards(dt);
    this.updateRings(dt);
    this.updateStreaks();
    this.updateTrail(dt);
    this.updatePops(dt);
    this.updateGameplayDust(dt);
  }

  updateSparks(dt) {
    const sp = this.sp;
    let live = 0;
    for (let i = 0; i < SPARK_N; i++) {
      if (sp.life[i] > 0) {
        live++;
        sp.life[i] -= dt;
        const dr = 1 - Math.min(0.9, sp.drag[i] * dt);
        sp.vx[i] *= dr; sp.vz[i] *= dr;
        sp.vy[i] = (sp.vy[i] - sp.grav[i] * dt) * dr;
        sp.px[i] += sp.vx[i] * dt;
        sp.py[i] += sp.vy[i] * dt;
        sp.pz[i] += sp.vz[i] * dt;
        const f = Math.max(0, sp.life[i] / sp.max[i]);
        const o = i * 3;
        sp.pos[o] = sp.px[i]; sp.pos[o + 1] = sp.py[i]; sp.pos[o + 2] = sp.pz[i];
        sp.col[o] = sp.cr[i]; sp.col[o + 1] = sp.cg[i]; sp.col[o + 2] = sp.cb[i];
        sp.fade[i] = f < 0.7 ? f / 0.7 : 1;
        sp.size[i] = sp.baseSize[i] * (0.55 + 0.45 * f);
      } else if (sp.fade[i] !== 0) {
        sp.fade[i] = 0;
      }
    }
    this.sparkMesh.visible = live > 0;
    if (live > 0) {
      const g = this.sparkMesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aFade.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    }
  }

  updateShards(dt) {
    const sh = this.sh;
    let live = 0;
    for (let i = 0; i < SHARD_N; i++) {
      if (sh.life[i] > 0) {
        live++;
        sh.life[i] -= dt;
        sh.vy[i] -= 15 * dt;
        sh.px[i] += sh.vx[i] * dt;
        sh.py[i] += sh.vy[i] * dt;
        sh.pz[i] += sh.vz[i] * dt;
        sh.rx[i] += sh.rvx[i] * dt; sh.ry[i] += sh.rvy[i] * dt; sh.rz[i] += sh.rvz[i] * dt;
        if (sh.py[i] < 0.05) { sh.py[i] = 0.05; sh.vy[i] *= -0.42; sh.vx[i] *= 0.8; sh.vz[i] *= 0.8; }
        const f = Math.max(0, sh.life[i] / sh.max[i]);
        const s = sh.size[i] * (0.4 + 0.6 * f);
        _e.set(sh.rx[i], sh.ry[i], sh.rz[i]);
        _q.setFromEuler(_e);
        _s.set(s, s, s);
        _m.compose(_v.set(sh.px[i], sh.py[i], sh.pz[i]), _q, _s);
        this.shardMesh.setMatrixAt(i, _m);
      }
    }
    this.shardMesh.visible = live > 0;
    if (live > 0) this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  updateRings(dt) {
    const gt = this._gameTime();
    for (let i = 0; i < RING_N; i++) {
      const r = this.rings[i];
      if (!r.mesh.visible) continue;
      if (r.gt0 >= 0) {
        // game-clocked ring: absolute mapping — deterministic across warps
        r.t = (gt - r.gt0) / r.dur;
      } else {
        r.t += dt / r.dur;
      }
      if (r.t >= 1) { r.mesh.visible = false; r.gt0 = -1; continue; }
      const e = 1 - Math.pow(1 - r.t, 2.4); // ease-out expansion
      const s = r.from + (r.to - r.from) * e;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.uniforms.uAlpha.value = r.alpha * Math.pow(1 - r.t, 1.6);
    }
  }

  _spawnStreak(i) {
    const st = this.st;
    const speed = this.game ? this.game.ctx.speed : 14;
    st.on[i] = 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    // corridor around the ROAD (|x| ≤ 8.5): streaks must never read as
    // scribbles pasted over the facades lining the street (debt #7)
    st.px[i] = side * rand(2.2, 8.5) * (Math.random() < 0.25 ? 0.35 : 1);
    st.py[i] = rand(0.4, 7);
    st.pz[i] = rand(-55, -6);
    st.vz[i] = speed * rand(2.2, 3.4);
    st.len[i] = rand(4, 9);
  }

  // fill every slot at burst time so a capture taken during the transition
  // window shows the full deterministic tunnel (not RAF-count-dependent)
  _prefillStreaks() {
    for (let i = 0; i < STREAK_N; i++) this._spawnStreak(i);
  }

  updateStreaks() {
    const st = this.st;
    const gtDt = this._gtDt;
    const active = this._gameTime() < this.warpEndGt; // logic-time gate (debt #6)
    let live = 0;
    for (let i = 0; i < STREAK_N; i++) {
      if (st.on[i] && !active) {
        st.on[i] = 0; // past the deadline → kill instantly (no leak through warps)
      }
      if (st.on[i]) {
        st.pz[i] += st.vz[i] * gtDt; // advances on game time (frozen in photos)
        if (st.pz[i] > 16) st.on[i] = 0;
      } else if (active) {
        this._spawnStreak(i);
      }
      if (st.on[i]) {
        live++;
        _q.identity();
        _s.set(1, 1, st.len[i]);
        _m.compose(_v.set(st.px[i], st.py[i], st.pz[i]), _q, _s);
      } else {
        _m.makeScale(0, 0, 0);
      }
      this.streakMesh.setMatrixAt(i, _m);
    }
    this.streakMesh.visible = live > 0;
    if (live > 0) this.streakMesh.instanceMatrix.needsUpdate = true;
  }

  // player trail: ring of samples stored in TRACK space; world z = scroll - s.
  // r2 (debt #5): samples emit on 3D MOVEMENT (lateral + vertical + forward),
  // not scroll alone — hopper's 90 ms column hops used to inject one huge
  // lateral jump that the strip stretched into a straight laser dash. A jump
  // larger than HOP_BREAK marks the joint as broken and the strip fades to 0
  // across it, so teleports read as separated dashes, never a smear.
  updateTrail(dt) {
    const g = this.game;
    const tr = this.tr;
    let live = false;
    if (g && g.player && (g.state === 'RUN' || g.state === 'MENU') && !g.player.dead) {
      const pl = g.player;
      const scroll = g.track.scroll + g.ctx.speed * g.time.acc;
      const dx = pl.x - this._lastPX;
      const dy = pl.y - this._lastPY;
      const dz = scroll - this._lastPS;
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.emitAcc += moved;
      const gap = Math.max(0.42, 0.85 - g.ctx.speed * 0.01);
      if (this.emitAcc >= gap) {
        this.emitAcc = 0;
        // hop/teleport detector: lateral+vertical motion since the LAST emit
        const jump = Math.sqrt(dx * dx + dy * dy);
        // shift samples back (oldest drops off) — 40 floats, trivial
        tr.x.copyWithin(1, 0, TRAIL_N - 1);
        tr.y.copyWithin(1, 0, TRAIL_N - 1);
        tr.s.copyWithin(1, 0, TRAIL_N - 1);
        tr.brk.copyWithin(1, 0, TRAIL_N - 1);
        tr.x[0] = pl.x; tr.y[0] = pl.y + 0.55; tr.s[0] = scroll - 0.45; // start behind the runner
        tr.brk[0] = jump > 1.15 ? 1 : 0;
        this._lastPX = pl.x; this._lastPY = pl.y; this._lastPS = scroll;
      }
      live = true;
    }
    if (live) {
      const g2 = this.game;
      const scroll = g2.track.scroll + g2.ctx.speed * g2.time.acc;
      // r2 (critic #4): the wake must READ at cruise, without re-reading as a
      // laser. Speed-scaled — hopper's pinned top-down cruise (6.5-10.5 m/s
      // Director speed) keeps ≈ the old subtle values, full 0.8 peak alpha /
      // 0.12 half-width from 20 m/s up.
      const sb = Math.min(1, Math.max(0, (g2.ctx.speed - 6) / 14));
      const peakA = 0.55 + 0.25 * sb; // 0.55 → 0.8
      const halfW = 0.09 + 0.03 * sb; // 0.09 → 0.12
      const pos = this.trailMesh.geometry.attributes.position.array;
      const alp = this.trailMesh.geometry.attributes.aAlpha.array;
      for (let i = 0; i < TRAIL_N; i++) {
        const z = scroll - tr.s[i];
        const behind = z - 0.3; // metres behind the runner's heels
        const ageF = 1 - Math.min(1, Math.max(0, behind / 3.6)); // fade over ~3.6 m
        const headIn = Math.min(1, Math.max(0, behind / 0.55));  // ease-in at the head
        const taper = 1 - i / (TRAIL_N - 1);
        const w = (halfW * taper + 0.02) * (0.55 + 0.45 * ageF);
        const o = i * 6;
        pos[o] = tr.x[i] - w; pos[o + 1] = tr.y[i]; pos[o + 2] = z;
        pos[o + 3] = tr.x[i] + w; pos[o + 4] = tr.y[i]; pos[o + 5] = z;
        // per-joint fade: broken joints (hop teleport) kill both adjacent quads
        const brk = i > 0 && tr.brk[i] ? 0 : 1;
        const a = headIn * (ageF * ageF) * (0.25 + 0.75 * taper) * peakA * brk;
        alp[i * 2] = a; alp[i * 2 + 1] = a;
      }
      this.trailMesh.geometry.attributes.position.needsUpdate = true;
      this.trailMesh.geometry.attributes.aAlpha.needsUpdate = true;
    } else {
      // fade out gracefully, then stop drawing entirely
      const alp = this.trailMesh.geometry.attributes.aAlpha.array;
      let any = false;
      for (let i = 0; i < alp.length; i++) {
        if (alp[i] > 0) { alp[i] = Math.max(0, alp[i] - dt * 3); any = any || alp[i] > 0; }
      }
      if (any) this.trailMesh.geometry.attributes.aAlpha.needsUpdate = true;
      this.trailMesh.visible = any;
    }
    if (live) this.trailMesh.visible = true;
  }

  updatePops(dt) {
    for (let i = 0; i < POP_N; i++) {
      const p = this.pops[i];
      if (!p.sp.visible) continue;
      p.t += dt / p.dur;
      if (p.t >= 1) { p.sp.visible = false; continue; }
      const t = p.t;
      // r2 audit: ease-out-back pop-in (~12% overshoot in the first 0.28 of
      // life) instead of the old linear scale drift — popups now LAND like
      // shipped-UI score ticks; the rise decelerates so copy never slides off.
      const pin = Math.min(1, t / 0.28);
      const c1 = 1.70158, c3 = c1 + 1;
      const eb = 1 + c3 * Math.pow(pin - 1, 3) + c1 * Math.pow(pin - 1, 2);
      const sc = p.sx * (0.62 + 0.38 * eb) * (1 + t * 0.18);
      p.sp.scale.set(sc, sc * 0.3, 1);
      p.sp.position.y += p.rise * (1 - t * 0.55) * dt;
      p.sp.material.opacity = t < 0.1 ? t / 0.1 : Math.min(1, (1 - t) / 0.38);
    }
  }

  // jump / land / slide puffs — polled transitions (no bus events exist for these)
  updateGameplayDust(dt) {
    const g = this.game;
    if (!g || !g.player || g.state === 'DEAD' || g.state === 'PAUSE') {
      if (g) { this._pg.grounded = g.player ? g.player.grounded : true; }
      return;
    }
    const pl = g.player;
    const pg = this._pg;
    const pos = _v.set(pl.x, pl.y, 0);

    if (pg.grounded && !pl.grounded && pl.vy > 0) this.burst('jump', pos);
    if (!pg.grounded && pl.grounded) {
      const impact = Math.min(1, -pg.fallV / 9.2);
      this.burst('land', pos, { impact });
    }
    const sliding = pl.slideT > 0;
    if (!pg.slide && sliding) this.burst('slide', pos);
    if (sliding) {
      this.slideTrickle -= dt;
      if (this.slideTrickle <= 0) {
        this.slideTrickle = 0.09;
        this.spark(pl.x + rand(-0.25, 0.25), 0.09, 0.6, rand(-0.5, 0.5), rand(0.4, 1.2), rand(2, 4),
          rand(0.2, 0.35), rand(0.25, 0.45), TINT.dust, 2, 3);
      }
    }
    pg.grounded = pl.grounded;
    pg.slide = sliding;
    pg.fallV = pl.grounded ? 0 : Math.min(pg.fallV, pl.vy);
  }
}

export const FX = new FXSystems();
