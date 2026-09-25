/**
 * @file core/rng.js — deterministic mulberry32 PRNG (bible rule 7).
 * Run seed from ?seed=N; per-chunk streams via hashSeed(runSeed, tag, index).
 */

/** @returns {() => number} floats in [0, 1). */
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

/** FNV-style mix of integer parts into one 32-bit seed. */
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

export class Rng {
  constructor(seed) {
    this._next = mulberry32(seed);
  }
  next() {
    return this._next();
  }
  range(min, max) {
    return min + (max - min) * this._next();
  }
  int(min, max) {
    return min + Math.floor(this._next() * (max - min + 1));
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }
  chance(p) {
    return this._next() < p;
  }
  sign() {
    return this._next() < 0.5 ? -1 : 1;
  }
}

let runSeed = 0;

/** Resolve the run seed: ?seed=N else time-based. Call once at boot. */
export function initRunSeed(params) {
  const raw = params ? params.get("seed") : null;
  const parsed = raw === null ? NaN : parseInt(raw, 10);
  runSeed =
    Number.isFinite(parsed) && raw !== ""
      ? parsed >>> 0
      : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return runSeed;
}

export function getRunSeed() {
  return runSeed;
}

/** Derived stream for a sub-system (seed + numeric tag + index). */
export function rngFor(...parts) {
  return new Rng(hashSeed(...parts));
}
