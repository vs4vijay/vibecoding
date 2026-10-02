/**
 * @file core/rng.js
 * Deterministic seeded PRNG (mulberry32) with convenience helpers.
 * The run seed comes from ?seed=N for reproducible worlds/screenshots,
 * falling back to time-based seeding for normal play.
 */

/**
 * Create a mulberry32 generator.
 * @param {number} seed 32-bit integer seed.
 * @returns {() => number} Function producing floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash arbitrary integers into a single 32-bit seed (for per-chunk streams).
 * @param {...number} parts Integer components.
 * @returns {number} 32-bit seed.
 */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts[i] | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  return h >>> 0;
}

/** RNG wrapper with ergonomic helpers. */
export class Rng {
  /**
   * @param {number} seed 32-bit integer seed.
   */
  constructor(seed) {
    this._next = mulberry32(seed);
  }

  /** @returns {number} Float in [0, 1). */
  next() {
    return this._next();
  }

  /**
   * Float in [min, max).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  range(min, max) {
    return min + (max - min) * this._next();
  }

  /**
   * Integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  int(min, max) {
    return min + Math.floor(this._next() * (max - min + 1));
  }

  /**
   * Pick a random element.
   * @template T
   * @param {T[]} arr
   * @returns {T}
   */
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }

  /**
   * True with probability p.
   * @param {number} p Probability in [0, 1].
   * @returns {boolean}
   */
  chance(p) {
    return this._next() < p;
  }

  /**
   * In-place Fisher-Yates shuffle.
   * @template T
   * @param {T[]} arr
   * @returns {T[]} The same array, shuffled.
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

let runSeed = 0;

/**
 * Resolve the run seed: ?seed=N if provided, else time-based.
 * Call once at boot; subsequent getRunSeed() calls return the same value.
 * @param {URLSearchParams} [params]
 * @returns {number}
 */
export function initRunSeed(params) {
  const raw = params ? params.get("seed") : null;
  const parsed = raw === null ? NaN : parseInt(raw, 10);
  runSeed =
    Number.isFinite(parsed) && raw !== ""
      ? parsed >>> 0
      : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return runSeed;
}

/** @returns {number} The run seed set by initRunSeed(). */
export function getRunSeed() {
  return runSeed;
}

/**
 * A derived stream for a sub-system (e.g. chunk index k of world W).
 * @param {...number} parts Components (typically runSeed + index).
 * @returns {Rng}
 */
export function rngFor(...parts) {
  return new Rng(hashSeed(...parts));
}
