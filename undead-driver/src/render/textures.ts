import * as THREE from "three";
import { CONFIG } from "../config";

/**
 * Procedural texture factory (design D2). Two layers:
 *
 * - Pure math over Float32Array — seeded value noise, fBm, Sobel height→normal,
 *   radial falloff, and the per-surface generators. Deterministic (same seed →
 *   bit-identical buffer) and node-testable: importing this module never touches
 *   `document` (the canvas write is reached only through getSurfaceTexture /
 *   the radial one-offs, all runtime-lazy).
 * - Browser layer — writes a generated buffer into a canvas and caches the
 *   resulting CanvasTexture by identity (surface + kind + size + variant), so
 *   every map is generated exactly once (cache hit on second request).
 *
 * All caches are boot-populated (task 1.3 budgets generation); nothing here
 * runs in an update path, so allocation is irrelevant at steady state.
 * Every tunable (sizes, seeds, octaves, lacunarity, gain, strengths) lives in
 * CONFIG.textures — no magic numbers below.
 */

export type MapKind = "albedo" | "normal" | "roughness";

/** A generated map: interleaved channels per pixel, values in [0, 1]. */
export type SurfaceMap = { data: Float32Array; channels: 1 | 3 | 4 };

export type SurfaceName =
  | "asphalt"
  | "sand"
  | "metal"
  | "zombieWalker"
  | "zombieRunner"
  | "zombieBrute"
  | "carPaint"
  | "debris"
  | "foliage";

type MapGenerator = (size: number, seed: number) => SurfaceMap;

// ── seeded PRNG ──────────────────────────────────────────────────────────────

/**
 * mulberry32 — tiny, fast, deterministic integer PRNG. Identical seeds produce
 * identical sequences on every platform (pure int32/uint32 arithmetic).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Order-sensitive integer seed mixer (FNV-style) so composed seeds never collide. */
function mixSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h = Math.imul(h ^ (parts[i] | 0), 0x9e3779b1);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// ── noise primitives (pure, tileable) ────────────────────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Tileable value noise: `cells` random lattice points across the tile (wraps
 * for seamless tiling), bilinearly interpolated through smoothstep. `scale`
 * fields in CONFIG.textures map directly to `cells`.
 */
export function valueNoise(size: number, seed: number, cells: number, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(size * size);
  const rand = mulberry32(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  const step = size / cells;
  for (let y = 0; y < size; y++) {
    const fy = y / step;
    const y0 = Math.floor(fy);
    const ty = smoothstep(fy - y0);
    const y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = x / step;
      const x0 = Math.floor(fx);
      const tx = smoothstep(fx - x0);
      const x1 = (x0 + 1) % cells;
      const top = lattice[y0 * cells + x0] + (lattice[y0 * cells + x1] - lattice[y0 * cells + x0]) * tx;
      const bot = lattice[y1 * cells + x0] + (lattice[y1 * cells + x1] - lattice[y1 * cells + x0]) * tx;
      o[y * size + x] = top + (bot - top) * ty;
    }
  }
  return o;
}

/**
 * Fractal Brownian motion: octaves of value noise at growing frequency
 * (lacunarity) and shrinking amplitude (gain), amplitude-normalized so the
 * result stays in [0, 1]. Octave i uses seed + i*1013 (deterministic spread).
 */
export function fbm(
  size: number,
  seed: number,
  baseCells: number,
  octaves: number,
  lacunarity: number,
  gain: number,
  out?: Float32Array,
): Float32Array {
  const o = out ?? new Float32Array(size * size);
  const scratch = new Float32Array(size * size);
  o.fill(0);

  let totalWeight = 0;
  for (let i = 0; i < octaves; i++) totalWeight += Math.pow(gain, i);

  let cells = Math.max(1, Math.round(baseCells));
  for (let i = 0; i < octaves; i++) {
    const weight = Math.pow(gain, i) / totalWeight;
    valueNoise(size, seed + i * 1013, cells, scratch);
    for (let j = 0; j < o.length; j++) o[j] += scratch[j] * weight;
    cells = Math.max(1, Math.round(cells * lacunarity));
  }
  return o;
}

/**
 * Sobel height→normal conversion over a tileable height field. Output is
 * interleaved RGB, each channel encoded to [0, 1] via `v * 0.5 + 0.5`
 * (canvas-ready). Green follows the texture's +y (three.js/OpenGL convention).
 */
export function heightToNormal(height: Float32Array, size: number, strength: number, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(size * size * 3);
  const at = (x: number, y: number): number => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const nx = -gx * strength;
      const ny = -gy * strength;
      const len = Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * size + x) * 3;
      o[i] = 0.5 + (nx / len) * 0.5;
      o[i + 1] = 0.5 + (ny / len) * 0.5;
      o[i + 2] = 0.5 + (1 / len) * 0.5;
    }
  }
  return o;
}

/** Radial falloff (1 channel): 1 at center, 0 at tile edge, shaped by `power`. */
export function radialFalloff(size: number, power: number, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(size * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt(((x - c) / c) ** 2 + ((y - c) / c) ** 2);
      o[y * size + x] = Math.pow(Math.max(0, 1 - d), power);
    }
  }
  return o;
}

// ── shared generator helpers ─────────────────────────────────────────────────

type Rgb = [number, number, number];

const unpackHex = (hex: number): Rgb => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

/** Grayscale fBm height field. */
function heightField(size: number, seed: number, scale: number): Float32Array {
  const n = CONFIG.textures.noise;
  return fbm(size, seed, scale, n.octaves, n.lacunarity, n.gain);
}

/** Two-color fBm albedo blend. */
function blendAlbedo(size: number, seed: number, scale: number, low: number, high: number): SurfaceMap {
  const base = heightField(size, seed, scale);
  const lo = unpackHex(low);
  const hi = unpackHex(high);
  const data = new Float32Array(size * size * 3);
  for (let p = 0; p < size * size; p++) {
    const v = base[p];
    data[p * 3] = lo[0] + (hi[0] - lo[0]) * v;
    data[p * 3 + 1] = lo[1] + (hi[1] - lo[1]) * v;
    data[p * 3 + 2] = lo[2] + (hi[2] - lo[2]) * v;
  }
  return { data, channels: 3 };
}

/** Standard noise normal map from an fBm height field. */
function noiseNormal(size: number, seed: number, scale: number, strength: number): SurfaceMap {
  return { data: heightToNormal(heightField(size, seed, scale), size, strength), channels: 3 };
}

/** Roughness modulated around a base by an fBm field. */
function noiseRoughness(size: number, seed: number, scale: number, base: number, variance: number): SurfaceMap {
  const mod = heightField(size, seed, scale);
  const data = new Float32Array(size * size);
  for (let p = 0; p < size * size; p++) data[p] = clamp01(base + (mod[p] - 0.5) * 2 * variance);
  return { data, channels: 1 };
}

// ── surface generators ───────────────────────────────────────────────────────
// `seed` arriving here is the identity-mixed surface seed (see mapSeed);
// secondary fields (wear/burnt/scratch seeds) mix into it inside the generator.

/** Exemplar full PBR set: asphalt. Real generators — task 3.1 only re-tunes. */
export function generateAsphaltAlbedo(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.asphalt;
  const n = CONFIG.textures.noise;
  const base = heightField(size, seed, t.scale);
  const wear = fbm(size, mixSeed(seed, t.wearSeed), t.wearScale, n.octaves, n.lacunarity, n.gain);
  const speckle = valueNoise(size, mixSeed(seed, t.wearSeed, 7), Math.max(1, Math.round(size / 2)));
  const lo = unpackHex(t.albedoLow);
  const hi = unpackHex(t.albedoHigh);
  const data = new Float32Array(size * size * 3);
  for (let p = 0; p < size * size; p++) {
    const mixed = base[p] * (1 - t.wearAmount) + wear[p] * t.wearAmount;
    const v = clamp01(mixed + (speckle[p] - 0.5) * 0.12);
    data[p * 3] = lo[0] + (hi[0] - lo[0]) * v;
    data[p * 3 + 1] = lo[1] + (hi[1] - lo[1]) * v;
    data[p * 3 + 2] = lo[2] + (hi[2] - lo[2]) * v;
  }
  return { data, channels: 3 };
}

export function generateAsphaltNormal(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.asphalt;
  return noiseNormal(size, mixSeed(seed, 55), t.scale, t.normalStrength);
}

export function generateAsphaltRoughness(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.asphalt;
  // Tire-worn areas (low wear noise) polish smoother; aggregate speckle breaks it up.
  return noiseRoughness(size, mixSeed(seed, t.wearSeed), t.wearScale, t.roughBase, t.roughVariance);
}

// Stubs wired to config seeds — full PBR sets land with task 3.1.

function sandAlbedo(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.sand;
  return blendAlbedo(size, mixSeed(seed, 3), t.scale, t.albedoLow, t.albedoHigh);
}

function metalAlbedo(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.metal;
  const n = CONFIG.textures.noise;
  const rust = fbm(size, mixSeed(seed, 9), t.scale, n.octaves, n.lacunarity, n.gain);
  const burnt = fbm(size, mixSeed(seed, t.burntSeed), t.scale, n.octaves, n.lacunarity, n.gain);
  const base = unpackHex(t.albedoBase);
  const rustC = unpackHex(t.rustColor);
  const burntC = unpackHex(t.burntColor);
  const data = new Float32Array(size * size * 3);
  for (let p = 0; p < size * size; p++) {
    const r = clamp01(rust[p] * 1.4) * t.rustAmount;
    const b = clamp01(burnt[p] * 1.4 - 0.4) * t.burntAmount;
    for (let c = 0; c < 3; c++) {
      const withRust = base[c] + (rustC[c] - base[c]) * r;
      data[p * 3 + c] = withRust + (burntC[c] - withRust) * b;
    }
  }
  return { data, channels: 3 };
}

function skinAlbedo(size: number, seed: number, type: { mottle: number; tint: number }): SurfaceMap {
  const mottle = heightField(size, seed, CONFIG.textures.zombieSkin.scale);
  const tint = unpackHex(type.tint);
  const data = new Float32Array(size * size * 3);
  for (let p = 0; p < size * size; p++) {
    const v = 0.7 + (mottle[p] - 0.5) * 2 * type.mottle * 0.5;
    data[p * 3] = clamp01(tint[0] * v);
    data[p * 3 + 1] = clamp01(tint[1] * v);
    data[p * 3 + 2] = clamp01(tint[2] * v);
  }
  return { data, channels: 3 };
}

function skinRoughness(size: number, seed: number): SurfaceMap {
  return noiseRoughness(size, mixSeed(seed, 21), CONFIG.textures.zombieSkin.scale, 0.62, 0.2);
}

/** Grayscale flake + scratch detail overlay (material-side tint per D3). */
function paintDetail(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.carPaint;
  const flakes = valueNoise(size, mixSeed(seed, 5), Math.max(1, Math.round(size / 2)));
  const scratches = heightField(size, mixSeed(seed, t.scratchSeed), Math.round(t.scale / 3));
  const data = new Float32Array(size * size);
  for (let p = 0; p < size * size; p++) {
    data[p] = clamp01(
      0.5 + (flakes[p] - 0.5) * t.flakeAmount + (scratches[p] - 0.5) * 2 * t.scratchAmount,
    );
  }
  return { data, channels: 1 };
}

function foliageAlbedo(size: number, seed: number): SurfaceMap {
  const t = CONFIG.textures.foliage;
  const mask = heightField(size, seed, t.scale);
  const rgb = blendAlbedo(size, mixSeed(seed, 3), t.scale, t.albedoLow, t.albedoHigh);
  const data = new Float32Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    data[p * 4] = rgb.data[p * 3];
    data[p * 4 + 1] = rgb.data[p * 3 + 1];
    data[p * 4 + 2] = rgb.data[p * 3 + 2];
    data[p * 4 + 3] = mask[p] > t.alphaCut ? 1 : 0;
  }
  return { data, channels: 4 };
}

const GENERATORS: Record<SurfaceName, Record<MapKind, MapGenerator>> = {
  asphalt: {
    albedo: generateAsphaltAlbedo,
    normal: generateAsphaltNormal,
    roughness: generateAsphaltRoughness,
  },
  sand: {
    albedo: sandAlbedo,
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.sand.scale, CONFIG.textures.sand.normalStrength),
    roughness: (s, seed) => noiseRoughness(s, mixSeed(seed, 21), CONFIG.textures.sand.scale, CONFIG.textures.sand.roughBase, 0.1),
  },
  metal: {
    albedo: metalAlbedo,
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.metal.scale, CONFIG.textures.metal.normalStrength),
    roughness: (s, seed) => noiseRoughness(s, mixSeed(seed, 21), CONFIG.textures.metal.scale, CONFIG.textures.metal.roughBase, 0.25),
  },
  zombieWalker: {
    albedo: (s, seed) => skinAlbedo(s, seed, CONFIG.textures.zombieSkin.walker),
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.zombieSkin.scale, CONFIG.textures.zombieSkin.normalStrength),
    roughness: skinRoughness,
  },
  zombieRunner: {
    albedo: (s, seed) => skinAlbedo(s, seed, CONFIG.textures.zombieSkin.runner),
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.zombieSkin.scale, CONFIG.textures.zombieSkin.normalStrength),
    roughness: skinRoughness,
  },
  zombieBrute: {
    albedo: (s, seed) => skinAlbedo(s, seed, CONFIG.textures.zombieSkin.brute),
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.zombieSkin.scale, CONFIG.textures.zombieSkin.normalStrength),
    roughness: skinRoughness,
  },
  carPaint: {
    albedo: paintDetail, // grayscale detail overlay; paint color lives on the material
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.carPaint.scale, CONFIG.textures.carPaint.normalStrength),
    roughness: paintDetail,
  },
  debris: {
    albedo: (s, seed) => blendAlbedo(s, mixSeed(seed, 3), CONFIG.textures.debris.scale, CONFIG.textures.debris.albedoLow, CONFIG.textures.debris.albedoHigh),
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.debris.scale, 0.9),
    roughness: (s, seed) => noiseRoughness(s, mixSeed(seed, 21), CONFIG.textures.debris.scale, 0.8, 0.15),
  },
  foliage: {
    albedo: foliageAlbedo,
    normal: (s, seed) => noiseNormal(s, mixSeed(seed, 55), CONFIG.textures.foliage.scale, 0.6),
    roughness: (s, seed) => noiseRoughness(s, mixSeed(seed, 21), CONFIG.textures.foliage.scale, 0.85, 0.1),
  },
};

// ── caches ───────────────────────────────────────────────────────────────────

const SURFACE_BASE_SEED: Record<SurfaceName, number> = {
  asphalt: CONFIG.textures.asphalt.seed,
  sand: CONFIG.textures.sand.seed,
  metal: CONFIG.textures.metal.seed,
  zombieWalker: CONFIG.textures.zombieSkin.walker.seed,
  zombieRunner: CONFIG.textures.zombieSkin.runner.seed,
  zombieBrute: CONFIG.textures.zombieSkin.brute.seed,
  carPaint: CONFIG.textures.carPaint.seed,
  debris: CONFIG.textures.debris.seed,
  foliage: CONFIG.textures.foliage.seed,
};

const KIND_SEED_OFFSET: Record<MapKind, number> = { albedo: 0, normal: 1013, roughness: 2027 };

function mapSeed(surface: SurfaceName, kind: MapKind, variant: number): number {
  return mixSeed(CONFIG.textures.masterSeed, SURFACE_BASE_SEED[surface], KIND_SEED_OFFSET[kind], variant);
}

function identityKey(surface: SurfaceName, kind: MapKind, size: number, variant: number): string {
  return `${surface}|${kind}|${size}|${variant}`;
}

/** Pure-layer cache (node-testable): identity → generated buffer, exactly once. */
const bufferCache = new Map<string, SurfaceMap>();

export function getSurfaceBuffer(
  surface: SurfaceName,
  kind: MapKind,
  size: number = CONFIG.textures.defaultSize,
  variant = 0,
): SurfaceMap {
  const key = identityKey(surface, kind, size, variant);
  const hit = bufferCache.get(key);
  if (hit) return hit;
  const map = GENERATORS[surface][kind](size, mapSeed(surface, kind, variant));
  bufferCache.set(key, map);
  return map;
}

// ── browser canvas layer (never executed in node) ────────────────────────────

/** CanvasTexture cache: same identity → same texture object (generated once). */
const textureCache = new Map<string, THREE.CanvasTexture>();

function mapToCanvas(map: SurfaceMap, size: number): HTMLCanvasElement {
  // `document` is touched only inside this function — importing the module in
  // node stays side-effect free.
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("textures: 2d canvas context unavailable");
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const { data, channels } = map;
  for (let p = 0; p < size * size; p++) {
    const o = p * 4;
    const i = p * channels;
    if (channels === 1) {
      const v = (data[i] * 255) | 0;
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
      px[o + 3] = 255;
    } else if (channels === 3) {
      px[o] = (data[i] * 255) | 0;
      px[o + 1] = (data[i + 1] * 255) | 0;
      px[o + 2] = (data[i + 2] * 255) | 0;
      px[o + 3] = 255;
    } else {
      px[o] = (data[i] * 255) | 0;
      px[o + 1] = (data[i + 1] * 255) | 0;
      px[o + 2] = (data[i + 2] * 255) | 0;
      px[o + 3] = (data[i + 3] * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(map: SurfaceMap, key: string, kind: MapKind, size: number): THREE.CanvasTexture {
  const hit = textureCache.get(key);
  if (hit) return hit;
  const tex = new THREE.CanvasTexture(mapToCanvas(map, size));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = kind === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = CONFIG.textures.anisotropy;
  textureCache.set(key, tex);
  return tex;
}

/** Cached CanvasTexture for a surface map. Browser-only (needs `document`). */
export function getSurfaceTexture(
  surface: SurfaceName,
  kind: MapKind,
  size: number = CONFIG.textures.defaultSize,
  variant = 0,
): THREE.CanvasTexture {
  return toTexture(getSurfaceBuffer(surface, kind, size, variant), identityKey(surface, kind, size, variant), kind, size);
}

function getRadialTexture(key: string, size: number, power: number): THREE.CanvasTexture {
  const hit = textureCache.get(key);
  if (hit) return hit;
  const map: SurfaceMap = { data: radialFalloff(size, power), channels: 1 };
  return toTexture(map, key, "roughness", size);
}

/** Additive beam-cone falloff map (lamp heads, headlights — tasks 2.2/4.x). */
export function getBeamFalloffTexture(): THREE.CanvasTexture {
  const t = CONFIG.textures.beamFalloff;
  return getRadialTexture(`beam|${t.size}|${t.falloffPow}`, t.size, t.falloffPow);
}

/** Lamp light-pool decal map (task 2.2). */
export function getLightPoolTexture(): THREE.CanvasTexture {
  const t = CONFIG.textures.lightPool;
  return getRadialTexture(`pool|${t.size}|${t.falloffPow}`, t.size, t.falloffPow);
}
