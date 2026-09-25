/**
 * @file core/assets.js — procedural PBR system + shared MaterialLibrary
 * (zero external assets, offline PWA). TextureFactory renders tileable
 * canvas sets (albedo / normal-Sobel / roughness / AO); noise wraps on both
 * axes (integer-frequency lattice) so repeats never seam. Generation scales
 * by quality tier: gen size 256 + no AO on low/medium, 512 + AO on high/
 * ultra (hero sets — road, wreck hulls — floor 512 via gen.minSize).
 * Extension point: GENERATORS + MATERIAL_DEFS are plain registries — later
 * slices add zombieSkin / vehiclePaint without touching the core.
 */
import * as THREE from "three";
import { CONFIG } from "./config.js";

// ---- tileable noise toolkit (stateless, integer-hashed) --------------------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const wrapN = (n, p) => ((n % p) + p) % p;

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** u,v in [0,1); lattice wraps per axis -> seamless tiling. */
function vnoiseT(u, v, fu, fv, seed) {
  const x = u * fu, y = v * fv;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = wrapN(ix, fu), x1 = wrapN(ix + 1, fu);
  const y0 = wrapN(iy, fv), y1 = wrapN(iy + 1, fv);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbmT(u, v, seed, oct, fu, fv = fu) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += vnoiseT(u, v, fu << o, fv << o, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Sobel height -> tangent-space normal (OpenGL green-up, flipY canvas). */
function heightToNormalRGBA(h, size, strength) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yUp = (y === 0 ? size - 1 : y - 1) * size;
    const yDn = (y === size - 1 ? 0 : y + 1) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xL = x === 0 ? size - 1 : x - 1, xR = x === size - 1 ? 0 : x + 1;
      const dx = (h[yc + xL] - h[yc + xR]) * strength;
      const dy = (h[yDn + x] - h[yUp + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      out[i] = (dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function grayToRGBA(field, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    const v = clamp01(field[i]) * 255, j = i * 4;
    out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255;
  }
  return out;
}

/** Clumped aggregate stamps (grit, pebbles); soft edges stay mip-safe.
 *  o.gate(u01) optionally rejects cluster centres by lane position so road
 *  wear marks cluster onto wheel tracks / shoulders instead of uniform.
 *  o.mult = [lo, hi] switches to a MULTIPLICATIVE blend: the target color is
 *  the local base pixel × lerp(lo, hi, sh) × a shaded dome term —
 *  the dot albedo stays a bounded delta over whatever the base is, so the
 *  dots can never pop brighter than base×hi (holds at night too, where
 *  absolute-color speckle reads as litter under moonlight). o.fall widens
 *  the soft edge falloff (fraction of the radius that fades out; default
 *  0.3); o.shade scales the directional dome shading in mult mode. */
function stampStones(height, rgb, size, seed, o) {
  const fall = o.fall || 0.3;
  for (let c = 0; c < o.clusters; c++) {
    const ccx = hash2(c, 1, seed) * size, ccy = hash2(c, 2, seed) * size;
    if (o.gate && hash2(c, 3, seed) > o.gate(ccx / size)) continue;
    for (let s = 0; s < o.perCluster; s++) {
      const ang = hash2(s, c, seed + 11) * Math.PI * 2;
      const dist = Math.sqrt(hash2(s, c, seed + 23)) * o.spread;
      const cx = ccx + Math.cos(ang) * dist, cy = ccy + Math.sin(ang) * dist;
      const r = lerp(o.rMin, o.rMax, hash2(s, c, seed + 37));
      const sh = hash2(s, c, seed + 41);
      const cr = o.colMin ? lerp(o.colMin[0], o.colMax[0], sh) : 0;
      const cg = o.colMin ? lerp(o.colMin[1], o.colMax[1], sh) : 0;
      const cb = o.colMin ? lerp(o.colMin[2], o.colMax[2], sh) : 0;
      const m = o.mult ? lerp(o.mult[0], o.mult[1], sh) : 1;
      const rr = Math.ceil(r);
      for (let dy = -rr; dy <= rr; dy++) {
        const py = wrapN(Math.floor(cy) + dy, size);
        for (let dx = -rr; dx <= rr; dx++) {
          const px = wrapN(Math.floor(cx) + dx, size);
          const d = Math.sqrt(dx * dx + dy * dy) / r;
          if (d >= 1) continue;
          const t = smooth(clamp01((1 - d) / fall));
          const dome = Math.sqrt(1 - d * d);
          const i = (py * size + px) * 4;
          if (o.mult) {
            const shade = 1 + ((dx - dy) / (r * 2.4)) * 0.4 * o.shade - (1 - dome) * 0.3 * o.shade;
            rgb[i] += (rgb[i] * m * shade - rgb[i]) * t;
            rgb[i + 1] += (rgb[i + 1] * m * shade - rgb[i + 1]) * t;
            rgb[i + 2] += (rgb[i + 2] * m * shade - rgb[i + 2]) * t;
          } else {
            const light = clamp(1 + ((dx - dy) / (r * 2.4)) * 0.4 - (1 - dome) * 0.3, 0.6, 1.24);
            rgb[i] = rgb[i] * (1 - t) + clamp01((cr * light) / 255) * 255 * t;
            rgb[i + 1] = rgb[i + 1] * (1 - t) + clamp01((cg * light) / 255) * 255 * t;
            rgb[i + 2] = rgb[i + 2] * (1 - t) + clamp01((cb * light) / 255) * 255 * t;
          }
          const hv = dome * t + 0.12 * (1 - t);
          if (hv > height[py * size + px]) height[py * size + px] = hv;
        }
      }
    }
  }
}

/** Irregular dark oil-drip blotches: 3-5 soft lobes elongated along the
 *  road axis, low-alpha edges (mip-safe), pore-filling height damp. */
function stampOil(rgb, height, size, seed, o) {
  for (let d = 0; d < o.count; d++) {
    const cx = hash2(d, 1, seed) * size;
    if (hash2(d, 2, seed) > o.base + o.bias * o.wear(cx / size)) continue;
    const cy = hash2(d, 3, seed) * size;
    const lobes = 3 + Math.floor(hash2(d, 4, seed) * 3);
    const rBase = o.radius * (0.7 + hash2(d, 5, seed) * 0.6);
    for (let l = 0; l < lobes; l++) {
      const lx = cx + (hash2(l + 1, d, seed + 13) - 0.5) * rBase * 2.2;
      const ly = cy + (hash2(l + 1, d, seed + 17) - 0.5) * rBase * 3.0;
      const r = rBase * (0.5 + hash2(l + 1, d, seed + 19) * 0.7);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        const py = wrapN(Math.floor(ly) + dy, size);
        for (let dx = -ri; dx <= ri; dx++) {
          const px = wrapN(Math.floor(lx) + dx, size);
          const dist = Math.sqrt(dx * dx + dy * dy) / r;
          if (dist >= 1) continue;
          const k = 1 - (1 - dist) * (1 - dist) * o.strength;
          const i = (py * size + px) * 4;
          rgb[i] *= k; rgb[i + 1] *= k; rgb[i + 2] *= k;
          height[py * size + px] *= 1 - (1 - dist) * o.strength * 0.5;
        }
      }
    }
  }
}

/** Random-walk streak (tar snakes, cracks, dikes); wraps at tile edges. */
function stampWalk(size, seed, o, visit) {
  let x = o.x0, y = o.y0, ang = o.angle0;
  for (let s = 0; s < o.steps; s++) {
    ang += (hash2(s, seed, seed * 3 + 11) - 0.5) * o.wiggle;
    x += Math.cos(ang) * o.stepLen;
    y += Math.sin(ang) * o.stepLen;
    visit(wrapN(Math.floor(x), size), wrapN(Math.floor(y), size), s);
  }
}

// ---- generator scaffold -----------------------------------------------------
// spec(): compiles a compact descriptor {n, ao, aoF, fields(u,v,F),
// h(u,v,F), rgb(u,v,h,F,c), rough(u,v,h,F), stamps[]} into ONE fused
// generate(height, rgb, rough, size) pass. fields() fills the shared scratch
// once per pixel so h/rgb/rough reuse each noise field instead of
// re-evaluating it; rgb writes into the shared c triple — nothing allocates
// per pixel. Stamps run after the base albedo and may touch height.
const _F = new Float32Array(8);
const _C = new Float32Array(3);

function spec(o) {
  return {
    size: o.size || 512,
    minSize: o.minSize || 0, // hero sets floor their gen size on every tier
    normalStrength: o.n,
    withAo: !!o.ao,
    aoFromHeight: o.aoF,
    clampV: !!o.clampV, // non-tiled v (rock: v = height fraction, skirt at 0)
    generate(height, rgb, rough, size) {
      const F = _F, c = _C;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size, p = y * size + x, i = p * 4;
          if (o.fields) o.fields(u, v, F);
          const h = o.h(u, v, F);
          height[p] = h;
          o.rgb(u, v, h, F, c);
          rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2]; rgb[i + 3] = 255;
        }
      }
      for (const st of o.stamps || []) st(rgb, size, height);
      // Roughness reads the POST-stamp height (concrete joints etch it).
      if (o.rough) {
        for (let y = 0; y < size; y++) {
          const v = y / size;
          for (let x = 0; x < size; x++) {
            const p = y * size + x;
            rough[p] = o.rough(x / size, v, height[p], F);
          }
        }
      } else {
        rough.fill(0.9);
      }
    },
  };
}

const darken = (rgb, size, seed, steps, stepLen, wiggle, vertical, k) => {
  for (let c = 0; c < steps; c++) {
    stampWalk(size, seed + c, {
      x0: hash2(c, 2, seed) * size, y0: vertical ? 0 : hash2(c, 4, seed) * size,
      steps: vertical ? 160 : 80, stepLen,
      angle0: Math.PI / 2 + (vertical ? (hash2(c, 5, seed) - 0.5) * 0.3 : hash2(c, 6, seed) * Math.PI * 2),
      wiggle,
    }, (px, py) => {
      const i = (py * size + px) * 4;
      rgb[i] *= k; rgb[i + 1] *= k; rgb[i + 2] *= k;
    });
  }
};

// ---- material generators (desert-highway set) -------------------------------
const GENERATORS = {
  /** Highway asphalt: aggregate, polished wheel tracks, tar snakes, paint.
   * u spans the 12.6 m paved width; v repeats every 12 m along the road. */
  road: (() => {
    // Wheel-track polish (round-3 re-author): 6 bands (3 lanes x 2 tracks).
    // The old straight constant-x bands read as repeating specular smears
    // under the raking sun, so each band now MEANDERS along z (low-freq
    // noise on its centre x) and fades in/out over 2-4 intensity segments
    // per tile (smooth 1-D wrapped noise) — no continuous smear line
    // survives. Sheen is carried by the ROUGHNESS dip (polishRough); the
    // albedo lift stays near-invisible (CONFIG.ROAD_ART.polishLighten).
    // Band state depends only on v, so it is precomputed once per texture
    // row and the per-pixel loop stays cheap (512-gen budget).
    const LANES = [-3.4, 0, 3.4];
    const NB = 6;
    const W = CONFIG.ROAD_ART;
    const rowXC = new Float32Array(NB);
    const rowG = new Float32Array(NB);
    const polishRow = (vM) => {
      for (let b = 0; b < NB; b++) {
        const seed = 100 + b;
        rowXC[b] = LANES[b % 3] + (b < 3 ? -1 : 1) * 0.78
          + (fbmT(0.5, vM / 12, seed, 2, 3) - 0.5) * W.polishWobble;
        const nSeg = 2 + Math.floor(hash2(b, 3, seed) * 3); // 2-4 segments per tile
        rowG[b] = lerp(W.polishSegLo, 1, vnoiseT(0.5, vM / 12, 1, nSeg, seed + 7));
      }
    };
    // Broader wear weight for debris/oil placement: 1 on wheel tracks and
    // shoulders, fading to 0 between lanes (u spans the 12.6 m paved width).
    const wearAt = (u) => {
      const x = u * 12.6 - 6.3;
      let w = clamp01((Math.abs(x) - 4.9) / 1.1); // shoulders past edge lines
      for (const lc of [-3.4, 0, 3.4]) {
        for (const s of [-1, 1]) {
          const d = Math.abs(x - (lc + s * 0.78));
          w = Math.max(w, 1 - d / 1.1);
        }
      }
      return w;
    };
    // Lane-dash paint from CONFIG.ROAD_ART.dashPaint (sRGB fractions): kept
    // desaturated so bloom + tone-mapping can't clip its channels apart
    // (read as purple fringe at night).
    const dash = CONFIG.ROAD_ART.dashPaint.map((c) => Math.round(c * 255));
    return {
      size: 512,
      minSize: 512, // hero texture: full res on every tier
      normalStrength: 1.6,
      withAo: true,
      generate(height, rgb, rough, size) {
        // Polish computed once here; roughness reuses it (was re-evaluated).
        const polish = new Float32Array(size * size);
        for (let y = 0; y < size; y++) {
          const v = y / size, vM = v * 12;
          polishRow(vM);
          for (let x = 0; x < size; x++) {
            const u = x / size, p = y * size + x, i = p * 4;
            const xM = u * 12.6 - 6.3;
            let band = 0;
            for (let b = 0; b < NB; b++) {
              const d = Math.abs(xM - rowXC[b]);
              if (d < W.polishHalfW) band = Math.max(band, (1 - d / W.polishHalfW) * rowG[b]);
            }
            const pol = clamp01(band * (0.8 + fbmT(u, vM / 12, 59, 2, 6) * 0.35));
            polish[p] = pol;
            // Worn polish: the albedo lift is now a whisper; the roughness
            // map below does the specular work (sheen + wear read together).
            const val = (CONFIG.ROAD_ART.albedoBase + fbmT(u, v, 52, 2, 4) * 20 + fbmT(u, v, 53, 2, 40) * 9) * (1 + pol * CONFIG.ROAD_ART.polishLighten);
            rgb[i] = val; rgb[i + 1] = val * 0.99; rgb[i + 2] = val * 0.97;
            height[p] = 0.18 * (1 - pol * 0.32);
          }
        }
        for (let i = 3; i < rgb.length; i += 4) rgb[i] = 255;
        // Aggregate: wear-gated so grit piles on tracks/shoulders, mid-lane
        // stays cleaner (gate keeps ~2/3 of candidate clusters, weighted).
        // Round-4 anti-litter: stones ~40% smaller and ~half as dense, and
        // blended MULTIPLICATIVELY — each dot is a bounded ±5-7% delta over
        // the LOCAL base albedo (measured worst-case lift base×1.055), so
        // dots read as asphalt aggregate at dusk and scale away with the
        // base under moonlight instead of popping as bright litter.
        stampStones(height, rgb, size, 55, {
          clusters: 150, perCluster: 9, rMin: 0.66, rMax: 1.56, spread: 38,
          mult: [0.93, 1.05], shade: 0.06, fall: 0.5,
          gate: (u01) => W.wearBase + W.wearBias * wearAt(u01),
        });
        // Oil drips: soft lobed blotches under the leaking wrecks' lanes.
        stampOil(rgb, height, size, 54, {
          count: W.oilCount, radius: W.oilRadius, strength: W.oilStrength,
          base: W.wearBase, bias: W.wearBias, wear: wearAt,
        });
        const bump = (px, py, dv) => { height[py * size + px] = Math.min(1, height[py * size + px] + dv); };
        const uOf = (xM) => (xM + 6.3) / 12.6;
        // Solid edge lines: yellow left (-5.12), white right (+5.12).
        for (const [xM, col] of [[-5.12, [200, 170, 60]], [5.12, [212, 210, 198]]]) {
          const px0 = Math.round(uOf(xM) * size);
          for (let y = 0; y < size; y++) {
            if (fbmT(0, y / size, 57, 2, 24) <= 0.24) continue; // paint-loss gaps
            for (let dx = 0; dx < 5; dx++) {
              const px = wrapN(px0 + dx, size), i = (y * size + px) * 4;
              rgb[i] = col[0]; rgb[i + 1] = col[1]; rgb[i + 2] = col[2];
              bump(px, y, 0.12);
            }
          }
        }
        // Dashed lane lines at x=±1.7 (3 m dash / 3 m gap).
        for (const xM of [-1.7, 1.7]) {
          const px0 = Math.round(uOf(xM) * size);
          for (let y = 0; y < size; y++) {
            if (((y / size) * 12) % 6 > 3) continue;
            if (fbmT(0.5, y / size, 58, 2, 30) > 0.82) continue;
            for (let dx = 0; dx < 5; dx++) {
              const px = wrapN(px0 + dx, size), i = (y * size + px) * 4;
              rgb[i] = dash[0]; rgb[i + 1] = dash[1]; rgb[i + 2] = dash[2];
              bump(px, y, 0.1);
            }
          }
        }
        // Tar snakes: dark sealant meanders along the road axis. 3-5 texels
        // wide (7-12 cm at 512/12.6 m) so they hold up in the near field.
        for (let t = 0; t < 7; t++) {
          const w = 3 + Math.floor(hash2(t, 3, 91) * 3), dark = 0.42 + hash2(t, 5, 92) * 0.2;
          stampWalk(size, 90 + t, {
            x0: hash2(t, 7, 93) * size, y0: hash2(t, 9, 94) * size, steps: 120, stepLen: 3.2,
            angle0: Math.PI / 2 + (hash2(t, 11, 95) - 0.5) * 0.9, wiggle: 0.3,
          }, (px, py, s) => {
            const w2 = w + (hash2(s, t, 96) > 0.85 ? 2 : 0);
            for (let dy = 0; dy < w2; dy++) {
              for (let dx = 0; dx < 2; dx++) {
                const i = (wrapN(py + dy, size) * size + wrapN(px + dx, size)) * 4;
                rgb[i] *= 1 - dark; rgb[i + 1] *= 1 - dark; rgb[i + 2] *= 1 - dark;
              }
            }
          });
        }
        darken(rgb, size, 120, 3, 2.4, 0.8, false, 0.6); // hairline cracks
        // Road -> shoulder transition (round-4): the paved mesh ends in a
        // hard value line against the desert plane, so a narrow gravel band
        // at each road-edge UV boundary (u = 0 / 1) mixes the asphalt toward
        // the sand tone with a smooth inward falloff; a small noisy height
        // lift gives the lip a gritty normal read.
        const B = W.edgeBlendPx;
        if (B > 0) {
          const sr = W.edgeBlendTone[0], sg = W.edgeBlendTone[1], sb = W.edgeBlendTone[2];
          for (let x = 0; x < B; x++) {
            const t = smooth(1 - x / B) * W.edgeBlendStrength;
            for (const px of [x, size - 1 - x]) {
              for (let y = 0; y < size; y++) {
                const p = y * size + px, i = p * 4;
                rgb[i] += (sr - rgb[i]) * t;
                rgb[i + 1] += (sg - rgb[i + 1]) * t;
                rgb[i + 2] += (sb - rgb[i + 2]) * t;
                height[p] = Math.min(1, height[p] + t * 0.22 * (0.5 + hash2(px, y, 121)));
              }
            }
          }
        }
        // Roughness from the cached polish field: the polished tracks carry
        // the sheen (deep dip vs 0.88-0.98 bare asphalt elsewhere).
        for (let y = 0; y < size; y++) {
          const v = y / size;
          for (let x = 0; x < size; x++) {
            const u = x / size, p = y * size + x;
            rough[p] = lerp(0.88 + fbmT(u, v, 56, 2, 14) * 0.1, W.polishRough, polish[p]);
          }
        }
      },
    };
  })(),

  /** Desert sand: domain-warped wind ripples + grit + dark scrub-dirt crust
   *  patches. The ripple PHASE is shifted across the tile by a low-frequency
   *  wrapped fbm (whole-cycle warp, CONFIG.SAND_ART.rippleWarp) so no
   *  continuous sine line survives the grazing-angle compression that read
   *  as "fingerprint wallpaper"; ripple energy also dies on the dry crust.
   *  Wind-drift streaks come from a shear-wrapped field (u-2v keeps integer
   *  lattice wraps) at yet another angle, and three stampStones scales add
   *  clustered pebble/grit relief. Round-3 macro structure: a 2-octave
   *  low-frequency field (2-4 cycles per 13 m tile ≈ 3.3-6.5 m cells, the
   *  lowest tileable 2D octave) swings the albedo ±CONFIG.SAND_ART.macroStrength
   *  in broad patches, wobbled diagonal dune washes add large-scale shading,
   *  and the fine grit is GATED by that same macro field (dense in dark
   *  patches, sparse on bright rises) so the speckle is never uniform. */
  sand: spec({
    n: 2.4,
    ao: true,
    fields(u, v, F) {
      F[0] = fbmT(u, v, 61, 2, 3); // ripple domain-warp field (wraps -> tileable)
      F[1] = fbmT(u, v, 62, 2, 8); // dune body (dominant)
      F[2] = fbmT(u, v, 63, 1, 5); // dry crust patches (also gate the ripples)
      F[3] = fbmT(u, v, 64, 1, 48); // fine grit speckle
      F[4] = fbmT(u, v, 67, 1, 2); // medium albedo patchiness
      F[5] = fbmT(u - 2 * v, v, 68, 2, 5, 2); // wind-drift streaks (cross-road shear angle)
      F[6] = fbmT(u, v, 70, 2, 2); // macro value field (freq 2 = lowest NON-degenerate tileable 2D octave: fu=1 collapses to a 1-D corner gradient)
    },
    h(u, v, F) {
      const S = CONFIG.SAND_ART;
      const dry = clamp01(F[2] * 1.1 - 0.22);
      const mask = 1 - dry * 0.85; // ripples vanish on crusted dirt flats
      const w = (F[0] - 0.5) * S.rippleWarp; // phase warp in whole cycles
      const r1 = Math.sin((u * S.rippleFreq + w) * Math.PI * 2);
      const r2 = Math.sin((u * S.ripple2[0] - v * S.ripple2[1] + w * 0.7 + 0.9) * Math.PI * 2);
      return clamp01(0.3 + F[1] * 0.4 + (r1 * 0.5 + 0.5) * 0.15 * mask + (r2 * 0.5 + 0.5) * 0.08 * mask + (F[3] - 0.5) * 0.06);
    },
    rgb(u, v, h, F, c) {
      const S = CONFIG.SAND_ART;
      const dry = clamp01(F[2] * 1.1 - 0.22);
      // Contrast-stretched macro field drives BOTH the ±18% value structure
      // and the grit gate (dense speckle in dark patches, sparse on rises).
      const m = clamp01((F[6] - 0.5) * 2.2 + 0.5);
      const gTh = lerp(S.gritLo, S.gritHi, m);
      const grit = clamp01((F[3] - gTh) / (1 - gTh));
      const drift = clamp01((F[5] - S.driftBias) * 2.2) * S.driftStrength;
      const patch = lerp(0.88, 1.07, F[4]) * (1 - drift);
      // Dune-form washes: broad dark bands on the (u+v) diagonal, phase
      // wobbled by the ripple-warp field so no straight gradient edge lives.
      const washP = (u + v) * S.washBands + (F[0] - 0.5) * S.washWarp;
      const wash = smooth(clamp01((Math.sin(washP * Math.PI * 2) - 0.25) / 0.75));
      const k = patch * lerp(1 - S.macroStrength, 1 + S.macroStrength, m) * (1 - S.washStrength * wash);
      c[0] = (lerp(96, 148, h) * lerp(0.72, 1.05, dry) + grit * S.gritAmp) * k;
      c[1] = (lerp(80, 128, h) * lerp(0.74, 1.03, dry) + grit * S.gritAmp * 0.8) * k;
      c[2] = (lerp(58, 96, h) * lerp(0.78, 1.0, dry) + grit * S.gritAmp * 0.6) * k;
    },
    rough: (u, v, h) => 0.96 - h * 0.08, // wind-packed crests slightly smoother
    stamps: [
      // Three pebble/grit scales, clustered (never uniform): fine grit carpets,
      // mid scattered pebbles, sparse coarse stones — all dome the height map.
      (rgb, size, height) => stampStones(height, rgb, size, 65, { clusters: 30, perCluster: 9, rMin: 0.7, rMax: 1.4, spread: 30, colMin: [92, 78, 60], colMax: [138, 120, 96] }),
      (rgb, size, height) => stampStones(height, rgb, size, 66, { clusters: 16, perCluster: 7, rMin: 1.5, rMax: 2.7, spread: 46, colMin: [100, 85, 64], colMax: [150, 132, 104] }),
      (rgb, size, height) => stampStones(height, rgb, size, 69, { clusters: 8, perCluster: 4, rMin: 2.6, rMax: 4.2, spread: 60, colMin: [94, 80, 62], colMax: [146, 128, 100] }),
    ],
  }),

  /** Layered mesa rock: strata bands (CONFIG.MESA_ART.strataBands, spaced
   *  h/N apart = 0.6-1.8 m in world space across the MESAS height range) at
   *  ±12% luminance with noise-wobbled boundaries, mid-frequency albedo
   *  mottling (±10%), vertical fracture dikes, a fine scree/grain field so
   *  close faces carry surface (not flat fill), and a dark scree/talus skirt
   *  over the bottom ~15%. Base albedo is darkened + pulled ~10% toward
   *  grey — distant mesas must not start as saturated single-value fills
   *  before the per-instance haze tint. Lathe UVs map v ≈ height fraction
   *  (v = profile INDEX in three r172, but the profiles sample y near-
   *  linearly: ±7% band-spacing distortion, verified against mesa heights).
   *  Grain freq is anisotropic (u spans the full base circumference 2πw =
   *  163-490 m, v only spans h = 15-44 m) so grain cells stay ~1-3 m in
   *  world space on both axes; 1 octave keeps 4+ texels/cycle (Nyquist-safe
   *  in gen, and its ±4% amplitude mips away at distance — no shimmer).
   *  Tops are lifted so upper faces catch the dusk key (smooth-shaded: the
   *  material's flatShading is OFF — derivative flat normals alternate
   *  light/dark across the two triangles of every jittered lathe quad, which
   *  read as a checkerboard at close range; boulders keep baked flat
   *  normals from PolyhedronGeometry detail 0). Shared with boulders. */
  rock: spec({
    n: 3.6, // strata grooves + grain relief read as carved strata, not shading bands
    ao: true,
    clampV: true,
    fields(u, v, F) {
      F[0] = fbmT(u, v, 71, 2, 3); // strata wobble (shared by height + tone)
      F[1] = fbmT(u, v, 72, 2, 10); // fracture detail (also skews skirt edge)
      F[2] = fbmT(u, v, 73, 2, 7); // varnish variation
      F[3] = fbmT(u, v, 75, 2, 5); // mid-frequency mottle (max 10 cycles = 51 texels/cycle: far under Nyquist)
      F[4] = fbmT(u, v, 76, 1, 120, 14); // fine scree/grain (see anisotropy note above)
    },
    h(u, v, F) {
      const M = CONFIG.MESA_ART;
      const P = v * M.strataBands + F[0] * M.strataWobble;
      return clamp01(0.35 + (Math.sin(P * Math.PI * 2) * 0.5 + 0.5) * 0.3 + F[1] * 0.3
        + (F[4] - 0.5) * M.grainHeight);
    },
    rgb(u, v, h, F, c) {
      const M = CONFIG.MESA_ART;
      const P = v * M.strataBands + F[0] * M.strataWobble;
      // wrapN keeps P's wobble below 0 from indexing tone[-1] (NaN -> black).
      const tone = M.strataTones[wrapN(Math.floor(P), M.strataTones.length)];
      const k = tone * lerp(0.92, 1.06, F[2]) * lerp(0.9, 1.08, v) * lerp(0.9, 1.1, F[3])
        * (1 + (F[4] - 0.5) * M.grainAlbedo);
      // Talus skirt: noisy-edged darker debris band over the mesa base.
      const skirtT = smooth(clamp01((v + (F[1] - 0.5) * 0.1 - 0.05) / 0.11));
      const skirt = 1 - M.skirtDarken * (1 - skirtT);
      const r = lerp(112, 158, h) * k * skirt;
      const g = lerp(82, 118, h) * k * 0.99 * skirt;
      const b = lerp(62, 92, h) * k * 0.96 * skirt;
      const avg = (r + g + b) / 3; // ~10% desaturated, then ~10% darker
      c[0] = (r + (avg - r) * 0.1) * 0.9;
      c[1] = (g + (avg - g) * 0.1) * 0.9;
      c[2] = (b + (avg - b) * 0.1) * 0.9;
    },
    rough: (u, v, h) => 0.86 + (1 - h) * 0.1 + (v < 0.15 ? 0.06 : 0),
    stamps: [(rgb, size) => darken(rgb, size, 74, 4, 3.4, 0.12, true, 0.68)],
  }),

  /** Rusted steel: pitted orange blooms over dark metal, vertical bleed. */
  rust: spec({
    n: 3.0,
    ao: true,
    aoF: (v) => clamp01(0.42 + v * 0.62),
    fields(u, v, F) {
      F[0] = fbmT(u, v, 81, 3, 12); // pit field
      F[1] = fbmT(u, v * 0.2, 82, 2, 6); // vertical bleed streaks
    },
    h(u, v, F) {
      return clamp01(0.32 + F[0] * 0.6);
    },
    rgb(u, v, pit, F, c) {
      const metal = clamp01(0.62 - pit * 0.5);
      const streak = lerp(0.9, 1.1, F[1]);
      c[0] = lerp(lerp(66, 150, pit), 96, metal) * streak;
      c[1] = lerp(lerp(40, 78, pit), 100, metal);
      c[2] = lerp(lerp(28, 44, pit), 108, metal);
    },
    rough: (u, v, h) => 0.78 + (1 - h) * 0.16,
  }),

  /** Faded painted metal (trailers, guardrail): chalky paint, primer chips. */
  paintedMetal: spec({
    n: 2.0,
    ao: true,
    fields(u, v, F) {
      F[0] = fbmT(u, v, 85, 3, 9); // chip field
      F[1] = fbmT(u, v, 86, 2, 30); // fine weathering
      F[2] = fbmT(u, v, 87, 2, 4); // paint luminance
    },
    h(u, v, F) {
      const chip = F[0];
      return clamp01(chip > 0.6 ? 0.62 - (chip - 0.6) : 0.9 + (F[1] - 0.5) * 0.1);
    },
    rgb(u, v, h, F, c) {
      const l = lerp(0.82, 1.05, F[2]);
      if (h < 0.56) { c[0] = 96 * l; c[1] = 62 * l; c[2] = 38 * l; }
      else if (h < 0.68) { c[0] = 120 * l; c[1] = 118 * l; c[2] = 112 * l; }
      else { c[0] = 158 * l; c[1] = 158 * l; c[2] = 150 * l; }
    },
    rough: (u, v, h) => (h > 0.8 ? 0.5 : h < 0.56 ? 0.85 : 0.68),
  }),

  /** Weathered concrete: stains + one formwork joint per tile, sandblasted. */
  concrete: spec({
    n: 1.5,
    ao: true,
    fields(u, v, F) {
      F[0] = fbmT(u, v, 90, 3, 10);
      F[1] = fbmT(u, v, 91, 2, 48);
      F[2] = fbmT(u, v, 92, 2, 3);
      F[3] = fbmT(u, v, 93, 2, 40);
      F[4] = fbmT(u, v, 94, 2, 7);
    },
    h(u, v, F) {
      return 0.6 + F[0] * 0.22 + F[1] * 0.14;
    },
    rgb(u, v, h, F, c) {
      const val = (124 + F[3] * 20 - (1 - F[2]) * 22) * lerp(0.95, 1.05, F[4]);
      c[0] = val * 1.04; c[1] = val * 0.99; c[2] = val * 0.9;
    },
    rough: (u, v, h) => 0.88 + (1 - h) * 0.08,
    stamps: [
      (rgb, size, height) => {
        for (let x = 0; x < size; x++) {
          for (let o = 0; o < 3; o++) {
            const y = wrapN(8 + o, size), i = (y * size + x) * 4;
            const k = o === 2 ? 1.1 : 0.76;
            rgb[i] *= k; rgb[i + 1] *= k; rgb[i + 2] *= k;
            if (o < 2) height[y * size + x] *= 0.72;
          }
        }
      },
    ],
  }),

  /** Charred / burnt: carbonized black, ash blooms, heat crazing. Albedo is
   *  floored at 0.07 LINEAR (sRGB ~76 after every multiplier below, ash
   *  stamp included) — backlit scorch bands must never read as a pure black
   *  box under the dusk rig (round-3 lighting floor). */
  charred: spec({
    n: 3.2,
    ao: true,
    aoF: (v) => clamp01(0.4 + v * 0.6),
    fields(u, v, F) {
      F[0] = fbmT(u, v, 95, 3, 9); // burn field
      F[1] = fbmT(u, v, 96, 2, 22); // ash blooms
    },
    h(u, v, F) {
      return clamp01(0.3 + F[0] * 0.55);
    },
    rgb(u, v, h, F, c) {
      const base = lerp(84, 106, clamp01((h - 0.42) * 2.1)) * lerp(0.97, 1.1, F[1]);
      c[0] = base * 1.04; c[1] = base; c[2] = base * 0.96;
    },
    rough: (u, v, h) => 0.9 - h * 0.22,
    stamps: [(rgb, size) => darken(rgb, size, 97, 6, 3, 0.9, false, 0.93)],
  }),

  /** Wreck hull paint (CONFIG.WRECK_ART): chalky panels with an explicit
   *  ~2 m panel grid along u = hull length on box side faces (per-panel
   *  value step + crisp wobbled seam lines that pick up rust), sparse primer
   *  chips, albedo lifted off black with a LINEAR top-down dust gradient
   *  (box side faces: v=1 roof, v=0 rocker), a noisy lower dust band, two
   *  horizontal feature lines (window sill + skirt break) with a sparse
   *  rivet row on the sill, and near-vertical rain-drip weathering streaks —
   *  one shared set, tinted per vehicle via MATERIAL_DEFS
   *  (wreckWhite/wreckRed/wreckTeal) so hulls stay instanced. Floors at 512
   *  (gen.minSize): bus/trailer flanks are the hero surfaces of the QA
   *  beauty/close cameras and smear into mush at 256 (round-3 verdict).
   *  Round-6 "metal, not wood": drips are short/straight/sparse, seam cores
   *  tightened to 1-2 px, and the paint-luminance mottle moved from 4 to 9
   *  cycles (smooth 4-cycle blobs rode the top-down ramp as marble grain).
   *  Pixel-based stamp params (drip walk, seam width) are tuned for 512. */
  wreck: spec({
    n: 2.2,
    ao: true,
    minSize: 512,
    fields(u, v, F) {
      F[0] = fbmT(u, v, 88, 2, 9); // chip field (2 oct — 512 gen-time budget)
      F[1] = fbmT(u, v, 86, 2, 30); // fine weathering (also gates dust band)
      F[2] = fbmT(u, v, 87, 2, 9); // paint mottle (9 cycles: mottle, not veins)
      F[3] = fbmT(u, 0.31, 89, 2, 7); // seam-line wobble (u wraps)
    },
    h(u, v, F) {
      const chip = F[0], T = CONFIG.WRECK_ART.chipThreshold;
      return clamp01(chip > T ? 0.62 - (chip - T) : 0.9 + (F[1] - 0.5) * 0.1);
    },
    rgb(u, v, h, F, c) {
      const W = CONFIG.WRECK_ART;
      // Panel grid: panelsPerTile per hull side (bus 11.5 m -> ~1.9 m), each
      // panel stepping ±10% via a wrapped hash (tileable), edges wobbled by
      // the low-frequency field. Crisp seam lines (seamPx at 512) replace
      // the old fbm-quantized bands that read as smear up close.
      const pan = u * W.panelsPerTile + (F[3] - 0.5) * W.panelWobble;
      const pi = wrapN(Math.floor(pan), W.panelsPerTile);
      const band = lerp(0.9, 1.1, hash2(pi, 17, 901));
      const l = lerp(0.86, 1.02, F[2]) * band;
      if (h < 0.56) { c[0] = 114 * l; c[1] = 74 * l; c[2] = 46 * l; } // primer chips
      else if (h < 0.68) { c[0] = 140 * l; c[1] = 138 * l; c[2] = 130 * l; }
      else { c[0] = 176 * l; c[1] = 174 * l; c[2] = 166 * l; } // chalky paint
      // Backlit-convoy lift + top-down dust gradient (v = panel height).
      // Strictly LINEAR in v (no smoothstep/curve): a curved value ramp is
      // what made the flank read as a shaped organic surface (round-6).
      let k = W.albedoLift * lerp(1 - W.baseDarken, 1 + W.topLighten, v);
      // Noisy dust band on the panel lower edges (fades out at dustBandV).
      const dust = clamp01((W.dustBandV - v) / W.dustBandV) * clamp01(F[1] * 1.5 - 0.25);
      k *= 1 - W.dustBandMax * dust;
      // Seam lines: darkened panel break with rust bleed (patchy gate).
      const seamW = (W.seamPx * W.panelsPerTile) / 512;
      const seam = clamp01(1 - Math.abs(pan - Math.round(pan)) / seamW);
      k *= 1 - W.seamDarken * seam;
      // Horizontal feature lines (sill + skirt break): crisp ~2 px cores
      // with a lit lip just below (machined metal edge, not grain). Wander
      // is capped at ~1 px so the lines stay rule-straight.
      for (const lv of [W.sillV, W.skirtV]) {
        const d = ((v - lv) + (F[1] - 0.5) * W.lineWobble) * 512;
        const core = clamp01(1 - Math.abs(d) / 1.2);
        const lip = clamp01(1 - Math.abs(d + 2.2) / 1.2);
        k *= (1 - W.lineDarken * core) * (1 + W.lineLift * lip);
      }
      // Rivet row along the sill line: sparse ~1 px darker dots on a ~14 px
      // lattice (rivetsPerTile 36 -> 14.2 px pitch; wrapN keeps it tileable).
      const rp = u * W.rivetsPerTile;
      const rpk = Math.round(rp);
      const dvR = Math.abs(v - (W.sillV - W.rivetOffsetPx / 512)) * 512;
      if (dvR < 0.9 && hash2(wrapN(rpk, W.rivetsPerTile), 23, 903) < W.rivetChance) {
        const duR = Math.abs(rp - rpk) * (512 / W.rivetsPerTile);
        k *= 1 - W.rivetDarken * clamp01(1 - duR / 0.55) * clamp01(1 - dvR / 0.9);
      }
      c[0] *= k; c[1] *= k; c[2] *= k;
      // Albedo ceiling (round-5): the worst-case chain paint 176 × l 1.04 ×
      // band 1.1 × albedoLift × topLighten used to exceed the 255 sRGB
      // byte ceiling — top-strip texels clamped to flat 255 (= 1.0 LINEAR
      // albedo) and lost all panel variation, spiking sunlit roofs/flanks
      // over the bloom threshold. albedoLift is sized so the raw worst case
      // lands ~230; this clamp is a cheap invariant guard (no plateau at
      // current tunables), and chunks.js caps instance tone against the
      // same W.texelCeil so paint × tone stays ≤ CONFIG.WRECKS.albedoCap.
      const ceil = W.texelCeil;
      if (c[0] > ceil) c[0] = ceil;
      if (c[1] > ceil) c[1] = ceil;
      if (c[2] > ceil) c[2] = ceil;
      const rustK = W.rustEdgeMix * seam * clamp01(F[2] * 1.6 - 0.3);
      if (rustK > 0) {
        c[0] = lerp(c[0], 122 * l, rustK);
        c[1] = lerp(c[1], 64 * l, rustK);
        c[2] = lerp(c[2], 36 * l, rustK);
      }
    },
    rough: (u, v, h) => (h > 0.8 ? 0.55 : h < 0.56 ? 0.85 : 0.7),
    stamps: [
      // Rain drips: near-vertical, low-wiggle walks running DOWN the panels
      // (pixel y grows with v, so the head at angle -PI/2 fades in toward
      // the streak tail; wrapN keeps every streak tileable). Round-6: count
      // 26 -> 14, length halved, wiggle 0.55 -> 0.22 — wavy long streaks
      // fused into wood-grain bands at hero distance; these read as vertical
      // weathering. 2 px wide for mip safety at 512.
      (rgb, size) => {
        const W = CONFIG.WRECK_ART;
        for (let d = 0; d < W.dripCount; d++) {
          const seed = 198 + d;
          stampWalk(size, seed, {
            x0: hash2(d, 1, seed) * size,
            y0: size * (0.15 + hash2(d, 2, seed) * 0.8),
            steps: W.dripSteps, stepLen: W.dripStepLen,
            angle0: -Math.PI / 2 + (hash2(d, 3, seed) - 0.5) * W.dripJitter,
            wiggle: W.dripWiggle,
          }, (px, py, s) => {
            const k = 1 - W.dripDarken * (0.25 + 0.75 * (s / W.dripSteps));
            for (let dx = 0; dx < 2; dx++) {
              const i = (py * size + wrapN(px + dx, size)) * 4;
              rgb[i] *= k; rgb[i + 1] *= k; rgb[i + 2] *= k;
            }
          });
        }
      },
    ],
  }),
};

// ---- canvas art (scrub, signs, city, dust) ----------------------------------

/**
 * Obstacle texture atlas (entities/obstacles.js, run-core-loop task 3.2).
 * ONE albedo canvas + ONE emissive-mask canvas serve all three obstacle
 * archetypes (one InstancedMesh each = 3 draws total): per-part UVs are
 * remapped into these regions (obstacles.js remapUV), so a single
 * MeshStandardMaterial per archetype carries rust metal, hazard-stripe
 * paint, concrete AND the emissive chips (barrier stripes / gantry hazard
 * lamps / separator reflectors) with zero extra draws. v is the three.js
 * convention (v=1 = canvas top); the painters derive every rect from these
 * fractions so layout and paint can never drift.
 */
export const OBSTACLE_ATLAS = {
  size: 512,
  regions: {
    // [u0, v0, u1, v1]
    stripes: [0, 0.5, 0.5, 1], // diagonal hazard boards (barrier planks)
    rust: [0.5, 0.5, 1, 1], // weathered painted metal (legs, posts, beam, panel)
    concrete: [0, 0, 0.5, 0.5], // dust-covered separator
    lamp: [0.6875, 0.1640625, 0.796875, 0.2734375], // hazard-lamp chip (56 px)
    refl: [0.53125, 0.0546875, 0.6171875, 0.140625], // amber-red reflector chip (44 px)
  },
};

/** Shared diagonal hazard-band fill for the atlas pair: fills 45 deg amber
 *  bands (ctx pre-translated to the stripes rect's top-left) into a w*h
 *  span, so albedo paint and emissive mask can never drift apart. */
function obstacleStripeBands(ctx, w, h) {
  const band = h / 5;
  for (let s = -h; s < w + h; s += band * 2) {
    ctx.beginPath();
    ctx.moveTo(s, h);
    ctx.lineTo(s + h, 0);
    ctx.lineTo(s + h + band, 0);
    ctx.lineTo(s + band, h);
    ctx.closePath();
    ctx.fill();
  }
}

function drawObstacleAtlas(ctx, w, h) {
  const R = OBSTACLE_ATLAS.regions;
  const X = (u) => u * w;
  const Y = (v) => (1 - v) * h; // flipY: canvas y runs opposite v
  const rect = (r) => [X(r[0]), Y(r[3]), (r[2] - r[0]) * w, (r[3] - r[1]) * h];
  ctx.clearRect(0, 0, w, h);

  // Hazard stripes (top-left quadrant): dusty amber / charcoal 45 deg bands.
  {
    const [sx, sy, sw, sh] = rect(R.stripes);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    ctx.fillStyle = "#2a251f";
    ctx.fillRect(sx, sy, sw, sh);
    ctx.translate(sx, sy);
    ctx.fillStyle = "#c07f38";
    obstacleStripeBands(ctx, sw, sh);
    // Dust + grime (keeps the paint read as abandoned roadworks, not candy).
    for (let i = 0; i < 220; i++) {
      const g = hash2(i, 1, 91);
      ctx.fillStyle = `rgba(${142 + g * 40 | 0},${120 + g * 34 | 0},${88 + g * 26 | 0},${0.05 + hash2(i, 2, 91) * 0.16})`;
      ctx.fillRect(hash2(i, 3, 91) * sw, hash2(i, 4, 91) * sh, 3 + hash2(i, 5, 91) * 22, 2 + hash2(i, 6, 91) * 9);
    }
    const grime = ctx.createLinearGradient(0, sh * 0.55, 0, sh);
    grime.addColorStop(0, "rgba(52,42,30,0)");
    grime.addColorStop(1, "rgba(52,42,30,0.5)");
    ctx.fillStyle = grime;
    ctx.fillRect(0, sh * 0.55, sw, sh * 0.45);
    ctx.restore();
  }

  // Weathered painted metal (top-right quadrant): grey-taupe paint over rust
  // mottle + drip streaks + panel seams (the barrier/gantry read).
  {
    const [rx, ry, rw, rh] = rect(R.rust);
    ctx.save();
    ctx.translate(rx, ry);
    ctx.fillStyle = "#635a4e";
    ctx.fillRect(0, 0, rw, rh);
    for (let i = 0; i < 90; i++) {
      const m = hash2(i, 7, 93);
      ctx.fillStyle = `rgba(${104 + m * 44 | 0},${62 + m * 26 | 0},${34 + m * 18 | 0},${0.1 + hash2(i, 8, 93) * 0.3})`;
      const cx = hash2(i, 9, 93) * rw, cy = hash2(i, 10, 93) * rh;
      ctx.fillRect(cx, cy, 6 + hash2(i, 11, 93) * 34, 4 + hash2(i, 12, 93) * 20);
    }
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(58,44,30,${0.12 + hash2(i, 13, 93) * 0.2})`;
      ctx.fillRect(hash2(i, 14, 93) * rw, hash2(i, 15, 93) * rh, 2 + hash2(i, 16, 93) * 3, 14 + hash2(i, 17, 93) * 60);
    }
    ctx.fillStyle = "rgba(30,24,18,0.4)";
    for (let s = 1; s < 4; s++) ctx.fillRect((s * rw) / 4, 0, 2, rh);
    ctx.restore();
  }

  // Concrete separator (bottom-left quadrant): pale dusty grey, mottle,
  // tar streaks, spall chips.
  {
    const [cx0, cy0, cw, ch] = rect(R.concrete);
    ctx.save();
    ctx.translate(cx0, cy0);
    ctx.fillStyle = "#8d8377";
    ctx.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 160; i++) {
      const g = hash2(i, 21, 95);
      ctx.fillStyle = `rgba(${120 + g * 44 | 0},${112 + g * 40 | 0},${100 + g * 36 | 0},${0.07 + hash2(i, 22, 95) * 0.2})`;
      ctx.fillRect(hash2(i, 23, 95) * cw, hash2(i, 24, 95) * ch, 4 + hash2(i, 25, 95) * 30, 3 + hash2(i, 26, 95) * 16);
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(46,38,28,${0.14 + hash2(i, 27, 95) * 0.22})`;
      ctx.fillRect(hash2(i, 28, 95) * cw, hash2(i, 29, 95) * ch, 2 + hash2(i, 30, 95) * 3, 20 + hash2(i, 31, 95) * 52);
    }
    ctx.restore();
  }

  // Chip quadrant (bottom-right): charred-dark field with the two emissive
  // chips — warm hazard lamp, amber-red reflector.
  {
    const [qx, qy, qw, qh] = rect([0.5, 0, 1, 0.5]);
    ctx.fillStyle = "#17120d";
    ctx.fillRect(qx, qy, qw, qh);
    const [lx, ly, lw, lh] = rect(R.lamp);
    ctx.fillStyle = "#ffd9a0";
    ctx.fillRect(lx, ly, lw, lh);
    ctx.strokeStyle = "rgba(40,28,16,0.9)";
    ctx.lineWidth = 3;
    ctx.strokeRect(lx + 1.5, ly + 1.5, lw - 3, lh - 3); // lamp housing rim
    const [fx, fy, fw, fh] = rect(R.refl);
    ctx.fillStyle = "#ff8a4a";
    ctx.fillRect(fx, fy, fw, fh);
  }
}

/** Emissive mask twin of the atlas: black everywhere except the hazard
 *  stripes' amber bands (dust-dimmed) and the two chips. The materials'
 *  emissive color/intensity (CONFIG.OBSTACLES.glow) tint this mask. */
function drawObstacleGlow(ctx, w, h) {
  const R = OBSTACLE_ATLAS.regions;
  const X = (u) => u * w;
  const Y = (v) => (1 - v) * h;
  const rect = (r) => [X(r[0]), Y(r[3]), (r[2] - r[0]) * w, (r[3] - r[1]) * h];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  {
    const [sx, sy, sw, sh] = rect(R.stripes);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    ctx.translate(sx, sy);
    ctx.fillStyle = "rgba(214,214,214,0.9)";
    obstacleStripeBands(ctx, sw, sh);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.25 + hash2(i, 41, 97) * 0.45})`;
      ctx.fillRect(hash2(i, 42, 97) * sw, hash2(i, 43, 97) * sh, 4 + hash2(i, 44, 97) * 26, 3 + hash2(i, 45, 97) * 12);
    }
    ctx.restore();
  }
  const [lx, ly, lw, lh] = rect(R.lamp);
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(lx, ly, lw, lh);
  const [fx, fy, fw, fh] = rect(R.refl);
  ctx.fillRect(fx, fy, fw, fh);
}

function drawScrub(ctx, w, h, seed) {
  ctx.clearRect(0, 0, w, h);
  const branch = (x, y, ang, len, wid, depth) => {
    if (depth <= 0 || len < 3) return;
    const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
    ctx.strokeStyle = depth > 2 ? "rgba(64,54,38,0.9)" : "rgba(88,76,50,0.8)";
    ctx.lineWidth = wid;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    for (let i = 0, n = 2 + (hash2(depth, seed, 3) > 0.5 ? 1 : 0); i < n; i++) {
      branch(nx, ny, ang + (hash2(i, depth, seed + 5) - 0.5) * 2.1, len * (0.55 + hash2(i, depth, seed + 7) * 0.25), wid * 0.62, depth - 1);
    }
  };
  branch(w / 2, h - 4, -Math.PI / 2 + (hash2(1, 2, seed) - 0.5) * 0.3, h * 0.42, w * 0.05, 5);
  for (let i = 0; i < 26; i++) {
    const a = hash2(i, 1, seed + 11) * Math.PI * 2, r = hash2(i, 2, seed + 11) * w * 0.34;
    ctx.fillStyle = hash2(i, 3, seed + 11) > 0.5 ? "rgba(104,88,52,0.85)" : "rgba(72,64,40,0.8)";
    ctx.fillRect(w / 2 + Math.cos(a) * r, h - 10 - Math.abs(Math.sin(a)) * h * 0.42, 2 + hash2(i, 4, seed) * 2, 2);
  }
}

function drawGuideSign(ctx, w, h) {
  ctx.fillStyle = "#153a2b";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(226,228,222,0.85)";
  ctx.lineWidth = 6;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  ctx.fillStyle = "rgba(228,230,224,0.92)";
  ctx.textBaseline = "middle";
  const font = (px) => `bold ${Math.round(px)}px "Arial Narrow","Helvetica Neue",sans-serif`;
  ctx.font = font(h * 0.26);
  ctx.fillText("SOLACE", w * 0.12, h * 0.34);
  ctx.font = font(h * 0.2);
  ctx.fillText("LAST EXIT", w * 0.12, h * 0.64);
  ctx.fillText("2", w * 0.78, h * 0.64);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(210,196,160,${0.03 + hash2(i, 1, 7) * 0.05})`;
    ctx.fillRect(hash2(i, 2, 7) * w, hash2(i, 3, 7) * h, 8 + hash2(i, 4, 7) * 40, 3 + hash2(i, 5, 7) * 10);
  }
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = "rgba(112,74,40,0.28)";
    ctx.fillRect(hash2(i, 6, 7) * w, h - 6 - hash2(i, 7, 7) * 14, 2 + hash2(i, 8, 7) * 3, 6 + hash2(i, 9, 7) * 10);
  }
}

/**
 * Burning-city skyline: transparent top, ember glow, dark towers + windows.
 * Round-3 re-author (was regular-height boxes with uniform window-dot
 * grids): buildings come in 4 scale classes riding a noise-driven skyline
 * envelope, adjacent heights are pushed apart so no two neighbours match,
 * rooflines are broken up (setbacks, antennas with beacons, water tanks,
 * side wings), windows are irregular (per-building spacing + lit fraction,
 * whole dark floors, occasional bright clusters) and a warm base wash plus
 * a per-tower top-haze gradient melt the mass into the glow band and the
 * sky instead of reading as cardboard slabs. The card is far wider than the
 * frustum, so the outer envelopeFrac of each side is smoothstep-faded to
 * zero (destination-in mask over everything, towers and windows included) —
 * the rectangle's hard edges can never read as a horizon seam. Peak glow
 * alpha stays low enough that card opacity × gradient keeps the glow below
 * ~65% luminance behind the tower silhouettes.
 */
function drawCity(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const glow = ctx.createLinearGradient(0, 0, 0, h);
  glow.addColorStop(0, "rgba(255,120,50,0)");
  glow.addColorStop(0.55, "rgba(255,110,44,0.22)");
  glow.addColorStop(0.82, "rgba(255,140,60,0.4)");
  glow.addColorStop(1, "rgba(255,150,66,0.55)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) {
    const cx = hash2(i, 1, 31) * w, cy = h * (0.72 + hash2(i, 2, 31) * 0.16);
    const r = h * (0.1 + hash2(i, 3, 31) * 0.14);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,196,110,0.38)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const rgba = (c, aMul = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] * aMul).toFixed(3)})`;
  // Height classes as [min, max] fractions of the card: low-rise, mid,
  // high, tower (round-3: was one uniform 0.24-0.58 box height).
  const CLASSES = [[0.1, 0.17], [0.18, 0.27], [0.3, 0.42], [0.47, 0.62]];
  const tower = (x, bw, bh, col, colTop, seed, i) => {
    const top = h - bh;
    // Aerial-perspective melt: mass fades slightly toward its roofline so
    // tops stop reading as cut-out slabs against the sky; the base eases
    // off a touch so the glow shows through the feet (no hard bottom edge).
    const grad = ctx.createLinearGradient(0, top, 0, h);
    grad.addColorStop(0, rgba(colTop));
    grad.addColorStop(0.3, rgba(col));
    grad.addColorStop(0.85, rgba(col));
    grad.addColorStop(1, rgba(col, 0.7));
    ctx.fillStyle = grad;
    // Stepped setback on the upper third of tall buildings (roofline break).
    let bodyTop = top;
    if (bh > h * 0.3 && hash2(i, 20, seed) < 0.75) {
      const ubh = Math.round(bh * (0.18 + hash2(i, 21, seed) * 0.16));
      const ubw = Math.max(6, bw * (0.5 + hash2(i, 22, seed) * 0.3));
      const ux = x + (bw - ubw) * hash2(i, 23, seed);
      ctx.fillRect(x, top + ubh, bw, bh - ubh);
      ctx.fillRect(ux, top, ubw, ubh);
      bodyTop = top + ubh;
    } else {
      ctx.fillRect(x, top, bw, bh);
    }
    // Side wing annex (massing variety; may overlap neighbours — fine).
    if (hash2(i, 24, seed) < 0.4) {
      const ww = bw * (0.3 + hash2(i, 25, seed) * 0.3);
      const wh = bh * (0.35 + hash2(i, 26, seed) * 0.25);
      ctx.fillStyle = rgba(col, 0.92);
      ctx.fillRect(hash2(i, 27, seed) < 0.5 ? x - ww * 0.55 : x + bw - ww * 0.45, h - wh, ww, wh);
    }
    // Roof furniture: antenna mast + faint beacon on tall roofs, water tank
    // on short ones.
    if (bh > h * 0.3 && hash2(i, 28, seed) < 0.55) {
      const ax = x + bw * (0.25 + hash2(i, 29, seed) * 0.5);
      const ah = 6 + hash2(i, 30, seed) * 16;
      ctx.fillStyle = rgba(col);
      ctx.fillRect(ax, top - ah, 1.6, ah);
      if (hash2(i, 31, seed) < 0.5) {
        ctx.fillStyle = "rgba(255,96,60,0.7)";
        ctx.fillRect(ax - 0.7, top - ah - 2, 3, 3);
      }
    } else if (bh < h * 0.26 && hash2(i, 32, seed) < 0.35) {
      const tx = x + bw * (0.2 + hash2(i, 33, seed) * 0.5);
      ctx.fillStyle = rgba(col);
      ctx.fillRect(tx, top - 7, 7, 6);
      ctx.fillRect(tx + 1, top - 1, 1.4, 3);
      ctx.fillRect(tx + 4.6, top - 1, 1.4, 3);
    }
    // Irregular windows: per-building spacing + lit fraction, some floors
    // fully dark, occasional tight bright cluster (generator-fed rooms).
    const litFrac = 0.05 + hash2(i, 40, seed) * 0.16;
    const colStep = 5 + Math.floor(hash2(i, 41, seed) * 4);
    const rowStep = 8 + Math.floor(hash2(i, 42, seed) * 4);
    const hasCluster = hash2(i, 43, seed) < 0.3;
    const ccx = x + bw * (0.25 + hash2(i, 44, seed) * 0.5);
    const ccy = top + bh * (0.35 + hash2(i, 45, seed) * 0.4);
    let row = 0;
    for (let wy = bodyTop + 5; wy < h - 5; wy += rowStep, row++) {
      if (hash2(i, 50 + (row % 8), seed + row) < 0.22) continue; // dark floor
      for (let wx = x + 3; wx < x + bw - 4; wx += colStep) {
        const wr = hash2(wx | 0, wy | 0, 38);
        const dx = wx - ccx, dy = wy - ccy;
        if (hasCluster && dx * dx + dy * dy < 90) {
          ctx.fillStyle = "rgba(255,208,132,0.95)";
          ctx.fillRect(wx, wy, 3, 4);
        } else if (wr < litFrac) {
          ctx.fillStyle = wr < litFrac * 0.4 ? "rgba(255,176,88,0.85)" : "rgba(255,132,64,0.55)";
          ctx.fillRect(wx, wy, 2.5, 3.5);
        }
      }
    }
  };
  // One depth layer of the skyline: widths/heights from 4 classes scaled by
  // a noise-driven envelope, adjacent heights pushed apart (no repeated
  // slab rhythm), slight overlaps so the mass reads continuous.
  const skyline = (seed, col, colTop, wMin, wMax, wts) => {
    let x = -24, prevH = -1, i = 0;
    while (x < w + 24) {
      const rc = hash2(i, 1, seed);
      const cls = rc < wts[0] ? 0 : rc < wts[0] + wts[1] ? 1 : rc < wts[0] + wts[1] + wts[2] ? 2 : 3;
      let bh = h * lerp(CLASSES[cls][0], CLASSES[cls][1], hash2(i, 2, seed))
        * lerp(0.78, 1.08, fbmT(x / w, 0.37, seed + 3, 2, 3));
      if (prevH >= 0 && Math.abs(bh - prevH) < h * 0.04) bh = prevH + (bh >= prevH ? 1 : -1) * h * 0.055;
      bh = clamp(bh, h * 0.08, h * 0.64);
      prevH = bh;
      const bw = lerp(wMin, wMax, hash2(i, 3, seed));
      tower(x, bw, bh, col, colTop, seed, i);
      x += bw * lerp(0.82, 1.04, hash2(i, 4, seed));
      i++;
    }
  };
  // Far core: taller average + hazier; near districts: lower + darker.
  skyline(35, [30, 21, 17, 0.5], [78, 52, 36, 0.26], 14, 38, [0.3, 0.32, 0.26, 0.12]);
  skyline(36, [13, 9, 10, 0.92], [52, 34, 25, 0.5], 22, 56, [0.44, 0.34, 0.17, 0.05]);
  // Building feet melt into the glow band (no hard bottom edge against it).
  const baseWash = ctx.createLinearGradient(0, h * 0.52, 0, h);
  baseWash.addColorStop(0, "rgba(255,132,52,0)");
  baseWash.addColorStop(0.65, "rgba(255,136,54,0.16)");
  baseWash.addColorStop(1, "rgba(255,152,68,0.34)");
  ctx.fillStyle = baseWash;
  ctx.fillRect(0, h * 0.52, w, h * 0.48);
  // Horizontal envelope: smoothstep to zero over each outer fraction. Stops
  // sample the smoothstep curve (5 per side ≈ piecewise-linear match).
  const f = CONFIG.CITY.envelopeFrac;
  const mask = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 4; i++) {
    const t = i / 4, a = smooth(t).toFixed(3);
    mask.addColorStop(t * f, `rgba(0,0,0,${a})`);
    mask.addColorStop(1 - t * f, `rgba(0,0,0,${a})`);
  }
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

/** Dust mote sprite: warm amber-grey (never white — a white core reads as
 *  sensor-noise bokeh) with a soft wide falloff, no hard bright centre. */
function drawDustDot(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(255,205,150,0.8)");
  g.addColorStop(0.35, "rgba(255,192,132,0.34)");
  g.addColorStop(0.7, "rgba(255,184,122,0.09)");
  g.addColorStop(1, "rgba(255,184,122,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Fake grounded contact shadow (stretched per vehicle by geometry scale).
 *  Black core fading to transparent; tint/alpha come from the material. */
function drawContactShadow(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(0,0,0,0.72)");
  g.addColorStop(0.5, "rgba(0,0,0,0.38)");
  g.addColorStop(0.8, "rgba(0,0,0,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Soft warm blob for fake night light pools / horizon haze (geometry
 *  stretches it into an ellipse; tint comes from the material color). */
function drawLightPool(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(0.75, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** DOT-style reflective contour tape (chunks.js trailer rear): 8 crisp
 *  alternating dashes. The material is a flat MeshBasicMaterial tinted
 *  0x8a2020, so the canvas holds the VALUE alternation (bright "white"
 *  dash vs dim red dash) and the tint pulls both into the red family —
 *  the classic red/white tape read at dusk, no bloom (HDR < 0.05). */
function drawDotTape(ctx, w, h) {
  const dash = w / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#f2ece0" : "#9c1f1f";
    ctx.fillRect(Math.round(i * dash), 0, Math.ceil(dash), h);
  }
}

const CANVAS_ART = {
  scrub: { width: 128, height: 128, draw: (ctx, w, h) => drawScrub(ctx, w, h, 21) },
  signGuide: { width: 256, height: 128, draw: drawGuideSign },
  city: { width: 1024, height: 256, draw: drawCity },
  dustDot: { width: 64, height: 64, draw: drawDustDot },
  contactShadow: { width: 128, height: 128, draw: drawContactShadow },
  lightPool: { width: 128, height: 128, draw: drawLightPool },
  dotTape: { width: 128, height: 8, draw: drawDotTape },
  obstacleAtlas: { width: OBSTACLE_ATLAS.size, height: OBSTACLE_ATLAS.size, draw: drawObstacleAtlas },
  obstacleGlow: { width: OBSTACLE_ATLAS.size, height: OBSTACLE_ATLAS.size, draw: drawObstacleGlow },
};

// ---- MaterialLibrary --------------------------------------------------------
const MATERIAL_DEFS = {
  road: { set: "road", metalness: 0, roughness: 1.0, envMapIntensity: CONFIG.ROAD_ART.envMapIntensity },
  sand: { set: "sand", metalness: 0, roughness: 1.0, envMapIntensity: 0.05 },
  // flatShading stays OFF (round-5): derivative flat normals give each of a
  // lathe quad's two triangles its own normal — on the jittered mesa profiles
  // they alternate light/dark and read as a checkerboard up close. Lathe
  // geometry carries analytic smooth normals + the rock normal map instead;
  // boulders keep faceted read via baked PolyhedronGeometry normals.
  rock: { set: "rock", metalness: 0, roughness: 0.94, envMapIntensity: 0.14, flatShading: false },
  rust: { set: "rust", metalness: 0.32, roughness: 0.84, envMapIntensity: 0.5 },
  paintedMetal: { set: "paintedMetal", metalness: 0.4, roughness: 0.62, envMapIntensity: 0.7 },
  concrete: { set: "concrete", metalness: 0, roughness: 0.92, envMapIntensity: 0.22 },
  // Scorch band / burnt trim: floor lifted so backlit rears keep a charcoal
  // read instead of a black box (generator albedo floor 0.07 linear), and
  // roughness 0.8 so the PMREM horizon still sheens across it.
  charred: { set: "charred", metalness: 0.1, roughness: 0.8, envMapIntensity: 0.5 },
  // Wreck hull paints: one shared "wreck" PBR set, tinted per vehicle. Keep
  // the tint desaturated/dusty — the chalky albedo does the weathering.
  // envMapIntensity 0.6 keeps panel faces off black in the shadowed side.
  // Roughness raised +0.06 (round-4): near-horizontal faces (bus/trailer
  // roofs) must stay under the bloom threshold — the sun's grazing
  // specular on smooth chalky paint was spiking them to clipped white.
  wreckWhite: { set: "wreck", color: 0xd9d4c6, metalness: 0.3, roughness: 0.72, envMapIntensity: 0.6 },
  wreckRed: { set: "wreck", color: 0xa8523c, metalness: 0.3, roughness: 0.76, envMapIntensity: 0.6 },
  wreckTeal: { set: "wreck", color: 0x648a80, metalness: 0.3, roughness: 0.74, envMapIntensity: 0.6 },
  // Window glass: two roughness variants alternated per window quad
  // (chunks.js) so bands don't read as one uniform strip; slightly
  // transparent over the dark interior backing inset behind them.
  wreckGlassA: { color: 0x141a1f, metalness: 0.35, roughness: 0.15, envMapIntensity: 1.2, opacity: 0.65 },
  wreckGlassB: { color: 0x141a1f, metalness: 0.35, roughness: 0.3, envMapIntensity: 1.2, opacity: 0.65 },
  interior: { color: 0x1a120c, metalness: 0, roughness: 1, envMapIntensity: 0 },
  // Wheel rims: worn steel a step lighter than the rubber, env-tinted.
  rimMetal: { color: 0x8a8a84, metalness: 0.7, roughness: 0.35, envMapIntensity: 0.6 },
  rubber: { color: 0x141414, metalness: 0, roughness: 0.92, envMapIntensity: 0.1 },
  emissiveStrip: { color: 0x0a0804, emissive: 0xffb24d, emissiveIntensity: 1.7, metalness: 0, roughness: 0.4, envMapIntensity: 1 },
  // Vehicle taillight markers (chunks.js trailer/cab rears): dull body, red
  // emissive that punches through backlit rears as the convoy focal point.
  // Intensity is dusk/night-switched at chunk build (CONFIG.VEHICLE_LIGHTS).
  taillight: { color: 0x1a0503, emissive: 0xff2a1a, emissiveIntensity: 2.2, metalness: 0, roughness: 0.4, envMapIntensity: 1 },
  // Rail-post delineator: amber family, tuned to read as a small bright dot
  // under bloom 0.62/0.62 — separate from emissiveStrip (night code drives
  // that one's intensity globally).
  reflector: { color: 0x1a1208, emissive: 0xffb24d, emissiveIntensity: 1.15, metalness: 0, roughness: 0.4, envMapIntensity: 1 },
  contactShadow: { canvas: "contactShadow", color: 0x000000, metalness: 0, roughness: 1, envMapIntensity: 0, opacity: 0.45, depthWrite: false },
  scrub: { canvas: "scrub", alphaTest: 0.42, metalness: 0, roughness: 1.0, envMapIntensity: 0.1, doubleSide: true },
  signGuide: { canvas: "signGuide", metalness: 0.05, roughness: 0.55, envMapIntensity: 0.5 },
  // Shambler skin (chunks.js round-6 hero subject): flat sickly olive-grey,
  // untextured — the silhouette plus the amber eye dots carry the figure.
  // Roughness 0.9 keeps grazing dusk specular off; low envMapIntensity so
  // night frames read the moon rim, not a grey plastic shell.
  shambler: { color: 0x6b7054, metalness: 0, roughness: 0.9, envMapIntensity: 0.15 },
  // Runner kit (entities/player.js, task 3.4): flat clothed-runner tones;
  // untextured like shambler (same compiled program).
  runnerJacket: { color: 0x7d4630, metalness: 0, roughness: 0.85, envMapIntensity: 0.2 },
  runnerPants: { color: 0x33383e, metalness: 0, roughness: 0.9, envMapIntensity: 0.18 },
  runnerSkin: { color: 0xa8704f, metalness: 0, roughness: 0.72, envMapIntensity: 0.25 },
  runnerBoot: { color: 0x2a1d14, metalness: 0, roughness: 0.85, envMapIntensity: 0.18 },
  // Obstacle archetypes (entities/obstacles.js, task 3.2): all three share
  // the atlas albedo + emissive-mask canvas pair; per-part UVs select each
  // part's finish, so ONE material per archetype keeps the whole system at
  // 3 draws. Emissive color per archetype (amber / amber-red per palette);
  // intensity is baked dusk/night by obstacles.js at construct (the
  // taillight/reflector precedent) and, at night, blinked on the gantry.
  obstacleBarrier: { canvas: "obstacleAtlas", emissiveCanvas: "obstacleGlow", emissive: 0xffb24d, emissiveIntensity: 0.4, metalness: 0.22, roughness: 0.82, envMapIntensity: 0.5 },
  obstacleGantry: { canvas: "obstacleAtlas", emissiveCanvas: "obstacleGlow", emissive: 0xffb24d, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.78, envMapIntensity: 0.55 },
  obstacleBlock: { canvas: "obstacleAtlas", emissiveCanvas: "obstacleGlow", emissive: 0xff7a3d, emissiveIntensity: 0.5, metalness: 0.08, roughness: 0.9, envMapIntensity: 0.35 },
};

/**
 * Lazy procedural texture factory. PBR sets come from spec() descriptors
 * (height field -> albedo/normal/roughness/AO DataTextures); decor art comes
 * from CANVAS_ART painters. Everything is generated once, then cached.
 */
class TextureFactory {
  constructor() {
    this._sets = new Map();
    this._canvases = new Map();
    this.maxAnisotropy = 8;
    this._genMs = 0;
    this._texSize = 512;
    this._aoEnabled = true;
  }

  /**
   * Tier budget for generated sets: base gen size (256 cheap tiers / 512)
   * and the AO pass gate. Hero sets may floor their size via gen.minSize.
   */
  configure({ texSize = 512, aoMaps = true } = {}) {
    this._texSize = texSize;
    this._aoEnabled = !!aoMaps;
  }

  get generationMs() {
    return this._genMs;
  }

  /** @returns {{map, normalMap, roughnessMap, aoMap?}} tileable PBR set */
  getSet(key, gen) {
    const cached = this._sets.get(key);
    if (cached) return cached;
    const t0 = performance.now();
    const size = Math.min(gen.size || 512, Math.max(this._texSize, gen.minSize || 0));

    const height = new Float32Array(size * size);
    const albedo = new Uint8ClampedArray(size * size * 4);
    const rough = new Float32Array(size * size);
    gen.generate(height, albedo, rough, size);

    const map = this._dataTexture(albedo, size, THREE.SRGBColorSpace);
    const normalMap = this._dataTexture(
      heightToNormalRGBA(height, size, gen.normalStrength ?? 1), size, THREE.NoColorSpace);
    const roughnessMap = this._dataTexture(grayToRGBA(rough, size), size, THREE.NoColorSpace);
    let aoMap = null;
    if (gen.withAo && this._aoEnabled) {
      // Cheap horizon AO: darken where a texel sits above its neighborhood.
      const ao = new Float32Array(size * size);
      const half = 3;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sum = 0, n = 0;
          for (let dy = -half; dy <= half; dy += 2) {
            for (let dx = -half; dx <= half; dx += 2) {
              const qy = (y + dy + size) % size, qx = (x + dx + size) % size;
              sum += height[qy * size + qx]; n++;
            }
          }
          const h = height[y * size + x];
          ao[y * size + x] = Math.max(0, 1 - Math.max(0, h - sum / n) * 1.4) * (gen.aoF ?? 1);
        }
      }
      aoMap = this._dataTexture(grayToRGBA(ao, size), size, THREE.NoColorSpace);
    }

    const set = { map, normalMap, roughnessMap, aoMap };
    if (gen.clampV) {
      // Non-tiled v (mesa rock: v is a height fraction with the talus skirt
      // at 0) — clamping keeps mip blending from smearing the skirt band
      // across the top edge.
      for (const t of [set.map, set.normalMap, set.roughnessMap, set.aoMap]) {
        if (t) t.wrapT = THREE.ClampToEdgeWrapping;
      }
    }
    this._sets.set(key, set);
    this._genMs += performance.now() - t0;
    return set;
  }

  /** Cached decor canvas texture (transparent where the painter leaves alpha 0). */
  getCanvas(key, art) {
    const cached = this._canvases.get(key);
    if (cached) return cached;
    const t0 = performance.now();
    const canvas = document.createElement("canvas");
    canvas.width = art.width;
    canvas.height = art.height;
    art.draw(canvas.getContext("2d"), art.width, art.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, this.maxAnisotropy);
    tex.needsUpdate = true;
    this._canvases.set(key, tex);
    this._genMs += performance.now() - t0;
    return tex;
  }

  _dataTexture(rgba, size, colorSpace) {
    const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
    tex.colorSpace = colorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  }
}

class MaterialLibrary {
  constructor() {
    this.factory = new TextureFactory();
    this._materials = new Map();
  }

  /**
   * Call once after renderer creation. Applies the quality preset's texture
   * budget and (on software rasterizers) a tight anisotropy cap — anisotropic
   * fetches are a real per-frame cost there.
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [preset] Quality preset (QUALITY_PRESETS entry).
   * @param {boolean} [softwareGL] Software rasterizer detected.
   */
  init(renderer, preset, softwareGL = false) {
    const cap = softwareGL ? 2 : 8;
    this.factory.maxAnisotropy = Math.min(cap, renderer.capabilities.getMaxAnisotropy());
    if (preset) {
      this.factory.configure({ texSize: preset.texSize, aoMaps: preset.aoMaps });
    }
  }

  /** @returns {THREE.MeshStandardMaterial} Shared material by key. */
  get(key) {
    const cached = this._materials.get(key);
    if (cached) return cached;
    const def = MATERIAL_DEFS[key];
    if (!def) throw new Error(`MaterialLibrary: unknown material '${key}'`);
    const params = { metalness: def.metalness, roughness: def.roughness, envMapIntensity: def.envMapIntensity };
    if (def.color !== undefined) params.color = new THREE.Color(def.color);
    if (def.emissive !== undefined) {
      params.emissive = new THREE.Color(def.emissive);
      params.emissiveIntensity = def.emissiveIntensity;
    }
    if (def.flatShading) params.flatShading = true;
    if (def.doubleSide) params.side = THREE.DoubleSide;
    if (def.alphaTest) params.alphaTest = def.alphaTest;
    if (def.opacity !== undefined) {
      params.transparent = true;
      params.opacity = def.opacity;
      params.depthWrite = def.depthWrite !== false;
    }
    if (def.set) {
      const set = this.factory.getSet(def.set, GENERATORS[def.set]);
      params.map = set.map;
      params.normalMap = set.normalMap;
      params.roughnessMap = set.roughnessMap;
      if (set.aoMap) params.aoMap = set.aoMap;
      params.normalScale = new THREE.Vector2(1, 1);
    } else if (def.canvas) {
      params.map = this.factory.getCanvas(def.canvas, CANVAS_ART[def.canvas]);
    }
    if (def.emissiveCanvas !== undefined) {
      params.emissiveMap = this.factory.getCanvas(def.emissiveCanvas, CANVAS_ART[def.emissiveCanvas]);
    }
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = key;
    this._materials.set(key, mat);
    return mat;
  }

  /** Raw decor canvas texture (city glow, dust sprite). */
  canvas(key) {
    return this.factory.getCanvas(key, CANVAS_ART[key]);
  }

  textureSet(setKey) {
    return this.factory.getSet(setKey, GENERATORS[setKey]);
  }

  get generationMs() {
    return this.factory.generationMs;
  }
}

export const materialLibrary = new MaterialLibrary();
