// World dressing (W1-VIS): buildings, light gates, billboards, curbs, posts,
// distant ridges. Design rules:
//  - Per chunk ALL static dressing merges into ONE BufferGeometry with a tiny
//    custom shader (window grids computed from local coords → never crawl or
//    stretch, fade to clean silhouettes with distance). One draw call per chunk.
//  - Recycle-time work is swap-only: pre-built geometry variants + pooled gates
//    and billboards. Zero allocation in populate/decorate.
//  - Fog is matched by hand: exp2 #0b0518 @ 0.0075, identical to floor/sky.
import * as THREE from 'three';
import { COL } from '../core/Palette.js';
import { RNG } from '../core/RNG.js';
import { Pool } from '../core/Pool.js';
import { billboardTexture, POSTER_COUNT, coinTokenGeometry, coinTokenMaterial } from '../fx/Textures.js';

const CHUNK_LEN = 60;
const FOG_D = 0.0075;
const now = () => performance.now() / 1000;

// ---------------------------------------------------------------------------
// box writer (shared face table, CCW winding viewed from outside)
// ---------------------------------------------------------------------------
const FACES = [
  { n: [1, 0, 0], hn: 0, u: [0, 0, -1], v: [0, 1, 0] },  // hn filled per-box (hw/hh/hd)
  { n: [-1, 0, 0], hn: 0, u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], hn: 1, u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], hn: 1, u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], hn: 2, u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], hn: 2, u: [-1, 0, 0], v: [0, 1, 0] },
];

function pushBox(o, cx, cy, cz, w, h, d, write) {
  const half = [w / 2, h / 2, d / 2];
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const hn = half[F.hn];
    const base = o.pos.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let ci = 0; ci < 4; ci++) {
      const su = corners[ci][0], sv = corners[ci][1];
      // p = c + n*hn + u*(su*hu) + v*(sv*hv); hu/hv = half extents along u/v
      const hu = Math.abs(F.u[0]) * half[0] + Math.abs(F.u[1]) * half[1] + Math.abs(F.u[2]) * half[2];
      const hv = Math.abs(F.v[0]) * half[0] + Math.abs(F.v[1]) * half[1] + Math.abs(F.v[2]) * half[2];
      o.pos.push(
        cx + F.n[0] * hn + F.u[0] * su * hu + F.v[0] * sv * hv,
        cy + F.n[1] * hn + F.u[1] * su * hu + F.v[1] * sv * hv,
        cz + F.n[2] * hn + F.u[2] * su * hu + F.v[2] * sv * hv,
      );
      o.nor.push(F.n[0], F.n[1], F.n[2]);
      if (o.col && write) o.col.push(write[0], write[1], write[2]);
    }
    o.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function toGeometry(o, extraAttrs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(o.nor), 3));
  if (o.col) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(o.col), 3));
  if (extraAttrs) for (const [name, arr, item] of extraAttrs) {
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(arr), item));
  }
  g.setIndex(o.idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// city material — merged boxes + in-shader windows / neon trim
// ---------------------------------------------------------------------------
function makeCityMaterial() {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: COL.deep.clone() },
      uCyan: { value: COL.cyan.clone() },
      uMagenta: { value: COL.magenta.clone() },
      uGold: { value: COL.gold.clone() },
      uRed: { value: COL.red.clone() },
    },
    vertexShader: /* glsl */`
      attribute vec3 aDims;
      attribute vec3 aOrigin;
      attribute float aSeed;
      attribute float aKind;
      varying vec3 vLocal;
      varying vec3 vOrigin;
      varying vec3 vNrm;
      varying vec3 vDims;
      varying float vSeed;
      varying float vKind;
      varying float vDist;
      void main() {
        vLocal = position;
        vOrigin = aOrigin;
        vNrm = normal;
        vDims = aDims;
        vSeed = aSeed;
        vKind = aKind;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uCyan;
      uniform vec3 uMagenta;
      uniform vec3 uGold;
      uniform vec3 uRed;
      varying vec3 vLocal;
      varying vec3 vOrigin;
      varying vec3 vNrm;
      varying vec3 vDims;
      varying float vSeed;
      varying float vKind;
      varying float vDist;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      vec3 pickNeon(float s) {
        float hs = fract(s * 0.731);
        return hs < 0.38 ? uCyan : hs < 0.70 ? uMagenta : hs < 0.88 ? uGold : uRed;
      }

      void main() {
        vec3 base;
        if (vKind > 1.5) {
          // posts, curbs, antennas: near-black structural
          base = vec3(0.014, 0.010, 0.034);
        } else if (vKind > 0.5) {
          // neon accent boxes (rooftop strips, antenna tips, lamp heads)
          float pulse = 0.86 + 0.14 * sin(uTime * 2.1 + vSeed);
          base = pickNeon(vSeed) * 1.5 * pulse;
        } else {
          // box-local coordinates: y from the box base, horizontal centered —
          // window grids must be anchored per building, never to chunk space.
          // r4: facade base lifted a touch so upper masses never read as a
          // pure near-black slab at speed (windows carry the rest).
          float ly = vLocal.y - vOrigin.y;
          float fy = clamp(ly / max(vDims.y, 1.0), 0.0, 1.0);
          base = mix(vec3(0.020, 0.013, 0.048), vec3(0.062, 0.040, 0.128), fy);
          base *= 0.82 + 0.45 * fract(vSeed * 0.371);   // per-building tint variance

          // r4b grazing-safe floor structure: the window grid + neon trim die
          // on near-tangent faces (their pixel footprint explodes and the
          // crisp mask kills them — correctly, or they'd alias into a color
          // wash). But that left the menu camera's flanking towers as large
          // EMPTY dark slabs. Floor bands depend only on ly, so they survive
          // any angle: per-floor luminance alternation + a faint slab-line
          // glow give tangent facades readable structure at zero aliasing cost.
          float fb = fract(ly / 2.7);
          float fBand = 0.5 + 0.5 * sin(floor(ly / 2.7) * 2.4 + vSeed * 6.1);
          base *= 1.0 + (fBand - 0.5) * 0.34;
          float fSep = 1.0 - smoothstep(0.05, 0.13, min(fb, 1.0 - fb));
          base += vec3(0.012, 0.014, 0.026) * fSep;
          bool sideFace = abs(vNrm.x) > 0.5;
          vec2 fc = sideFace ? vec2(vLocal.z - vOrigin.z, ly) : vec2(vLocal.x - vOrigin.x, ly);
          float he = sideFace ? vDims.z * 0.5 : vDims.x * 0.5;
          float aa = max(fwidth(fc.x) + fwidth(fc.y), 1e-4);
          // kill detail before it aliases into a flat color wash (grazing angles)
          float crisp = smoothstep(0.55, 0.18, aa);

          // neon trim outline (vertical edges + roofline) on ~35% of buildings
          float edgeM = min(he - abs(fc.x), vDims.y - ly);
          float trimSel = step(fract(vSeed * 0.617), 0.35);
          float trim = (1.0 - smoothstep(0.13 - aa, 0.13 + aa, edgeM)) * trimSel * crisp;
          float detailVis = 1.0 - smoothstep(120.0, 300.0, vDist);
          base += pickNeon(vSeed + 0.113) * trim * 0.85 * detailVis;

          // window grid in meters (rows from the box base, columns from center)
          vec2 cell = vec2(1.55, 2.7);
          vec2 wuv = vec2(fc.x / cell.x, ly / cell.y);
          vec2 gid = floor(wuv);
          vec2 gfr = fract(wuv);
          float wx = 1.0 - smoothstep(0.34 - aa, 0.34 + aa, min(gfr.x, 1.0 - gfr.x) * cell.x);
          float wy = 1.0 - smoothstep(0.44 - aa, 0.44 + aa, min(gfr.y, 1.0 - gfr.y) * cell.y);
          float win = wx * wy * crisp;
          float zone = smoothstep(1.6, 2.6, ly)                          // no ground-floor windows
                     * (1.0 - smoothstep(vDims.y - 0.9, vDims.y - 0.45, ly));
          float wn = hash12(mod(gid, 97.0) + vec2(mod(vSeed, 17.0) * 7.31, mod(vSeed, 23.0) * 3.17));
          float allLit = step(0.96, fract(vSeed * 0.523));
          // r4: lit-window density + VARIETY. The old 7-18% uniform scatter
          // left tall facades as near-black slabs with sparse speckle dots
          // (run30 + menu critics). Now: higher base density that climbs for
          // near facades, plus whole-floor "office" bands so lit windows form
          // readable clusters instead of dither noise.
          float nearBoost = 1.0 - smoothstep(40.0, 170.0, vDist);
          float floorBand = step(0.82, hash12(vec2(floor(mod(vSeed, 31.0)) + 3.1, gid.y)));
          float litP = 0.15 + nearBoost * 0.13 + allLit * 0.28 + floorBand * 0.34;
          float lit = step(1.0 - litP, wn);
          float flicker = 0.86 + 0.15 * sin(uTime * (0.4 + wn * 1.3) + wn * 44.0);
          vec3 winCol = wn < 0.74 ? vec3(1.0, 0.82, 0.55)
                      : wn < 0.90 ? vec3(0.62, 0.86, 1.0)
                      : wn < 0.965 ? uMagenta : uCyan;
          base += winCol * win * zone * lit * flicker * (0.7 + wn * 0.8) * 0.72 * detailVis;
          base += vec3(0.010, 0.014, 0.028) * win * zone * (1.0 - lit) * detailVis;

          // r2: storefront neon band at street level on track-facing faces —
          // the near ground floor used to be a featureless dark slab
          float trackFace = step(0.5, abs(vNrm.x));
          float storeSel = step(fract(vSeed * 0.913), 0.62);
          float store = (1.0 - smoothstep(0.16, 0.34, abs(ly - 1.25)))
                      * trackFace * storeSel * crisp
                      * (1.0 - smoothstep(26.0, 60.0, vDist));
          float seg = step(0.35, fract(fc.x / 3.1 + fract(vSeed * 0.377)));
          float sFlick = 0.86 + 0.14 * sin(uTime * 1.7 + vSeed);
          base += pickNeon(vSeed + 0.31) * store * seg * sFlick * 0.95;
        }

        float fade = exp(-pow(vDist * ${FOG_D}, 2.0));   // FogExp2 match
        vec3 col = mix(uDeep, base, fade);
        col += (hash12(gl_FragCoord.xy) - 0.5) * (1.2 / 255.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------
// per-chunk city geometry (deterministic variants)
// ---------------------------------------------------------------------------
function buildCityGeometry(rng) {
  const o = { pos: [], nor: [], idx: [] };
  const dims = [], origins = [], seeds = [], kinds = [];
  const box = (cx, cy, cz, w, h, d, seed, kind) => {
    pushBox(o, cx, cy, cz, w, h, d, null);
    for (let i = 0; i < 24; i++) {
      dims.push(w, h, d);
      origins.push(cx, cy, cz);
      seeds.push(seed);
      kinds.push(kind);
    }
  };

  for (const side of [-1, 1]) {
    let z = -2 - rng() * 4;
    while (z > -CHUNK_LEN + 4) {
      const w = 5 + rng() * 10;               // extent along z
      const d = 5 + rng() * 9;                // extent along x
      const inner = 14 + rng() * 9;           // inner face distance from track
      const x = side * (inner + d / 2);
      const cz = z - w / 2;
      // height gradient: low near the track, towers farther out (opens a valley)
      let h = 6 + Math.pow(rng(), 1.5) * 30 * (0.45 + inner / 26);
      if (rng() < 0.12) h += 15;              // occasional supertall
      const seed = rng() * 100;
      box(x, h / 2, cz, d, h, w, seed, 0);
      if (rng() < 0.62) {                      // setback tier
        const h2 = h * (0.28 + rng() * 0.32);
        const w2 = w * (0.45 + rng() * 0.35);
        const d2 = d * (0.5 + rng() * 0.3);
        box(x, h + h2 / 2, cz - (w / 2 - w2 / 2) * (rng() - 0.5) * 2, d2, h2, w2, seed + 3.1, 0);
        h += h2;
      }
      if (rng() < 0.4) {                       // rooftop block
        box(x + (rng() - 0.5) * d * 0.4, h + 0.9, cz + (rng() - 0.5) * w * 0.4,
          1.6 + rng() * 2.2, 1.8, 1.6 + rng() * 2.2, seed + 7.7, 0);
      }
      if (rng() < 0.30) {                      // antenna + tip light
        const ah = 4 + rng() * 9;
        box(x, h + ah / 2, cz, 0.28, ah, 0.28, seed, 2);
        box(x, h + ah + 0.35, cz, 0.5, 0.7, 0.5, seed + 2.2, 1);
      }
      if (rng() < 0.35) {                      // rooftop neon strip
        box(x, h + 0.16, cz, d * 0.7, 0.3, 0.3, seed + 5.5, 1);
      }
      z -= w + 1.5 + rng() * 7;
    }
  }

  // curbs hugging the lane rails (both sides, full chunk length)
  for (const side of [-1, 1]) box(side * 5.15, 0.19, -CHUNK_LEN / 2, 0.42, 0.38, CHUNK_LEN, 3.3, 2);

  // light posts + shaded lamp heads (housing wraps the glow panel so the lamp
  // reads as a fixture from behind, not a featureless floating slab)
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const pz = -7 - i * 15 - (rng() - 0.5) * 4;
      box(side * 5.95, 2.1, pz, 0.16, 4.2, 0.16, 1.7 + i, 2);      // post
      box(side * 5.58, 4.14, pz, 0.85, 0.12, 0.14, 1.7 + i, 2);    // arm
      box(side * 5.24, 4.18, pz, 0.74, 0.24, 0.42, 1.7 + i, 2);    // housing shell
      box(side * 5.24, 4.045, pz, 0.5, 0.09, 0.24, 0.05, 1);       // inset glow panel
      box(side * 5.24, 3.92, pz, 0.42, 0.05, 0.3, 0.05, 1);        // under-glow sliver
    }
  }

  return toGeometry(o, [['aDims', dims, 3], ['aOrigin', origins, 3], ['aSeed', seeds, 1], ['aKind', kinds, 1]]);
}

// ---------------------------------------------------------------------------
// light gates (pooled) — structure mesh + merged glow mesh
// ---------------------------------------------------------------------------
function buildGateStruct() {
  const o = { pos: [], nor: [], idx: [] };
  pushBox(o, -5.7, 3.6, 0, 0.55, 7.2, 0.55, null);
  pushBox(o, 5.7, 3.6, 0, 0.55, 7.2, 0.55, null);
  pushBox(o, 0, 7.45, 0, 12.4, 0.55, 0.8, null);
  return toGeometry(o);
}

function buildGateGlow(magenta) {
  const o = { pos: [], nor: [], col: [], idx: [] };
  const main = magenta ? [1.0, 0.17, 0.84] : [0.0, 0.94, 1.0];
  const alt = magenta ? [0.0, 0.94, 1.0] : [1.0, 0.17, 0.84];
  pushBox(o, 0, 7.45, 0.43, 11.9, 0.18, 0.06, main);            // beam light bar
  pushBox(o, -3, 6.86, 0, 0.55, 0.14, 0.14, main);
  pushBox(o, 0, 6.86, 0, 0.55, 0.14, 0.14, alt);
  pushBox(o, 3, 6.86, 0, 0.55, 0.14, 0.14, main);
  pushBox(o, -5.7, 0.31, 0, 0.62, 0.62, 0.62, main);            // pillar base boots
  pushBox(o, 5.7, 0.31, 0, 0.62, 0.62, 0.62, main);             // (wrap + anchor the
                                                                // pillar feet — the old
                                                                // floating front plates
                                                                // read as stray cubes)
  return toGeometry(o);
}

const gateStructMat = new THREE.MeshStandardMaterial({
  color: 0x0d0a1e, metalness: 0.6, roughness: 0.4,
});
function makeGate(magenta) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(buildGateStruct(), gateStructMat);
  const glow = new THREE.Mesh(
    buildGateGlow(magenta),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }),
  );
  g.add(s, glow);
  return g;
}

// ---------------------------------------------------------------------------
// billboards (pooled) — structure mesh + poster panel with swappable art
// ---------------------------------------------------------------------------
const bbStructMat = new THREE.MeshStandardMaterial({
  color: 0x0c0918, metalness: 0.55, roughness: 0.45,
});
function makeBillboard() {
  const o = { pos: [], nor: [], idx: [] };
  pushBox(o, -2.7, 1.9, -0.12, 0.24, 3.8, 0.24, null);
  pushBox(o, 2.7, 1.9, -0.12, 0.24, 3.8, 0.24, null);
  pushBox(o, 0, 5.62, -0.14, 7.5, 4.25, 0.16, null);            // frame
  const g = new THREE.Group();
  g.add(new THREE.Mesh(toGeometry(o), bbStructMat));
  const panelMat = new THREE.MeshBasicMaterial({
    map: billboardTexture(0), toneMapped: false, fog: false,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 3.75), panelMat);
  panel.position.set(0, 5.62, 0.1);
  g.add(panel);
  g.userData.setArt = (i) => { panelMat.map = billboardTexture(i); };
  return g;
}

// ---------------------------------------------------------------------------
// distant ridges (static scene furniture — infinite parallax)
// ---------------------------------------------------------------------------
function buildRidge(zPos, baseH, varH, tintTop, tintLow, seed) {
  const o = { pos: [], col: [], idx: [] };
  const N = 160;                // wide span: the ridge must never show its end
  const SPAN = 1010;            // ±1010 keeps the far tip inside camera far (1200)
  const ss = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const ridgeY = (x) => {
    const s = seed;
    let y = baseH
      + varH * (0.55 * Math.sin(x * 0.0105 + s) + 0.30 * Math.sin(x * 0.023 + s * 2.7)
      + 0.15 * Math.sin(x * 0.051 + s * 5.1));
    // central gap for the sun — smoothstep ramp (a linear kink read as a notch)
    y *= 0.18 + 0.82 * ss((Math.abs(x) - 34) / 150);
    // sink the flanks to a low lip far out — eased, so no clipped mesh-end seam
    const ef = ss((Math.abs(x) - 520) / 460);
    y = y * (1 - ef) + 2.0 * ef;
    return Math.max(y, 2.2);
  };
  for (let i = 0; i <= N; i++) {
    const x = -SPAN + (i / N) * SPAN * 2;
    const y = ridgeY(x);
    o.pos.push(x, y, zPos);
    o.pos.push(x, -4, zPos);
    const k = Math.min(1, Math.max(0, y / (baseH + varH)));
    const top = tintTop, low = tintLow;
    o.col.push(
      low[0] + (top[0] - low[0]) * k, low[1] + (top[1] - low[1]) * k, low[2] + (top[2] - low[2]) * k,
      low[0], low[1], low[2],
    );
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    o.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(o.col), 3));
  g.setIndex(o.idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------
let registered = false;

export const Props = {
  // Call once after Game exists: Props.register(game.track, game.scene)
  register(track, scene) {
    if (registered) return;
    registered = true;

    // r8 (coin unification): run/run30 coins were the weakest asset on screen —
    // the octahedron gem minified to a flat pale-yellow card with stepped
    // edges. Swap the shared coin mesh to the faceted gold token family
    // (geometry + material; mesh only — spawn/collect logic untouched, this is
    // the same registration pattern phases use on the camera rig). The old
    // material's emissive pulse in Track.applyRender becomes a harmless no-op
    // on the retired object.
    if (track.coinMesh) {
      track.coinMesh.geometry = coinTokenGeometry(0.36);
      track.coinMesh.material = coinTokenMaterial();
    }

    // distant ridges — layered depth behind everything (occlude the sun's base).
    // The NEAR ridge is the taller, dominant silhouette; the far one only peeks
    // through its saddles (a shorter far ridge removes the sliver notches where
    // the two silhouettes cross at shallow angles).
    const deep = COL.deep.clone();
    const far = buildRidge(-560, 22, 26,
      [0.135, 0.055, 0.26], [deep.r * 1.15, deep.g * 1.15, deep.b * 1.3], 1.7);
    const near = buildRidge(-470, 26, 34,
      [0.075, 0.030, 0.15], [deep.r * 1.05, deep.g * 1.05, deep.b * 1.15], 4.2);
    scene.add(far, near);

    // per-chunk city meshes + variants
    const cityMat = makeCityMaterial();
    const variants = [];
    for (let v = 0; v < 5; v++) variants.push(buildCityGeometry(RNG(0x51EE + v * 977)));
    const cityByChunk = new Map();
    for (const chunk of track.chunks) {
      const mesh = new THREE.Mesh(variants[0], cityMat);
      mesh.matrixAutoUpdate = false;
      mesh.onBeforeRender = () => { cityMat.uniforms.uTime.value = now(); };
      cityByChunk.set(chunk.index, mesh);
    }

    // pooled gates + billboards
    const gatePool = new Pool(() => makeGate(false), null, 'props:gate');
    const gatePoolM = new Pool(() => makeGate(true), null, 'props:gateM');
    gatePool.prewarm(4);
    gatePoolM.prewarm(2);
    const bbPool = new Pool(makeBillboard, null, 'props:billboard');
    bbPool.prewarm(5);

    track.registerDresser((chunk, rng) => {
      const city = cityByChunk.get(chunk.index);
      city.geometry = variants[Math.min((rng() * variants.length) | 0, variants.length - 1)];
      chunk.attach(city);

      if (rng() < 0.28) {                        // light gate over the track
        const g = (rng() < 0.3 ? gatePoolM : gatePool).get();
        g.position.set(0, 0, -(6 + rng() * 46));
        chunk.attach(g);
      }
      if (rng() < 0.36) {                        // roadside billboard
        const b = bbPool.get();
        const side = rng() < 0.5 ? -1 : 1;
        b.position.set(side * (7.9 + rng() * 1.3), 0, -(5 + rng() * 46));
        b.rotation.y = -side * (Math.PI / 2 - 0.45);
        b.userData.setArt((rng() * POSTER_COUNT) | 0);
        chunk.attach(b);
      }
    });

    // Phase dressing delegate: Game only routes Track.decorate → dressers, so
    // the phases' own decorate(chunk, rng) (flight columns, drift arches, stack
    // monoliths) never ran — registration instead of editing Game (AGENTS.md §1).
    // Pooled props + userData.onRelease keep chunk reset/recycle clean.
    track.registerDresser((chunk, rng) => {
      const g = typeof window !== 'undefined' ? window.__NR && window.__NR.game : null;
      if (!g || g.state !== 'RUN') return;
      const ph = g.phase;
      // skip the startRun populate: this.phase is still the PREVIOUS phase's
      // instance there (Game swaps to 'run' after track.reset) — its dressing
      // would leak into the fresh run's first chunks.
      if (!ph || ph.id === 'run' || (g.track.scroll < 1 && ph.id !== 'run')) return;
      if (ph.id === 'run') return;
      try { ph.decorate(chunk, rng); } catch (e) { /* dressing never breaks boot */ }
    });
  },
};
