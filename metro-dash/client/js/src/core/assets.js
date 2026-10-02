/**
 * @file core/assets.js
 * Procedural PBR texture system + shared MaterialLibrary singleton.
 *
 * Zero external assets: every material is generated at boot into <canvas>
 * elements and wrapped in THREE.CanvasTexture sets
 * ({ map, normalMap, roughnessMap, aoMap }). Normal maps are derived from a
 * shared height field via a Sobel filter. Everything is cached by key so a
 * texture generates exactly once; total generation stays well under the
 * 300 ms boot budget (8 sets x 512px).
 *
 * Conventions:
 *  - albedo: SRGBColorSpace; normal/roughness/ao: NoColorSpace (linear).
 *  - RepeatWrapping everywhere; anisotropy = min(8, renderer max).
 *  - Materials are MeshStandardMaterial with physically plausible
 *    metalness/roughness; geometry UVs are expected to be sized to real
 *    world metres (see fitBoxUVs/fitPlaneUVs) so texel density is uniform.
 */
import * as THREE from "three";

// ------------------------------------------------------------
// Small pixel/noise toolkit
// ------------------------------------------------------------

/** @param {number} size @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}} */
function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  return { canvas, ctx };
}

/** Fast integer hash -> float in [0,1). */
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

const wrapN = (n, p) => ((n % p) + p) % p;

/**
 * Tileable 2D value noise. u,v live in [0,1) and the integer lattice wraps
 * per axis (fu, fv), so every texture generated from it is seamlessly
 * tileable on both axes — no edge seams at repeat boundaries.
 */
function vnoiseT(u, v, fu, fv, seed) {
  const x = u * fu;
  const y = v * fv;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const x0 = wrapN(ix, fu);
  const x1 = wrapN(ix + 1, fu);
  const y0 = wrapN(iy, fv);
  const y1 = wrapN(iy + 1, fv);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Tileable fbm: octave o samples at per-axis frequencies (fu, fv) << o,
 * which stay integers, preserving seamless wrapping at every octave.
 * @param {number} u @param {number} v Normalized [0,1) coordinates.
 * @param {number} seed @param {number} octaves
 * @param {number} fu Base frequency along u. @param {number} [fv] Along v.
 * @returns {number} In [0,1].
 */
function fbmT(u, v, seed, octaves, fu, fv = fu) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoiseT(u, v, fu << o, fv << o, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Sobel-filter a Float32 height field into a tangent-space normal map.
 * Green channel follows the OpenGL convention (+Y = +V; CanvasTexture is
 * flipY, so +V is canvas-up), giving correct bump direction under raking
 * light.
 * @param {Float32Array} h Height field (size x size, values ~[0,1]).
 * @param {number} size
 * @param {number} strength Slope multiplier.
 * @returns {Uint8ClampedArray} RGBA bytes.
 */
function heightToNormalRGBA(h, size, strength) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yUp = (y === 0 ? size - 1 : y - 1) * size; // canvas up = texture +V
    const yDn = (y === size - 1 ? 0 : y + 1) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xL = x === 0 ? size - 1 : x - 1;
      const xR = x === size - 1 ? 0 : x + 1;
      const dx = (h[yc + xL] - h[yc + xR]) * strength;
      // flipY canvas: +V (normal-map green) points up the image, i.e. -y.
      // n.y ∝ dh/dy places bumps outward from peaks (OpenGL green-up).
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

/** Float field [0,1] -> grayscale RGBA bytes. */
function grayToRGBA(field, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    const v = clamp01(field[i]) * 255;
    const j = i * 4;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

/** Fill RGB with a grey value + optional per-channel tint. */
function setRGB(data, i, r, g, b) {
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
}

// ------------------------------------------------------------
// Texture factory
// ------------------------------------------------------------

/**
 * A generated PBR texture set.
 * @typedef {object} PbrSet
 * @property {THREE.CanvasTexture} map
 * @property {THREE.CanvasTexture} normalMap
 * @property {THREE.CanvasTexture} roughnessMap
 * @property {THREE.CanvasTexture=} aoMap
 */

/**
 * TextureFactory renders PBR sets into canvases. Height fields are shared
 * between the normal, roughness and AO derivations.
 */
class TextureFactory {
  /**
   * @param {number} maxAnisotropy Renderer max anisotropy (capped at 8).
   */
  constructor(maxAnisotropy = 8) {
    this.maxAnisotropy = Math.min(8, maxAnisotropy);
    /** @type {Map<string, PbrSet>} */
    this.cache = new Map();
    /** @type {Map<string, THREE.CanvasTexture>} Single-canvas textures. */
    this.canvasCache = new Map();
    this.generationMs = 0;
  }

  /**
   * Build (or fetch from cache) a PBR set.
   * @param {string} key Cache key.
   * @param {{size?: number, seed?: number,
   *   albedo: (data: Uint8ClampedArray, size: number, height: Float32Array) => void,
   *   height: (h: Float32Array, size: number) => void,
   *   roughness: (r: Float32Array, size: number, height: Float32Array) => void,
   *   normalStrength?: number, withAo?: boolean, aoFromHeight?: (v: number) => number}} spec
   * @returns {PbrSet}
   */
  getSet(key, spec) {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const t0 = performance.now();
    const size = spec.size || 512;
    const seed = spec.seed || 1;

    // Shared height field.
    const height = new Float32Array(size * size);
    spec.height(height, size);

    // Albedo.
    const albedoData = new Uint8ClampedArray(size * size * 4);
    spec.albedo(albedoData, size, height);
    // Default alpha.
    for (let i = 3; i < albedoData.length; i += 4) albedoData[i] = 255;

    // Roughness.
    const roughField = new Float32Array(size * size);
    spec.roughness(roughField, size, height);

    const set = {
      map: this._tex(albedoData, size, THREE.SRGBColorSpace),
      normalMap: this._tex(
        heightToNormalRGBA(height, size, spec.normalStrength ?? 2.5),
        size,
        THREE.NoColorSpace,
      ),
      roughnessMap: this._tex(grayToRGBA(roughField, size), size, THREE.NoColorSpace),
    };
    if (spec.withAo) {
      const f = spec.aoFromHeight || ((v) => 0.55 + 0.45 * v);
      const ao = new Float32Array(size * size);
      for (let i = 0; i < ao.length; i++) ao[i] = f(height[i]);
      set.aoMap = this._tex(grayToRGBA(ao, size), size, THREE.NoColorSpace);
      set.aoMap.channel = 0; // use base UVs (no uv1 attribute required)
    }

    this.cache.set(key, set);
    this.generationMs += performance.now() - t0;
    return set;
  }

  /**
   * Wrap RGBA bytes into a tiled CanvasTexture.
   * @param {Uint8ClampedArray} rgba
   * @param {number} size
   * @param {string} colorSpace
   * @returns {THREE.CanvasTexture}
   * @private
   */
  _tex(rgba, size, colorSpace) {
    const { canvas, ctx } = makeCanvas(size);
    ctx.putImageData(new ImageData(rgba, size, size), 0, 0);
    return this._wrapCanvas(canvas, colorSpace);
  }

  /**
   * Wrap a pre-existing canvas into a texture with factory defaults.
   * @param {HTMLCanvasElement} canvas
   * @param {string} colorSpace
   * @returns {THREE.CanvasTexture}
   * @private
   */
  _wrapCanvas(canvas, colorSpace) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = colorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Build (or fetch from cache) a single CanvasTexture drawn with the 2D
   * canvas API (facades, posters, painted road...). All client textures stay
   * inside the factory so color spaces / anisotropy / caching stay uniform.
   * @param {string} key Cache key.
   * @param {{width: number, height: number, colorSpace?: string,
   *   draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void}} spec
   * @returns {THREE.CanvasTexture}
   */
  getCanvas(key, spec) {
    const cached = this.canvasCache.get(key);
    if (cached) return cached;
    const t0 = performance.now();
    const { canvas, ctx } = makeCanvas(spec.width);
    canvas.height = spec.height;
    spec.draw(ctx, spec.width, spec.height);
    const tex = this._wrapCanvas(canvas, spec.colorSpace || THREE.SRGBColorSpace);
    this.canvasCache.set(key, tex);
    this.generationMs += performance.now() - t0;
    return tex;
  }

  /**
   * Build (or fetch from cache) TWO canvases drawn in a single pass (facade
   * albedo + emissive window mask share their random decisions).
   * @param {string} key Cache key.
   * @param {{width: number, height: number,
   *   drawPair: (ctxA: CanvasRenderingContext2D, ctxB: CanvasRenderingContext2D, w: number, h: number) => void,
   *   colorSpace?: string, colorSpaceB?: string}} spec
   * @returns {[THREE.CanvasTexture, THREE.CanvasTexture]} [albedo, secondary]
   */
  getCanvasPair(key, spec) {
    const cached = this.canvasCache.get(key);
    if (cached) return cached;
    const t0 = performance.now();
    const a = makeCanvas(spec.width);
    a.canvas.height = spec.height;
    const b = makeCanvas(spec.width);
    b.canvas.height = spec.height;
    spec.drawPair(a.ctx, b.ctx, spec.width, spec.height);
    const pair = [
      this._wrapCanvas(a.canvas, spec.colorSpace || THREE.SRGBColorSpace),
      this._wrapCanvas(b.canvas, spec.colorSpaceB || THREE.NoColorSpace),
    ];
    this.canvasCache.set(key, pair);
    this.generationMs += performance.now() - t0;
    return pair;
  }
}

// ------------------------------------------------------------
// Per-material pixel generators
// ------------------------------------------------------------

/**
 * Scatter clumped stone clusters into albedo/height (ballast, asphalt).
 * Stones gather around cluster centers with soft blended edges (mip-safe:
 * no isolated bright specks, no hard cutoffs that shimmer mid-distance).
 * @param {Float32Array} height
 * @param {Uint8ClampedArray} rgb
 * @param {number} size
 * @param {number} seed
 * @param {{clusters: number, perCluster: number, rMin: number, rMax: number,
 *   spread: number, colMin: number[], colMax: number[]}} opts
 */
function stampStones(height, rgb, size, seed, opts) {
  const { clusters, perCluster, rMin, rMax, spread, colMin, colMax } = opts;
  for (let c = 0; c < clusters; c++) {
    const ccx = hash2(c, 1, seed) * size;
    const ccy = hash2(c, 2, seed) * size;
    for (let s = 0; s < perCluster; s++) {
      const ang = hash2(s, c, seed + 11) * Math.PI * 2;
      const dist = Math.sqrt(hash2(s, c, seed + 23)) * spread;
      const cx = ccx + Math.cos(ang) * dist;
      const cy = ccy + Math.sin(ang) * dist;
      const r = lerp(rMin, rMax, hash2(s, c, seed + 37));
      const shade = hash2(s, c, seed + 41);
      const cr = lerp(colMin[0], colMax[0], shade);
      const cg = lerp(colMin[1], colMax[1], shade);
      const cb = lerp(colMin[2], colMax[2], shade);
      const rr = Math.ceil(r);
      for (let dy = -rr; dy <= rr; dy++) {
        const py = wrapN(Math.floor(cy) + dy, size);
        for (let dx = -rr; dx <= rr; dx++) {
          const px = wrapN(Math.floor(cx) + dx, size);
          const d = Math.sqrt(dx * dx + dy * dy) / r;
          if (d >= 1) continue;
          // Soft rim: full stone inside, feathered blend over outer 30%.
          const t = smooth(clamp01((1 - d) / 0.3));
          const dome = Math.sqrt(1 - d * d);
          // Top-left key light + rim darkening, capped so nothing blows out.
          const light = clamp(
            1.0 + ((dx - dy) / (r * 2.4)) * 0.45 - (1 - dome) * 0.3,
            0.62,
            1.28,
          );
          const i = (py * size + px) * 4;
          const sr = clamp01((cr * light) / 255) * 255;
          const sg = clamp01((cg * light) / 255) * 255;
          const sb = clamp01((cb * light) / 255) * 255;
          rgb[i] = rgb[i] * (1 - t) + sr * t;
          rgb[i + 1] = rgb[i + 1] * (1 - t) + sg * t;
          rgb[i + 2] = rgb[i + 2] * (1 - t) + sb * t;
          const hVal = dome * t + 0.1 * (1 - t);
          if (hVal > height[py * size + px]) height[py * size + px] = hVal;
        }
      }
    }
  }
}

/** Dark crack random-walk stamped into albedo + height. */
function stampCrack(height, rgb, size, seed, x0, y0, steps, stepLen, darkness) {
  let x = x0;
  let y = y0;
  let ang = hash2(seed, 7, seed) * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    ang += (hash2(s, seed, seed * 3 + 11) - 0.5) * 0.9;
    x += Math.cos(ang) * stepLen;
    y += Math.sin(ang) * stepLen;
    const xi = ((Math.floor(x) % size) + size) % size;
    const yi = ((Math.floor(y) % size) + size) % size;
    const w = 1 + (hash2(s, 5, seed) > 0.7 ? 1 : 0);
    for (let oy = 0; oy < w; oy++) {
      for (let ox = 0; ox < w; ox++) {
        const px = (xi + ox) % size;
        const py = (yi + oy) % size;
        const i = (py * size + px) * 4;
        rgb[i] *= 1 - darkness;
        rgb[i + 1] *= 1 - darkness;
        rgb[i + 2] *= 1 - darkness;
        height[py * size + px] *= 1 - darkness * 0.85;
      }
    }
  }
}

const GENERATORS = {
  /**
   * Railway ballast: dark grey-brown crushed stone in clumped piles, strong
   * height relief. Stones are 2.5-6 cm at the track's texel density.
   */
  ballast: {
    size: 512,
    normalStrength: 4.2,
    withAo: true,
    height(h, size) {
      for (let i = 0; i < h.length; i++) h[i] = 0.1; // deep crevices
    },
    albedo(rgb, size, height) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const i = (y * size + x) * 4;
          const n = fbmT(u, v, 31, 3, 6);
          const base = 96 + n * 34; // sunlit mid grey-brown so shadows read
          setRGB(rgb, i, base * 1.06, base, base * 0.9);
        }
      }
      stampStones(height, rgb, size, 77, {
        clusters: 60,
        perCluster: 84,
        rMin: 7,
        rMax: 16,
        spread: 18,
        colMin: [84, 79, 72],
        colMax: [128, 122, 112],
      });
    },
    roughness(r, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          r[y * size + x] = 0.88 + fbmT(x / size, v, 5, 2, 10) * 0.1;
        }
      }
    },
  },

  /**
   * Aged concrete: subtle stains and pores, precast formwork panel joints
   * (2 horizontal + 1 vertical line per tile) so wall repeats read as
   * intentional panels. Fully tileable.
   */
  concrete: {
    size: 512,
    normalStrength: 1.4,
    withAo: true,
    height(h, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          h[y * size + x] =
            0.6 + fbmT(u, v, 90, 3, 10) * 0.22 + fbmT(u, v, 91, 2, 48) * 0.18;
        }
      }
    },
    albedo(rgb, size, height) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const u = x / size;
          const stain = fbmT(u, v, 93, 2, 3);
          const grain = fbmT(u, v, 94, 2, 40);
          let val = 132 + grain * 22 - (1 - stain) * 20;
          val *= lerp(0.94, 1.06, fbmT(u, v, 95, 2, 7));
          setRGB(rgb, i, val * 0.97, val * 0.99, val * 0.95);
        }
      }
      // Formwork joints: groove (dark + height dip) with a bright drip edge.
      const grooveRow = (ry) => {
        for (let x = 0; x < size; x++) {
          for (let o = 0; o < 3; o++) {
            const y = wrapN(ry + o, size);
            const i = (y * size + x) * 4;
            const k = o === 2 ? 1.1 : 0.78;
            rgb[i] *= k;
            rgb[i + 1] *= k;
            rgb[i + 2] *= k;
            if (o < 2) height[y * size + x] *= 0.7;
          }
        }
      };
      grooveRow(0);
      grooveRow(size / 2);
      for (let y = 0; y < size; y++) {
        for (let o = 0; o < 2; o++) {
          const x = wrapN(size / 2 + o, size);
          const i = (y * size + x) * 4;
          const k = o === 1 ? 1.08 : 0.84;
          rgb[i] *= k;
          rgb[i + 1] *= k;
          rgb[i + 2] *= k;
          if (o === 0) height[y * size + x] *= 0.78;
        }
      }
      // Hairline cracks, subtle.
      for (let c = 0; c < 4; c++) {
        stampCrack(height, rgb, size, 100 + c, hash2(c, 9, 99) * size, hash2(c, 8, 99) * size, 90, 3.2, 0.38);
      }
    },
    roughness(r, size, height) {
      for (let i = 0; i < r.length; i++) r[i] = 0.86 + (1 - height[i]) * 0.1;
    },
  },

  /**
   * Brushed/scuffed metal: anisotropic streaks along X, tileable.
   */
  brushedMetal: {
    size: 512,
    normalStrength: 0.8,
    height(h, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          h[y * size + x] =
            0.5 + (vnoiseT(u, v, 6, 200, 7) - 0.5) * 0.5 + (fbmT(u, v, 8, 2, 5) - 0.5) * 0.3;
        }
      }
    },
    albedo(rgb, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const streak = vnoiseT(u, v, 6, 200, 7);
          const blotch = fbmT(u, v, 9, 3, 4);
          const val = 112 + streak * 24 + (blotch - 0.5) * 22;
          const i = (y * size + x) * 4;
          setRGB(rgb, i, val, val * 1.005, val * 1.02);
        }
      }
    },
    roughness(r, size, height) {
      for (let i = 0; i < r.length; i++) r[i] = 0.26 + (1 - height[i]) * 0.24;
    },
  },

  /**
   * Painted steel: chipped paint revealing primer, rust blooms. Tileable.
   * The chip/rust noise fields are computed once in height() and cached in
   * _fields for reuse by albedo() (halves generation cost).
   */
  paintedSteel: {
    size: 512,
    normalStrength: 2.2,
    withAo: true,
    _fields: null,
    height(h, size) {
      const chip = new Float32Array(size * size);
      const rust = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const i = y * size + x;
          const chipN = fbmT(u, v, 41, 4, 9);
          const rustN = fbmT(u, v, 42, 3, 5);
          chip[i] = chipN;
          rust[i] = rustN;
          let val = 0.9;
          if (chipN > 0.62) val = 0.62 - (chipN - 0.62) * 1.4; // chips recessed
          if (rustN > 0.68) val = Math.min(val, 0.72);
          h[i] = clamp01(val + (fbmT(u, v, 43, 2, 30) - 0.5) * 0.08);
        }
      }
      this._fields = { chip, rust };
    },
    albedo(rgb, size) {
      // Transit-orange paint, grey primer, brown rust.
      const paint = [214, 118, 30];
      const primer = [122, 120, 116];
      const rust = [118, 72, 40];
      const { chip, rust: rustF } = this._fields;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const chipN = chip[y * size + x];
          const rustN = rustF[y * size + x];
          const wear = fbmT(x / size, v, 44, 2, 28);
          let c = paint;
          if (chipN > 0.62) c = chipN > 0.74 ? rust : primer;
          else if (rustN > 0.7) c = rust;
          const l = lerp(0.9, 1.08, wear);
          setRGB(rgb, i, c[0] * l, c[1] * l, c[2] * l);
        }
      }
    },
    roughness(r, size, height) {
      // Derived from the shared height field (paint/primer/rust zones are
      // already encoded there) instead of recomputing the noise fields.
      for (let i = 0; i < r.length; i++) {
        const h = height[i];
        r[i] = h > 0.8 ? 0.42 : h > 0.66 ? 0.8 : h < 0.56 ? 0.86 : 0.6;
      }
    },
  },

  /**
   * Aged wood sleepers: grain along X (integer ring cycles so the sine
   * phase wraps), cracks, muted creosote-brown fade.
   */
  wood: {
    size: 512,
    normalStrength: 2.4,
    withAo: true,
    height(h, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const rings = Math.sin((u * 5 + fbmT(u, v, 61, 2, 4) * 0.8) * Math.PI * 2) * 0.5 + 0.5;
          const grain = vnoiseT(u, v, 64, 4, 62);
          h[y * size + x] = clamp01(0.45 + rings * 0.3 + (grain - 0.5) * 0.35);
        }
      }
    },
    albedo(rgb, size, height) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const u = x / size;
          const h = height[y * size + x];
          const weather = fbmT(u, v, 63, 2, 5);
          // Aged creosote brown: dark, muted saturation, slightly warm.
          const r = lerp(50, 86, h) * lerp(0.9, 1.06, weather);
          const g = lerp(44, 74, h) * lerp(0.9, 1.06, weather);
          const b = lerp(38, 58, h) * lerp(0.9, 1.06, weather);
          setRGB(rgb, i, r, g, b);
        }
      }
      for (let c = 0; c < 4; c++) {
        stampCrack(height, rgb, size, 70 + c, 0, hash2(c, 3, 71) * size, 130, 4, 0.55);
      }
    },
    roughness(r, size, height) {
      for (let i = 0; i < r.length; i++) r[i] = 0.78 + (1 - height[i]) * 0.16;
    },
  },

  /**
   * Red brick with recessed mortar. Pattern arithmetic wraps per tile.
   */
  brick: {
    size: 512,
    normalStrength: 3.6,
    withAo: true,
    // Brick layout constants (texels).
    rowH: 64,
    brickW: 128,
    mortar: 9,
    height(h, size) {
      const { rowH, brickW, mortar } = GENERATORS.brick;
      for (let y = 0; y < size; y++) {
        const row = Math.floor(y / rowH);
        const yIn = y - row * rowH;
        const offset = row % 2 ? brickW / 2 : 0;
        for (let x = 0; x < size; x++) {
          const xIn = (x + offset) % brickW;
          const edgeX = Math.min(xIn, brickW - xIn);
          const edgeY = Math.min(yIn, rowH - yIn);
          const edge = Math.min(edgeX, edgeY);
          const bump = fbmT(x / size, y / size, 81, 2, 24) * 0.1;
          if (edge < mortar) {
            h[y * size + x] = 0.28 + (edge / mortar) * 0.2 + bump;
          } else {
            h[y * size + x] = 0.72 + bump;
          }
        }
      }
    },
    albedo(rgb, size, height) {
      const { rowH, brickW, mortar } = GENERATORS.brick;
      for (let y = 0; y < size; y++) {
        const row = Math.floor(y / rowH);
        const offset = row % 2 ? brickW / 2 : 0;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const xIn = (x + offset) % brickW;
          const edge = Math.min(xIn, brickW - xIn, y - row * rowH, rowH - (y - row * rowH));
          if (edge < mortar) {
            const m = 128 + fbmT(x / size, y / size, 82, 2, 18) * 34;
            setRGB(rgb, i, m * 0.98, m * 0.97, m * 0.92);
          } else {
            const brickId = Math.floor((x + offset) / brickW) * 7 + row * 13;
            const jitter = hash2(brickId, 3, 83);
            const soot = fbmT(x / size, y / size, 84, 3, 3);
            const r = lerp(118, 168, jitter) * lerp(0.72, 1.05, soot);
            const g = lerp(52, 82, jitter) * lerp(0.75, 1.05, soot);
            const b = lerp(40, 62, jitter) * lerp(0.78, 1.05, soot);
            setRGB(rgb, i, r, g, b);
          }
        }
      }
    },
    roughness(r, size, height) {
      for (let i = 0; i < r.length; i++) r[i] = height[i] > 0.6 ? 0.82 : 0.95;
    },
    aoFromHeight: (v) => clamp01(0.5 + (v - 0.28) * 0.9),
  },

  /**
   * Asphalt: dark aggregate with lighter worn patches.
   */
  asphalt: {
    size: 512,
    normalStrength: 1.8,
    withAo: true,
    height(h, size) {
      for (let i = 0; i < h.length; i++) h[i] = 0.2;
    },
    albedo(rgb, size, height) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const u = x / size;
          const wear = fbmT(u, v, 52, 3, 4);
          const val = 46 + wear * 22 + fbmT(u, v, 53, 2, 40) * 9;
          setRGB(rgb, i, val, val * 0.99, val * 0.96);
        }
      }
      stampStones(height, rgb, size, 55, {
        clusters: 150,
        perCluster: 14,
        rMin: 1.2,
        rMax: 2.8,
        spread: 36,
        colMin: [62, 63, 66],
        colMax: [86, 88, 92],
      });
    },
    roughness(r, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          r[y * size + x] = 0.86 + fbmT(x / size, v, 56, 2, 14) * 0.1;
        }
      }
    },
  },

  /**
   * Corrugated metal: sine ridges along X (integer cycles -> seamless),
   * galvanized streaks.
   */
  corrugated: {
    size: 512,
    normalStrength: 4.5,
    height(h, size) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const wave = (Math.sin(u * Math.PI * 2 * 8) * 0.5 + 0.5) ** 1.4;
          h[y * size + x] = clamp01(wave * 0.9 + vnoiseT(u, v, 24, 3, 65) * 0.1);
        }
      }
    },
    albedo(rgb, size, height) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const u = x / size;
          const h = height[y * size + x];
          const grime = fbmT(u, v, 66, 3, 4);
          const val = lerp(92, 168, h) * lerp(0.8, 1.06, grime);
          setRGB(rgb, i, val * 0.98, val, val * 1.02);
        }
      }
    },
    roughness(r, size, height) {
      for (let i = 0; i < r.length; i++) r[i] = 0.34 + (1 - height[i]) * 0.2;
    },
  },

  /**
   * Worn diamond tread plate (ramps): raised lozenges in a staggered grid,
   * scuffed bare metal, and one painted yellow chevron band per tile (the
   * grip/grip direction marking). Tileable on both axes.
   */
  treadPlate: {
    size: 512,
    normalStrength: 3.4,
    withAo: true,
    height(h, size) {
      const cell = size / 4; // 4 lozenge rows per tile
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const row = Math.floor(y / cell);
          const offset = row % 2 ? cell / 2 : 0;
          const lx = ((x + offset) % cell) / cell - 0.5;
          const ly = (y % cell) / cell - 0.5;
          // Rotated lozenge distance (45 deg diamond).
          const d = Math.abs(lx + ly) / 1.414 + Math.abs(lx - ly) / 1.414;
          const lobe = clamp01(1 - d * 2.6);
          const base = 0.34 + fbmT(x / size, y / size, 120, 2, 26) * 0.12;
          h[y * size + x] = clamp01(base + lobe * 0.62);
        }
      }
    },
    albedo(rgb, size, height) {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const i = (y * size + x) * 4;
          const h = height[y * size + x];
          const wear = fbmT(u, v, 121, 3, 5);
          // Worn galvanized steel with darker scuffed valleys.
          const val = lerp(96, 152, h) * lerp(0.82, 1.06, wear);
          setRGB(rgb, i, val, val * 1.004, val * 1.012);
        }
      }
      // Yellow chevron band across the middle of the tile (points -v = up
      // the slope when v runs along it), worn by foot traffic.
      const bandC = size * 0.5;
      const bandH = size * 0.16;
      for (let y = bandC - bandH; y < bandC + bandH; y++) {
        for (let x = 0; x < size; x++) {
          const t = (x / size) * 4; // 4 chevrons per tile
          const cx = (t - Math.floor(t)) * 2 - 1; // -1..1 per chevron
          const cy = (y - bandC) / bandH;
          const edge = Math.abs(Math.abs(cx) * 0.85 + cy * 0.5 - 0.35);
          const inChevron = edge < 0.16 ? 1 : 0;
          if (!inChevron) continue;
          const i = (y * size + x) * 4;
          const worn = 0.55 + fbmT(x / size, y / size, 122, 2, 30) * 0.45;
          const r = 216 * worn;
          const g = 172 * worn;
          const b = 44 * worn;
          rgb[i] = rgb[i] * (1 - 0.85) + r * 0.85;
          rgb[i + 1] = rgb[i + 1] * (1 - 0.85) + g * 0.85;
          rgb[i + 2] = rgb[i + 2] * (1 - 0.85) + b * 0.85;
        }
      }
    },
    roughness(r, size, height) {
      for (let i = 0; i < r.length; i++) r[i] = 0.44 + (1 - height[i]) * 0.3;
    },
    aoFromHeight: (v) => clamp01(0.55 + (v - 0.3) * 0.7),
  },
};

// ------------------------------------------------------------
// Canvas art: building facades, posters, awnings, painted road,
// station platform. All seeded via the stateless hash2 so albedo and
// mask passes agree, and everything tiles on both axes.
// ------------------------------------------------------------

const FACADE_TILE = 512; // texture spans 4 window bays x 4 floors
const FACADE_CELL = 128; // px per bay / per floor
/** World size of one facade tile: 4 bays x 3 m, 4 floors x 3 m. */
export const FACADE_TILE_M = 12;

// ORM mask channel packing (sampled by roughnessMap/metalnessMap/aoMap):
//   R = ambient occlusion, G = roughness, B = metalness.
const ORM_WALL = "rgb(238,224,0)"; // ao .93 / rough .88 / metal 0
const ORM_GLASS = "rgb(255,44,214)"; // ao 1 / rough .17 / metal .84
const ORM_SPANDREL = "rgb(225,205,0)"; // slightly glossier panel band

const rgbStr = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Edge-safe rect: repeats across tile borders so noise wraps seamlessly. */
function wrapRect(ctx, x, y, w, h, S) {
  ctx.fillRect(x, y, w, h);
  if (x + w > S) ctx.fillRect(x - S, y, w, h);
  if (y + h > S) ctx.fillRect(x, y - S, w, h);
}

/**
 * Facade style descriptors. Wall colors are baked mid-tones; per-instance
 * tints in world/buildings.js modulate lightness on top. Windows are dark
 * reflective glass (sky gradient at the top), a few lit (emissive mask).
 * @type {Array<object>}
 */
export const FACADE_STYLES = [
  { key: "brickA", wall: [152, 86, 66], detail: "brick", winW: 56, winY: 32, winH: 64, litChance: 0.12, lintel: true, sill: true, retail: true, glassTint: [70, 98, 128] },
  { key: "brickB", wall: [128, 74, 60], detail: "brick", winW: 62, winY: 28, winH: 68, litChance: 0.15, lintel: true, sill: true, retail: true, glassTint: [62, 90, 120] },
  { key: "sandA", wall: [200, 180, 144], detail: "band", winW: 52, winY: 32, winH: 70, litChance: 0.1, lintel: false, sill: true, retail: true, glassTint: [76, 106, 136] },
  { key: "sandB", wall: [178, 160, 128], detail: "smooth", winW: 58, winY: 30, winH: 66, litChance: 0.12, lintel: true, sill: true, retail: true, glassTint: [70, 100, 130] },
  { key: "blueA", wall: [124, 138, 154], detail: "panel", winW: 66, winY: 28, winH: 72, litChance: 0.1, lintel: false, sill: true, retail: true, glassTint: [62, 92, 124] },
  { key: "blueB", wall: [106, 122, 142], detail: "smooth", winW: 72, winY: 26, winH: 74, litChance: 0.12, lintel: false, sill: false, retail: true, glassTint: [58, 88, 120] },
  { key: "glassA", wall: [46, 58, 68], detail: "glass", glass: true, spandrel: "rgb(40,52,62)", litChance: 0.09 },
  { key: "glassB", wall: [52, 62, 62], detail: "glass", glass: true, spandrel: "rgb(46,58,58)", litChance: 0.11 },
];

function drawBrickDetail(ctx) {
  ctx.fillStyle = "rgba(20,12,8,0.13)";
  for (let y = 0; y < FACADE_TILE; y += 12) ctx.fillRect(0, y, FACADE_TILE, 2);
  ctx.fillStyle = "rgba(255,240,230,0.05)";
  for (let y = 0; y < FACADE_TILE; y += 12) ctx.fillRect(0, y + 2, FACADE_TILE, 1);
  ctx.fillStyle = "rgba(20,12,8,0.1)";
  for (let row = 0; row < FACADE_TILE / 12; row++) {
    const off = row % 2 ? 13 : 0;
    for (let x = off; x < FACADE_TILE; x += 26) ctx.fillRect(x, row * 12, 2, 12);
  }
}

function drawPanelDetail(ctx) {
  ctx.fillStyle = "rgba(20,24,30,0.16)";
  for (let x = 0; x < FACADE_TILE; x += FACADE_CELL) ctx.fillRect(x, 0, 3, FACADE_TILE);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let x = 3; x < FACADE_TILE; x += FACADE_CELL) ctx.fillRect(x, 0, 2, FACADE_TILE);
}

function drawBandDetail(ctx) {
  for (let y = 0; y < FACADE_TILE; y += 64) {
    ctx.fillStyle = "rgba(90,70,40,0.07)";
    ctx.fillRect(0, y + 60, FACADE_TILE, 4);
  }
}

function drawGlassRow(mapCtx, ormCtx, y0, style, seed, row) {
  // Spandrel band across the bottom third of the row.
  mapCtx.fillStyle = style.spandrel;
  mapCtx.fillRect(0, y0 + 94, FACADE_TILE, 34);
  mapCtx.fillStyle = "rgba(255,255,255,0.07)";
  mapCtx.fillRect(0, y0 + 94, FACADE_TILE, 3);
  ormCtx.fillStyle = ORM_SPANDREL;
  ormCtx.fillRect(0, y0 + 94, FACADE_TILE, 34);
  // Curtain-wall glass with a strong sky gradient.
  const g = mapCtx.createLinearGradient(0, y0 + 6, 0, y0 + 94);
  g.addColorStop(0, "rgb(86,118,152)");
  g.addColorStop(0.55, "rgb(52,78,108)");
  g.addColorStop(1, "rgb(30,44,62)");
  mapCtx.fillStyle = g;
  mapCtx.fillRect(0, y0 + 6, FACADE_TILE, 88);
  ormCtx.fillStyle = ORM_GLASS;
  ormCtx.fillRect(0, y0 + 6, FACADE_TILE, 88);
  // Mullion grid.
  mapCtx.fillStyle = "rgba(16,20,24,0.5)";
  for (let x = 0; x < FACADE_TILE; x += 32) mapCtx.fillRect(x, y0 + 6, 3, 88);
  for (let y = y0 + 28; y < y0 + 94; y += 30) mapCtx.fillRect(0, y, FACADE_TILE, 2);
  // Subtle daytime interior lights.
  for (let b = 0; b < 4; b++) {
    if (hash2(row, b, seed) < style.litChance) {
      const x = b * 32 + 38 + (b % 2) * 64;
      mapCtx.fillStyle = "rgb(216,226,236)";
      mapCtx.fillRect(x, y0 + 34, 24, 28);
    }
  }
  mapCtx.fillStyle = "rgba(222,226,230,0.25)";
  mapCtx.fillRect(0, y0 + 2, FACADE_TILE, 3);
}

function drawWindow(mapCtx, ormCtx, x, y, w, h, style, seed, id) {
  const lit = hash2(id, 17, seed) < style.litChance;
  mapCtx.fillStyle = "rgba(12,10,8,0.4)";
  mapCtx.fillRect(x - 2, y - 2, w + 5, h + 5);
  ormCtx.fillStyle = ORM_GLASS;
  ormCtx.fillRect(x - 2, y - 2, w + 5, h + 5);
  const g = mapCtx.createLinearGradient(0, y, 0, y + h);
  if (lit) {
    g.addColorStop(0, "rgb(224,216,196)");
    g.addColorStop(1, "rgb(178,170,152)");
  } else {
    const t = style.glassTint;
    g.addColorStop(0, rgbStr(t));
    g.addColorStop(1, `rgb(${Math.round(t[0] * 0.32)},${Math.round(t[1] * 0.34)},${Math.round(t[2] * 0.4)})`);
  }
  mapCtx.fillStyle = g;
  mapCtx.fillRect(x, y, w, h);
  mapCtx.fillStyle = "rgba(255,255,255,0.08)";
  mapCtx.fillRect(x, y, w, Math.max(3, h * 0.12));
  mapCtx.strokeStyle = "rgba(212,208,198,0.65)";
  mapCtx.lineWidth = 3;
  mapCtx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  mapCtx.fillStyle = "rgba(30,30,30,0.5)";
  mapCtx.fillRect(x, y + h * 0.42, w, 3);
  if (style.lintel) {
    mapCtx.fillStyle = "rgba(0,0,0,0.25)";
    mapCtx.fillRect(x - 8, y - 9, w + 16, 8);
    mapCtx.fillStyle = "rgba(255,255,255,0.18)";
    mapCtx.fillRect(x - 8, y - 12, w + 16, 3);
    ormCtx.fillStyle = ORM_WALL;
    ormCtx.fillRect(x - 8, y - 12, w + 16, 12);
  }
  if (style.sill) {
    mapCtx.fillStyle = "rgba(236,231,219,0.55)";
    mapCtx.fillRect(x - 9, y + h + 2, w + 18, 6);
    mapCtx.fillStyle = "rgba(0,0,0,0.28)";
    mapCtx.fillRect(x - 9, y + h + 8, w + 18, 4);
    ormCtx.fillStyle = ORM_WALL;
    ormCtx.fillRect(x - 9, y + h + 2, w + 18, 10);
    // Grime streaking under the sill.
    const streaks = 2 + Math.floor(hash2(id, 23, seed) * 3);
    for (let s = 0; s < streaks; s++) {
      const sx = x - 6 + hash2(id, 31 + s, seed) * (w + 6);
      const sw = 3 + hash2(id, 41 + s, seed) * 7;
      const sh = 18 + hash2(id, 47 + s, seed) * 58;
      mapCtx.fillStyle = `rgba(42,36,28,${0.05 + hash2(id, 53 + s, seed) * 0.09})`;
      wrapRect(mapCtx, sx, y + h + 12, sw, sh, FACADE_TILE);
    }
  }
}

/**
 * Draw one facade tile (4 bays x 4 floors) into albedo + ORM contexts.
 * Floor row 0 is the building base (taller retail glazing + sign band);
 * ledges separate every floor; everything wraps on both axes.
 * The ORM canvas packs ao (R) / roughness (G) / metalness (B): window glass
 * is smooth + metallic so it mirrors the blue sky env; walls are matte.
 */
function drawFacade(mapCtx, ormCtx, style, seed) {
  const S = FACADE_TILE;
  mapCtx.fillStyle = rgbStr(style.wall);
  mapCtx.fillRect(0, 0, S, S);
  ormCtx.fillStyle = ORM_WALL;
  ormCtx.fillRect(0, 0, S, S);
  // Weathering blotches.
  for (let i = 0; i < 110; i++) {
    const x = hash2(i, 1, seed) * S;
    const y = hash2(i, 2, seed) * S;
    const w = 20 + hash2(i, 3, seed) * 90;
    const h = 12 + hash2(i, 4, seed) * 60;
    const dark = hash2(i, 5, seed) > 0.5;
    mapCtx.fillStyle = dark
      ? `rgba(30,26,22,${0.03 + hash2(i, 6, seed) * 0.05})`
      : `rgba(255,250,240,${0.03 + hash2(i, 6, seed) * 0.04})`;
    wrapRect(mapCtx, x, y, w, h, S);
  }
  if (style.detail === "brick") drawBrickDetail(mapCtx);
  else if (style.detail === "panel") drawPanelDetail(mapCtx);
  else if (style.detail === "band") drawBandDetail(mapCtx);

  for (let r = 0; r < 4; r++) {
    const y0 = r * FACADE_CELL;
    if (style.glass) {
      drawGlassRow(mapCtx, ormCtx, y0, style, seed, r);
      continue;
    }
    const retail = style.retail && r === 0;
    if (retail) {
      mapCtx.fillStyle = "rgba(28,24,20,0.55)";
      mapCtx.fillRect(0, y0 + 2, S, 18);
      mapCtx.fillStyle = "rgba(255,255,255,0.1)";
      mapCtx.fillRect(0, y0 + 2, S, 3);
    }
    for (let b = 0; b < 4; b++) {
      const x0 = b * FACADE_CELL;
      const winW = retail ? 88 : style.winW;
      const winH = retail ? 92 : style.winH;
      const winY = retail ? y0 + 26 : y0 + style.winY;
      const winX = x0 + (FACADE_CELL - winW) / 2;
      drawWindow(mapCtx, ormCtx, winX, winY, winW, winH, style, seed, r * 4 + b);
    }
    if (r > 0) {
      mapCtx.fillStyle = "rgba(0,0,0,0.25)";
      mapCtx.fillRect(0, y0, S, 5);
      mapCtx.fillStyle = "rgba(255,252,244,0.22)";
      mapCtx.fillRect(0, y0 - 4, S, 4);
    }
  }
}

/**
 * Generate all 8 facade texture pairs. Called once at boot by the building
 * band. @returns {Object<string, {map, orm}>}
 */
export function makeFacadeTextures(factory) {
  const out = {};
  for (let i = 0; i < FACADE_STYLES.length; i++) {
    const style = FACADE_STYLES[i];
    const seed = 900 + i * 17;
    const [map, orm] = factory.getCanvasPair(`facade:${style.key}`, {
      width: FACADE_TILE,
      height: FACADE_TILE,
      drawPair: (a, b) => drawFacade(a, b, style, seed),
    });
    out[style.key] = { map, orm };
  }
  return out;
}

// --- Posters / billboards: abstract bright transit advertising ------------

const POSTER_DESIGNS = [
  { bg: "rgb(234,110,32)", accent: "rgb(250,240,225)", ink: "rgb(30,26,24)" },
  { bg: "rgb(24,146,142)", accent: "rgb(245,250,248)", ink: "rgb(12,40,40)" },
  { bg: "rgb(242,196,44)", accent: "rgb(40,44,52)", ink: "rgb(46,38,20)" },
  { bg: "rgb(212,58,110)", accent: "rgb(250,242,240)", ink: "rgb(56,14,30)" },
];

function drawPoster(ctx, w, h, d, seed) {
  ctx.fillStyle = d.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = d.accent;
  ctx.beginPath();
  ctx.moveTo(w * 0.62, 0);
  ctx.lineTo(w * 0.82, 0);
  ctx.lineTo(w * 0.42, h);
  ctx.lineTo(w * 0.22, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  for (let c = 0; c < 3; c++) {
    const cx = hash2(c, 1, seed) * w;
    const cy = 30 + hash2(c, 2, seed) * (h - 60);
    const r = 18 + hash2(c, 3, seed) * 46;
    ctx.fillStyle = c % 2 ? d.accent : d.ink;
    ctx.globalAlpha = 0.5 + hash2(c, 4, seed) * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Fake copy lines (readable as type at distance, abstract up close).
  for (let t = 0; t < 4; t++) {
    const ty = 34 + t * 36;
    const tw = 120 + hash2(t, 5, seed) * 170;
    ctx.fillStyle = t === 0 ? d.ink : d.accent;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(36, ty, tw, t === 0 ? 26 : 14);
    if (t < 3) {
      ctx.fillStyle = d.bg;
      ctx.fillRect(44, ty + (t === 0 ? 7 : 3), tw - 60, t === 0 ? 5 : 3);
    }
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(250,248,242,0.95)";
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = "rgba(20,18,16,0.8)";
  ctx.fillRect(12, h - 40, w - 24, 28);
  ctx.fillStyle = "rgba(240,236,228,0.8)";
  for (let s = 0; s < 6; s++) ctx.fillRect(28 + s * 78, h - 32, 44, 8);
}

/** @returns {THREE.CanvasTexture} Poster texture i (0..3). */
export function makePosterTexture(factory, i) {
  return factory.getCanvas(`poster:${i}`, {
    width: 512,
    height: 256,
    draw: (ctx, w, h) => drawPoster(ctx, w, h, POSTER_DESIGNS[i % 4], 700 + i * 13),
  });
}

/**
 * 2x2 poster atlas (1024x512, four designs in 512x256 quadrants). Used by
 * the instanced wall-poster ring + station signs: one draw call serves every
 * poster via a per-instance quadrant offset. Quadrant (col,row) samples
 * uv * 0.5 + (col * 0.5, row * 0.5).
 * @returns {THREE.CanvasTexture}
 */
// --- Train livery ATLAS (wave 4) ------------------------------------------
// One 1024x768 canvas per livery variant covers the whole car body box:
//   v [0.58, 1.00]  side band  (12 m x 2.25 m, u = car length)
//   v [0.25, 0.58]  roof band  (12 m x 2.00 m, u = car length, v = across)
//   v [0.00, 0.25]  end block  (2.0 m x 2.25 m, u [0, 0.16]) + dark patch for
//                   the unseen bottom face at u [0.16, 0.20]
// The side band paints the window band + glass + mullions, door OPENINGS
// (dark reveals behind the 3D leaves), trim lines and very subtle weathering.
// Car numbers are separate decal meshes (see makeTrainDigitTexture).

/**
 * Livery palette variants. All stay inside the transit orange/cream/teal
 * family + a yellow/gray set, per art direction.
 */
export const TRAIN_LIVERY_VARIANTS = [
  {
    key: "transitOrange",
    body: "#d97a2b",
    bodyDark: "#c96f26",
    band: "#f2e8d8",
    trim: "#2c3a4a",
    glassTop: "#5d7f9c",
    glassBottom: "#1a2530",
    roof: "#a3968a",
    accent: "#f2e8d8",
  },
  {
    key: "tealNavy",
    body: "#2e8f8a",
    bodyDark: "#27807b",
    band: "#e9eef0",
    trim: "#1e2a44",
    glassTop: "#54779b",
    glassBottom: "#152030",
    roof: "#93a4ac",
    accent: "#f0c869",
  },
  {
    key: "solarGray",
    body: "#e3b23a",
    bodyDark: "#d5a72f",
    band: "#d8dcde",
    trim: "#4a5158",
    glassTop: "#4e6478",
    glassBottom: "#1c242e",
    roof: "#9aa1a6",
    accent: "#d97a2b",
  },
];

// Atlas geometry constants (must match mapTrainBodyUVs in entities/trains.js).
const TRAIN_ATLAS_W = 1024;
const TRAIN_ATLAS_H = 768;
const TRAIN_SIDE_Y = 322; // canvas y where the side band ends (v 0.58)
const TRAIN_ROOF_Y = 576; // canvas y where the roof band ends (v 0.25)
const TRAIN_SIDE_PX_H = 322 / 2.25; // px per metre vertically on the sides
const TRAIN_ROOF_PX_H = (TRAIN_ROOF_Y - TRAIN_SIDE_Y) / 2.0;
const TRAIN_END_PX_H = (TRAIN_ATLAS_H - TRAIN_ROOF_Y) / 2.25;
const TRAIN_END_PX_W = 164 / 2.0;
/** Door opening centres along the car (z, m). */
export const TRAIN_DOOR_Z = [-3.4, 0, 3.4];
const TRAIN_DOOR_HALF_W = 0.66; // painted reveal half width (m)

function hexRGBA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Draw the full body atlas for one livery variant.
 * Side band: body field, panel seams, cream window band with dark glass +
 * mullions, door reveals, trim, skirt shadow, faint weathering.
 * Roof band: ribbed panels, longitudinal weathering strips, center walkway.
 * End block: windshield, destination box, headlight rings, anti-climber.
 */
function drawTrainAtlas(ctx, v) {
  const W = TRAIN_ATLAS_W;
  // ---------- side band (y 0..322) ----------
  const sy = (worldY) => (3.1 - worldY) * TRAIN_SIDE_PX_H; // world y -> canvas y
  const sh = (m) => m * TRAIN_SIDE_PX_H;
  // Body field with a gentle top-light gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, TRAIN_SIDE_Y);
  bg.addColorStop(0, v.body);
  bg.addColorStop(0.55, v.body);
  bg.addColorStop(1, v.bodyDark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, TRAIN_SIDE_Y);
  // Carbody panel seams every 2 m (wrap-safe: exact division of 1024).
  for (let x = 0; x <= W; x += Math.round(W / 6)) {
    ctx.fillStyle = "rgba(30,20,12,0.16)";
    ctx.fillRect((x + W) % W, 0, 2, TRAIN_SIDE_Y);
    ctx.fillStyle = "rgba(255,240,220,0.10)";
    ctx.fillRect((x + W + 2) % W, 0, 1, TRAIN_SIDE_Y);
  }
  // Cream window band (1.92..2.82 m) with dark glass strip (2.0..2.75 m).
  ctx.fillStyle = v.band;
  ctx.fillRect(0, sy(2.82), W, sh(0.9));
  const gg = ctx.createLinearGradient(0, sy(2.75), 0, sy(2.0));
  gg.addColorStop(0, v.glassTop);
  gg.addColorStop(0.35, v.glassTop);
  gg.addColorStop(1, v.glassBottom);
  ctx.fillStyle = gg;
  ctx.fillRect(0, sy(2.75), W, sh(0.75));
  // Glass top sky reflection streak.
  ctx.fillStyle = "rgba(235,244,252,0.22)";
  ctx.fillRect(0, sy(2.75), W, sh(0.07));
  // Window mullions every 1.05 m (12 m / 1.05 -> aligned to the tile).
  ctx.fillStyle = hexRGBA(v.body, 1);
  for (let x = Math.round(W / 12); x < W; x += Math.round(W / 12)) {
    ctx.fillRect(x - 2, sy(2.75), 4, sh(0.75));
  }
  // Band trim lines.
  ctx.fillStyle = v.trim;
  ctx.fillRect(0, sy(2.82), W, sh(0.045));
  ctx.fillRect(0, sy(1.995), W, sh(0.05));
  // Accent stripe low on the body.
  ctx.fillStyle = v.accent;
  ctx.fillRect(0, sy(1.32), W, sh(0.09));
  ctx.fillStyle = v.trim;
  ctx.fillRect(0, sy(1.245), W, sh(0.035));
  // Door reveals: dark openings behind the 3D leaves (painted on BOTH u
  // hemispheres so both car sides align with the shared leaf positions).
  for (const dz of TRAIN_DOOR_Z) {
    for (const flipped of [false, true]) {
      const u = flipped ? (6 - dz) / 12 : (dz + 6) / 12;
      const cx = u * W;
      const halfW = TRAIN_DOOR_HALF_W * (W / 12);
      ctx.fillStyle = "rgba(12,10,9,0.85)";
      ctx.fillRect(cx - halfW, sy(2.8), halfW * 2, sh(1.94));
      // Reveal shadow gradient (deeper at the edges).
      const rg = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
      rg.addColorStop(0, "rgba(0,0,0,0.55)");
      rg.addColorStop(0.5, "rgba(0,0,0,0.12)");
      rg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = rg;
      ctx.fillRect(cx - halfW, sy(2.8), halfW * 2, sh(1.94));
    }
  }
  // Roof-edge contact shadow + skirt shadow (subtle, 2 bands).
  ctx.fillStyle = "rgba(25,18,12,0.35)";
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = "rgba(20,14,10,0.28)";
  ctx.fillRect(0, TRAIN_SIDE_Y - 5, W, 5);
  // Faint weathering: 6 long streaks under the band corners (no blotches).
  for (let i = 0; i < 6; i++) {
    const x = ((i * 197 + 53) % W);
    const w = 3 + (i % 3);
    ctx.fillStyle = `rgba(35,26,18,${0.05 + (i % 2) * 0.03})`;
    ctx.fillRect(x, sy(1.98), w, sh(0.5 + (i % 3) * 0.22));
  }

  // ---------- roof band (y 322..576) ----------
  const ry = (across) => TRAIN_SIDE_Y + (1 - (across + 1) / 2) * (TRAIN_ROOF_Y - TRAIN_SIDE_Y);
  ctx.fillStyle = v.roof;
  ctx.fillRect(0, TRAIN_SIDE_Y, W, TRAIN_ROOF_Y - TRAIN_SIDE_Y);
  // Transverse ribs every 0.45 m.
  const ribPx = Math.round(W / (12 / 0.45));
  for (let x = 0; x < W; x += ribPx) {
    ctx.fillStyle = "rgba(30,26,22,0.16)";
    ctx.fillRect(x, TRAIN_SIDE_Y, 3, TRAIN_ROOF_Y - TRAIN_SIDE_Y);
    ctx.fillStyle = "rgba(255,252,246,0.10)";
    ctx.fillRect(x + 3, TRAIN_SIDE_Y, 2, TRAIN_ROOF_Y - TRAIN_SIDE_Y);
  }
  // Center walkway strip (slightly lighter, edged).
  const walkT = ry(0.62);
  const walkB = ry(-0.62);
  ctx.fillStyle = "rgba(255,252,244,0.09)";
  ctx.fillRect(0, walkT, W, walkB - walkT);
  ctx.fillStyle = "rgba(30,26,22,0.2)";
  ctx.fillRect(0, walkT, W, 2);
  ctx.fillRect(0, walkB - 2, W, 2);
  // Longitudinal weathering strips (soft dark bands, symmetric).
  for (const across of [0.78, 0.3, -0.3, -0.78]) {
    const y = ry(across);
    const wg = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    wg.addColorStop(0, "rgba(40,34,28,0)");
    wg.addColorStop(0.5, "rgba(40,34,28,0.11)");
    wg.addColorStop(1, "rgba(40,34,28,0)");
    ctx.fillStyle = wg;
    ctx.fillRect(0, y - 10, W, 20);
  }
  // Roof edge grime fall-off.
  const eg = ctx.createLinearGradient(0, TRAIN_SIDE_Y, 0, TRAIN_SIDE_Y + 16);
  eg.addColorStop(0, "rgba(30,26,20,0.3)");
  eg.addColorStop(1, "rgba(30,26,20,0)");
  ctx.fillStyle = eg;
  ctx.fillRect(0, TRAIN_SIDE_Y, W, 16);
  const eg2 = ctx.createLinearGradient(0, TRAIN_ROOF_Y - 16, 0, TRAIN_ROOF_Y);
  eg2.addColorStop(0, "rgba(30,26,20,0)");
  eg2.addColorStop(1, "rgba(30,26,20,0.3)");
  ctx.fillStyle = eg2;
  ctx.fillRect(0, TRAIN_ROOF_Y - 16, W, 16);
  // A few rust streaks from rib joints (very faint).
  for (let i = 0; i < 5; i++) {
    const x = (i * 263 + 90) % W;
    ctx.fillStyle = "rgba(122,74,40,0.10)";
    ctx.fillRect(x, TRAIN_SIDE_Y + 20 + (i % 3) * 60, 2, 40 + (i % 4) * 30);
  }

  // ---------- end block (x 0..164, y 576..768) ----------
  const ex = (wx) => (wx + 1) * TRAIN_END_PX_W; // -1..1 -> 0..164
  const ey = (worldY) => TRAIN_ROOF_Y + (3.1 - worldY) * TRAIN_END_PX_H;
  const eh = (m) => m * TRAIN_END_PX_H;
  const eg3 = ctx.createLinearGradient(0, TRAIN_ROOF_Y, 0, TRAIN_ATLAS_H);
  eg3.addColorStop(0, v.body);
  eg3.addColorStop(1, v.bodyDark);
  ctx.fillStyle = eg3;
  ctx.fillRect(0, TRAIN_ROOF_Y, TRAIN_END_PX_W * 2, TRAIN_ATLAS_H - TRAIN_ROOF_Y);
  // Windshield band (2.05..2.65 m) with dark glass + frame.
  ctx.fillStyle = v.trim;
  ctx.fillRect(ex(-0.82), ey(2.7), ex(0.82) - ex(-0.82), eh(0.7));
  const wg2 = ctx.createLinearGradient(0, ey(2.65), 0, ey(2.05));
  wg2.addColorStop(0, v.glassTop);
  wg2.addColorStop(1, v.glassBottom);
  ctx.fillStyle = wg2;
  ctx.fillRect(ex(-0.76), ey(2.65), ex(0.76) - ex(-0.76), eh(0.58));
  ctx.fillStyle = "rgba(235,244,252,0.18)";
  ctx.fillRect(ex(-0.76), ey(2.65), ex(0.76) - ex(-0.76), eh(0.08));
  // Center divider post + wiper arm (reads as real glass at close range).
  ctx.fillStyle = v.trim;
  ctx.fillRect(ex(-0.015), ey(2.65), ex(0.015) - ex(-0.015), eh(0.58));
  ctx.strokeStyle = "rgba(30,26,22,0.75)";
  ctx.lineWidth = Math.max(1, eh(0.02));
  ctx.beginPath();
  ctx.moveTo(ex(-0.1), ey(2.12));
  ctx.lineTo(ex(0.28), ey(2.5));
  ctx.stroke();
  // Destination sign box with legible amber destination text.
  ctx.fillStyle = "#10151c";
  ctx.fillRect(ex(-0.6), ey(2.98), ex(0.6) - ex(-0.6), eh(0.24));
  ctx.fillStyle = "rgba(30,36,44,0.6)";
  ctx.fillRect(ex(-0.6), ey(2.98), ex(0.6) - ex(-0.6), eh(0.05));
  ctx.fillStyle = "rgba(255, 186, 84, 0.95)";
  ctx.font = `bold ${Math.round(eh(0.16))}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("METRO", ex(0), ey(2.98) + eh(0.13));
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  // Headlight rings (the 3D lens cylinders sit on these).
  for (const wx of [-0.62, 0.62]) {
    ctx.beginPath();
    ctx.arc(ex(wx), ey(1.05), TRAIN_END_PX_W * 0.075, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,18,16,0.8)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex(wx), ey(1.05), TRAIN_END_PX_W * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(226,222,205,0.85)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex(wx) - 1, ey(1.05) - 1, TRAIN_END_PX_W * 0.028, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,252,240,0.9)";
    ctx.fill();
  }
  // Anti-climber ribs + coupler hatch.
  ctx.fillStyle = "rgba(25,20,16,0.5)";
  for (let i = 0; i < 3; i++) ctx.fillRect(ex(-0.7), ey(0.98 - i * 0.09), ex(0.7) - ex(-0.7), eh(0.035));
  ctx.fillStyle = "rgba(15,12,10,0.6)";
  ctx.fillRect(ex(-0.22), ey(0.88), ex(0.22) - ex(-0.22), eh(0.5));

  // ---------- dark patch for the unseen bottom face ----------
  ctx.fillStyle = "#101215";
  ctx.fillRect(TRAIN_END_PX_W * 2, TRAIN_ROOF_Y, 42, TRAIN_ATLAS_H - TRAIN_ROOF_Y);
}

/**
 * Build the body atlas texture for livery variant i (3 variants).
 * @param {TextureFactory} factory
 * @param {number} i Variant index.
 * @returns {THREE.CanvasTexture}
 */
export function makeTrainAtlasTexture(factory, i) {
  return factory.getCanvas(`trainAtlas:${i}`, {
    width: TRAIN_ATLAS_W,
    height: TRAIN_ATLAS_H,
    draw: (ctx) => drawTrainAtlas(ctx, TRAIN_LIVERY_VARIANTS[i % TRAIN_LIVERY_VARIANTS.length]),
  });
}

/**
 * Door leaf texture (0.60 m x 1.92 m leaf): door-colored field, rubber seal
 * edges, top window with glass, grab handle, kick panel.
 * @param {TextureFactory} factory
 * @param {number} i Variant index.
 * @returns {THREE.CanvasTexture}
 */
export function makeTrainDoorTexture(factory, i) {
  const v = TRAIN_LIVERY_VARIANTS[i % TRAIN_LIVERY_VARIANTS.length];
  return factory.getCanvas(`trainDoor:${i}`, {
    width: 128,
    height: 256,
    draw: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, v.bodyDark);
      g.addColorStop(1, v.body);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Rubber seal around the leaf.
      ctx.strokeStyle = "rgba(24,20,18,0.9)";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      // Window (0.30 x 0.55 m, upper center).
      const winW = 0.3 * (w / 0.6);
      const winH = 0.55 * (h / 1.92);
      const wx = (w - winW) / 2;
      const wy = 0.12 * (h / 1.92);
      ctx.fillStyle = "rgba(24,20,18,0.9)";
      ctx.fillRect(wx - 3, wy - 3, winW + 6, winH + 6);
      const gg = ctx.createLinearGradient(0, wy, 0, wy + winH);
      gg.addColorStop(0, v.glassTop);
      gg.addColorStop(1, v.glassBottom);
      ctx.fillStyle = gg;
      ctx.fillRect(wx, wy, winW, winH);
      ctx.fillStyle = "rgba(235,244,252,0.2)";
      ctx.fillRect(wx, wy, winW, 6);
      // Grab handle (bright, near the leading edge).
      ctx.fillStyle = "#e8e4da";
      ctx.fillRect(w * 0.78, h * 0.42, 7, h * 0.16);
      ctx.fillStyle = "rgba(30,26,22,0.5)";
      ctx.fillRect(w * 0.78 - 2, h * 0.42 - 2, 11, h * 0.16 + 4);
      // Kick panel.
      ctx.fillStyle = "rgba(30,24,18,0.35)";
      ctx.fillRect(6, h - 0.3 * (h / 1.92), w - 12, 0.3 * (h / 1.92) - 6);
      ctx.fillStyle = "rgba(255,245,230,0.14)";
      ctx.fillRect(6, h - 0.3 * (h / 1.92), w - 12, 3);
    },
  });
}

/**
 * Car-number digit atlas: 10 digits in 64 px cells on transparent ground.
 * Decal quads sample 4 cells for a 4-digit car number.
 * @param {TextureFactory} factory
 * @returns {THREE.CanvasTexture}
 */
export function makeTrainDigitTexture(factory) {
  return factory.getCanvas("trainDigits", {
    width: 640,
    height: 128,
    draw: (ctx) => {
      ctx.clearRect(0, 0, 640, 128);
      ctx.font = "bold 96px Arial, 'Helvetica Neue', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let d = 0; d <= 9; d++) {
        ctx.fillStyle = "#22303c";
        ctx.fillText(String(d), 32 + d * 64, 68);
      }
    },
  });
}

// --- Construction barricade: orange/white diagonal stripes -----------------

/**
 * Barrier plank texture (2.0 m x 0.3 m face). 45-degree orange/white
 * hazard stripes with paint wear and bottom grime.
 * @param {TextureFactory} factory
 * @returns {THREE.CanvasTexture}
 */
export function makeBarrierStripeTexture(factory) {
  return factory.getCanvas("barrierStripe", {
    width: 512,
    height: 80,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#ece7db";
      ctx.fillRect(0, 0, w, h);
      // Diagonal stripes: parallelograms with period 128 px (0.5 m), 45 deg
      // in world space -> dx 64 / dy 66 in canvas space.
      ctx.fillStyle = "#d97a2b";
      for (let x = -h; x < w + h; x += 128) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + 64, 0);
        ctx.lineTo(x + 64 + 64, 0);
        ctx.lineTo(x + 64, h);
        ctx.closePath();
        ctx.fill();
      }
      // Wear: chips + grime along the bottom edge.
      for (let i = 0; i < 26; i++) {
        const x = ((i * 97 + 31) % w);
        const y = (i * 37) % h;
        ctx.fillStyle = i % 2 ? "rgba(60,48,36,0.25)" : "rgba(255,250,240,0.3)";
        ctx.fillRect(x, y, 2 + (i % 3) * 2, 2 + (i % 2) * 2);
      }
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,0.12)");
      g.addColorStop(0.75, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(30,22,14,0.3)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(30,22,14,0.5)";
      ctx.fillRect(0, 0, w, 3);
      ctx.fillRect(0, h - 4, w, 4);
    },
  });
}

// --- Overhead gantry sign: STOP + down chevrons ----------------------------

/**
 * Gantry sign panel texture (2.2 m x 1.3 m).
 * @param {TextureFactory} factory
 * @returns {THREE.CanvasTexture}
 */
export function makeGantrySignTexture(factory) {
  return factory.getCanvas("gantrySign", {
    width: 384,
    height: 224,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#1e2a3a";
      ctx.fillRect(0, 0, w, h);
      // Frame.
      ctx.strokeStyle = "#ece7db";
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = "#d97a2b";
      ctx.fillRect(8, 8, w - 16, 8);
      // STOP text.
      ctx.font = "bold 92px Arial, 'Helvetica Neue', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#f4efe4";
      ctx.fillText("STOP", w / 2, h * 0.4);
      // Down chevrons (roll under).
      for (let c = -1; c <= 1; c++) {
        const cx = w / 2 + c * 84;
        ctx.beginPath();
        ctx.moveTo(cx - 26, h * 0.62);
        ctx.lineTo(cx, h * 0.62 + 22);
        ctx.lineTo(cx + 26, h * 0.62);
        ctx.lineTo(cx + 26, h * 0.62 + 12);
        ctx.lineTo(cx, h * 0.62 + 34);
        ctx.lineTo(cx - 26, h * 0.62 + 12);
        ctx.closePath();
        ctx.fillStyle = "#f0c869";
        ctx.fill();
      }
      // Subtle wear.
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = "rgba(230,225,214,0.08)";
        ctx.fillRect((i * 71) % w, (i * 43) % h, 3 + (i % 3) * 3, 2 + (i % 2) * 2);
      }
    },
  });
}

// --- x2 token face ----------------------------------------------------------

/**
 * "2x" token texture (0.46 m square faces). Gold field, navy ring, big 2x.
 * The 12 px top-left corner is solid gold and is sampled by the token edges.
 * @param {TextureFactory} factory
 * @returns {THREE.CanvasTexture}
 */
export function makeTokenTexture(factory) {
  return factory.getCanvas("token2x", {
    width: 256,
    height: 256,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#e8b83c";
      ctx.fillRect(0, 0, w, h);
      // Face design.
      ctx.fillStyle = "#22303c";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f0c869";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 132px Arial, 'Helvetica Neue', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#22303c";
      ctx.fillText("2x", w / 2 + 4, h / 2 + 8);
      // Radial shine.
      const g = ctx.createRadialGradient(w * 0.36, h * 0.32, 8, w / 2, h / 2, w * 0.5);
      g.addColorStop(0, "rgba(255,248,220,0.5)");
      g.addColorStop(0.55, "rgba(255,248,220,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  });
}

export function makePosterAtlasTexture(factory) {
  return factory.getCanvas("posterAtlas", {
    width: 1024,
    height: 512,
    draw: (ctx) => {
      for (let q = 0; q < 4; q++) {
        const col = q % 2;
        const row = Math.floor(q / 2);
        ctx.save();
        ctx.translate(col * 512, row * 256);
        drawPoster(ctx, 512, 256, POSTER_DESIGNS[q % POSTER_DESIGNS.length], 700 + q * 13);
        ctx.restore();
      }
    },
  });
}

// --- Awning canvas: stripes + hem (per-instance tints add variety) --------

export function makeAwningTexture(factory) {
  return factory.getCanvas("awning", {
    width: 128,
    height: 128,
    draw: (ctx, w, h) => {
      for (let x = 0; x < w; x += 24) {
        ctx.fillStyle = (x / 24) % 2 ? "rgb(240,236,226)" : "rgb(206,60,48)";
        ctx.fillRect(x, 0, 24, h);
      }
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,0.16)");
      g.addColorStop(0.7, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(20,16,14,0.4)";
      ctx.fillRect(0, h - 8, w, 8);
    },
  });
}

// --- Clean transit panel: 2-tone painted metal (station canopies, fascias,
// bridge piers). Deliberately NO mottling — flat orange field, cream band,
// dark trim lines, faint panel seams. Tileable on both axes.

export function makeTransitPanelTexture(factory) {
  return factory.getCanvas("transitPanel", {
    width: 512,
    height: 256,
    draw: (ctx, w, h) => {
      // Base coat.
      ctx.fillStyle = "rgb(219,124,36)";
      ctx.fillRect(0, 0, w, h);
      // Cream band with dark trim lines.
      ctx.fillStyle = "rgb(240,231,212)";
      ctx.fillRect(0, h * 0.4, w, h * 0.24);
      ctx.fillStyle = "rgb(43,46,50)";
      ctx.fillRect(0, h * 0.4, w, 6);
      ctx.fillRect(0, h * 0.64 - 6, w, 6);
      // Thin secondary accent stripe below the band.
      ctx.fillStyle = "rgb(240,231,212)";
      ctx.fillRect(0, h * 0.78, w, h * 0.05);
      ctx.fillStyle = "rgb(43,46,50)";
      ctx.fillRect(0, h * 0.78 + h * 0.05, w, 4);
      // Precast panel seams every quarter tile (subtle, wrap-safe).
      for (let x = 0; x <= w; x += w / 4) {
        ctx.fillStyle = "rgba(70,34,10,0.18)";
        ctx.fillRect(wrapN(Math.round(x), w), 0, 3, h);
        ctx.fillStyle = "rgba(255,238,216,0.12)";
        ctx.fillRect(wrapN(Math.round(x) + 3, w), 0, 2, h);
      }
      // Gentle top light, bottom shade (reads as painted sheet metal).
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,0.07)");
      g.addColorStop(0.5, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(30,20,10,0.10)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  });
}

// --- Painted road: asphalt + edge lines + dashed center line --------------
// One tile = 5.55 m across (u) x 12 m along (v). Tileable along v.

export function makeRoadTexture(factory) {
  return factory.getCanvas("roadPainted", {
    width: 512,
    height: 512,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "rgb(52,54,56)";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const x = hash2(i, 1, 808) * w;
        const y = hash2(i, 2, 808) * h;
        const l = hash2(i, 3, 808) > 0.5;
        ctx.fillStyle = `rgba(${l ? "120,122,124" : "20,20,22"},${0.04 + hash2(i, 4, 808) * 0.08})`;
        ctx.fillRect(x, y, 2 + hash2(i, 5, 808) * 5, 2 + hash2(i, 6, 808) * 5);
      }
      // Wheel-worn bands.
      ctx.fillStyle = "rgba(16,16,18,0.1)";
      ctx.fillRect(w * 0.22, 0, w * 0.13, h);
      ctx.fillRect(w * 0.63, 0, w * 0.13, h);
      // Edge lines.
      ctx.fillStyle = "rgba(226,222,210,0.55)";
      ctx.fillRect(w * 0.075, 0, 5, h);
      ctx.fillRect(w * 0.925 - 5, 0, 5, h);
      // Dashed center line: 2 dashes per tile, gap at the tile border.
      ctx.fillStyle = "rgba(228,224,210,0.72)";
      for (const y0 of [8, h / 2 + 8]) ctx.fillRect(w / 2 - 5, y0, 10, h / 2 - 16);
      // Wear on the paint.
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = "rgba(52,54,56,0.5)";
        ctx.fillRect(w / 2 - 6, hash2(i, 7, 809) * h, 12, 6 + hash2(i, 8, 809) * 22);
      }
    },
  });
}

// --- Station platform top: concrete + yellow safety line + tactile dots ---
// u spans the 1.82 m platform width (u=1 is the track edge), v runs along it.

export function makePlatformTexture(factory) {
  return factory.getCanvas("platformTop", {
    width: 512,
    height: 512,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "rgb(148,146,140)";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1100; i++) {
        const x = hash2(i, 1, 812) * w;
        const y = hash2(i, 2, 812) * h;
        const l = hash2(i, 3, 812) > 0.5;
        ctx.fillStyle = `rgba(${l ? "188,186,180" : "90,90,88"},${0.05 + hash2(i, 4, 812) * 0.1})`;
        ctx.fillRect(x, y, 2 + hash2(i, 5, 812) * 4, 2 + hash2(i, 6, 812) * 4);
      }
      ctx.fillStyle = "rgba(30,30,30,0.28)";
      for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 3);
      // Yellow safety line near the track edge.
      ctx.fillStyle = "rgb(226,176,38)";
      ctx.fillRect(w * 0.78, 0, w * 0.12, h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(148,146,140,${0.25 + hash2(i, 9, 813) * 0.4})`;
        ctx.fillRect(
          w * 0.78 + hash2(i, 10, 813) * w * 0.12,
          hash2(i, 11, 813) * h,
          6 + hash2(i, 12, 813) * 18,
          4 + hash2(i, 13, 813) * 14,
        );
      }
      // Tactile warning dots.
      ctx.fillStyle = "rgba(120,116,108,0.5)";
      for (let y = 8; y < h; y += 22) {
        for (let x = w * 0.92; x < w * 0.97; x += 16) {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = "rgba(24,24,24,0.22)";
      ctx.fillRect(w - 10, 0, 10, h);
    },
  });
}

// ------------------------------------------------------------
// UV helpers (uniform texel density for shared materials)
// ------------------------------------------------------------

const TEXELS_PER_METER = 48; // world texel density at UV scale 1

/**
 * Scale BoxGeometry UVs so every face maps worldSize * TEXELS_PER_METER.
 * Keeps one shared material at a consistent texel density on any box.
 * @param {THREE.BoxGeometry} geo
 * @param {number} sx @param {number} sy @param {number} sz Box dimensions.
 * @param {number} [density] Texels per metre override.
 * @returns {THREE.BoxGeometry} The same geometry (chainable).
 */
export function fitBoxUVs(geo, sx, sy, sz, density = TEXELS_PER_METER) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x,-x,+y,-y,+z,-z; 4 verts each.
  const faceDims = [
    [sz, sy], [sz, sy], // x faces: (depth, height)
    [sx, sz], [sx, sz], // y faces: (width, depth)
    [sx, sy], [sx, sy], // z faces: (width, height)
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = faceDims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * du * density * 0.01, uv.getY(i) * dv * density * 0.01);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------
// MaterialLibrary singleton
// ------------------------------------------------------------

/**
 * Material definitions: texture set key + physical params.
 * envMapIntensity tuned per material so metals pop without glow-soup.
 * @type {Record<string, {set: string, metalness: number, roughness: number, envMapIntensity: number, color?: number, emissive?: number}>}
 */
const MATERIAL_DEFS = {
  // Ground materials keep env near zero: shadowed ballast/asphalt is lit by
  // the neutral-warm hemisphere only, so shadows stay neutral (not navy).
  ballast: { set: "ballast", metalness: 0.0, roughness: 1.0, envMapIntensity: 0.16 },
  concrete: { set: "concrete", metalness: 0.0, roughness: 0.92, envMapIntensity: 0.4 },
  asphalt: { set: "asphalt", metalness: 0.0, roughness: 0.95, envMapIntensity: 0.08 },
  brick: { set: "brick", metalness: 0.0, roughness: 0.9, envMapIntensity: 0.45 },
  wood: { set: "wood", metalness: 0.0, roughness: 0.85, envMapIntensity: 0.4 },
  brushedMetal: { set: "brushedMetal", metalness: 1.0, roughness: 0.42, envMapIntensity: 1.1 },
  paintedSteel: { set: "paintedSteel", metalness: 0.35, roughness: 0.55, envMapIntensity: 0.9 },
  /** @deprecated wave-4 train bodies use lib.trainVariants (this corrugated
   *  set now only dresses station canopies and similar scenery) */
  corrugated: { set: "corrugated", metalness: 0.9, roughness: 0.45, envMapIntensity: 1.0 },
  // Rail head: dark polished steel — the sun-disc rake reads against it.
  railSteel: { set: null, color: 0x7d7468, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.7 },
  // Wave-4 coin gold: brighter base + tighter roughness + stronger env so the
  // beveled coin pops speculars under the sky PMREM.
  // metalness < 1 so the warm gold base dominates the blue-sky reflection
  // (full-metal coins mirrored the sky and read as lime-green discs).
  gold: { set: null, color: 0xffc93c, metalness: 0.65, roughness: 0.3, envMapIntensity: 1.1, emissive: 0x6b4a08, emissiveIntensity: 0.45 },
  steelDark: { set: null, color: 0x33383e, metalness: 0.85, roughness: 0.45, envMapIntensity: 0.9 },
  plasticDark: { set: null, color: 0x23262b, metalness: 0.0, roughness: 0.6, envMapIntensity: 0.6 },
  // Wave-2 world dressing:
  catSteel: { set: null, color: 0x39584a, metalness: 0.45, roughness: 0.55, envMapIntensity: 0.5 }, // dark green transit steel
  roofSlab: { set: null, color: 0x8f8a80, metalness: 0.0, roughness: 0.95, envMapIntensity: 0.2 }, // parapets / roof caps
  // Wave-4 props:
  treadPlate: { set: "treadPlate", metalness: 0.6, roughness: 0.52, envMapIntensity: 0.8 }, // ramp deck
  lensDark: { set: null, color: 0x111a22, metalness: 0.75, roughness: 0.18, envMapIntensity: 1.35 }, // headlight/taillight glass (day)
  lensLit: { set: null, color: 0xfff3cf, metalness: 0.2, roughness: 0.3, envMapIntensity: 0.6, emissive: 0xffe9b0, emissiveIntensity: 1.5 }, // moving-train headlights
  lampAmber: { set: null, color: 0xffb43a, metalness: 0.1, roughness: 0.32, envMapIntensity: 0.7, emissive: 0x7a3d08, emissiveIntensity: 0.4 }, // barricade/gantry lamps
  pickupPaint: { set: null, color: 0xffffff, metalness: 0.42, roughness: 0.4, envMapIntensity: 0.95, vertexColors: true }, // vertex-colored pickup bodies
  // Wave-3 character (stylized flat dielectrics; palette matches the passed
  // world: teal / transit orange / cream / navy). Low env so fabric stays
  // matte under the bright sky; plastics a touch glossier.
  hoodie: { set: null, color: 0x1db3a3, metalness: 0.0, roughness: 0.88, envMapIntensity: 0.3 }, // teal fabric
  denim: { set: null, color: 0x2c3a5e, metalness: 0.0, roughness: 0.92, envMapIntensity: 0.28 }, // navy jeans
  denimCuff: { set: null, color: 0x3d4e7c, metalness: 0.0, roughness: 0.92, envMapIntensity: 0.28 }, // rolled-cuff fade
  skin: { set: null, color: 0xdfa277, metalness: 0.0, roughness: 0.52, envMapIntensity: 0.4, emissive: 0x3a2418, emissiveIntensity: 0.35 }, // warm tan
  sneaker: { set: null, color: 0xdcd8cc, metalness: 0.0, roughness: 0.7, envMapIntensity: 0.35 }, // off-white leather (dimmed: pure white read as a blank plank)
  capPlastic: { set: null, color: 0xffc23d, metalness: 0.0, roughness: 0.42, envMapIntensity: 0.55 }, // yellow-orange cap / cups
  accentOrange: { set: null, color: 0xe8742c, metalness: 0.0, roughness: 0.38, envMapIntensity: 0.6 }, // transit-orange accents
  packFabric: { set: null, color: 0xc7532f, metalness: 0.0, roughness: 0.9, envMapIntensity: 0.28 }, // backpack canvas
  creamFabric: { set: null, color: 0xf0e7d4, metalness: 0.0, roughness: 0.9, envMapIntensity: 0.28 }, // drawstrings
  ink: { set: null, color: 0x22201d, metalness: 0.0, roughness: 0.5, envMapIntensity: 0.4 }, // eyes / brows / webbing
  hair: { set: null, color: 0x45301f, metalness: 0.0, roughness: 0.82, envMapIntensity: 0.3 }, // hair tufts
};

class MaterialLibrary {
  constructor() {
    /** @type {TextureFactory} */
    this.factory = new TextureFactory();
    /** @type {Map<string, THREE.MeshStandardMaterial>} */
    this._materials = new Map();
    this._initialized = false;
  }

  /**
   * Must be called once after renderer creation (sets anisotropy caps).
   * @param {THREE.WebGLRenderer} renderer
   */
  init(renderer) {
    this.factory.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this._initialized = true;
  }

  /**
   * Get (lazily build) a shared material by key.
   * @param {keyof typeof MATERIAL_DEFS} key
   * @returns {THREE.MeshStandardMaterial}
   */
  get(key) {
    const cached = this._materials.get(key);
    if (cached) return cached;
    const def = MATERIAL_DEFS[key];
    if (!def) throw new Error(`MaterialLibrary: unknown material '${key}'`);
    const params = {
      metalness: def.metalness,
      roughness: def.roughness,
      envMapIntensity: def.envMapIntensity,
    };
    if (def.color !== undefined) params.color = new THREE.Color(def.color);
    if (def.vertexColors) params.vertexColors = true;
    if (def.set) {
      const set = this.factory.getSet(def.set, GENERATORS[def.set]);
      params.map = set.map;
      params.normalMap = set.normalMap;
      params.roughnessMap = set.roughnessMap;
      if (set.aoMap) params.aoMap = set.aoMap;
      params.normalScale = new THREE.Vector2(1, 1);
    }
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = key;
    this._materials.set(key, mat);
    return mat;
  }

  // Ergonomic accessors for the common sets.
  /**
   * Train livery variants (wave 4): 3 palettes, each a {body, door} material
   * pair built over the shared body-atlas / door-leaf canvases. Bodies keep
   * the clean metro-livery direction (window band + glass + mullions) and add
   * doors, trim, roof weathering and per-variant roofs.
   * @returns {{key: string, body: THREE.MeshStandardMaterial, door: THREE.MeshStandardMaterial}[]}
   */
  get trainVariants() {
    if (!this._trainVariants) {
      this._trainVariants = TRAIN_LIVERY_VARIANTS.map((v, i) => {
        const body = new THREE.MeshStandardMaterial({
          map: makeTrainAtlasTexture(this.factory, i),
          metalness: 0.25,
          roughness: 0.46,
          envMapIntensity: 0.75,
        });
        body.name = `trainBody:${v.key}`;
        const door = new THREE.MeshStandardMaterial({
          map: makeTrainDoorTexture(this.factory, i),
          metalness: 0.3,
          roughness: 0.42,
          envMapIntensity: 0.7,
        });
        door.name = `trainDoor:${v.key}`;
        return { key: v.key, body, door };
      });
    }
    return this._trainVariants;
  }

  /** Car-number decal material (digit atlas, alpha-cut). */
  get trainDigit() {
    if (!this._trainDigit) {
      this._trainDigit = new THREE.MeshStandardMaterial({
        map: makeTrainDigitTexture(this.factory),
        transparent: false,
        alphaTest: 0.5,
        metalness: 0.1,
        roughness: 0.6,
        envMapIntensity: 0.4,
      });
      this._trainDigit.name = "trainDigit";
      // Digit atlas is one-shot (u 0..1): no wrapping.
      this._trainDigit.map.wrapS = THREE.ClampToEdgeWrapping;
      this._trainDigit.map.wrapT = THREE.ClampToEdgeWrapping;
    }
    return this._trainDigit;
  }

  /** Striped barricade plank material (2 m x 0.3 m face maps the canvas). */
  get barrierStripe() {
    if (!this._barrierStripe) {
      this._barrierStripe = new THREE.MeshStandardMaterial({
        map: makeBarrierStripeTexture(this.factory),
        metalness: 0.08,
        roughness: 0.6,
        envMapIntensity: 0.5,
      });
      this._barrierStripe.name = "barrierStripe";
    }
    return this._barrierStripe;
  }

  /** Gantry sign panel material (STOP + chevrons). */
  get gantrySign() {
    if (!this._gantrySign) {
      this._gantrySign = new THREE.MeshStandardMaterial({
        map: makeGantrySignTexture(this.factory),
        metalness: 0.12,
        roughness: 0.55,
        envMapIntensity: 0.5,
      });
      this._gantrySign.name = "gantrySign";
    }
    return this._gantrySign;
  }

  /** x2 token face material (gold token with "2x"). */
  get pickupToken() {
    if (!this._pickupToken) {
      this._pickupToken = new THREE.MeshStandardMaterial({
        map: makeTokenTexture(this.factory),
        metalness: 0.55,
        roughness: 0.34,
        envMapIntensity: 1.1,
      });
      this._pickupToken.name = "pickupToken";
    }
    return this._pickupToken;
  }

  get treadPlate() { return this.get("treadPlate"); }
  get lensDark() { return this.get("lensDark"); }
  get lensLit() { return this.get("lensLit"); }
  get lampAmber() { return this.get("lampAmber"); }
  get pickupPaint() { return this.get("pickupPaint"); }

  get ballast() { return this.get("ballast"); }
  get concrete() { return this.get("concrete"); }
  get asphalt() { return this.get("asphalt"); }
  get brick() { return this.get("brick"); }
  get wood() { return this.get("wood"); }
  get brushedMetal() { return this.get("brushedMetal"); }
  get paintedSteel() { return this.get("paintedSteel"); }
  get corrugated() { return this.get("corrugated"); }
  get railSteel() { return this.get("railSteel"); }
  get gold() { return this.get("gold"); }
  get steelDark() { return this.get("steelDark"); }
  get plasticDark() { return this.get("plasticDark"); }
  get catSteel() { return this.get("catSteel"); }
  get roofSlab() { return this.get("roofSlab"); }
  // Wave-3 character materials.
  get hoodie() { return this.get("hoodie"); }
  get denim() { return this.get("denim"); }
  get denimCuff() { return this.get("denimCuff"); }
  get skin() { return this.get("skin"); }
  get sneaker() { return this.get("sneaker"); }
  get capPlastic() { return this.get("capPlastic"); }
  get accentOrange() { return this.get("accentOrange"); }
  get packFabric() { return this.get("packFabric"); }
  get creamFabric() { return this.get("creamFabric"); }
  get ink() { return this.get("ink"); }
  get hair() { return this.get("hair"); }

  /**
   * Retrieve the raw texture set behind a textured material (QA/inspection).
   * @param {string} setKey Generator key (e.g. "concrete").
   * @returns {PbrSet}
   */
  textureSet(setKey) {
    return this.factory.getSet(setKey, GENERATORS[setKey]);
  }

  /** Total texture generation time in ms (QA). */
  get generationMs() {
    return this.factory.generationMs;
  }
}

/** Shared singleton. Call init(renderer) once at boot. */
export const materialLibrary = new MaterialLibrary();
