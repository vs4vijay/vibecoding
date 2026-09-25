// HOPPER — Crossy-Road grid crossing. [W1-PHASES]
// The world becomes a grid of 2.6 m rows scrolling toward the player; hop
// lane-by-lane (arrows/WASD, snappy 90 ms hop with squash+stretch). Rows are
// grass (safe) / road (seeded deterministic traffic) / river (drifting logs —
// stand on a log or drown). Waiting >4 s per row lets the Static edge catch
// you. Fairness: first 3 rows + 2.2 s calm are always grass; every row keeps
// a guaranteed safe column within ±1 hop of the previous one; roads never
// cover more than 3 of 7 cells; rivers always pin a log chain on the safe
// column at spawn. World scroll is pinned to a cruise speed via the Director
// accessor patch (rows must be hop-able at 12–40 m/s run speed).
import * as THREE from 'three';
import { Phase, suppressRunObstacles, captureAnim, CoinSet, pinDirectorSpeed, wrapActions, expirePopups } from './Phase.js';
import { COL } from '../core/Palette.js';
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { Static } from '../world/Static.js';
import { Obstacles } from '../world/Obstacles.js';
import { Pool } from '../core/Pool.js';
import { horizonGlowTexture, softGlowBandTexture, glowSpriteTexture, gridTerrainTexture, headlightConeTexture, shadowSpriteTexture, coinTokenGeometry, chevronTexture } from '../fx/Textures.js';

const ROW_D = 2.6;
const COLS = 7;
const colX = (c) => (c - 3) * 2.6;
const MAX_ROWS = 44;          // (92 m ahead + 16 behind) / 2.6
const HOP_TIME = 0.09;        // spec: snappy 90 ms hop
const EDGE_WARN = 2.6;        // s idle before the Static creeps
const EDGE_KILL = 4.0;        // s idle → camera-edge kill (spec)
const Z_MIN_AHEAD = 7.0;      // how far ahead of the scroll line you may hop
const Z_MAX_BEHIND = 2.6;

const T_GRASS = 0, T_ROAD = 1, T_RIVER = 2;

// module scratch — zero allocs
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP_Y = new THREE.Vector3(0, 1, 0);

// row palette (vertex colors, unlit) — r4 material pass, on-palette:
// roads = run-road asphalt (dark violet-black, never flat lavender), water =
// deep teal, safe strips = cyan-lifted deep violet with EMISSIVE EDGE LINES
// instead of matte green fill (readability: safe = cyan family, hazard =
// red/orange — the old desaturated green sat outside the palette entirely).
// r4b: emissive lines trimmed under the 0.85 bloom threshold — the old
// 1.45-1.75 peaks bloomed into white laser lines at near-camera angles.
// r8: water base DEEPENED (safe-platform language must always parse: the log
// trim/edge glow carries "standable", the river bed stays the darkest surface
// in the scene at every angle).
const C_ROAD = [0.032, 0.024, 0.060];
const C_DASH = [0.34, 0.38, 0.56];
const C_WATER = [0.006, 0.036, 0.104];
const C_SAFE = [0.028, 0.050, 0.078];
const C_EDGE = [0.10, 0.82, 0.98];
const C_SAFE_EDGE = [0.13, 0.92, 1.06];   // emissive curb line on every safe row
const C_DASH_GEO = [0.34, 0.38, 0.56];    // r8: real dash quads (kind 3 = distance fade only)

// field half-width: road/grass/water quads run to ±FIELD_X (traffic wraps at
// ±12.6, safely inside); the bright neon lines at ±9.4 mark the PLAYABLE grid
const FIELD_X = 13.4;
const PLAY_X = 9.4;

export class HopperPhase extends Phase {
  id = 'hopper';
  title = 'CROSSING GRID';
  duration = 38;
  weight = 1.0;
  // r6: followX/lookX (read by CameraRig) DAMP the lateral follow — the old
  // 0.82/1.25 gains let a hop to the outer columns shove the playfield into
  // one half of the frame with the fogged void filling the other.
  cameraHint = { fov: 55, height: 16.5, dist: 5.4, followX: 0.30, lookX: 0.50 };

  constructor() {
    super();
    this.t = 0;
    this.rowU = 0; this.maxRowU = 0; this.waitT = 0;
    this.col = 3; this.px = 0;
    this.hopT = 0; this.hopping = false;
    this.fromU = 0; this.toU = 0; this.fromX = 0; this.toX = 0;
    this.queued = null;
    this.prevSafe = 3;
    this.topU = 0;
    this.rows = [];
    this._nextSlot = 0;
    this._warned = false;
    this._aiT = 0;
    this._built = false;
    this._anim = null;
    this._unpin = null;
    this._unwrap = null;
    this._hopSpeed = 8;
    this._hiddenObs = [];
    this._padU = 0;
    this._chevU = [];
    this._pylonU = [];
  }

  _build(scene) {
    if (this._built) return;
    this._built = true;
    this._scene = scene;

    // --- merged ground: 44 slots × (row quad + 3 dashes + 2 neon boundaries
    // + 2 emissive safe curbs) = 1 draw. aKind per vertex drives the
    // row-surface shader (water glints, smooth safe-strip mottle + survey
    // grid, asphalt sheen). uTime comes from the fixed step → deterministic
    // under warp (Photo API). r4: VPS 24 → 32 for the safe-curb quads.
    const VPS = 32; // verts per row slot
    const pos = new Float32Array(MAX_ROWS * VPS * 3);
    const col = new Float32Array(MAX_ROWS * VPS * 3);
    const kind = new Float32Array(MAX_ROWS * VPS);
    const idx = [];
    for (let r = 0; r < MAX_ROWS; r++) {
      const b = r * VPS;
      // main quad (winding CCW seen from above — quads face +Y)
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      for (let d = 0; d < 7; d++) {
        const db = b + 4 + d * 4;
        idx.push(db, db + 2, db + 1, db, db + 3, db + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.groundPos = pos; this.groundCol = col; this.groundKind = kind;
    this.groundMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uDashPhase: { value: 0 },
        uDeep: { value: COL.deep.clone() },
        uEdge: { value: new THREE.Color(0.009, 0.0042, 0.036) },  // lit survey-ground base
      },
      vertexShader: /* glsl */`
        attribute vec3 aCol;
        attribute float aKind;
        varying vec3 vCol;
        varying float vKind;
        varying vec3 vW;
        varying float vDist;
        void main() {
          vCol = aCol;
          vKind = aKind;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mv = viewMatrix * wp;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uScroll;
        uniform float uTime;
        uniform float uDashPhase;
        uniform vec3 uDeep;
        uniform vec3 uEdge;
        varying vec3 vCol;
        varying float vKind;
        varying vec3 vW;
        varying float vDist;
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
            mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
        }
        float lineAA(float coord, float cell, float halfW) {
          float q = coord / cell;
          float d = abs(fract(q - 0.5) - 0.5) * cell;
          float aa = max(fwidth(coord), 1e-4);
          float m = 1.0 - smoothstep(halfW - aa, halfW + aa, d);
          m *= smoothstep(cell * 1.6, cell * 0.8, aa * 2.0);
          return m;
        }
        void main() {
          vec3 col = vCol;
          float x = vW.x;
          float wz = vW.z + uScroll;           // track-space distance
          float ax = abs(x);
          // r6: line quads are geometry-oversized; their VISIBLE band is
          // AA-masked here. r8b: the mask width is ANALYTIC (pixel footprint
          // estimated from vDist) — fwidth() inside discard-divergent quads
          // produced ragged comb-teeth edges on the minified lines in
          // SwiftShader-class rasterizers. Masked-out fragments still DISCARD
          // (the row-base quad underneath is coplanar-ish and drawn first).
          float px = max(vDist * 0.0022, 0.004);   // ~world-units per pixel
          // dashes: AA on both axes, phase-locked to the row grid via
          // uDashPhase; fade before distance minification aliases them
          if (vKind > 2.5 && vKind < 3.5) {
            float zp = mod(wz - uDashPhase, 2.6) - 1.3;     // 0 at row center
            float mz = 1.0 - smoothstep(0.60 - px, 0.60 + px, abs(zp));
            float lc = clamp(floor(x / 2.6 + 0.5), -1.0, 1.0) * 2.6;
            float m = (1.0 - smoothstep(0.08 - px, 0.08 + px, abs(x - lc)))
                    * mz * (1.0 - smoothstep(14.0, 42.0, vDist));
            if (m < 0.02) discard;
            col *= m;
          } else if (vKind > 3.5 && vKind < 4.5) {
            // play boundary band: |x| 9.14 … 9.40
            float m = smoothstep(9.14 - px, 9.14 + px, ax)
                    * (1.0 - smoothstep(9.40 - px, 9.40 + px, ax));
            m *= 1.0 - smoothstep(60.0, 115.0, vDist);
            if (m < 0.02) discard;
            col *= m;
          } else if (vKind > 4.5) {
            // safe-curb band: |x| 8.96 … 9.14
            float m = smoothstep(8.96 - px, 8.96 + px, ax)
                    * (1.0 - smoothstep(9.14 - px, 9.14 + px, ax));
            m *= 1.0 - smoothstep(60.0, 115.0, vDist);
            if (m < 0.02) discard;
            col *= m;
          }
          // SAFE STRIP (kind 1): cyan-lifted deep field, SMOOTH luminance
          // mottle (value noise — the old per-cell hash steps read as hard
          // patch seams) + a faint survey grid so the strip is material,
          // not a matte slab. Continues the run floor's grid language.
          // r4b: plus an EMISSIVE ROW LADDER — a soft cyan light line across
          // the strip at every row boundary, so "safe" reads as a lit ladder
          // rung (cyan family) instead of a flat desaturated slab.
          if (vKind > 0.5 && vKind < 1.5) {
            float mote = vnoise(vec2(x * 0.55, wz * 0.55)) * 0.65
                       + vnoise(vec2(x * 1.7, wz * 1.7)) * 0.35;
            col *= 0.80 + 0.38 * mote;
            col += vec3(0.004, 0.020, 0.026) * smoothstep(0.58, 0.88, mote);
            // r8: the survey grid + row rungs are clipped to the PLAYABLE
            // strip — they used to run the full field width, poking out past
            // the boundary line as periodic comb-teeth stubs (t=20/25).
            float inPlay = 1.0 - smoothstep(9.10, 9.42, ax);
            float gx = lineAA(x, 2.6, 0.030) * 0.55;
            float gz = lineAA(wz, 2.6, 0.026) * 0.42;
            col += vec3(0.020, 0.115, 0.140) * (gx + gz) * inPlay
                 * (1.0 - smoothstep(30.0, 70.0, vDist));
            float rung = 1.0 - smoothstep(0.05, 0.16, abs(fract(wz / 2.6 + 0.5) - 0.5) * 2.6);
            col += vec3(0.030, 0.30, 0.36) * rung * inPlay * (1.0 - smoothstep(16.0, 36.0, vDist));
          }
          // WATER (kind 2): dark teal base + ripple lines and sparse sparkles.
          // r8: ripples toned down (they were lifting the river BRIGHTER than
          // the safe strips, inverting the safe/danger read), and the sparkles
          // are soft round glints at the hash-cell centers — the old cells
          // filled their whole tile and read as flat pale-blue SQUARE decals.
          if (vKind > 1.5 && vKind < 2.5) {
            float swell = 0.5 + 0.5 * sin(wz * 0.35 + x * 0.22 - uTime * 0.8);
            float rip = pow(sin(x * 1.9 + wz * 3.2 - uTime * 2.6) * 0.5 + 0.5, 6.0);
            col += vec3(0.020, 0.082, 0.110) * rip * (0.30 + 0.70 * swell);
            float rip2 = pow(sin(x * 0.8 - wz * 1.4 + uTime * 1.1) * 0.5 + 0.5, 8.0);
            col += vec3(0.010, 0.045, 0.066) * rip2 * 0.6;
            vec2 sc = vec2(x * 1.3, wz * 1.3 + uTime * 1.4);
            float sp = hash12(floor(sc) + 31.7);
            vec2 fc = fract(sc) - 0.5;
            float spark = step(0.982, sp) * exp(-dot(fc, fc) * 26.0);
            col += vec3(0.14, 0.50, 0.58) * max(0.0, spark) * 0.40;
          }
          // ROAD (kind 0): run-asphalt with a slow sheen band + wheel-worn
          // mottle — never a flat lavender slab
          if (vKind < 0.5) {
            float sheen = exp(-pow((fract(wz / 26.0) - 0.5) * 5.0, 2.0));
            col += vec3(0.010, 0.014, 0.030) * sheen;
            float wear = vnoise(vec2(x * 0.9, wz * 0.35)) * 0.5
                       + vnoise(vec2(x * 2.6, wz * 2.6)) * 0.5;
            col *= 0.86 + 0.26 * wear;
          }
          float fade = exp(-pow(vDist * 0.0075, 2.0));   // FogExp2 #0b0518 match
          // r8: world-edge dissolve lands on the LIT survey-ground base (the
          // brightened terrain backdrop's near-field color) instead of near-
          // black — the old uDeep target made the last 1.6 m of every row a
          // black band that merged with the unlit flank into a bare void
          // (measured 99% black at t=25 bottom-left).
          float edgeT = smoothstep(11.8, 13.4, ax);
          col = mix(col, uEdge, edgeT);
          vec3 outc = mix(uDeep, col, fade);
          outc += (hash12(gl_FragCoord.xy) - 0.5) * (1.2 / 255.0);
          gl_FragColor = vec4(outc, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.groundMesh = new THREE.Mesh(g, this.groundMat);
    this.groundMesh.position.y = 0.045;
    this.groundMesh.frustumCulled = false;

    // --- terrain backdrop: the survey grid continues past the field edge in
    // every direction (no black dead zones at the frame sides); camera-locked
    // in z so it never ends, fog fades it before the plane's far edge
    this.terrainTex = gridTerrainTexture();
    this.terrainTex.repeat.set(29, 50);
    this.terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 520),
      new THREE.MeshBasicMaterial({ map: this.terrainTex }),
    );
    this.terrain.rotation.x = -Math.PI / 2;
    this.terrain.position.set(0, -0.06, -90);

    // row record pool (fixed car/log slots — no allocs after init)
    this.rowPool = new Pool(() => ({
      u: 0, slot: 0, type: T_GRASS, safeCol: 3,
      cars: [{ x: 0, v: 0, dir: 1, len: 1, on: false }, { x: 0, v: 0, dir: 1, len: 1, on: false }, { x: 0, v: 0, dir: 1, len: 1, on: false }, { x: 0, v: 0, dir: 1, len: 1, on: false }],
      logs: [{ anchor: 0, x: 0, amp: 0, om: 0, ph: 0, len: 2, on: false }, { anchor: 0, x: 0, amp: 0, om: 0, ph: 0, len: 2, on: false }, { anchor: 0, x: 0, amp: 0, om: 0, ph: 0, len: 2, on: false }],
    }), (r) => { r.u = 0; r.type = T_GRASS; for (const c of r.cars) c.on = false; for (const l of r.logs) l.on = false; }, 'hopper:rows');

    for (let i = 0; i < MAX_ROWS; i++) this.rows.push(this.rowPool.get());

    // --- traffic (instanced) — hazards read red/orange ONLY (readability rule);
    // the old magenta/silver mix parsed as decoration, not danger.
    // r12: the whole variant set pushed DEEPER into red/orange — the old
    // 0xff3355 red carried a high blue channel that, under the scene's violet
    // hemisphere + magenta rim lights, sheened PINK on one car in three
    // (off-language). These four sit hue-locked 350°-25°, and metalness drops
    // 0.5 → 0.2 so the colored lights can't paint a pink specular sheen.
    this.carMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x5a0d12, emissiveIntensity: 0.85, metalness: 0.2, roughness: 0.55,
    });
    this.carIM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.85, 1.55), this.carMat, 48);
    this.carIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carIM.frustumCulled = false;
    // r4: dedicated Color objects — the old list held four references to the
    // shared _c scratch, so every car wore the same orange
    const hues = [new THREE.Color(0xd9203a), new THREE.Color(0xff5a2a),
      new THREE.Color(0xc41f28), new THREE.Color(0xff7a1a)];
    for (let i = 0; i < 48; i++) this.carIM.setColorAt(i, hues[i % 4]);

    // hot roof bar per car (punches through fog/bloom pre-bloom like the run
    // obstacles' cap rails) — second instanced mesh, one draw
    this.carBarMat = new THREE.MeshBasicMaterial({ color: 0xff4b30, toneMapped: false });
    this.carBarIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.09, 0.18), this.carBarMat, 48);
    this.carBarIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carBarIM.frustumCulled = false;

    // r4 vehicle language — cars must read as VEHICLES from the top-down cam:
    // dark glass cabin (LOW metalness — a mirror-finish cabin was bouncing the
    // scene's magenta rim light and reading as a glowing pink box), dark
    // undercarriage skirt, rubber wheels, headlight dots + thrown light cone,
    // and a contact shadow pooling under the body.
    // r12: the old 0.35 metalness / 0.32 roughness still threw a hard magenta
    // specular of the rim light on some approach angles — one cabin per row
    // flared to saturated PINK (the "off-language car"). Glass now kills the
    // sharp highlight: near-dielectric, matte-sanded.
    this.cabinMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c1c, metalness: 0.12, roughness: 0.62, emissive: 0x0a1030, emissiveIntensity: 0.5,
    });
    this.cabinIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.5, 1.3), this.cabinMat, 48);
    this.cabinIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cabinIM.frustumCulled = false;

    this.chassisMat = new THREE.MeshStandardMaterial({
      color: 0x0b0714, metalness: 0.3, roughness: 0.85,
    });
    this.chassisIM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.34, 0.3, 1.68), this.chassisMat, 48);
    this.chassisIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chassisIM.frustumCulled = false;

    // wheels — dark rubber discs (axle along z, cars travel along x); 4 per
    // car, one instanced draw. The bare-box read was the r3 critic's car nit.
    const wheelGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.24, 10);
    wheelGeo.rotateX(Math.PI / 2);
    this.wheelMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a12, metalness: 0.1, roughness: 0.9,
    });
    this.wheelIM = new THREE.InstancedMesh(wheelGeo, this.wheelMat, 192);
    this.wheelIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheelIM.frustumCulled = false;

    // emissive side skirt trim — a low hot stripe tying the fleet to the
    // hazard language (hue-dominant red-orange, under the blowout ceiling)
    this.trimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.trimMat.color.setRGB(0.95, 0.28, 0.15);
    this.trimIM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.07, 0.05), this.trimMat, 96);
    this.trimIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trimIM.frustumCulled = false;

    this.headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.headMat.color.setRGB(1.7, 1.45, 0.95);
    this.headIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.12, 0.1), this.headMat, 96);
    this.headIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.headIM.frustumCulled = false;

    this.shadowMat2 = new THREE.MeshBasicMaterial({
      map: shadowSpriteTexture(), transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.shadowIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.shadowMat2, 48);
    this.shadowIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadowIM.frustumCulled = false;
    this.shadowIM.renderOrder = 1;

    this.beamMat = new THREE.MeshBasicMaterial({
      map: headlightConeTexture(), transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.beamMat.color.setRGB(1.0, 0.80, 0.52);   // amber — pure additive white
    // read as pale gray smears over the violet tarmac; r4: softer still so the
    // fans read as thrown LIGHT, not paper decals glued to the tarmac
    // (r6: texture falloff is radial from the lamp — bright lobe at the
    // bumper, dissolving fan. r12: the texture is now an analytic cone with
    // zero-alpha borders — no wedge silhouette — so the opacity rides a step
    // to keep the thrown-light read at gameplay distance)
    this.beamIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.beamMat, 48);
    this.beamIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beamIM.frustumCulled = false;
    this.beamIM.renderOrder = 2;

    // --- logs (instanced) — dark timber with a cool teal wet-sheen rim so they
    // read as solid standable silhouettes against the glinting water. r4b: the
    // old green emissive sat outside the safe language (cyan family) and read
    // as a matte green slab from the top-down cam.
    // r8: two emissive CYAN TRIM RAILS ride every log (second instanced draw)
    // — dark timber on dark water must parse as "standable" at every angle,
    // and the trim gives the log a lit outline the top-down cam always sees.
    const logGeo = new THREE.CylinderGeometry(0.38, 0.38, 1, 9);
    logGeo.rotateZ(Math.PI / 2); // length along x
    this.logMat = new THREE.MeshStandardMaterial({
      color: 0x14222a, emissive: 0x0e7f94, emissiveIntensity: 0.75, metalness: 0.15, roughness: 0.6,
    });
    this.logIM = new THREE.InstancedMesh(logGeo, this.logMat, 48);
    this.logIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.logIM.frustumCulled = false;

    this.logTrimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.logTrimMat.color.setRGB(0.09, 0.62, 0.72);   // cyan family = safe/standable
    this.logTrimIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 0.07), this.logTrimMat, 96);
    this.logTrimIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.logTrimIM.frustumCulled = false;

    this.coins = new CoinSet(scene, 64, 'hopper:coins');
    // r8: the shared CoinSet token is built for chase cameras (faces ±Z);
    // hopper's top-down camera sees that edge-on. Re-orient the SAME faceted
    // family face-UP so the hot gold hex face reads from above (same geometry
    // factory + material — identity unified with run/drift, orientation per
    // camera). The old cloned emissive gem is gone.
    const upCoin = coinTokenGeometry(0.40);
    upCoin.rotateX(-Math.PI / 2);
    this.coins.mesh.geometry = upCoin;

    // sky-language backdrop: the top-down camera can never see the horizon,
    // so the run-phase sun band is painted ONTO the field — a sun pool far
    // ahead + a horizon glow ramp where the rows fade into fog (both additive,
    // camera-pinned: light, not geometry). r4: softGlowBandTexture fades at
    // ALL edges — the hard left/right plane edges read as a translucent
    // ghost-box over the river rows.
    const softTex = softGlowBandTexture();
    this.sunPool = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 120),
      new THREE.MeshBasicMaterial({
        map: softTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.sunPool.rotation.x = -Math.PI / 2;
    this.sunPool.rotation.z = Math.PI; // hot edge at the far end
    this.sunPool.position.set(0, 0.09, -72);

    this.horizonBand = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 30),
      new THREE.MeshBasicMaterial({
        map: softTex, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.horizonBand.rotation.x = -Math.PI / 2;
    this.horizonBand.rotation.z = Math.PI;
    this.horizonBand.position.set(0, 0.075, -30);

    // hero light pool — lifts the runner off the gray road (contrast). r4b:
    // smaller + dimmer — at 2.1 m / op 0.55 the additive core saturated the
    // dark river rows into a pale boxy blob (the "ghost box" read).
    this.playerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({
        map: glowSpriteTexture('#5df6ff'), transparent: true, opacity: 0.30,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.playerGlow.rotation.x = -Math.PI / 2;
    this.playerGlow.renderOrder = 2;

    // --- r12 spawn dressing (visual only) — the t=0 view was a bare calm
    // grid: the fairness rules keep the opening rows empty, so the phase's
    // FIRST frame read as an unfinished gray ladder. Three pooled elements,
    // laid out at enter() and faded out as real traffic arrives:
    //   launch pad   — gold/cyan contact light under the spawn cell
    //   chevrons     — cyan safe-line markers on the first calm rows ahead
    //   edge pylons  — survey posts framing the field boundary
    // All cyan/gold (safe/collectible language — nothing hazard-colored).
    this.padMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.padMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), this.padMat);
    this.padMesh.rotation.x = -Math.PI / 2;
    this.padMesh.renderOrder = 2;
    this.padPoolMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#5df6ff'), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.padPoolMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), this.padPoolMat);
    this.padPoolMesh.rotation.x = -Math.PI / 2;
    this.padPoolMesh.renderOrder = 2;

    this.chevMat = new THREE.MeshBasicMaterial({
      map: chevronTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.chevMat.color.setRGB(0.30, 1.05, 1.25);
    this.chevIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.7, 1.25), this.chevMat, 4);
    this.chevIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevIM.frustumCulled = false;
    this.chevIM.renderOrder = 2;
    this.chevIM.count = 0;

    this.pylonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.pylonMat.color.setRGB(0.14, 0.85, 1.00);   // cyan survey-marker family
    // r12b: tall thin posts read as floating splinters from the top-down cam —
    // restyled as grounded lit RUNWAY STUDS (flat, wide, glowing); the contact
    // pool carries the light read.
    this.pylonIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.30, 0.14, 0.30), this.pylonMat, 24);
    this.pylonIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pylonIM.frustumCulled = false;
    this.pylonIM.count = 0;
    // grounded contact light under each stud
    this.pylonGlowMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#5df6ff'), transparent: true, opacity: 0.62,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.pylonGlowMat.color.setRGB(0.14, 0.62, 0.74);
    this.pylonGlowIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.pylonGlowMat, 24);
    this.pylonGlowIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pylonGlowIM.frustumCulled = false;
    this.pylonGlowIM.renderOrder = 2;
    this.pylonGlowIM.count = 0;
  }

  // ---- row generation (all through the seeded run rng) -----------------------
  genRow(r, ctx) {
    const rng = ctx.rng || ctx.track.rng; // ctx.rng is null until first fixed step
    const scroll = ctx.track.scroll;
    // r4: slot assignment moved OUT of genRow to the callers (enter/recycle) —
    // the old `slot = slot + 1` advanced EVERY row's slot on every call, so a
    // recycled row overwrote the slot its neighbor still owned. Net effect:
    // one 2.6 m hole scrolled through the field forever, and the terrain
    // backdrop's blue plots showed through it as a "translucent ghost box".
    r.safeCol = Math.max(0, Math.min(COLS - 1, this.prevSafe + ((rng() * 3) | 0) - 1));
    this.prevSafe = r.safeCol;

    const calm = r.u < this.startU + 2.2 * this._hopSpeed || r.u < this.startU + 3 * ROW_D;
    const closing = (r.u - scroll) / Math.max(this._hopSpeed, 1) < 2.0; // exit fairness
    r.type = (calm || closing) ? T_GRASS : rng() < 0.36 ? T_GRASS : rng() < 0.55 ? T_ROAD : T_RIVER;

    for (let i = 0; i < 4; i++) r.cars[i].on = false;
    for (let i = 0; i < 3; i++) r.logs[i].on = false;

    if (r.type === T_ROAD) {
      const dir = rng() < 0.5 ? -1 : 1;
      const v = 3.5 + rng() * 4 + ctx.director.difficulty() * 1.3;
      const n = 2 + (rng() < 0.45 ? 1 : 0);
      // pick distinct cells ≥ 2 apart, never the safe column
      const chosen = [];
      let guard = 0;
      while (chosen.length < n && guard++ < 24) {
        const cell = (rng() * COLS) | 0;
        if (cell === r.safeCol) continue;
        let ok = true;
        for (const c of chosen) if (Math.abs(c - cell) < 2) { ok = false; break; }
        if (ok) chosen.push(cell);
      }
      chosen.sort((a, b) => a - b);
      for (let i = 0; i < chosen.length; i++) {
        const car = r.cars[i];
        car.on = true;
        car.dir = dir;
        car.v = v * (0.9 + rng() * 0.25);
        car.len = rng() < 0.3 ? 2 : 1; // trucks are 2 cells
        car.x = colX(chosen[i]) + dir * rng() * 4;
      }
    } else if (r.type === T_RIVER) {
      // logs ping-pong around anchored positions (deterministic sine drift) so
      // the chain pinned on the safe column is there whenever the row arrives
      const l0 = r.logs[0];
      l0.on = true;
      l0.len = 3 + (rng() < 0.4 ? 1 : 0);
      l0.anchor = colX(r.safeCol);
      l0.amp = 2.6; l0.om = 0.5 + rng() * 0.3; l0.ph = rng() * 6.28;
      for (let i = 1; i < 3; i++) {
        const l = r.logs[i];
        l.on = true;
        l.len = 2 + (rng() < 0.5 ? 1 : 0);
        l.anchor = colX((r.safeCol + i * 3) % COLS) + (rng() - 0.5) * 2.0;
        l.amp = 2.2 + rng() * 1.2; l.om = 0.45 + rng() * 0.35; l.ph = rng() * 6.28;
        l.x = l.anchor;
      }
      l0.x = l0.anchor;
    }

    // coins on the safe line
    if (!calm && rng() < 0.6) {
      this.coins.add(r.u + ROW_D / 2, colX(r.safeCol), 0.55, rng() * 6.28);
    }

    this._writeRow(r);
  }

  // write one row slot into the merged ground geometry
  _writeRow(r) {
    const pos = this.groundPos, col = this.groundCol, kind = this.groundKind;
    const b = r.slot * 32;
    const zN = -(r.u + ROW_D); // near-edge world z at mesh offset 0
    const zF = -r.u;
    const t = r.type;
    const base = t === T_ROAD ? C_ROAD : t === T_RIVER ? C_WATER : C_SAFE;
    const kCol = t === T_GRASS ? 1.0 : t === T_ROAD ? 0.0 : 2.0;
    const quad = (vi, x0, x1, z0, z1, cr, cg, cb, k, yOff) => {
      const y = yOff || 0;
      const o = (b + vi) * 3;
      pos[o] = x0; pos[o + 1] = y; pos[o + 2] = z0;
      pos[o + 3] = x1; pos[o + 4] = y; pos[o + 5] = z0;
      pos[o + 6] = x1; pos[o + 7] = y; pos[o + 8] = z1;
      pos[o + 9] = x0; pos[o + 10] = y; pos[o + 11] = z1;
      col[o] = cr; col[o + 1] = cg; col[o + 2] = cb;
      col[o + 3] = cr; col[o + 4] = cg; col[o + 5] = cb;
      col[o + 6] = cr; col[o + 7] = cg; col[o + 8] = cb;
      col[o + 9] = cr; col[o + 10] = cg; col[o + 11] = cb;
      const ko = b + vi;
      kind[ko] = k; kind[ko + 1] = k; kind[ko + 2] = k; kind[ko + 3] = k;
    };
    // r4: NO per-row brightness alternation — alternating shade bands were the
    // visible "butt seams" between rows; the shader's smooth mottle carries
    // the variation now.
    // r6: line quads are drawn WIDER than their visible band — the ground
    // shader AA-masks them against their true band (dashes ±0.08, boundary
    // 9.14-9.40, curb 8.96-9.14), so edges are screen-space gradients instead
    // of minified hard geometry (the stair-step aliasing at t=20/25).
    quad(0, -FIELD_X, FIELD_X, zN, zF, base[0], base[1], base[2], kCol);
    // r8: dash quads span the FULL row (the visible dash band is cut in the
    // shader, phase-locked to the row grid and AA'd on both axes — hard
    // geometric z-ends were the ragged-dash source at minification).
    // r8b: line quads ride +0.012 m above the row base — they are coplanar
    // with it otherwise, and the depth-test flicker shredded their edges into
    // comb-teeth at mid distance (t=10..25).
    const LIFT = 0.012;
    const dashCol = C_DASH;
    for (let d = 0; d < 3; d++) {
      const cx = -2.6 + d * 2.6;
      quad(4 + d * 4, cx - 0.30, cx + 0.30, zN, zF,
        dashCol[0], dashCol[1], dashCol[2], 3, LIFT);
    }
    // neon play boundary (cyan = safe grid edge, mirrors the run rails); the
    // road surface continues past it so traffic rolls on tarmac, not void
    quad(16, -PLAY_X - 0.4, -PLAY_X + 0.5, zN, zF, C_EDGE[0], C_EDGE[1], C_EDGE[2], 4, LIFT);
    quad(20, PLAY_X - 0.5, PLAY_X + 0.4, zN, zF, C_EDGE[0], C_EDGE[1], C_EDGE[2], 4, LIFT);
    // r4: emissive curb lines hugging both edges of every SAFE row — the
    // "lit lane" that makes safe vs hazard legible without matte green fill.
    // quads are oversized; the shader masks the true 8.96…9.14 band
    if (t === T_GRASS) {
      quad(24, -PLAY_X + 0.12, -PLAY_X + 0.58, zN, zF,
        C_SAFE_EDGE[0], C_SAFE_EDGE[1], C_SAFE_EDGE[2], 5, LIFT);
      quad(28, PLAY_X - 0.58, PLAY_X - 0.12, zN, zF,
        C_SAFE_EDGE[0], C_SAFE_EDGE[1], C_SAFE_EDGE[2], 5, LIFT);
    } else {
      // non-safe rows collapse their curb quads to zero-area (kind 0) so the
      // shared index buffer stays valid without extra draws
      quad(24, 0, 0, zN, zF, 0, 0, 0, 0);
      quad(28, 0, 0, zN, zF, 0, 0, 0, 0);
    }
    this.groundDirty = true;
  }

  rowAt(u) {
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) {
      if (u >= rows[i].u && u < rows[i].u + ROW_D) return rows[i];
    }
    return null;
  }

  enter(ctx) {
    this._build(window.__NR.scene);
    const scene = this._scene;
    const track = ctx.track;
    const p = ctx.player;
    this.t = 0;
    this.startU = track.scroll;
    this.rowU = track.scroll;
    this.maxRowU = track.scroll;
    this.waitT = 0;
    this.col = 3;
    this.px = 0;
    this.hopping = false;
    this.hopT = 0;
    this.queued = null;
    this.prevSafe = 3;
    this._warned = false;
    this._aiT = 0;
    this._hopSpeed = Math.max(6.5, Math.min(10.5, ctx.speed * 0.45));
    this._unpin = pinDirectorSpeed(ctx.director, this._hopSpeed);

    suppressRunObstacles(track.scroll);
    expirePopups();
    track.clearCoins();
    p.slideT = 0;
    p.vy = 0;

    // rows: init from scroll−10 (behind) forward
    this.topU = this.startU - 10;
    for (let i = 0; i < MAX_ROWS; i++) {
      const r = this.rows[i];
      r.slot = i;                       // r4: unique slots, owned until recycled
      r.u = this.topU;
      this.topU += ROW_D;
      this.genRow(r, ctx);
    }
    this._nextSlot = 0;
    this.groundDirty = true;
    // dash pattern is phase-locked to the row grid (rows live at rows[0].u +
    // k·ROW_D forever — recycle preserves the lattice)
    this.groundMat.uniforms.uDashPhase.value = ((this.rows[0].u % ROW_D) + ROW_D) % ROW_D;

    // r8 entry frame: snap straight into the styled top-down camera — the 1.5 s
    // transition FX covers the cut. The old entry frame was the tail of the
    // run-chase pose gliding over a near-grazing field: flat grey-blue slab +
    // a leftover run obstacle pad under the runner (placeholder-grade first
    // impression of the phase).
    const rig = ctx.camera;
    rig.pos.set(this.px * 0.30, 16.5, 5.4);
    rig.look.set(this.px * 0.50, 1.6, -6);
    rig.fov = 55;
    rig.fovApplied = 55;
    rig.fovKick = 0;
    rig.trauma = 0;

    // r8: leftover run-phase obstacles at/behind the runner (a jump barrier
    // used to sit right at the spawn point reading as a flat orange pad).
    // Visual-only hide — spawn/fairness/collision untouched; every hidden
    // object is restored on exit, so pooled reuse is safe.
    this._hiddenObs.length = 0;
    const obs = Obstacles.active;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i].obj;
      if (o && o.visible) { o.visible = false; this._hiddenObs.push(o); }
    }

    // instanced meshes carry identity matrices + max counts until the first
    // fixed step writes them — park at zero so the entry frame (and photo
    // t=0) never renders a stack of identity cars at the origin (the old
    // "flat orange pad" under the spawn point).
    this.carIM.count = 0; this.carBarIM.count = 0; this.cabinIM.count = 0;
    this.chassisIM.count = 0; this.wheelIM.count = 0; this.trimIM.count = 0;
    this.headIM.count = 0; this.shadowIM.count = 0; this.beamIM.count = 0;
    this.logIM.count = 0; this.logTrimIM.count = 0;

    scene.add(this.groundMesh, this.terrain, this.carIM, this.carBarIM, this.cabinIM,
      this.chassisIM, this.wheelIM, this.trimIM, this.headIM, this.shadowIM, this.beamIM,
      this.logIM, this.logTrimIM, this.sunPool, this.horizonBand, this.playerGlow,
      this.padMesh, this.padPoolMesh, this.chevIM, this.pylonIM, this.pylonGlowIM);

    // the straight-road city dressing + run grid floor fight the top-down grid
    // field — hide them for the phase (same mechanism DriftPhase uses: the
    // Props dresser is dressers[0] by registration order)
    this._floorHidden = false;
    if (track.floor) { track.floor.visible = false; this._floorHidden = true; }
    const dressers = track.dressers;
    this._propsDresser = dressers.length ? dressers[0] : null;
    if (this._propsDresser) {
      const di = dressers.indexOf(this._propsDresser);
      if (di >= 0) dressers.splice(di, 1);
    }
    for (let c = 0; c < track.chunks.length; c++) {
      const att = track.chunks[c].attached;
      for (let k = 0; k < att.length; k++) att[k].visible = false;
    }

    // r12 spawn dressing layout: anchor the launch pad at the entry cell and
    // mark the safe hop line on the first calm rows (guaranteed grass by the
    // fairness rules — their safeCol is already seeded in the row records).
    this._padU = this.startU;
    this._chevU.length = 0;
    for (let i = 0; i < this.rows.length && this._chevU.length < 3; i++) {
      if (this.rows[i].u > this.startU + 0.2 && this.rows[i].u < this.startU + ROW_D * 3.5) {
        this._chevU.push({ u: this.rows[i].u + ROW_D / 2, x: colX(this.rows[i].safeCol) });
      }
    }
    this._pylonU.length = 0;
    for (let k = 0; k < 4; k++) {
      this._pylonU.push({ u: this.startU + 5.2 + k * 7.8, side: k & 1 ? 1 : -1 });
    }
    this._writeSpawnDressing(track.scroll);

    // press routing: hopper owns up/down/left/right
    this._unwrap = wrapActions(ctx.input, (a) => {
      if (ctx.game.state !== 'RUN') return false;
      if (a === 'up') { this.tryHop(ctx, 0, 1); return true; }
      if (a === 'down') { this.tryHop(ctx, 0, -1); return true; }
      if (a === 'left') { this.tryHop(ctx, -1, 0); return true; }
      if (a === 'right') { this.tryHop(ctx, 1, 0); return true; }
      return false;
    });

    this._anim = captureAnim(ctx);
    this._armRunStartCleanup(ctx);
  }

  // r12 spawn dressing writer — pure function of (scroll, t) so the photo
  // API's warp renders it identically to realtime; re-poses the pad/chevrons
  // with the world, fades all three layers out as traffic arrives.
  _writeSpawnDressing(scroll) {
    const kPad = Math.min(1, this.t / 2.6);
    const kChev = Math.min(1, this.t / 3.4);
    const fadeP = Math.max(0, 1 - kPad);
    const fadeC = Math.max(0, 1 - kChev);
    const padOn = fadeP > 0.01;
    this.padMesh.visible = padOn;
    this.padPoolMesh.visible = padOn;
    if (padOn) {
      const pulse = 1 + Math.sin(this.t * 6) * 0.06;
      this.padMesh.position.set(0, 0.075, scroll - this._padU);
      this.padMesh.scale.set(pulse, pulse, 1);
      this.padMat.opacity = 0.42 * fadeP * fadeP;
      this.padPoolMesh.position.set(0, 0.08, scroll - this._padU);
      this.padPoolMat.opacity = 0.30 * fadeP;
    }
    let nc = 0;
    if (fadeC > 0.01) {
      this.chevMat.opacity = 0.85 * fadeC;
      _e.set(-Math.PI / 2, 0, 0); _q.setFromEuler(_e);
      for (let i = 0; i < this._chevU.length && nc < 4; i++) {
        const c = this._chevU[i];
        const wz = scroll - c.u;
        if (wz > 13) continue;
        _s.set(1, 1, 1);
        _p.set(c.x, 0.085, wz);
        _m.compose(_p, _q, _s);
        this.chevIM.setMatrixAt(nc++, _m);
      }
    }
    this.chevIM.count = nc;
    this.chevIM.instanceMatrix.needsUpdate = true;
    this.chevIM.visible = nc > 0;
    // survey pylons: grounded bollards with a contact light pool, live until
    // they scroll past the camera
    let np = 0;
    _e.set(0, 0, 0); _q.setFromEuler(_e);
    for (let i = 0; i < this._pylonU.length; i++) {
      const pl = this._pylonU[i];
      const wz = scroll - pl.u;
      if (wz > 13) continue;
      _s.set(1, 1, 1);
      _p.set(pl.side * 9.9, 0.09, wz);
      _m.compose(_p, _q, _s);
      this.pylonIM.setMatrixAt(np, _m);
      _e.set(-Math.PI / 2, 0, 0); _q.setFromEuler(_e);
      _s.set(1.45, 1.45, 1);
      _p.set(pl.side * 9.9, 0.07, wz);
      _m.compose(_p, _q, _s);
      this.pylonGlowIM.setMatrixAt(np, _m);
      _e.set(0, 0, 0); _q.setFromEuler(_e);
      np++;
    }
    this.pylonIM.count = np;
    this.pylonIM.instanceMatrix.needsUpdate = true;
    this.pylonIM.visible = np > 0;
    this.pylonGlowIM.count = np;
    this.pylonGlowIM.instanceMatrix.needsUpdate = true;
    this.pylonGlowIM.visible = np > 0;
  }

  exit(ctx) {
    this._disarmRunStartCleanup();
    if (this._unwrap) { this._unwrap(); this._unwrap = null; }
    if (this._anim) { this._anim.restore(); this._anim = null; }
    if (this._unpin) { this._unpin(); this._unpin = null; }
    for (let i = 0; i < this._hiddenObs.length; i++) this._hiddenObs[i].visible = true;
    this._hiddenObs.length = 0;
    this._scene.remove(this.groundMesh, this.terrain, this.carIM, this.carBarIM, this.cabinIM,
      this.chassisIM, this.wheelIM, this.trimIM, this.headIM, this.shadowIM, this.beamIM,
      this.logIM, this.logTrimIM, this.sunPool, this.horizonBand, this.playerGlow,
      this.padMesh, this.padPoolMesh, this.chevIM, this.pylonIM, this.pylonGlowIM);
    const track = ctx.track;
    if (this._floorHidden && track.floor) { track.floor.visible = true; this._floorHidden = false; }
    if (this._propsDresser) {
      const d = track.dressers;
      if (d.indexOf(this._propsDresser) < 0) d.unshift(this._propsDresser);
      this._propsDresser = null;
    }
    for (let c = 0; c < track.chunks.length; c++) {
      const att = track.chunks[c].attached;
      for (let k = 0; k < att.length; k++) att[k].visible = true;
    }
    this.coins.clear();
    Static.setIntensity(0.12);
    const p = ctx.player;
    p.y = 0; p.vy = 0;
    p.laneI = this.col < 2 ? 0 : this.col > 4 ? 2 : 1;
    p.x = colX(Math.max(0, Math.min(6, this.col)));
    p.group.position.set(p.x, 0, 0);
    p.group.rotation.set(0, 0, 0);
    this.hopping = false;
  }

  tryHop(ctx, dc, dr) {
    if (ctx.player.dead) return;
    if (this.hopping) { this.queued = { dc, dr }; return; }
    const scroll = ctx.track.scroll;
    this.fromU = this.rowU;
    this.fromX = this.px;
    let nc = this.col + dc;
    nc = Math.max(0, Math.min(COLS - 1, nc));
    this.col = nc;
    this.toX = colX(nc);
    let toU = this.rowU + dr * ROW_D;
    toU = Math.min(scroll + Z_MIN_AHEAD, Math.max(scroll - Z_MAX_BEHIND, toU));
    this.toU = toU;
    this.hopT = 0;
    this.hopping = true;
    sound('jump');
  }

  update(dt, ctx) {
    const track = ctx.track;
    const scroll = track.scroll;
    const p = ctx.player;
    this.t += dt;
    suppressRunObstacles(scroll);

    // rows scroll because the pinned Director speed drives track.scroll; the
    // merged ground mesh is drawn in track space at offset +scroll
    this.groundMesh.position.z = scroll;
    this.groundMat.uniforms.uScroll.value = scroll;
    this.groundMat.uniforms.uTime.value = this.t;
    // terrain is z-PINNED (set at build): the camera never moves in z, so a
    // scroll-locked backdrop slides out of the fixed visible window

    // recycle + gen rows (r4: recycled row claims the next free slot — the
    // slot ring matches the FIFO order, so no live row's geometry is clobbered)
    const rows = this.rows;
    while (rows[0].u < scroll - 16) {
      const r = rows.shift();
      r.u = this.topU;
      this.topU += ROW_D;
      r.slot = this._nextSlot;
      this._nextSlot = (this._nextSlot + 1) % MAX_ROWS;
      this.genRow(r, ctx);
      rows.push(r);
    }
    if (this.groundDirty) {
      const geo = this.groundMesh.geometry;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aCol.needsUpdate = true;
      geo.attributes.aKind.needsUpdate = true;
      this.groundDirty = false;
    }

    // cars + logs advance (deterministic seeded speeds)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      for (let k = 0; k < 4; k++) {
        const car = r.cars[k];
        if (!car.on) continue;
        car.x += car.dir * car.v * dt;
        if (car.x > 12.6) car.x -= 25.2;
        else if (car.x < -12.6) car.x += 25.2;
      }
      for (let k = 0; k < 3; k++) {
        const log = r.logs[k];
        if (!log.on) continue;
        log.x = log.anchor + Math.sin(this.t * log.om + log.ph) * log.amp;
      }
    }

    // ---- hop interpolation ---------------------------------------------------
    if (this.hopping) {
      this.hopT += dt;
      const k = Math.min(1, this.hopT / HOP_TIME);
      this.px = this.fromX + (this.toX - this.fromX) * k;
      this.rowU = this.fromU + (this.toU - this.fromU) * k;
      p.y = Math.sin(k * Math.PI) * 0.52;
      if (k >= 1) {
        this.hopping = false;
        p.y = 0;
        p.character._sqT = 0.1; // landing squash
        if (this.queued) { const q = this.queued; this.queued = null; this.tryHop(ctx, q.dc, q.dr); }
      }
    } else {
      p.y = 0;
    }
    // carried forward if the scroll line passes the player (static edge kills
    // idlers; being pushed keeps them reachable for it)
    const minU = scroll - Z_MAX_BEHIND;
    if (this.rowU < minU) { this.rowU = minU; this.fromU = this.toU = minU; }

    const pz = scroll - this.rowU;
    p.x = this.px;
    p.grounded = true;
    p.slideT = 0;
    p.group.position.set(this.px, p.y, pz);
    p.group.rotation.z = Math.max(-0.3, Math.min(0.3, (this.toX - this.px) * -0.5));

    // ---- standing hazards -------------------------------------------------------
    if (!p.dead && !this.hopping) {
      const r = this.rowAt(this.rowU);
      if (r) {
        if (r.type === T_ROAD) {
          for (let k = 0; k < 4; k++) {
            const car = r.cars[k];
            if (!car.on) continue;
            const half = car.len * 2.6 * 0.5 * 0.72 + 0.22;
            if (Math.abs(car.x - this.px) < half) { p.kill('hopper-traffic'); break; }
          }
        } else if (r.type === T_RIVER) {
          let onLog = false;
          for (let k = 0; k < 3; k++) {
            const log = r.logs[k];
            if (!log.on) continue;
            const half = log.len * 2.6 * 0.5 * 0.85 + 0.28;
            if (Math.abs(log.x - this.px) < half) {
              onLog = true;
              // carried by the log: analytic velocity of the sine drift
              this.px += log.amp * log.om * Math.cos(this.t * log.om + log.ph) * dt;
              if (Math.abs(this.px) > 9.2) p.kill('hopper-swept');
              break;
            }
          }
          if (!onLog && !p.dead) p.kill('hopper-river');
        }
      }
    }

    // ---- static edge (wait too long = camera-edge kill) ------------------------
    if (!p.dead) {
      if (this.rowU >= this.maxRowU - 0.01) {
        this.waitT += dt;
      } else {
        this.maxRowU = this.rowU;
        this.waitT = 0;
        this._warned = false;
      }
      if (this.rowU > this.maxRowU) this.maxRowU = this.rowU;
      if (this.waitT > EDGE_WARN) {
        const urg = Math.min(1, (this.waitT - EDGE_WARN) / (EDGE_KILL - EDGE_WARN));
        Static.setIntensity(0.14 + urg * 0.3); // creeping dread, not a full swallow
        if (!this._warned && urg > 0.25) {
          this._warned = true;
          bus.emit('ui:toast', { msg: 'THE STATIC CLOSES IN — KEEP HOPPING', kind: 'system' });
        }
      }
      if (this.waitT > EDGE_KILL) {
        p.kill('static-edge');
      }
    }

    // ---- autopilot (warp / attract): hop the safe line, matching scroll pace ----
    if (p.autopilot && !p.dead) {
      this._aiT += dt;
      const cadence = Math.max(0.26, (ROW_D / this._hopSpeed) * 0.7); // outpace scroll
      if (!this.hopping && this._aiT > cadence) {
        this._aiT = 0;
        this._aiHops = (this._aiHops || 0) + 1;
        const next = this.rowAt(this.rowU + ROW_D);
        const target = next ? next.safeCol : 3;
        // steer every 3rd hop so forward progress always wins
        if (target !== this.col && this._aiHops % 3 === 0) this.tryHop(ctx, target > this.col ? 1 : -1, 0);
        else this.tryHop(ctx, 0, 1);
      }
    }

    // ---- traffic/log instances ---------------------------------------------------
    // r4: each car writes body + roof bar + glass cabin + undercarriage +
    // wheels ×4 + side skirt trim ×2 + headlight pair + ground light cone +
    // contact shadow. dir flips the cone; truck length (len 2) stretches
    // body/chassis/cabin/wheelbase/shadow.
    let nc = 0;
    for (let i = 0; i < rows.length && nc < 48; i++) {
      const r = rows[i];
      const wz = scroll - r.u - ROW_D / 2;
      if (wz > 12 || wz < -110) continue;
      for (let k = 0; k < 4 && nc < 48; k++) {
        const car = r.cars[k];
        if (!car.on) continue;
        const L = car.len === 2 ? 1.9 : 1;
        const dir = car.dir;
        _e.set(0, 0, 0); _q.setFromEuler(_e);
        _s.set(L, car.len === 2 ? 1.2 : 1, 1);
        _p.set(car.x, 0.52, wz);
        _m.compose(_p, _q, _s);
        this.carIM.setMatrixAt(nc, _m);
        _p.y = 0.52 + 0.85 * _s.y * 0.5 + 0.08; // roof bar rides the body top
        _m.compose(_p, _q, _s);
        this.carBarIM.setMatrixAt(nc, _m);
        // glass cabin (offset toward the REAR by heading; windshield faces travel)
        _s.set(L, 1, 1);
        _p.set(car.x - dir * 0.35 * L, 0.95, wz);
        _m.compose(_p, _q, _s);
        this.cabinIM.setMatrixAt(nc, _m);
        // dark undercarriage skirt (grounds the body)
        _p.set(car.x, 0.16, wz);
        _m.compose(_p, _q, _s);
        this.chassisIM.setMatrixAt(nc, _m);
        // wheels ×4 (rubber discs, axle across travel)
        _s.set(1, 1, 1);
        for (let w = 0; w < 4; w++) {
          _p.set(car.x + (w & 1 ? 0.68 : -0.68) * L, 0.30, wz + (w & 2 ? 0.66 : -0.66));
          _m.compose(_p, _q, _s);
          this.wheelIM.setMatrixAt(nc * 4 + w, _m);
        }
        // emissive side skirt trim ×2
        _s.set(L, 1, 1);
        _p.set(car.x, 0.30, wz - 0.80);
        _m.compose(_p, _q, _s);
        this.trimIM.setMatrixAt(nc * 2, _m);
        _p.z = wz + 0.80;
        _m.compose(_p, _q, _s);
        this.trimIM.setMatrixAt(nc * 2 + 1, _m);
        // headlight pair on the leading face
        _s.set(1, 1, 1);
        _p.set(car.x + dir * (1.06 * L), 0.52, wz - 0.5);
        _m.compose(_p, _q, _s);
        this.headIM.setMatrixAt(nc * 2, _m);
        _p.z = wz + 0.5;
        _m.compose(_p, _q, _s);
        this.headIM.setMatrixAt(nc * 2 + 1, _m);
        // contact shadow pooling under the body
        _e.set(-Math.PI / 2, 0, 0); _q.setFromEuler(_e);
        _s.set(3.1 * L, 2.6, 1);
        _p.set(car.x, 0.055, wz);
        _m.compose(_p, _q, _s);
        this.shadowIM.setMatrixAt(nc, _m);
        // thrown headlight cone ahead of the bumper (flat, additive, softened)
        _e.set(-Math.PI / 2, 0, 0); _q.setFromEuler(_e);   // lay flat, tip toward -Z
        _q2.setFromAxisAngle(UP_Y, dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        _q.premultiply(_q2);                               // tip toward travel dir
        _s.set(2.1, 2.9, 1);
        _p.set(car.x + dir * (1.1 * L + 1.35), 0.075, wz);
        _m.compose(_p, _q, _s);
        this.beamIM.setMatrixAt(nc, _m);
        nc++;
      }
    }
    this.carIM.count = nc;
    this.carBarIM.count = nc;
    this.cabinIM.count = nc;
    this.chassisIM.count = nc;
    this.wheelIM.count = nc * 4;
    this.trimIM.count = nc * 2;
    this.headIM.count = nc * 2;
    this.shadowIM.count = nc;
    this.beamIM.count = nc;
    this.carIM.instanceMatrix.needsUpdate = true;
    this.carBarIM.instanceMatrix.needsUpdate = true;
    this.cabinIM.instanceMatrix.needsUpdate = true;
    this.chassisIM.instanceMatrix.needsUpdate = true;
    this.wheelIM.instanceMatrix.needsUpdate = true;
    this.trimIM.instanceMatrix.needsUpdate = true;
    this.headIM.instanceMatrix.needsUpdate = true;
    this.shadowIM.instanceMatrix.needsUpdate = true;
    this.beamIM.instanceMatrix.needsUpdate = true;
    let nl = 0;
    for (let i = 0; i < rows.length && nl < 48; i++) {
      const r = rows[i];
      if (r.type !== T_RIVER) continue;
      const wz = scroll - r.u - ROW_D / 2;
      if (wz > 12 || wz < -110) continue;
      for (let k = 0; k < 3 && nl < 48; k++) {
        const log = r.logs[k];
        if (!log.on) continue;
        _e.set(0, 0, 0); _q.setFromEuler(_e);
        _s.set(log.len * 2.35, 1, 1);
        _p.set(log.x, 0.22, wz);
        _m.compose(_p, _q, _s);
        this.logIM.setMatrixAt(nl, _m);
        // cyan trim rails on both z-flanks of the log (safe-platform language)
        _s.set(log.len * 2.35 * 0.94, 1, 1);
        _p.set(log.x, 0.46, wz - 0.30);
        _m.compose(_p, _q, _s);
        this.logTrimIM.setMatrixAt(nl * 2, _m);
        _p.z = wz + 0.30;
        _m.compose(_p, _q, _s);
        this.logTrimIM.setMatrixAt(nl * 2 + 1, _m);
        nl++;
      }
    }
    this.logIM.count = nl;
    this.logIM.instanceMatrix.needsUpdate = true;
    this.logTrimIM.count = nl * 2;
    this.logTrimIM.instanceMatrix.needsUpdate = true;

    // ---- traffic/log instances ---------------------------------------------------

    this.coins.update(dt, scroll, p);
    // r8: the camera is FIXED in z, so the visible world window is fixed too —
    // the backdrop planes are pinned in z here (they were scroll-locked, which
    // slid them out of the window: past scroll ≈ 366 the terrain no longer
    // covered the flanks and the frame edge measured ~99% bare black; the sun
    // pool/horizon band had likewise drifted off). Only opacity breathes.
    this.sunPool.material.opacity = 0.52 + Math.sin(this.t * 0.9) * 0.06;
    this.horizonBand.material.opacity = 0.55 + Math.sin(this.t * 0.7 + 2.0) * 0.06;
    this.playerGlow.position.set(this.px, 0.07, pz);
    this.playerGlow.material.opacity = 0.28 + Math.max(0, p.y) * 0.32;
    this._writeSpawnDressing(scroll);
    this._anim.play(this.hopping ? 'jump' : 'idle', dt, 0);
  }
}
