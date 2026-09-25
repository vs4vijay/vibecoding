// STACK GATES — Ketchapp-Stack timing gates. [W1-PHASES]
// Giant glowing gate frames every ~40 m; a bright marker sweeps across each
// gate's crossbar (scroll-locked sweep: it accelerates with run speed). Press
// jump/drift when the marker crosses the center zone:
//   PERFECT  → +50 style, combo up, a block is added to the tower trailing
//              behind you;
//   GOOD     → +5 style, pass;
//   MISS     → tower shrinks + 8 % speed penalty (stacks, capped) — this phase
//              is pure positive scoring: missing is NEVER death (spec §5).
// The marker position is a pure function of track scroll, so it is identical
// under warp and realtime for a given seed.
import * as THREE from 'three';
import { Phase, suppressRunObstacles, pinDirectorSpeed, wrapActions, expirePopups } from './Phase.js';
import { Pool } from '../core/Pool.js';
import { COL } from '../core/Palette.js';
import { FX } from '../fx/FX.js';
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { glowSpriteTexture, shadowSpriteTexture } from '../fx/Textures.js';

const MARK_SPAN = 3.4;       // marker sweeps ±3.4 across the bar
const SWEEP_K = Math.PI / 8; // spatial frequency: one half-sweep per 8 m —
                             // sweep speed scales with run speed (5→16 m/s)
const PERFECT_W = 1.25;      // |mx| for perfect — matches the gold zone (≈ ±0.25 s at v13)
const GOOD_W = 2.4;          // |mx| for good (≈ ±0.5 s at v13)
const JUDGE_Z = 3.0;         // |wz| window for good/perfect judgement
const MISS_Z = 7.0;          // presses while the marker is far out still count (miss)
const TOWER_MAX = 28;

// module scratch — zero allocs
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const GOLD = new THREE.Color(1.45, 0.78, 0.11);
const RED = new THREE.Color(2.2, 0.016, 0.013);
// r12 color math (same ACES rule as the flight lasers): sRGB G/B ≈ 0.10-0.18
// needs LINEAR G/B ≈ 0.01-0.03 — the old G/B ≈ 0.10 linear lifted to a pastel
// CORAL slab, and the gold peak (lum 1.45) bloomed the whole cursor into an
// amorphous white blob. RED now sits deep under the bloom line (crisp hot red,
// no coral), GOLD just kisses it (lum ≈ 0.88 — tight bloom, hue-dominant).

// clamped smoothstep 0..1 (module-local, zero-alloc)
function smoothstep01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

// merged box writer (r1b): [cx, cy, cz, w, h, d] → one BufferGeometry
function mergedBoxes(boxes, colors) {
  const pos = [], nor = [], col = colors ? [] : null, idx = [];
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let bi = 0; bi < boxes.length; bi++) {
    const [cx, cy, cz, w, h, d] = boxes[bi];
    const c = colors ? colors[bi] : null;
    const half = [w / 2, h / 2, d / 2];
    for (let f = 0; f < 6; f++) {
      const n = FACES[f];
      const u = n[0] !== 0 ? [0, 0, 1] : [1, 0, 0];
      const v = n[1] !== 0 ? [0, 0, 1] : [0, 1, 0];
      const hu = Math.abs(u[0]) * half[0] + Math.abs(u[1]) * half[1] + Math.abs(u[2]) * half[2];
      const hv = Math.abs(v[0]) * half[0] + Math.abs(v[1]) * half[1] + Math.abs(v[2]) * half[2];
      const cn = Math.abs(n[0]) * half[0] + Math.abs(n[1]) * half[1] + Math.abs(n[2]) * half[2];
      const b2 = pos.length / 3;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let ci = 0; ci < 4; ci++) {
        const su = corners[ci][0], sv = corners[ci][1];
        pos.push(cx + n[0] * cn + u[0] * su * hu, cy + n[1] * cn + v[1] * sv * hv, cz + n[2] * cn + u[2] * su * hu + v[2] * sv * hv);
        nor.push(n[0], n[1], n[2]);
        if (col) col.push(c[0], c[1], c[2]);
      }
      idx.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  return g;
}

// neon edge cage around a 1.4 × 0.5 × 1.4 block (12 glowing edges, one
// geometry). r4b: bars 0.085 → 0.105 — at run distance the cage must read as
// a CAGE, not a single lit strip.
function towerEdgeGeometry() {
  const e = 0.105, hx = 0.7, hy = 0.25, hz = 0.7;
  const boxes = [
    // vertical corners
    [-hx + e / 2, 0, -hz + e / 2, e, 0.5, e], [hx - e / 2, 0, -hz + e / 2, e, 0.5, e],
    [-hx + e / 2, 0, hz - e / 2, e, 0.5, e], [hx - e / 2, 0, hz - e / 2, e, 0.5, e],
    // top rim
    [0, hy - e / 2, -hz + e / 2, 1.4, e, e], [0, hy - e / 2, hz - e / 2, 1.4, e, e],
    [-hx + e / 2, hy - e / 2, 0, e, e, 1.4], [hx - e / 2, hy - e / 2, 0, e, e, 1.4],
    // bottom rim
    [0, -hy + e / 2, -hz + e / 2, 1.4, e, e], [0, -hy + e / 2, hz - e / 2, 1.4, e, e],
    [-hx + e / 2, -hy + e / 2, 0, e, e, 1.4], [hx - e / 2, -hy + e / 2, 0, e, e, 1.4],
  ];
  return mergedBoxes(boxes);
}

export class StackPhase extends Phase {
  id = 'stack';
  title = 'STACK GATES';
  duration = 38;
  weight = 1.0;
  cameraHint = { fov: 63, height: 5.0, dist: 8.8 };

  constructor() {
    super();
    this.t = 0;
    this.gates = [];
    this.nextGateU = 0;
    this.tower = 3;        // start with a small pedestal tower
    this.penalty = 0;
    this.base = 13;
    this._built = false;
    this._unpin = null;
    this._unwrap = null;
  }

  _build(scene) {
    if (this._built) return;
    this._built = true;
    this._scene = scene;

    // gate frame: dark structure + hot glow bar (pooled, 2 draws each)
    const structMat = new THREE.MeshStandardMaterial({ color: 0x141026, metalness: 0.6, roughness: 0.4 });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.gatePool = new Pool(() => {
      const grp = new THREE.Group();
      // monumental thin posts (dark) with hot cyan light strips + gold caps
      const pil = new THREE.BoxGeometry(0.34, 7.2, 0.34);
      const postMat2 = new THREE.MeshStandardMaterial({
        color: 0x0d0a1c, emissive: 0x0a2534, emissiveIntensity: 1.0, metalness: 0.6, roughness: 0.4,
      });
      const l = new THREE.Mesh(pil, postMat2); l.position.set(-4.7, 3.6, 0);
      const r = new THREE.Mesh(pil, postMat2); r.position.set(4.7, 3.6, 0);
      const cap = new THREE.BoxGeometry(10.2, 0.3, 0.3);
      const capM = new THREE.Mesh(cap, postMat2); capM.position.y = 7.25;
      grp.add(l, r, capM);
      // timing beam at eye level: dark housing + glow (cyan wings + a blazing
      // gold center perfect-zone the marker sweeps across)
      const o = { pos: [], col: [], idx: [] };
      const bar = (cx, cy, cz, w, h, d, c) => {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let f = 0; f < 6; f++) {
          const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f];
          const u = n[0] !== 0 ? [0, 0, 1] : [1, 0, 0];
          const v = n[1] !== 0 ? [0, 0, 1] : [0, 1, 0];
          const hw = w / 2, hh = h / 2, hd = d / 2;
          const hu = Math.abs(u[0]) * hw + Math.abs(u[1]) * hh + Math.abs(u[2]) * hd;
          const hv = Math.abs(v[0]) * hw + Math.abs(v[1]) * hh + Math.abs(v[2]) * hd;
          const cn = Math.abs(n[0]) * hw + Math.abs(n[1]) * hh + Math.abs(n[2]) * hd;
          const b2 = o.pos.length / 3;
          for (let ci = 0; ci < 4; ci++) {
            o.pos.push(cx + n[0] * cn + u[0] * corners[ci][0] * hu, cy + n[1] * cn + v[1] * corners[ci][1] * hv, cz + n[2] * cn + u[2] * corners[ci][0] * hu + v[2] * corners[ci][1] * hv);
            o.col.push(c[0], c[1], c[2]);
          }
          o.idx.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
        }
      };
      const dim = [0.16, 0.92, 1.05], gold = [1.9, 1.45, 0.42], capGold = [1.7, 1.3, 0.38];
      bar(-2.95, 2.3, 0, 3.25, 0.42, 0.5, dim);   // left wing
      bar(2.95, 2.3, 0, 3.25, 0.42, 0.5, dim);    // right wing
      bar(0, 2.3, 0, 2.9, 0.58, 0.55, gold);      // perfect zone (taller, hotter)
      bar(-4.7, 3.4, 0.19, 0.14, 6.2, 0.06, dim); // post light strips
      bar(4.7, 3.4, 0.19, 0.14, 6.2, 0.06, dim);
      bar(-4.7, 7.34, 0, 0.5, 0.16, 0.5, capGold);// gold post caps (beacons)
      bar(4.7, 7.34, 0, 0.5, 0.16, 0.5, capGold);
      // r4: thin emissive trim ON THE FRAME ITSELF — the posts + top cap used
      // to be a dead matte near-black mass against the sun; continuous light
      // lines along the cap underside and the posts' outer faces give the
      // portal a lit silhouette (deliberately dimmer than the timing beam so
      // the gold zone stays the hottest thing on the gate).
      // r6: the cap carried a hot line nowhere the runner's eye could see —
      // at t=20 the top beam crossed the frame as a dead black bar. Brighter
      // under-cap line + a light stripe ON the cap's front face + a top-edge
      // line read the beam as a lit portal header from every angle.
      const trim = [0.18, 1.0, 1.2];
      const trimSoft = [0.10, 0.52, 0.64];
      bar(0, 7.10, 0.20, 9.6, 0.09, 0.05, trim);      // under-cap light line
      bar(0, 7.25, 0.18, 10.0, 0.11, 0.05, trimSoft); // beam front-face stripe
      bar(0, 7.41, 0, 10.1, 0.05, 0.05, trimSoft);    // beam top-edge line
      bar(-4.7, 3.6, -0.20, 0.07, 6.9, 0.05, trim);   // outer-face post lines
      bar(4.7, 3.6, -0.20, 0.07, 6.9, 0.05, trim);
      bar(-1.45, 0.055, 0, 0.14, 0.02, 2.9, gold);// ground lane-pad rails (the
      bar(1.45, 0.055, 0, 0.14, 0.02, 2.9, gold); // perfect zone painted on the
      bar(0, 0.05, -1.45, 3.0, 0.02, 0.12, gold); // tarmac, unmissable from the
      bar(0, 0.05, 1.45, 3.0, 0.02, 0.12, gold);  // runner's eye line)
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.pos), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(o.col), 3));
      g.setIndex(o.idx);
      grp.add(new THREE.Mesh(g, glowMat));
      // perfect-zone halo: additive gold pool breathing behind the timing bar
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 1.7),
        new THREE.MeshBasicMaterial({
          map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      halo.position.set(0, 2.3, 0.42);
      grp.add(halo);
      grp.userData.halo = halo;
      // floor light pool under the perfect zone (contact light on the road)
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 3.4),
        new THREE.MeshBasicMaterial({
          map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, 0.04, 0);
      pad.renderOrder = 2;
      grp.add(pad);
      grp.userData.pad = pad;
      return grp;
    }, (grp) => grp.removeFromParent(), 'stack:gates');
    this.gatePool.prewarm(3);

    // sweeping marker (instanced across gates) — color lerp red→gold near
    // center. r6: the old 0.92 notch read as a low-contrast salmon speck at
    // speed (<200 ms parse fail). Now a 2.4 m bar with hot saturated states
    // plus an additive gold halo shell — the "press now" beat parses instantly.
    // r12: the HERO cursor rebuilt as a crisp slab — shallow depth (0.34) so
    // its silhouette stays a clean bar at every angle (the deep 0.5 box + free
    // Y-spin read as a tumbling plank), tight bloom via the trimmed GOLD/RED
    // tints above, and the halo re-shaped into a horizontal energy streak.
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.markIM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.62, 0.34), this.markMat, 6);
    this.markIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.markIM.frustumCulled = false;
    this.markIM.count = 0;   // r10: instance count must start at 0 — the photo
                             // API's first frame (at=0, no warp) never runs
                             // update(), and a max-count identity-matrix mesh
                             // renders a stacked blob at the origin
    this.markHaloMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.markHaloIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.markHaloMat, 6);
    this.markHaloIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.markHaloIM.frustumCulled = false;
    this.markHaloIM.renderOrder = 3;
    this.markHaloIM.count = 0;

    // combo tower trailing behind the player — r4: PALETTE-GOLD emissive body
    // (unlit HDR-tinted material reads as lit gold at ≤1.1, no blowout) with
    // the FULL 12-edge glow cage over it. The old tan/khaki LDR bodies read as
    // a flat shipping crate in the frame corner.
    this.towerIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.5, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), TOWER_MAX);
    this.towerIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.towerIM.frustumCulled = false;
    this.towerEdgeIM = new THREE.InstancedMesh(towerEdgeGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), TOWER_MAX);
    this.towerEdgeIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.towerEdgeIM.frustumCulled = false;
    // r10: counts start at 0 (see markIM — the photo first frame never runs
    // update(); TOWER_MAX identity blocks at the origin read as a white blob)
    this.towerIM.count = 0;
    this.towerEdgeIM.count = 0;
    for (let i = 0; i < TOWER_MAX; i++) {
      // r6: FACE emissive lowered so slabs read GOLD under the edge cage's
      // bloom bleed — the old 0.78/0.56/0.16 faces + 2.05-peak edges summed
      // into a near-white "tofu stack" in the crops (r6b verify: still
      // butter-pale at 5.7 m — faces now deep amber, cage trimmed to a hue-
      // dominant 1.5 peak that still clears the 0.85 bloom line).
      // r10: cage peak trimmed 1.50 → 1.30 and faces a step deeper — at the
      // 3 m pedestal distance the cage bloom halo blew the whole base block
      // to pure white; it still clears the bloom line (lum ≈ 0.95) so the
      // stack keeps its lit gold read with the edges staying readable.
      // r12: one more step DOWN on both — the tower's faces still measured
      // ≥240 after ACES on screen (overexposed slab). Faces (0.30,0.185,0.038)
      // and cage (1.16,0.85,0.24) keep the amber-heavy gold hue, cage still
      // clears the 0.85 bloom line (lum ≈ 0.79×bloom-kiss via face stack).
      // r13 [FX R3, critic item 5]: the r12 pair read butter-PALE at cruise —
      // the whitening driver is the cage's RED channel crossing the ACES knee
      // (1.16) while its bloom halo washes the wide faces. Rebalanced toward
      // YELLOW at the same bloom-kiss luminance (R1.05/G0.90/B0.18 → lum 0.88,
      // still over the 0.85 line) + one notch off the face albedo (0.30 →
      // 0.27). Same lit-gold glow, less red-driven white clip. (A deeper
      // blanket pull-down was tried and rejected: cage under the bloom line
      // reads as a flat unlit crate.)
      const twoTone = i % 2 ? 1.0 : 0.85;
      this.towerIM.setColorAt(i, _c.setRGB(0.27 * twoTone, 0.17 * twoTone, 0.034 * twoTone));
      this.towerEdgeIM.setColorAt(i, _c.setRGB(1.05, 0.90, 0.18));
    }

    // contact shadow pooling under the tower (grounds the crate stack)
    this.towerShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: shadowSpriteTexture(), transparent: true, opacity: 0.62, depthWrite: false,
      }),
    );
    this.towerShadow.rotation.x = -Math.PI / 2;
    this.towerShadow.renderOrder = 1;
    this.towerShadow.visible = false;

    // roadside monolith dressing (pooled; stacked dark slabs + neon trim).
    // Variants are built from a seeded local stream — warp-deterministic.
    this.monoMat = new THREE.MeshStandardMaterial({ color: 0x120e26, metalness: 0.55, roughness: 0.45 });
    this.monoGlowMat = new THREE.MeshBasicMaterial({ color: COL.cyan, toneMapped: false, fog: false });
    let ms = 0x57AC;
    const mrnd = () => { ms = (ms * 1664525 + 1013904223) >>> 0; return ms / 0xffffffff; };
    const monoGeo = [];
    for (let v = 0; v < 3; v++) {
      const h = 3 + mrnd() * 5.5;
      monoGeo.push({
        struct: mergedBoxes([
          [0, h / 2, 0, 2.0 + mrnd() * 0.8, h, 2.0 + mrnd() * 0.8],
          [(mrnd() - 0.5) * 0.8, h + 0.9, (mrnd() - 0.5) * 0.8, 1.4, 1.8, 1.4],
        ]),
        trimY: h * (0.55 + mrnd() * 0.3),
        trim2Y: h + 0.9,
      });
    }
    this.monoGeo = monoGeo;
    let monoIdx = 0;
    this.monoPool = new Pool(() => {
      const grp = new THREE.Group();
      const spec = monoGeo[monoIdx++ % monoGeo.length];
      const struct = new THREE.Mesh(spec.struct, this.monoMat);
      const trim = new THREE.Mesh(mergedBoxes([
        [0, spec.trimY, 1.06, 2.3, 0.09, 0.05],
        [0, spec.trim2Y, 0.76, 1.4, 0.09, 0.05],
      ]), this.monoGlowMat);
      grp.add(struct, trim);
      return grp;
    }, (grp) => grp.removeFromParent(), 'stack:monolith');
  }

  markerX(gate, scroll) {
    // Pure function of (scroll − gate.u): the sweep is locked to the gate's
    // approach, and ph0 is seeded so a center-crossing lands exactly at
    // wz = −1.2 — the "press now" beat is always inside the judge window
    // (guaranteed solvable, §12), reading as rhythm rather than double-timing.
    return Math.sin((scroll - gate.u) * SWEEP_K + gate.ph0) * MARK_SPAN;
  }

  enter(ctx) {
    this._build(window.__NR.scene);
    const track = ctx.track;
    this.t = 0;
    this.gates.length = 0;
    this.tower = 3;
    this.penalty = 0;
    this.base = ctx.speed;
    this._unpin = pinDirectorSpeed(ctx.director, () => this.base * (1 - this.penalty));

    // (re-)attach scene-level objects — exit() detaches, _build runs once
    this._scene.add(this.markIM, this.markHaloIM, this.towerIM, this.towerEdgeIM, this.towerShadow);
    // r10: lay out the pedestal + zero the marker instances so the phase's
    // FIRST rendered frame is finished (photo API at=0 never runs update())
    this.markIM.count = 0;
    this.markHaloIM.count = 0;
    this._writeTower(0, ctx.player.x);

    suppressRunObstacles(track.scroll);
    expirePopups();
    track.clearCoins();

    // r4b: pull the shared sky's sun down for this phase only — the sun
    // whiteout used to merge with the gold perfect zone muddying the target.
    // (uSunGain is a visual-only uniform added in fx/Shaders.js; restored on
    // exit so no other scene changes.) 0.8 still left the disc merging with
    // the gold zone at speed — 0.72 keeps them separable.
    const skyMat = typeof window !== 'undefined' ? window.__NR_SKY : null;
    if (skyMat && skyMat.uniforms && skyMat.uniforms.uSunGain) {
      skyMat.uniforms.uSunGain.value = 0.72;
      this._sunGainSet = true;
    }

    // spawn schedule: first gate ≥ 2.4 s out, exit-safe arrivals only
    this.nextGateU = track.scroll + Math.max(2.4 * ctx.speed, 40);

    this._unwrap = wrapActions(ctx.input, (a) => {
      if (a === 'up' || a === 'down' || a === 'drift') {
        this.judge(ctx);
        return true; // eaten: no jumping/sliding during the gate run
      }
      return false;
    });
    this._armRunStartCleanup(ctx);
  }

  exit(ctx) {
    this._disarmRunStartCleanup();
    if (this._unwrap) { this._unwrap(); this._unwrap = null; }
    if (this._unpin) { this._unpin(); this._unpin = null; }
    this.gates.length = 0;
    this._scene.remove(this.markIM, this.markHaloIM, this.towerIM, this.towerEdgeIM, this.towerShadow);
    if (this._sunGainSet) {
      const skyMat = typeof window !== 'undefined' ? window.__NR_SKY : null;
      if (skyMat && skyMat.uniforms && skyMat.uniforms.uSunGain) skyMat.uniforms.uSunGain.value = 1.0;
      this._sunGainSet = false;
    }
  }

  // roadside monolith slabs flanking the gate run (pooled)
  decorate(chunk, rng) {
    if (rng() > 0.55) return;
    const mono = this.monoPool.get();
    mono.userData.onRelease = (o) => this.monoPool.release(o);
    const side = rng() < 0.5 ? -1 : 1;
    mono.position.set(side * (9.5 + rng() * 5), 0, -(6 + rng() * 46));
    mono.rotation.y = (rng() - 0.5) * 0.9;
    chunk.attach(mono);
  }

  spawnGate(ctx) {
    const obj = this.gatePool.get();
    const u = this.nextGateU;
    // ph0: center-crossing pinned at wz −1.2; parity alternates sweep direction
    const n = ctx.rng() < 0.5 ? 0 : 1;
    const ph0 = (1.2 * SWEEP_K + n * Math.PI) % (2 * Math.PI);
    this.gates.push({ u, obj, judged: false, ph0 });
    this._scene.add(obj);
  }

  judge(ctx) {
    const p = ctx.player;
    if (p.dead) return;
    const scroll = ctx.track.scroll;
    let best = null, bestAbs = 99;
    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[i];
      if (gate.judged) continue;
      const wz = scroll - gate.u;
      if (wz > -MISS_Z && wz < JUDGE_Z) {
        const a = Math.abs(wz);
        if (a < bestAbs) { bestAbs = a; best = gate; }
      }
    }
    if (!best) return; // whiff — eaten but unjudged (gate still far out)
    best.judged = true;
    const wz = scroll - best.u;
    const mx = Math.abs(this.markerX(best, scroll));
    _p.set(p.x, 1.2, scroll - best.u);
    const inWindow = wz > -JUDGE_Z && wz < JUDGE_Z;
    if (inWindow && mx < PERFECT_W) {
      ctx.scoring.addStyle(50);
      if (this.tower < TOWER_MAX) this.tower++;
      bus.emit('style:perfect', { at: best.u });
      FX.spawnPop('gain', 50, 0, 2.2);
      FX.ring(_p, { to: 3.2, dur: 0.5, color: GOLD, alpha: 1.1, mode: 'wall' });
      sound('coin');
    } else if (inWindow && mx < GOOD_W) {
      ctx.scoring.addStyle(5);
      FX.spawnPop('gain', 5, 0, 2.1);
      sound('lane');
    } else {
      // MISS: tower shrinks + 8 % speed penalty (never death)
      this.tower = Math.max(0, this.tower - 1);
      this.penalty = Math.min(0.4, this.penalty + 0.08);
      ctx.camera.shake(0.32);
      FX.ring(_p, { to: 2.6, dur: 0.45, color: RED, alpha: 1, mode: 'wall' });
      bus.emit('ui:toast', { msg: 'MISSED GATE — TOWER DOWN', kind: 'system' });
    }
  }

  update(dt, ctx) {
    const track = ctx.track;
    const scroll = track.scroll;
    const p = ctx.player;
    const v = ctx.speed;
    this.t += dt;
    suppressRunObstacles(scroll);

    // spawn ahead — arrivals in the final 1.6 s are skipped (exit fairness)
    const gap = 42 - ctx.director.difficulty() * 5;
    while (this.nextGateU < scroll + 86) {
      const arrival = (this.nextGateU - scroll) / Math.max(v, 0.001);
      if (arrival >= 1.6) this.spawnGate(ctx);
      this.nextGateU += gap;
    }

    // recycle passed gates
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gate = this.gates[i];
      const wz = scroll - gate.u;
      if (wz > 12) {
        this._scene.remove(gate.obj);
        this.gatePool.release(gate.obj);
        this.gates.splice(i, 1);
        continue;
      }
      gate.obj.position.set(0, 0, wz);
      // perfect-zone halo + floor pad breathe (gold = the beat to hit)
      const halo = gate.obj.userData.halo;
      if (halo) halo.material.opacity = 0.34 + 0.18 * Math.sin(this.t * 5 + gate.u);
      const pad = gate.obj.userData.pad;
      if (pad) {
        const beat = Math.sin(this.t * 5 + gate.u);
        pad.material.opacity = 0.42 + 0.16 * beat;
        pad.scale.set(1 + beat * 0.05, 1 + beat * 0.05, 1);
      }
      // neutral gates that pass unjudged are just… passed (no penalty)
      if (!gate.judged && wz > 2.5) gate.judged = true;
    }

    // markers
    let nm = 0;
    for (let i = 0; i < this.gates.length && nm < 6; i++) {
      const gate = this.gates[i];
      const wz = scroll - gate.u;
      const mx = this.markerX(gate, scroll);
      const centering = 1 - Math.min(1, Math.abs(mx) / MARK_SPAN);
      // r10 (design law): the marker lerps between two LIT plateau states —
      // hot RED until the perfect zone (centering ≈ 0.63 ≈ |mx| 1.25), a fast
      // smoothstep ramp (0.66 → 0.80: the mixed band crosses just ~7 % of the
      // sweep position span and reads as amber "heating up", never pastel),
      // then hot GOLD. The halo rides at a dim-lit floor for the WHOLE sweep
      // with a trimmed peak (the old wide bright shell stacked with the
      // marker into a white blob at dead center).
      const heat = smoothstep01((centering - 0.66) / 0.14);
      // r12: the old free Y-spin (t·2 rad/s) presented the cursor edge-on or
      // diagonally at random beats — half of the "amorphous blob" read. It
      // now holds its facing with a ±3.5° sway and a slow breathe: alive, but
      // always a crisp slab.
      _e.set(0, Math.sin(this.t * 2.2 + i * 1.7) * 0.06, 0);
      _q.setFromEuler(_e);
      const pulse = 1 + Math.sin(this.t * 8 + i) * 0.04;
      _s.set(pulse, pulse, pulse);
      _p.set(mx, 2.3, wz);
      _m.compose(_p, _q, _s);
      this.markIM.setMatrixAt(nm, _m);
      this.markIM.setColorAt(nm, _c.copy(RED).lerp(GOLD, heat));
      // additive halo rides the marker — r12 SHAPED: a wide flat streak
      // (round sprite squashed 3.4×0.85) hugging the slab, so the glow wraps
      // the bar instead of ballooning around it; tint rides with heat.
      _q.identity();
      _s.set(3.4 + heat * 0.6, 0.85 + heat * 0.2, 1);
      _p.set(mx, 2.3, wz + 0.45);
      _m.compose(_p, _q, _s);
      this.markHaloIM.setMatrixAt(nm, _m);
      _c.copy(RED).lerp(GOLD, heat).multiplyScalar(0.16 + heat * 0.18);
      this.markHaloIM.setColorAt(nm, _c);
      nm++;
    }
    this.markIM.count = nm;
    this.markHaloIM.count = nm;
    this.markIM.instanceMatrix.needsUpdate = true;
    this.markHaloIM.instanceMatrix.needsUpdate = true;
    if (this.markIM.instanceColor) this.markIM.instanceColor.needsUpdate = true;
    if (this.markHaloIM.instanceColor) this.markHaloIM.instanceColor.needsUpdate = true;

    // combo tower trailing behind the player (kept inside the frame) — the
    // pose writer is shared with enter() (see _writeTower)
    this._writeTower(this.t, p.x);

    // autopilot: hit the zone under warp/attract
    if (p.autopilot && !p.dead) {
      for (let i = 0; i < this.gates.length; i++) {
        const gate = this.gates[i];
        if (gate.judged) continue;
        const wz = scroll - gate.u;
        if (wz > -1.6 && wz < 0 && Math.abs(this.markerX(gate, scroll)) < 0.7) this.judge(ctx);
        break;
      }
    }
  }

  // combo tower pose writer (kept inside the frame). r4b framing: pushed
  // further from the camera (z 5.4 → 3.1) and a full lane wider, so a grown
  // tower reads as a midground monument rising past the runner — not a corner
  // crate clipped by the frame edge. Still a tight column with a whisper of
  // sway, sitting on its contact shadow.
  // r10: shared by update() and enter() — under the photo API (at=0) update()
  // never runs before the first render, so enter() must lay out the pedestal
  // itself or the phase's first frame renders count-at-max identity blocks
  // stacked at the origin (the critic's "pure-white blob" under the player).
  _writeTower(t, px) {
    const n = Math.min(this.tower, TOWER_MAX);
    let towerX = 0, towerZ = 0;
    for (let i = 0; i < n; i++) {
      const sway = Math.sin(t * 2.2 + i * 0.55) * 0.018;
      _e.set(0, sway + i * 0.10, 0);
      _q.setFromEuler(_e);
      const pulse = 1 + (i === n - 1 ? Math.sin(t * 8) * 0.05 : 0);
      _s.set(pulse, 1, pulse);
      towerX = px * 0.9 + 4.45 + Math.sin(i * 2.4) * 0.08;
      towerZ = 3.1;
      _p.set(towerX, i * 0.52 + 0.26, towerZ);
      _m.compose(_p, _q, _s);
      this.towerIM.setMatrixAt(i, _m);
      this.towerEdgeIM.setMatrixAt(i, _m);
    }
    this.towerIM.count = n;
    this.towerEdgeIM.count = n;
    this.towerIM.instanceMatrix.needsUpdate = true;
    this.towerEdgeIM.instanceMatrix.needsUpdate = true;
    this.towerIM.visible = n > 0;
    this.towerEdgeIM.visible = n > 0;
    // contact light + shadow under the stack base (bottom block sits on it)
    if (n > 0) {
      this.towerShadow.visible = true;
      this.towerShadow.position.set(towerX, 0.025, towerZ);
      this.towerShadow.scale.set(3.4, 3.4, 1);
    } else {
      this.towerShadow.visible = false;
    }
  }
}
