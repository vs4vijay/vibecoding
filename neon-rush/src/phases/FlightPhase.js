// FLIGHT — Jetpack-Joyride hold-to-rise corridor with Flappy-style gap gates.
// [W1-PHASES] Rules:
//   - HOLD up/W/Space (or drift hold on touch) = thrust; release = gravity.
//   - Track floor "drops away": the corridor floats above the grid city floor
//     (floor deck y=FLOOR, ceiling deck y=CEIL). Floor/ceiling scrape = slow
//     + shake (never death, §12 fairness); gate bars / lasers = death.
//   - Fuel drains ~12 s per tank; gold fuel cells refill. Empty tank = weak
//     thrust, not death.
//   - Fairness: gap ≥ 2.2× player height; ≥ 1.1 s gate spacing at current
//     speed; no gate within 1.5 s of phase entry/exit; forgiving boxes.
import * as THREE from 'three';
import { Phase, pinDirectorSpeed, suppressRunObstacles, captureAnim, expirePopups } from './Phase.js';
import { Pool } from '../core/Pool.js';
import { FX } from '../fx/FX.js';
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { LANE_X } from '../world/Chunk.js';
import { corridorWallTexture, gateHazardTexture, horizonGlowTexture, glowSpriteTexture, fuelGaugeTexture, fuelFillTexture, coinTokenGeometry, coinTokenMaterial } from '../fx/Textures.js';

const FLOOR = 3.0;          // corridor floor (clears run-obstacle hitboxes)
const CEIL = 10.4;          // corridor ceiling
const THRUST = 30;          // accel up while held
const GRAV = 24;            // matches run gravity feel
const VY_MIN = -15;
const VY_MAX = 8.5;
const FUEL_DRAIN = 1 / 12;  // full tank ≈ 12 s
const FUEL_REFILL = 0.34;
const SPAWN_AHEAD = 84;
const BAR_W = 9.8;
const GATE_MIN_GAP_S = 1.18; // ≥ spacing seconds at the CURRENT speed (§12)
const MAX_GATES = 8;
const MAX_LASERS = 6;
const MAX_FUELS = 10;
const MAX_RINGS = 5;
const RIB_N = 14;            // ceiling light ribs streaming past (motion cue)

// module scratch — zero allocs in update loops
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const FLAME_A = new THREE.Color(2.6, 1.2, 0.35);
const FLAME_B = new THREE.Color(0.6, 2.2, 2.6);

function gridDeckTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0620';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#1d3f84';
  g.lineWidth = 4;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  g.strokeStyle = '#00f0ff';
  g.lineWidth = 2;
  g.globalAlpha = 0.6;
  g.beginPath(); g.moveTo(0, 1); g.lineTo(128, 1); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// corridor column pair (chunk dressing via decorate) — ONE merged mesh
function buildColumnPair() {
  const o = { pos: [], nor: [], idx: [] };
  const box = (cx, cy, cz, w, h, d) => {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const base = o.pos.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let f = 0; f < 6; f++) {
      // simple 6-face writer (axis aligned)
      const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f];
      const u = n[0] !== 0 ? [0, 0, 1] : [1, 0, 0];
      const v = n[1] !== 0 ? [0, 0, 1] : [0, 1, 0];
      const hu = Math.abs(u[0]) * hx + Math.abs(u[1]) * hy + Math.abs(u[2]) * hz;
      const hv = Math.abs(v[0]) * hx + Math.abs(v[1]) * hy + Math.abs(v[2]) * hz;
      const cn = Math.abs(n[0]) * hx + Math.abs(n[1]) * hy + Math.abs(n[2]) * hz;
      const b2 = o.pos.length / 3;
      for (let ci = 0; ci < 4; ci++) {
        const su = corners[ci][0], sv = corners[ci][1];
        o.pos.push(cx + n[0] * cn + u[0] * su * hu, cy + n[1] * cn + v[1] * sv * hv, cz + n[2] * cn + u[2] * su * hu + v[2] * sv * hv);
        o.nor.push(n[0], n[1], n[2]);
      }
      o.idx.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
      void base;
    }
  };
  // twin pillars + cap beams (dark structural with cyan cap handled by mat)
  box(-5.9, 5.2, 0, 0.7, 10.4, 0.7);
  box(5.9, 5.2, 0, 0.7, 10.4, 0.7);
  box(-5.9, 10.55, 0, 1.4, 0.5, 1.4);
  box(5.9, 10.55, 0, 1.4, 0.5, 1.4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(o.nor), 3));
  g.setIndex(o.idx);
  return g;
}

export class FlightPhase extends Phase {
  id = 'flight';
  title = 'FLIGHT ZONE';
  duration = 42;
  weight = 1.2;
  cameraHint = { fov: 68, height: 6.2, dist: 8.8 };

  constructor() {
    super();
    this.t = 0;
    this.fy = 4.6;
    this.vy = 0;
    this.fuel = 1;
    this.slowT = 0;
    this.graceT = 0;
    this.base = 13;
    this.nextGateU = 0;
    this.gates = [];
    this.lasers = [];
    this.fuels = [];
    this.rings = [];
    this._lowWarned = false;
    this._aiThrust = false;
    this._flameAcc = 0;
    this._built = false;
    this._anim = null;
    this._unpin = null;
    this._scene = null;
    this._cam = null;
    this._camObj = null;
    this._restoreAim = null;
  }

  // --- GPU resources, built once on first enter ---
  _build(scene) {
    if (this._built) return;
    this._built = true;
    this._scene = scene;
    // the fuel gauge rides the camera — the camera must be in the scene graph
    // or its children never render (main.js never adds it).
    scene.add(this._camObj = window.__NR.camera);

    // corridor decks (texture-scroll = motion)
    const deckTex = gridDeckTexture();
    deckTex.repeat.set(3, 26);
    this._deckTex = deckTex;
    const deckMat = new THREE.MeshBasicMaterial({ map: deckTex });
    const deckGeo = new THREE.BoxGeometry(BAR_W + 1.2, 0.24, 150);
    this.deckL = new THREE.Mesh(deckGeo, deckMat);
    this.deckL.position.set(0, FLOOR - 0.13, -55);
    this.deckH = new THREE.Mesh(deckGeo, deckMat);
    this.deckH.position.set(0, CEIL + 0.13, -55);
    this._deckMat = deckMat;

    // corridor walls: paneled plating with hot light seams + glowing base trim
    // (fx/Textures.js), sliding via texture offset = motion.
    // One repeat spans the full wall height so windows hug the ceiling once;
    // tiling runs along the corridor only. Fog fades them out (Basic + fog).
    this._wallTex = corridorWallTexture();
    this._wallTex.repeat.set(6.5, 1);
    const wallMat = new THREE.MeshBasicMaterial({ map: this._wallTex });
    const wallGeo = new THREE.PlaneGeometry(176, 10.6);
    this.wallL = new THREE.Mesh(wallGeo, wallMat);
    this.wallL.rotation.y = Math.PI / 2;                 // faces +x (into the corridor)
    this.wallL.position.set(-5.9, 7.5, -60);
    this.wallR = new THREE.Mesh(wallGeo, wallMat);
    this.wallR.rotation.y = -Math.PI / 2;                // faces -x
    this.wallR.position.set(5.9, 7.5, -60);
    this._wallMat = wallMat;

    // wall light columns — emissive strips streaming past on both walls
    // (depth/motion cue; one instanced draw per side pair). r4b HDR budget —
    // the previous 1.30-peak tint still crossed the bloom threshold at close
    // range and read as white bars. r10: the old (0.14,0.78,0.95) LINEAR input
    // lifts to a washed white-cyan after ACES+sRGB (the critic's "floating
    // white marker planks"). These values stay linear-HDR but R is pinned low
    // so the tubes render saturated LIT cyan at every distance, never white.
    this.wstripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    // r10b: (0.05,0.80,1.08) still lifted to a pale near-white column on screen
    // — dropped one step deeper so the tubes read unmistakably LIT CYAN.
    this.wstripMat.color.setRGB(0.03, 0.55, 0.78);
    this.wstripIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 2.6, 0.34), this.wstripMat, 16);
    this.wstripIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wstripIM.frustumCulled = false;

    // vanishing point: the corridor ends in LIGHT (gold sun core + magenta
    // horizon ramp) so depth reads toward the bright end, not into black
    const endGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 13),
      new THREE.MeshBasicMaterial({
        map: horizonGlowTexture(), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    const endCore = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({
        map: glowSpriteTexture('#ffd9a0'), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.endGlow = endGlow;
    this.endCore = endCore;

    // corridor skeleton: repeating structural ribs crossing the ceiling, plus
    // four continuous hot edge strips framing the flight channel (floor/ceiling
    // treatment). Ribs stream toward the camera via the scroll remainder.
    this.ribMat = new THREE.MeshBasicMaterial({ color: 0x00a6c0, toneMapped: false });
    this.ribIM = new THREE.InstancedMesh(new THREE.BoxGeometry(BAR_W + 1.1, 0.12, 0.6), this.ribMat, RIB_N);
    this.ribIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ribIM.frustumCulled = false;

    // continuous hot edge strips framing the flight channel. r10: the old
    // (0.20,0.60,0.70) LINEAR values lifted to washed white planks after the
    // output transform — now a vivid LIT cyan (slightly over the bloom line so
    // the rails kiss into glow without going white).
    this.stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.stripMat.color.setRGB(0.05, 0.92, 1.22);
    this.stripIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.stripMat, 4);
    this.stripIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stripIM.frustumCulled = false;
    { // continuous hot rails framing the flight channel (set once — static)
      const sm = new THREE.Matrix4();
      const ex = BAR_W / 2 + 0.35;
      for (let k = 0; k < 4; k++) {
        sm.makeScale(0.14, 0.07, 152);
        sm.setPosition(k & 1 ? ex : -ex, k < 2 ? FLOOR + 0.03 : CEIL + 0.03, -55);
        this.stripIM.setMatrixAt(k, sm);
      }
      this.stripIM.instanceMatrix.needsUpdate = true;
    }

    // gate bars (unit box, per-instance scale) — hazard-plate red steel with
    // hot upward chevrons pointing at the threadable gap. r4b: tint kept near
    // 1.0 so the plate's amber edge line stays orange under ACES (a >1 tint
    // pushed the texture's light rows past white → the full-width blown band).
    // r10: the tint is RED-dominant now — the old (1.0,0.85,0.78) pink-lean
    // multiplier was what let far bars mip out to a desaturated SALMON slab.
    this.barMat = new THREE.MeshBasicMaterial({ map: gateHazardTexture(), toneMapped: false });
    this.barMat.color.setRGB(1.06, 0.50, 0.38);
    this.barIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.barMat, MAX_GATES * 2);
    this.barIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.barIM.frustumCulled = false;

    // dark steel gate chassis: top/bottom cap beams hugging each bar (gives the
    // slab a machine silhouette instead of a floating red box) — r8: unlit
    // dark red-black, same anti-sheen treatment as the posts.
    // r10: the old setRGB(0.10,0.045,0.085) passed LINEAR values that lift to a
    // pale salmon-lavender slab after ACES+sRGB — the critic's "flat desaturated
    // SALMON slab". Hex 0x140b18 is interpreted as sRGB (converted properly) and
    // renders as intended: true near-black plum structure.
    this.frameMat = new THREE.MeshBasicMaterial({ color: 0x140b18, toneMapped: false });
    this.frameIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.frameMat, MAX_GATES * 2);
    this.frameIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.frameIM.frustumCulled = false;

    // hot orange lip where each cap meets the safe gap (the hazard edge —
    // reads "laser-cut steel" against the cyan safe opening). r4b: trimmed so
    // its bloom halo stops merging with the gap strips into a white band.
    // r10: pushed redder (less G) so the lip reads hot hazard orange, not tan.
    this.lipMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lipMat.color.setRGB(1.45, 0.28, 0.07);
    this.lipIM = new THREE.InstancedMesh(new THREE.BoxGeometry(BAR_W + 0.6, 0.09, 0.86), this.lipMat, MAX_GATES * 2);
    this.lipIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lipIM.frustumCulled = false;
    for (let i = 0; i < MAX_GATES * 2; i++) { _c.setRGB(1, 1, 1); this.lipIM.setColorAt(i, _c); }

    // cyan gap edge strips framing the SAFE opening (readability: gap glows
    // cyan/green, bars read red — the thread line is unmissable). r4b: the old
    // 1.34-peak tint bloomed these thin strips into the fat white crossbars
    // the critic shot at t=15; under the 0.85 bloom threshold they stay crisp
    // saturated cyan and still read as the lit thread line. Instance colors
    // carry a near-camera fade (a passed gate's strips sat <2 m from the lens
    // and washed the lower frame). r10: the near fade now bottoms out at 0.22
    // — a DIM LIT strip of the same hue (design law: fades never reach black).
    this.edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.edgeMat.color.setRGB(0.09, 0.85, 1.05);
    this.edgeIM = new THREE.InstancedMesh(new THREE.BoxGeometry(BAR_W, 0.16, 0.72), this.edgeMat, MAX_GATES * 2);
    this.edgeIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.edgeIM.frustumCulled = false;
    for (let i = 0; i < MAX_GATES * 2; i++) { _c.setRGB(1, 1, 1); this.edgeIM.setColorAt(i, _c); }

    // gate frame posts — r8: unlit near-black steel. Lit dark materials still
    // caught a pale grazing-angle sheen (fresnel at the frame edges) that read
    // as flat white-gray slabs; unlit dark = a clean structure silhouette at
    // every angle, with the hot strip carrying the gate's light language.
    // r10: the old setRGB(0.055,0.042,0.11) LINEAR triple lifted to a washed
    // pale-purple post that died against the tunnel at close range; the hex
    // value converts sRGB→linear properly and keeps a TRUE dark silhouette
    // while the HDR strip on its inner face carries the lit read.
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x0d0a1e, toneMapped: false });
    this.postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 1, 0.42), this.postMat, MAX_GATES * 2);
    this.postStripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.postStripMat.color.setRGB(0.18, 1.05, 1.30);
    this.postStripIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), this.postStripMat, MAX_GATES * 2);
    for (let i = 0; i < MAX_GATES * 2; i++) { _c.setRGB(1, 1, 1); this.postStripIM.setColorAt(i, _c); }

    // lasers — SOLID hot-red hazard rods (r8 restyle): the old wide additive
    // salmon shell read as an alpha-glitched translucent slab dead-center in
    // the flight path (and the player passes it in the next lane — actively
    // teaching wrong hazard language). Now: an opaque red-hot core (normal
    // blending, hue-dominant — never salmon) + a tight additive glow. The
    // near-camera fade DIMS the core toward deep ember red (design law: bright
    // emissive → dimmer emissive of the same hue — never black).
    this.laserCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, transparent: true, opacity: 1.0,
      depthWrite: false,
    });
    this.laserCoreIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 1, 0.13), this.laserCoreMat, MAX_LASERS);
    this.laserCoreIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.laserCoreIM.frustumCulled = false;
    this.laserGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.laserGlowIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1, 0.34), this.laserGlowMat, MAX_LASERS);
    this.laserGlowIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.laserGlowIM.frustumCulled = false;

    // fuel cells — r8: unified with the run/hopper faceted gold token family
    // (baked unlit facets, amber-heavy tint — reads as emissive gold from
    // every angle; the old lit octahedron gem swung toward flat cream).
    // Same geometry factory as CoinSet, scaled up for the corridor.
    // r10: the corridor's cyan ambient washed the shared coin tint to matte
    // beige up close — fuel cells get the hotter token strength (1.35) plus a
    // gold additive halo quad per instance so they read LIT at every distance.
    // r12: cells exiting near the frame edge read as a flat tan slab up close
    // — the rim facets washed out under the additive halo at close range.
    // Flight-only rebias: the RIM vertex band (material group 0) darkens one
    // step so the faceted gem silhouette holds at 1-2 m; halo trimmed to keep
    // it from saturating the faces it overlaps.
    this.fuelGeo = coinTokenGeometry(0.46);
    this.fuelGeo.scale(1.15, 1.15, 1.15);
    {
      const fcol = this.fuelGeo.attributes.color;
      for (const gr of this.fuelGeo.groups) {
        if (gr.materialIndex !== 0) continue;
        for (let v = gr.start; v < gr.start + gr.count; v++) {
          fcol.array[v * 3] *= 0.58; fcol.array[v * 3 + 1] *= 0.58; fcol.array[v * 3 + 2] *= 0.58;
        }
      }
      fcol.needsUpdate = true;
    }
    this.fuelMat = coinTokenMaterial(1.35);
    this.fuelIM = new THREE.InstancedMesh(this.fuelGeo, this.fuelMat, MAX_FUELS);
    this.fuelHaloMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.fuelHaloIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.fuelHaloMat, MAX_FUELS);
    this.fuelHaloIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fuelHaloIM.frustumCulled = false;
    this.fuelHaloIM.renderOrder = 3;

    // corridor rings — the phase's signature element. r6 rebuild: the R4
    // blowout fix had left them as a flat translucent torus + wide halo band
    // with NO bloom response ("2D stickers"). The core is now an HDR
    // hue-dominant cyan (lum ~1.3) so mid-distance rings feed the bloom pass
    // like the run-phase rails; the halo is a tighter additive shell. BOTH
    // meshes are transparent + depthWrite:false and instances fade to zero
    // well before the lens (and are SKIPPED below 2% tint — the old opaque
    // black-faded torus used to occlude the whole corridor as a huge dark
    // ellipse when a ring passed the camera).
    // r8: the halo torus had 8 tubular segments — a visibly STEPPED octagonal
    // silhouette up close; 24 segments read smooth. Near fade now DIMS AND
    // HUE-SHIFTS toward deep teal (per-instance color lerp) instead of
    // flattening to a gray annulus.
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false,
    });
    // r10: peak trimmed (0.40,1.55,1.85 → 0.22,1.30,1.55) — at mid distance the
    // old ring's bloom halo stacked into a fat WHITE donut; this stays over the
    // 0.85 bloom line (lum ≈ 1.15, still feeds the pass like the run rails)
    // while the ACES result keeps cyan dominance — lit ring, never white blob.
    this.ringMat.color.setRGB(0.22, 1.30, 1.55);
    this.ringIM = new THREE.InstancedMesh(new THREE.TorusGeometry(3.35, 0.085, 20, 56), this.ringMat, MAX_RINGS);
    this.ringHaloMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff, toneMapped: false, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ringHaloIM = new THREE.InstancedMesh(new THREE.TorusGeometry(3.35, 0.30, 24, 48), this.ringHaloMat, MAX_RINGS);
    for (let i = 0; i < MAX_RINGS; i++) {
      _c.setRGB(1, 1, 1);
      this.ringIM.setColorAt(i, _c);
      this.ringHaloIM.setColorAt(i, _c);
    }

    // fuel gauge — camera-attached HUD (draws over the world: no depth fights).
    // A textured glass face + HDR fill: the old flat dark planes floated in
    // the world reading as a broken artifact slab; the glowing frame + bright
    // fill parses instantly as a holographic fuel gauge.
    // r10: the fill is now a flowing ENERGY column (fuelFillTexture, HDR gold
    // multiplier + animated offset) with a soft gold back-glow — the old flat
    // (2.0,1.5,0.42) plane rendered as a dead beige/olive block.
    const gauge = new THREE.Group();
    const backGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 2.62),
      new THREE.MeshBasicMaterial({
        map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
        toneMapped: false,
      }),
    );
    backGlow.material.color.setRGB(1.35, 0.95, 0.30);
    backGlow.renderOrder = 90;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 2.26),
      new THREE.MeshBasicMaterial({
        map: fuelGaugeTexture(), transparent: true, toneMapped: false,
        depthTest: false, depthWrite: false,
      }),
    );
    this.gaugeFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.185, 1.78),
      new THREE.MeshBasicMaterial({
        map: fuelFillTexture(), transparent: true, toneMapped: false,
        depthTest: false, depthWrite: false,
      }),
    );
    this.gaugeFillTex = fuelFillTexture();
    this.gaugeFill.material.color.setRGB(1.65, 1.30, 0.72);      // HDR gold → blooms
    this.gaugeFill.geometry.translate(0, 0.89, 0);             // scale from the bottom
    this.gaugeFill.position.set(0, -0.87, 0.01);               // in front of the glass
    face.renderOrder = 91;
    this.gaugeFill.renderOrder = 92;
    gauge.add(backGlow); gauge.add(this.gaugeFill); gauge.add(face);
    gauge.position.set(-3.6, 0.9, -6);
    gauge.renderOrder = 90;
    gauge.visible = false;
    this.gauge = gauge;
  }

  enter(ctx) {
    // ctx has no scene ref — the debug API contract guarantees window.__NR
    this._build(window.__NR.scene);
    const scene = this._scene;
    const p = ctx.player;
    this.t = 0;
    this.fuel = 1;
    this.slowT = 0;
    this.graceT = 1.5;         // entry grace: auto-hover until inputs settle
    this._lowWarned = false;
    this.vy = 0;
    this.fy = Math.max(p.y, 4.4);
    p.slideT = 0;
    p.grounded = false;
    this.base = ctx.speed;
    this._unpin = pinDirectorSpeed(ctx.director, () => this.base * (this.slowT > 0 ? 0.82 : 1));

    suppressRunObstacles(ctx.track.scroll);
    expirePopups();
    ctx.track.clearCoins();

    // spawn schedule — first gate ≥ 2.6 s after entry (§12 calm + reaction)
    this.nextGateU = ctx.track.scroll + Math.max(2.6 * ctx.speed, 36);
    this.ringU = ctx.track.scroll + 10;

    // pools online
    scene.add(this.deckL, this.deckH, this.wallL, this.wallR, this.ribIM, this.stripIM,
      this.barIM, this.frameIM, this.lipIM, this.edgeIM, this.postIM, this.postStripIM,
      this.laserCoreIM, this.laserGlowIM, this.fuelIM, this.fuelHaloIM, this.ringIM, this.ringHaloIM, this.wstripIM,
      this.endGlow, this.endCore);
    for (const im of [this.barIM, this.frameIM, this.lipIM, this.edgeIM, this.postIM, this.postStripIM,
      this.laserCoreIM, this.laserGlowIM, this.fuelIM, this.fuelHaloIM, this.ringIM, this.ringHaloIM]) im.count = 0;
    this.ribIM.count = RIB_N;
    this.stripIM.count = 4;
    this.wstripIM.count = 16;
    // r10: streaming instances write their matrices in update() — under the
    // photo API (at=0, no warp) update may never run before the first render,
    // so frame 1 must already carry a valid layout, never identity-at-origin.
    this._layoutAmbient(ctx.track.scroll);
    this.gates.length = 0; this.lasers.length = 0; this.fuels.length = 0; this.rings.length = 0;

    // the straight-road city dressing (buildings, lamp posts whose heads used
    // to float inside the corridor, billboards) fights the tunnel — hide it
    // for the phase (same mechanism Hopper/Drift use: Props dresser = [0])
    const track = ctx.track;
    this._propsDresser = null;
    {
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
    }

    // fuel gauge on camera
    this._cam = ctx.camera.cam;
    this._cam.add(this.gauge);
    this.gauge.visible = true;

    this._anim = captureAnim(ctx);

    // r10: flight avatar read — at corridor altitudes the runner read as a
    // dark splayed smudge. Phase-owned additive kit (visual only): a jetpack
    // engine glow on the back, two wingtip lights, all hue-dominant cyan so
    // the silhouette carries a LIT core at every altitude. Removed on exit.
    // r12: the body STILL read near-black from the chase cam mid-dodge — the
    // skin's dark albedo + top-down key left the visible back faces unlit and
    // the wingtips read alone. Two more in-lane levers: a soft rim-shell glow
    // wrapping the torso (silhouette lift at every angle) and a phase-scoped
    // boost of the character's own fill light (real albedo response, boosted
    // on enter / restored on exit).
    if (!this._avatarKit) {
      const kit = new THREE.Group();
      const shell = new THREE.Mesh(
        new THREE.PlaneGeometry(1.05, 1.4),
        new THREE.MeshBasicMaterial({
          map: glowSpriteTexture('#7df4ff'), transparent: true, opacity: 0.30,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      shell.material.color.setRGB(0.08, 0.40, 0.50);
      shell.position.set(0, 1.05, 0.34);
      shell.renderOrder = 3;
      kit.add(shell);
      const eng = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 1.05),
        new THREE.MeshBasicMaterial({
          map: glowSpriteTexture('#7df4ff'), transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      eng.material.color.setRGB(0.30, 1.15, 1.40);
      eng.position.set(0, 0.95, 0.42);
      eng.renderOrder = 4;
      kit.add(eng);
      const tipGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
      const tipMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      tipMat.color.setRGB(0.25, 1.25, 1.50);
      for (const side of [-1, 1]) {
        const tip = new THREE.Mesh(tipGeo, tipMat);
        tip.position.set(side * 0.44, 1.02, 0.30);
        kit.add(tip);
      }
      this._avatarKit = kit;
    }
    p.group.add(this._avatarKit);
    this._avatarKit.visible = !p.dead;
    // r12 albedo lift (see kit comment): brighten the character's fill light
    // for this phase only; exit() restores the shipped values.
    const ch = p.character;
    if (ch && ch.glowLight) {
      if (!this._glowSaved) {
        this._glowSaved = { intensity: ch.glowLight.intensity, distance: ch.glowLight.distance };
      }
      ch.glowLight.intensity = 2.4;
      ch.glowLight.distance = 4.8;
    }

    // framing: the rig's generic look target (y = 1.6 + p.y·0.55) leaves the
    // flyer low in frame at corridor altitudes — re-aim at a blend biased to
    // the player's height so the ship reads against the gate openings.
    const rig = ctx.camera;
    const prevApply = rig.apply;
    const self = this;
    const patched = function () {
      prevApply.call(rig);
      const cam = rig.cam;
      _p.set(rig.look.x * 0.9, rig.look.y * 0.42 + self.fy * 0.66, rig.look.z);
      cam.lookAt(_p);
    };
    rig.apply = patched;
    this._restoreAim = () => { if (rig.apply === patched) rig.apply = prevApply; };

    this._armRunStartCleanup(ctx);
  }

  exit(ctx) {
    this._disarmRunStartCleanup();
    if (this._unpin) { this._unpin(); this._unpin = null; }
    if (this._anim) { this._anim.restore(); this._anim = null; }
    if (this._restoreAim) { this._restoreAim(); this._restoreAim = null; }
    if (this._avatarKit && this._avatarKit.parent) this._avatarKit.parent.remove(this._avatarKit);
    // r12: restore the character fill light boosted in enter()
    if (this._glowSaved && ctx && ctx.player && ctx.player.character && ctx.player.character.glowLight) {
      ctx.player.character.glowLight.intensity = this._glowSaved.intensity;
      ctx.player.character.glowLight.distance = this._glowSaved.distance;
      this._glowSaved = null;
    }
    const scene = this._scene;
    if (scene) {
      scene.remove(this.deckL, this.deckH, this.wallL, this.wallR, this.ribIM, this.stripIM,
        this.barIM, this.frameIM, this.lipIM, this.edgeIM, this.postIM, this.postStripIM,
        this.laserCoreIM, this.laserGlowIM, this.fuelIM, this.fuelHaloIM, this.ringIM, this.ringHaloIM, this.wstripIM,
        this.endGlow, this.endCore);
    }
    if (this._cam) { this._cam.remove(this.gauge); this.gauge.visible = false; this._cam = null; }
    // restore the city dressing hidden at enter
    if (ctx && ctx.track) {
      if (this._propsDresser) {
        const d = ctx.track.dressers;
        if (d.indexOf(this._propsDresser) < 0) d.unshift(this._propsDresser);
        this._propsDresser = null;
      }
      for (let c = 0; c < ctx.track.chunks.length; c++) {
        const att = ctx.track.chunks[c].attached;
        for (let k = 0; k < att.length; k++) att[k].visible = true;
      }
    }
    this.gates.length = 0; this.lasers.length = 0; this.fuels.length = 0; this.rings.length = 0;
  }

  // chunk dressing: neon corridor column pairs (pooled, 1 draw each)
  decorate(chunk, rng) {
    if (!this._colPool) {
      // r8: matte structure — lit dark materials caught a pale grazing sheen
      // that read as "wall planks" at frame corners (same defect as postMat).
      // r10: the setRGB(0.075,0.062,0.20) LINEAR triple lifted to washed
      // lavender columns; the hex value converts properly and stays a true
      // dark structural silhouette against the lit strips.
      this._colMat = new THREE.MeshBasicMaterial({ color: 0x191542, toneMapped: false });
      this._colPool = new Pool(() => {
        const mesh = new THREE.Mesh(buildColumnPair(), this._colMat);
        return mesh;
      }, (mesh) => { mesh.removeFromParent(); }, 'flight:columns');
    }
    if (rng() > 0.45) return;
    const col = this._colPool.get();
    col.userData.onRelease = (o) => this._colPool.release(o);
    col.position.set(0, 0, -(6 + rng() * 46));
    chunk.attach(col);
  }

  update(dt, ctx) {
    const g = ctx.game;
    const p = ctx.player;
    const v = ctx.speed;
    const scroll = ctx.track.scroll;
    this.t += dt;
    suppressRunObstacles(scroll);
    if (this.slowT > 0) this.slowT -= dt;
    // deck + wall texture scroll = corridor motion cue (repeat spans: deck 26
    // rows over 150 m, wall 6.5 tiles over 176 m)
    this._deckTex.offset.y -= v * dt * (26 / 150);
    this._wallTex.offset.x -= v * dt * (6.5 / 176);
    // §12.3: nothing may kill within the final 1.2 reaction-seconds — content
    // already on screen stays visible but stops being lethal
    const calmExit = g.phaseRemain() < 1.25;

    // ---- thrust / gravity -------------------------------------------------
    const inp = ctx.input;
    let thrust;
    if (p.autopilot) {
      // deterministic attract AI: ride the next gate's gap center
      let target = 6.3 + Math.sin(this.t * 0.8) * 1.4;
      for (let i = 0; i < this.gates.length; i++) {
        const wz = scroll - this.gates[i].u;
        if (wz < -3 && wz > -60) { target = this.gates[i].gapC; break; }
      }
      this._aiThrust = this.fy < target - 0.12;
      thrust = this._aiThrust;
    } else {
      thrust = inp.held('up') || inp.held('drift');
    }
    if (this.graceT > 0) {
      this.graceT -= dt;
      if (!thrust) {
        // entry grace: kinematic float to mid-corridor (spring vs g24 would sag)
        this.vy = (4.9 - this.fy) * 3.2;
      }
    }
    const power = this.fuel > 0 ? 1 : 0.22;
    this.vy += ((thrust ? THRUST * power : 0) - GRAV) * dt;
    if (this.vy < VY_MIN) this.vy = VY_MIN;
    if (this.vy > VY_MAX) this.vy = VY_MAX;
    this.fy += this.vy * dt;

    // floor / ceiling scrape — slow + shake, never death (fairness §12)
    if (this.fy < FLOOR) {
      this.fy = FLOOR;
      if (this.vy < -4) { ctx.camera.shake(0.3); this._scrapeFX(p); }
      this.vy = 0;
      this.slowT = 0.55;
    } else if (this.fy > CEIL - 0.5) {
      this.fy = CEIL - 0.5;
      if (this.vy > 3) { ctx.camera.shake(0.22); this._scrapeFX(p); }
      this.vy = Math.min(this.vy, 0);
      this.slowT = 0.45;
    }

    p.vy = this.vy;
    p.y = this.fy;
    p.grounded = false;
    p.slideT = 0;
    p.group.position.set(p.x, this.fy, 0);
    p.group.rotation.z = Math.max(-0.3, Math.min(0.3, (LANE_X[p.laneI] - p.x) * -0.2 - this.vy * 0.014));

    // ---- fuel -------------------------------------------------------------
    this.fuel = Math.max(0, this.fuel - FUEL_DRAIN * dt);
    if (this.fuel < 0.25 && !this._lowWarned) {
      this._lowWarned = true;
      bus.emit('ui:toast', { msg: 'FUEL LOW — GRAB CELLS', kind: 'system' });
    }
    if (this.fuel > 0.4) this._lowWarned = false;

    // ---- spawning ----------------------------------------------------------
    const rng = ctx.rng;
    while (this.nextGateU < scroll + SPAWN_AHEAD) {
      const arrival = (this.nextGateU - scroll) / Math.max(v, 0.001);
      if (arrival >= 1.5) { // exit fairness: nothing arrives in the last 1.5 s
        const gapH = 2.75 + rng() * 0.9;
        // both bars always visible: keep ≥ 0.5 m of bar against floor/ceiling
        let gapC = FLOOR + 0.5 + gapH / 2 + rng() * Math.max(0.01, (CEIL - FLOOR) - 1.0 - gapH);
        gapC = Math.min(CEIL - 0.5 - gapH / 2, Math.max(FLOOR + 0.5 + gapH / 2, gapC));
        this.gates.push({ u: this.nextGateU, gapC, gapH, nm: false });
        // fuel cells + lasers fill the interval before this gate
        const span = 30 + rng() * 14;
        if (this.nextGateU - span > scroll + 20 && rng() < 0.85 && this.fuels.length < MAX_FUELS - 1) {
          this.fuels.push({ u: this.nextGateU - span * 0.55, x: LANE_X[(rng() * 3) | 0], y: 4.2 + rng() * 4.2 });
        }
        if (rng() < 0.62 && this.nextGateU - 16 > scroll + 24 && this.lasers.length < MAX_LASERS - 1) {
          this.lasers.push({ u: this.nextGateU - span * 0.5, x: LANE_X[(rng() * 3) | 0] });
        }
      }
      this.nextGateU += Math.max(GATE_MIN_GAP_S * v, 30 + rng() * 16); // ≥ 1.18 s spacing at current speed
    }

    // ---- gates: recycle + collision ----------------------------------------
    const ph = p.height;
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gate = this.gates[i];
      const wz = scroll - gate.u;
      if (wz > 10) { this.gates.splice(i, 1); continue; }
      if (!p.dead && !calmExit && wz > -0.55 && wz < 0.55) {
        const gB = gate.gapC - gate.gapH / 2;
        const gT = gate.gapC + gate.gapH / 2;
        const pB = this.fy + 0.22, pT = this.fy + ph * 0.8;
        if (pB < gB + 0.12 || pT > gT - 0.12) {
          p.kill('flight-gate');
        } else {
          // threaded it — reward tight threads as near-misses
          const margin = Math.min(pB - (gB + 0.12), (gT - 0.12) - pT);
          if (margin < 0.3 && !gate.nm) {
            gate.nm = true;
            bus.emit('near-miss', { type: 'flight-gate' });
            bus.emit('style:near-miss');
            sound('near-miss');
          }
        }
      }
    }

    // ---- lasers -------------------------------------------------------------
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      const wz = scroll - l.u;
      if (wz > 10) { this.lasers.splice(i, 1); continue; }
      if (!p.dead && !calmExit && wz > -0.5 && wz < 0.5 &&
          Math.abs(p.x - l.x) < 0.42) {
        p.kill('flight-laser');
      }
    }

    // ---- fuel cells -----------------------------------------------------------
    for (let i = this.fuels.length - 1; i >= 0; i--) {
      const f = this.fuels[i];
      const wz = scroll - f.u;
      if (wz > 10) { this.fuels.splice(i, 1); continue; }
      if (wz > -1.0 && wz < 1.0 &&
          Math.abs(p.x - f.x) < 1.0 && Math.abs(this.fy + 0.7 - f.y) < 1.15) {
        this.fuels.splice(i, 1);
        this.fuel = Math.min(1, this.fuel + FUEL_REFILL);
        _p.set(f.x, f.y, wz);
        const pl = { x: f.x, y: f.y, z: wz, value: 1 };
        bus.emit('coin', pl);
        sound('coin');
        FX.ring(_p, { to: 1.6, dur: 0.35, color: FLAME_A, alpha: 0.9 });
      }
    }

    // ---- rings (leapfrog recycle) ---------------------------------------------
    while (this.rings.length < MAX_RINGS) {
      const last = this.rings.length ? this.rings[this.rings.length - 1].u : scroll - 6;
      this.rings.push({ u: Math.max(this.ringU, last + 15) });
      this.ringU = this.rings[this.rings.length - 1].u + 15;
    }
    for (let i = 0; i < this.rings.length; i++) {
      if (scroll - this.rings[i].u > 12) {
        this.rings[i].u = this.rings[this.rings.length - 1].u + 15;
      }
    }

    // ---- jet flame ---------------------------------------------------------
    if (thrust && this.fuel > 0 && !p.dead) {
      this._flameAcc += dt;
      while (this._flameAcc > 0.028) {
        this._flameAcc -= 0.028;
        FX.spark(p.x + (Math.random() - 0.5) * 0.34, this.fy + 0.28, 0.42,
          (Math.random() - 0.5) * 1.2, -2 - Math.random() * 2, 5 + Math.random() * 4,
          0.3 + Math.random() * 0.2, 0.34 + Math.random() * 0.3,
          Math.random() < 0.75 ? FLAME_A : FLAME_B, 2, 2.4);
      }
    }

    // ---- instance matrices ---------------------------------------------------
    let nb = 0, np = 0, ne = 0, nfr = 0, nlp = 0;
    for (let i = 0; i < this.gates.length && nb < MAX_GATES * 2; i++) {
      const gate = this.gates[i];
      const wz = scroll - gate.u;
      // r4b near-camera fade for the EMISSIVE gate parts (edges/lips/posts):
      // once a gate passes the runner it slides into the lens (camera z 8.8);
      // its lit strips used to wash the lower frame even at 3-25% tint while
      // <3 m out. Fade fully over wz 2→5.5. The dark hazard panels stay
      // (matte, no blowout — they read as passing structure).
      // r10 (design law): the fade bottoms out at 0.22 — a DIM LIT strip of
      // the same hue — never the old multiply-to-black (an unlit state).
      let gf = 1 - (wz - 2.0) / 3.5;
      if (gf < 0) gf = 0; else if (gf > 1) gf = 1;
      gf = gf * gf * (3 - 2 * gf);
      gf = 0.22 + 0.78 * gf;
      const gB = gate.gapC - gate.gapH / 2;
      const gT = gate.gapC + gate.gapH / 2;
      // cyan gap edge strips (safe opening reads hot against the red bars)
      _q.identity(); _s.set(1, 1, 1);
      _p.set(0, gB + 0.08, wz); _m.compose(_p, _q, _s);
      if (ne < MAX_GATES * 2) { this.edgeIM.setMatrixAt(ne, _m); _c.setRGB(gf, gf, gf); this.edgeIM.setColorAt(ne, _c); ne++; }
      _p.set(0, gT - 0.08, wz); _m.compose(_p, _q, _s);
      if (ne < MAX_GATES * 2) { this.edgeIM.setMatrixAt(ne, _m); this.edgeIM.setColorAt(ne, _c); ne++; }
      if (gB - FLOOR > 0.35) {
        _q.identity(); _s.set(BAR_W, gB - FLOOR, 0.55);
        _p.set(0, (FLOOR + gB) / 2, wz);
        _m.compose(_p, _q, _s);
        this.barIM.setMatrixAt(nb++, _m);
        // steel cap lip where the bar meets the safe gap
        _q.identity(); _s.set(BAR_W + 0.6, 0.34, 0.82);
        _p.set(0, gB - 0.2, wz);
        _m.compose(_p, _q, _s);
        if (nfr < MAX_GATES * 2) this.frameIM.setMatrixAt(nfr++, _m);
        // blooming hazard lip on the gap-facing edge of the cap
        _q.identity(); _s.set(1, 1, 1);
        _p.set(0, gB - 0.02, wz);
        _m.compose(_p, _q, _s);
        if (nlp < MAX_GATES * 2) { this.lipIM.setMatrixAt(nlp, _m); _c.setRGB(gf, gf, gf); this.lipIM.setColorAt(nlp, _c); nlp++; }
      }
      if (CEIL - gT > 0.35) {
        _q.identity(); _s.set(BAR_W, CEIL - gT, 0.55);
        _p.set(0, (gT + CEIL) / 2, wz);
        _m.compose(_p, _q, _s);
        this.barIM.setMatrixAt(nb++, _m);
        _q.identity(); _s.set(BAR_W + 0.6, 0.34, 0.82);
        _p.set(0, gT + 0.2, wz);
        _m.compose(_p, _q, _s);
        if (nfr < MAX_GATES * 2) this.frameIM.setMatrixAt(nfr++, _m);
        _q.identity(); _s.set(1, 1, 1);
        _p.set(0, gT + 0.06, wz);
        _m.compose(_p, _q, _s);
        if (nlp < MAX_GATES * 2) { this.lipIM.setMatrixAt(nlp, _m); this.lipIM.setColorAt(nlp, _c); nlp++; }
      }
      for (let side = -1; side <= 1 && np < MAX_GATES * 2; side += 2) {
        _q.identity(); _s.set(1, CEIL - FLOOR, 1);
        _p.set(side * (BAR_W / 2 + 0.1), (FLOOR + CEIL) / 2, wz);
        _m.compose(_p, _q, _s);
        this.postIM.setMatrixAt(np, _m);
        // hot strip on the corridor-facing face carries the near-camera fade
        _p.set(side * (BAR_W / 2 - 0.17), (FLOOR + CEIL) / 2, wz);
        _m.compose(_p, _q, _s);
        this.postStripIM.setMatrixAt(np, _m);
        _c.setRGB(gf, gf, gf);
        this.postStripIM.setColorAt(np, _c);
        np++;
      }
    }
    this.barIM.count = nb;
    this.frameIM.count = nfr;
    this.lipIM.count = nlp;
    this.postIM.count = np;
    this.postStripIM.count = np;
    this.edgeIM.count = ne;
    this.barIM.instanceMatrix.needsUpdate = true;
    this.frameIM.instanceMatrix.needsUpdate = true;
    this.lipIM.instanceMatrix.needsUpdate = true;
    this.postIM.instanceMatrix.needsUpdate = true;
    this.postStripIM.instanceMatrix.needsUpdate = true;
    this.edgeIM.instanceMatrix.needsUpdate = true;
    if (this.edgeIM.instanceColor) this.edgeIM.instanceColor.needsUpdate = true;
    if (this.lipIM.instanceColor) this.lipIM.instanceColor.needsUpdate = true;
    if (this.postStripIM.instanceColor) this.postStripIM.instanceColor.needsUpdate = true;

    // lasers: solid red-hot core + tight glow. The near fade DIMS the core
    // toward deep ember red (bright emissive → dimmer emissive of the same
    // hue, per the design law — the old near-black floor read as a broken
    // placeholder pillar at t≈10) and dissolves the glow — never a wash.
    let nl = 0;
    for (let i = 0; i < this.lasers.length && nl < MAX_LASERS; i++) {
      const l = this.lasers[i];
      const wz = scroll - l.u;
      _q.identity(); _s.set(1, CEIL - FLOOR, 1);
      _p.set(l.x, (FLOOR + CEIL) / 2, wz);
      _m.compose(_p, _q, _s);
      this.laserCoreIM.setMatrixAt(nl, _m);
      this.laserGlowIM.setMatrixAt(nl, _m);
      let fade = 1 - Math.min(1, Math.max(0, (wz - 0.3) / 2.9));
      fade = fade * fade * (3 - 2 * fade);
      // hue-dominant hot red core (opaque hazard); ember-red floor keeps it
      // LIT. r10b: G/B pinned at ~0.1 — through ACES+sRGB anything higher
      // tone-maps the rod to pastel pink instead of hazard red.
      _c.setRGB(0.50 + 1.80 * fade, 0.04 + 0.06 * fade, 0.05 + 0.05 * fade);
      this.laserCoreIM.setColorAt(nl, _c);
      _c.setRGB(0.55 * fade, 0.045 * fade, 0.09 * fade);
      this.laserGlowIM.setColorAt(nl, _c);
      nl++;
    }
    this.laserCoreIM.count = nl;
    this.laserGlowIM.count = nl;
    this.laserCoreIM.instanceMatrix.needsUpdate = true;
    this.laserGlowIM.instanceMatrix.needsUpdate = true;
    if (this.laserCoreIM.instanceColor) this.laserCoreIM.instanceColor.needsUpdate = true;
    if (this.laserGlowIM.instanceColor) this.laserGlowIM.instanceColor.needsUpdate = true;

    let nf = 0;
    let nfh = 0;
    for (let i = 0; i < this.fuels.length && nf < MAX_FUELS; i++) {
      const f = this.fuels[i];
      _e.set(0, this.t * 3.2 + i, 0.12 * Math.sin(this.t * 3 + i));
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _p.set(f.x, f.y + Math.sin(this.t * 2 + i * 1.7) * 0.22, scroll - f.u);
      _m.compose(_p, _q, _s);
      this.fuelIM.setMatrixAt(nf++, _m);
      // r10: additive gold halo quad rides every cell (billboard upright) —
      // the token reads LIT among the corridor's cyan at every distance
      _q.identity();
      _s.set(2.1, 2.1, 1);
      _p.set(f.x, f.y + Math.sin(this.t * 2 + i * 1.7) * 0.22, scroll - f.u + 0.01);
      _m.compose(_p, _q, _s);
      this.fuelHaloIM.setMatrixAt(nfh++, _m);
    }
    this.fuelIM.count = nf;
    this.fuelIM.instanceMatrix.needsUpdate = true;
    this.fuelHaloIM.count = nfh;
    this.fuelHaloIM.instanceMatrix.needsUpdate = true;

    // ceiling ribs + wall light columns stream toward the camera (shared with
    // the photo-API first-frame layout)
    this._layoutAmbient(scroll);

    // vanishing point: pinned at the corridor's far end so depth reads toward
    // a bright horizon (breathing pulse keeps it alive). r4: the end glow is
    // this scene's "sun" — allowed to be the brightest region, but dialed back
    // from wash to beacon so the mid-corridor stays readable.
    const endZ = scroll - 149;
    this.endGlow.position.set(0, 6.4, endZ);
    this.endCore.position.set(0, 6.2, endZ + 0.4);
    this.endGlow.material.opacity = 0.55 + Math.sin(this.t * 1.3) * 0.08;
    this.endCore.material.opacity = 0.68 + Math.sin(this.t * 1.9) * 0.06;

    let nr2 = 0;
    for (let i = 0; i < this.rings.length && nr2 < MAX_RINGS; i++) {
      const zw = scroll - this.rings[i].u;
      // r4b near-camera fade kept (a ring drifting into the lens must never
      // wash the frame — the r3 critic's 40% white ring). r6: instances below
      // 2% tint are SKIPPED entirely — the old opaque torus faded to a huge
      // black occluding ellipse as it passed the camera. r8: the fade lerps
      // the tint toward DEEP TEAL while dimming — hue-shift, not flatten.
      let fade = 1 - (zw - 1.2) / 3.3;
      if (fade < 0) fade = 0; else if (fade > 1) fade = 1;
      fade = fade * fade * (3 - 2 * fade);
      if (fade < 0.02) continue;
      _e.set(0, 0, this.t * 0.35 + i * 0.8);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _p.set(0, (FLOOR + CEIL) / 2, zw);
      _m.compose(_p, _q, _s);
      this.ringIM.setMatrixAt(nr2, _m);
      this.ringHaloIM.setMatrixAt(nr2, _m);
      _c.setRGB(0.10 + 0.90 * fade, 0.42 + 0.58 * fade, 0.50 + 0.50 * fade);
      this.ringIM.setColorAt(nr2, _c);
      this.ringHaloIM.setColorAt(nr2, _c);
      nr2++;
    }
    this.ringIM.count = nr2;
    this.ringHaloIM.count = nr2;
    this.ringIM.instanceMatrix.needsUpdate = true;
    this.ringHaloIM.instanceMatrix.needsUpdate = true;
    if (this.ringIM.instanceColor) this.ringIM.instanceColor.needsUpdate = true;
    if (this.ringHaloIM.instanceColor) this.ringHaloIM.instanceColor.needsUpdate = true;

    // ---- gauge + pose ---------------------------------------------------------
    const fuel = this.fuel;
    this.gaugeFill.scale.y = Math.max(0.02, fuel);
    // flowing-charge shimmer (the fill reads as live energy, not a dead block)
    this.gaugeFillTex.offset.y -= dt * 0.55;
    // HDR tints over the gold energy texture — LDR hex here would drop the
    // fill back under the bloom line
    if (fuel < 0.25) {
      if (Math.sin(this.t * 10) > 0) this.gaugeFill.material.color.setRGB(2.2, 0.32, 0.45);
      else this.gaugeFill.material.color.setRGB(0.55, 0.09, 0.13);
    } else {
      this.gaugeFill.material.color.setRGB(1.65, 1.30, 0.72);
    }
    if (this._avatarKit) this._avatarKit.visible = !p.dead;
    this._anim.play(thrust && fuel > 0 ? 'flap' : 'fly', dt, Math.min(1.6, v / 14));
  }

  // ceiling ribs + wall light columns: one shared layout writer so the photo
  // API's first frame (enter without warp — update() may never run) renders a
  // finished corridor instead of identity-at-origin instances.
  _layoutAmbient(scroll) {
    const ribBase = 10 - (scroll % 11);
    for (let i = 0; i < RIB_N; i++) {
      _q.identity(); _s.set(1, 1, 1);
      _p.set(0, CEIL + 0.02, ribBase - i * 11);
      _m.compose(_p, _q, _s);
      this.ribIM.setMatrixAt(i, _m);
    }
    this.ribIM.instanceMatrix.needsUpdate = true;
    const wsBase = 8 - (scroll % 9);
    for (let i = 0; i < 16; i++) {
      const side = i & 1 ? 5.86 : -5.86;
      _q.identity();
      _s.set(1, i % 4 === 0 ? 1.5 : 1, 1);
      _p.set(side, 4.4, wsBase - i * 4.5);
      _m.compose(_p, _q, _s);
      this.wstripIM.setMatrixAt(i, _m);
    }
    this.wstripIM.instanceMatrix.needsUpdate = true;
  }

  _scrapeFX(p) {
    for (let i = 0; i < 8; i++) {
      FX.spark(p.x + (Math.random() - 0.5) * 0.8, this.fy + (Math.random() < 0.5 ? 0 : 1),
        0.4, (Math.random() - 0.5) * 4, Math.random() * 3, Math.random() * 3,
        0.25 + Math.random() * 0.25, 0.3 + Math.random() * 0.3, FLAME_A, 6, 2);
    }
  }
}
