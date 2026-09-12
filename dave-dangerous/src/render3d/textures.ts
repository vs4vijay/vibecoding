// src/render3d/textures.ts
// Procedural PBR texture factory — no binary assets, no external fetches.
// Every surface is generated from tileable seeded value-noise / fBm on 2D canvas:
// albedo (sRGB) + Sobel normal map + roughness map + cavity AO map.
// Deterministic: same kind always yields the same textures (no Math.random).
import * as THREE from "three";

export interface PbrSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
}

type RGB = [number, number, number];

interface Fields {
  h: Float32Array; // height field 0..1 (canvas space, y down)
  rough: Float32Array; // roughness 0..1
  alb: Uint8ClampedArray; // RGBA albedo
}

// ---------------------------------------------------------------------------
// Deterministic noise toolkit (tileable integer-hash value noise + fBm)
// ---------------------------------------------------------------------------

/** Deterministic integer hash → [0,1). */
function ihash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise; px/py are integer lattice periods (u,v in [0,1)). */
function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let tx = x - xi;
  let ty = y - yi;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = ihash(x0, y0, seed);
  const b = ihash(x1, y0, seed);
  const c = ihash(x0, y1, seed);
  const d = ihash(x1, y1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Tileable anisotropic fBm (px≠py gives stretched features). */
function fbm2(u: number, v: number, oct: number, seed: number, px: number, py: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let o = 0; o < oct; o++) {
    sum += vnoise(u, v, Math.max(1, Math.round(fx)), Math.max(1, Math.round(fy)), seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

function fbm(u: number, v: number, oct: number, seed: number, period = 4): number {
  return fbm2(u, v, oct, seed, period, period);
}

/** Ridged fBm: ~1 along noise zero-crossings (crack / vein lines). */
function ridge2(u: number, v: number, oct: number, seed: number, px: number, py: number): number {
  return 1 - Math.abs(2 * fbm2(u, v, oct, seed, px, py) - 1);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smoothstep; works with inverted edges (a > b) for falloff masks. */
function sstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function mixNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix3(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// ---------------------------------------------------------------------------
// Field builders — one per surface kind
// ---------------------------------------------------------------------------

function alloc(S: number): Fields {
  return {
    h: new Float32Array(S * S),
    rough: new Float32Array(S * S),
    alb: new Uint8ClampedArray(S * S * 4),
  };
}

function put(f: Fields, i: number, h: number, rough: number, col: RGB): void {
  f.h[i] = clamp01(h);
  f.rough[i] = clamp01(rough);
  const j = i * 4;
  f.alb[j] = col[0];
  f.alb[j + 1] = col[1];
  f.alb[j + 2] = col[2];
  f.alb[j + 3] = 255;
}

/** Blue-slate cavern stone: strata banding, warped surface, deep cracks, mineral glints. */
function buildRock(S: number): Fields {
  const f = alloc(S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const wx = fbm(u, v, 3, 911, 3) - 0.5;
      const wy = fbm(u, v, 3, 933, 3) - 0.5;
      const base = fbm(u + wx * 0.55, v + wy * 0.55, 5, 101, 4);
      const strata = 0.5 + 0.5 * Math.sin((v + wy * 0.08) * Math.PI * 10 + wx * 2.5);
      const detail = fbm(u, v, 4, 303, 28);
      const cr = ridge2(u + wx * 0.3, v + wy * 0.3, 4, 555, 3, 3);
      const crack = sstep(0.845, 0.965, cr);
      const glint = sstep(0.86, 0.97, vnoise(u, v, 64, 64, 4242));
      const h = 0.40 + 0.34 * base + 0.16 * strata + 0.10 * detail - crack * 0.45;
      let col = mix3([13, 25, 32], [38, 66, 78], sstep(0.18, 0.55, h));
      col = mix3(col, [60, 96, 108], sstep(0.55, 0.9, h));
      col = mix3(col, [52, 86, 82], strata * 0.16);
      col = mix3(col, [5, 9, 12], crack * 0.92);
      col = mix3(col, [148, 202, 202], glint);
      put(f, y * S + x, h, 0.9 - h * 0.12 + crack * 0.08 - glint * 0.38, col);
    }
  }
  return f;
}

/** Carved vault bricks: mortar gaps, chipped edges, per-brick hue, occasional glyph. */
function buildBrick(S: number): Fields {
  const f = alloc(S);
  const ROWS = 8; // even → pattern tiles vertically
  const COLS = 4;
  const MORTAR = 0.055;
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const row = Math.min(ROWS - 1, Math.floor(v * ROWS));
      const fy0 = v * ROWS - row;
      const xr = u * COLS + (row % 2) * 0.5;
      const colI = Math.floor(xr);
      const fx0 = xr - colI;
      // chipped, wobbly mortar lines (global noise keeps seams continuous)
      const chipX = (fbm2(u, v, 3, 700 + row * 31, 16, 12) - 0.5) * 0.14;
      const chipY = (fbm2(u, v, 3, 800 + colI * 17, 12, 16) - 0.5) * 0.14;
      const fx = fx0 + chipX;
      const fy = fy0 + chipY;
      const edge = Math.min(Math.min(fx, 1 - fx), Math.min(fy, 1 - fy));
      const bid = ihash(colI, row, 991);
      const mortarM = 1 - sstep(MORTAR * 0.65, MORTAR * 1.35, edge);
      const surf = fbm(u, v, 4, 123, 18);
      const bulge = sstep(0, 0.4, edge) * 0.1;
      let h = 0.5 + bid * 0.22 + bulge + (surf - 0.5) * 0.16;
      h = mixNum(0.16, h, 1 - mortarM);
      // carved glyph on ~14% of bricks (3 variants)
      let glyph = 0;
      if (bid > 0.86 && mortarM < 0.5) {
        const gx = fx0 - 0.5;
        const gy = fy0 - 0.5;
        const variant = Math.floor(bid * 1000) % 3;
        if (variant === 0) {
          glyph = sstep(0.035, 0.012, Math.abs(Math.sqrt(gx * gx + gy * gy) - 0.26));
        } else if (variant === 1) {
          glyph = Math.max(sstep(0.05, 0.015, Math.abs(gx)), sstep(0.045, 0.012, Math.abs(gy + 0.02)));
        } else {
          glyph = sstep(0.05, 0.015, Math.abs(gy - (0.22 - Math.abs(gx) * 0.85)));
        }
        glyph *= sstep(MORTAR * 1.6, MORTAR * 2.4, edge);
        h -= glyph * 0.16;
      }
      const mossM = mortarM * sstep(0.55, 0.8, fbm(u, v, 3, 777, 6));
      let col = mix3([86, 78, 66], [64, 58, 55], bid);
      col = mix3(col, [96, 90, 76], sstep(0.5, 0.9, surf) * 0.4);
      col = mix3(col, [46, 70, 62], 0.25); // faint teal wash from the cavern air
      col = mix3(col, [24, 26, 30], mortarM);
      col = mix3(col, [44, 86, 58], mossM * 0.85);
      col = mix3(col, [30, 24, 20], glyph * 0.8);
      const rough = mixNum(0.9, 0.76 + bid * 0.12 - sstep(0.5, 0.9, surf) * 0.08, 1 - mortarM) + glyph * 0.1;
      put(f, y * S + x, h, rough, col);
    }
  }
  return f;
}

/** Dark green moss: soft clumps over deep shadow gaps, fine strands. */
function buildMoss(S: number): Fields {
  const f = alloc(S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const warp = fbm(u, v, 2, 51, 3) - 0.5;
      const clump = fbm2(u + warp * 0.35, v, 5, 3131, 5, 5);
      const fine = fbm(u, v, 4, 3434, 40);
      const strands = vnoise(u, v, 90, 18, 5151);
      const h = 0.3 + 0.55 * sstep(0.34, 0.75, clump) + 0.15 * fine;
      let col = mix3([14, 30, 20], [40, 82, 54], sstep(0.3, 0.68, h));
      col = mix3(col, [88, 134, 88], sstep(0.68, 0.95, h));
      col = mix3(col, [62, 110, 74], strands * 0.22);
      put(f, y * S + x, h, 0.9 + fine * 0.08 - sstep(0.7, 0.95, h) * 0.06, col);
    }
  }
  return f;
}

/** Shared lava vein network — crust cracks and the emissive map use the SAME
 *  field so glowing veins align exactly with the dark crust fractures. */
function lavaVein(u: number, v: number): number {
  const wx = fbm(u, v, 3, 5151, 3) - 0.5;
  const wy = fbm(u, v, 3, 5252, 3) - 0.5;
  const r = ridge2(u + wx * 0.45, v + wy * 0.45, 4, 5005, 3, 3);
  return sstep(0.8, 0.965, r);
}

/** Lava crust: charred plates with sunken glowing cracks. */
function buildLava(S: number): Fields {
  const f = alloc(S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const vein = lavaVein(u, v);
      const wx = fbm(u, v, 3, 5151, 3) - 0.5;
      const plate = fbm(u + wx * 0.3, v, 5, 202, 4);
      const ash = sstep(0.58, 0.78, fbm(u, v, 3, 909, 5));
      const h = 0.42 + plate * 0.42 - vein * 0.5;
      let col = mix3([46, 26, 16], [20, 11, 8], sstep(0.3, 0.75, h));
      col = mix3(col, [56, 50, 46], ash * 0.5);
      col = mix3(col, [96, 40, 18], vein * 0.6);
      put(f, y * S + x, h, 0.88 - vein * 0.3 + ash * 0.05, col);
    }
  }
  return f;
}

function lavaEmissiveField(u: number, v: number): number {
  const vein = Math.pow(lavaVein(u, v), 0.75);
  const second = sstep(0.86, 0.985, ridge2(u, v, 3, 6006, 2, 2)) * 0.35;
  return clamp01(Math.max(vein, second));
}

/** Brushed gold with tarnish patches. */
function buildGold(S: number): Fields {
  const f = alloc(S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const streak = fbm2(u, v, 3, 616, 3, 56);
      const tarnWarp = fbm(u, v, 2, 61, 3) - 0.5;
      const tarnish = sstep(0.44, 0.7, fbm2(u + tarnWarp * 0.4, v, 4, 62, 3, 3));
      const h = 0.5 + streak * 0.14 + (1 - tarnish) * 0.1;
      let col = mix3([120, 88, 38], [214, 164, 70], sstep(0.3, 0.75, h));
      col = mix3(col, [242, 208, 128], sstep(0.72, 0.95, h) * (1 - tarnish));
      col = mix3(col, [52, 40, 24], tarnish * 0.9);
      put(f, y * S + x, h, 0.36 - streak * 0.1 + tarnish * 0.44, col);
    }
  }
  return f;
}

/** Dark iron: fine directional scratches, pitting, dull grain. */
function buildMetal(S: number): Fields {
  const f = alloc(S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const l1 = sstep(0.028, 0, Math.abs(vnoise(u, v, 5, 120, 1401) - 0.5));
      const l2 = sstep(0.02, 0, Math.abs(vnoise(u, v, 130, 5, 1402) - 0.5)) * 0.6;
      const pit = sstep(0.78, 0.92, vnoise(u, v, 48, 48, 1403));
      const grain = fbm(u, v, 3, 1404, 30) * 0.15;
      const h = 0.55 + (l1 + l2) * 0.1 - pit * 0.3 + grain;
      let col = mix3([44, 49, 57], [70, 77, 88], sstep(0.4, 0.8, h));
      col = mix3(col, [16, 18, 22], pit);
      col = mix3(col, [96, 104, 116], (l1 + l2) * 0.5);
      put(f, y * S + x, h, 0.42 + (l1 + l2) * 0.12 + pit * 0.34, col);
    }
  }
  return f;
}

/** Ancient root bark: vertical fibres, deep grooves, moss patches. */
function buildBark(S: number): Fields {
  const f = alloc(S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const fiber = fbm2(u, v, 4, 801, 22, 3);
      const g = sstep(0.8, 0.95, ridge2(u, v, 3, 802, 9, 2));
      const mossM = sstep(0.6, 0.82, fbm(u, v, 3, 803, 4)) * 0.55;
      const h = 0.42 + fiber * 0.34 - g * 0.38;
      let col = mix3([38, 30, 22], [74, 60, 44], sstep(0.3, 0.8, h));
      col = mix3(col, [40, 70, 50], mossM);
      col = mix3(col, [18, 14, 10], g * 0.7);
      put(f, y * S + x, h, 0.92 - fiber * 0.05, col);
    }
  }
  return f;
}

const BUILDERS: Record<string, { build: (S: number) => Fields; bump: number }> = {
  rock: { build: buildRock, bump: 14 },
  brick: { build: buildBrick, bump: 16 },
  moss: { build: buildMoss, bump: 8 },
  lava: { build: buildLava, bump: 12 },
  gold: { build: buildGold, bump: 6 },
  metal: { build: buildMetal, bump: 9 },
  bark: { build: buildBark, bump: 12 },
};

// ---------------------------------------------------------------------------
// Field → canvas → texture pipeline
// ---------------------------------------------------------------------------

function makeCanvas(S: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("textures: 2D canvas context unavailable");
  return [c, ctx];
}

function blitRGB(ctx: CanvasRenderingContext2D, alb: Uint8ClampedArray, S: number): void {
  const img = ctx.createImageData(S, S);
  img.data.set(alb);
  ctx.putImageData(img, 0, 0);
}

function blitGray(ctx: CanvasRenderingContext2D, data: Float32Array, S: number): void {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const g = Math.round(clamp01(data[i]!) * 255);
    const j = i * 4;
    d[j] = g;
    d[j + 1] = g;
    d[j + 2] = g;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** OpenGL-style normal map (green = +v) from a height field, wrap-around Sobel. */
function normalCanvas(h: Float32Array, S: number, bump: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const k = bump * (S / 256);
  for (let y = 0; y < S; y++) {
    const yUp = ((y - 1 + S) % S) * S;
    const yDn = ((y + 1) % S) * S;
    const row = y * S;
    for (let x = 0; x < S; x++) {
      const xL = (x - 1 + S) % S;
      const xR = (x + 1) % S;
      const gx = (h[row + xR]! - h[row + xL]!) * k;
      const gy = (h[yDn + x]! - h[yUp + x]!) * k;
      const invLen = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const j = (row + x) * 4;
      d[j] = Math.round((-gx * invLen * 0.5 + 0.5) * 255);
      d[j + 1] = Math.round((gy * invLen * 0.5 + 0.5) * 255);
      d[j + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Separable box blur with wrap-around edges (keeps the map tileable). */
function blurWrap(src: Float32Array, S: number, r: number, passes: number): Float32Array {
  const cur = Float32Array.from(src);
  const tmp = new Float32Array(S * S);
  const w = r * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < S; y++) {
      const row = y * S;
      for (let x = 0; x < S; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += cur[row + ((x + k + S) % S)]!;
        tmp[row + x] = s / w;
      }
    }
    for (let x = 0; x < S; x++) {
      for (let y = 0; y < S; y++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[((y + k + S) % S) * S + x]!;
        cur[y * S + x] = s / w;
      }
    }
  }
  return cur;
}

function aoCanvas(h: Float32Array, S: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(S);
  const blurred = blurWrap(h, S, Math.max(3, Math.round(S / 32)), 2);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const cavity = Math.max(0, blurred[i]! - h[i]!) * 3.0;
    const ao = 0.45 + 0.55 * clamp01(1 - cavity);
    const g = Math.round(ao * 255);
    const j = i * 4;
    d[j] = g;
    d[j + 1] = g;
    d[j + 2] = g;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function finishTex(t: THREE.CanvasTexture, srgb: boolean): THREE.CanvasTexture {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; // clamped to device max by the renderer on upload
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const cache = new Map<string, PbrSet>();

/** PBR texture set for a named surface, generated once and cached. */
export function pbrSet(kind: string, size = 256): PbrSet {
  const key = `${kind}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = Math.max(32, Math.min(1024, Math.floor(size)));
  const def = BUILDERS[kind] ?? BUILDERS.rock!;
  const f = def.build(S);

  const [albCanvas, albCtx] = makeCanvas(S);
  blitRGB(albCtx, f.alb, S);
  const map = finishTex(new THREE.CanvasTexture(albCanvas), true);

  const normalMap = finishTex(new THREE.CanvasTexture(normalCanvas(f.h, S, def.bump)), false);
  const roughCanvas = makeCanvas(S);
  blitGray(roughCanvas[1], f.rough, S);
  const roughnessMap = finishTex(new THREE.CanvasTexture(roughCanvas[0]), false);
  const aoMap = finishTex(new THREE.CanvasTexture(aoCanvas(f.h, S)), false);

  const set: PbrSet = { map, normalMap, roughnessMap, aoMap };
  cache.set(key, set);
  return set;
}

/** Static emissive map for lava: glowing vein network on black (sRGB). */
export function lavaEmissiveTexture(size = 256): THREE.CanvasTexture {
  const S = Math.max(32, Math.min(1024, Math.floor(size)));
  const [c, ctx] = makeCanvas(S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const e = lavaEmissiveField(u, v);
      let col = mix3([26, 5, 2], [255, 92, 30], sstep(0.08, 0.62, e));
      col = mix3(col, [255, 210, 122], sstep(0.68, 0.98, e));
      const j = (y * S + x) * 4;
      d[j] = col[0];
      d[j + 1] = col[1];
      d[j + 2] = col[2];
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTex(new THREE.CanvasTexture(c), true);
}
