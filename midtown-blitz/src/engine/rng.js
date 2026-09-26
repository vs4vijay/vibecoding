/**
 * Seedable PRNG utilities (Midtown Blitz engine).
 *
 * A tiny mulberry32-style generator (design Decision 2: "math/PRNG helpers,
 * seedable RNG" live in the engine layer). Everything here is pure ES with
 * no DOM/three dependency, so node harnesses (scripts/*-test.mjs) and the
 * deterministic city generator (src/game/city-gen.js) can drive it directly.
 *
 * Stream discipline: every consumer that needs randomness creates its own
 * stream via {@link createRng} (or forks an existing one with
 * `rng.fork('label')`) instead of sharing one — that way adding a draw in
 * one phase never shifts the number sequence another phase sees. `fork`
 * derives a child seed from the parent's *current* internal state plus a
 * label, so fork call order is part of the deterministic contract.
 *
 * All results are plain IEEE-754 operations, so the same seed yields the
 * same sequence on every run/platform V8 runs on (byte-identical dumps are
 * verified by scripts/city-gen-test.mjs).
 */

/**
 * FNV-1a 32-bit hash of a string, for turning string seeds ("midtown-blitz-v1")
 * into uint32 generator seeds deterministically.
 * @param {string} str Arbitrary string to hash.
 * @returns {number} Unsigned 32-bit hash.
 */
export function hashStringToUint32(str) {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}

/**
 * Raw mulberry32 step function: returns a closure producing floats in
 * [0, 1) from a 32-bit seed. Exposed for completeness/tests; most code
 * should use {@link createRng} for the range/pick/chance helpers.
 * @param {number} seed Uint32 seed.
 * @returns {() => number} Step function yielding floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Handle for a created RNG stream.
 *
 * @typedef {object} Rng
 * @property {() => number} next Next float in [0, 1).
 * @property {(min: number, max: number) => number} float Float in [min, max).
 * @property {(min: number, max: number) => number} int Integer in [min, max]
 *   (both ends inclusive).
 * @property {<T>(items: T[]) => T} pick Uniform pick from a non-empty array.
 * @property {(p: number) => boolean} chance True with probability p (0..1).
 * @property {(label: string) => Rng} fork Derive an independent child
 *   stream from this stream's current state + a label.
 * @property {() => number} state Current internal uint32 state (for
 *   debugging/deriving child seeds; reading does not advance the stream).
 */

/**
 * Create a seeded RNG stream from a number or string seed.
 * @param {number | string} seed Uint32 number or arbitrary string
 *   (strings are hashed with {@link hashStringToUint32}).
 * @returns {Rng} The RNG stream.
 */
export function createRng(seed) {
  if (typeof seed !== 'string' && !Number.isFinite(Number(seed))) {
    throw new TypeError(`createRng: seed must be a finite number or string, got ${String(seed)}`);
  }
  const seedUint32 =
    typeof seed === 'string' ? hashStringToUint32(seed) : (Number(seed) >>> 0);

  let a = seedUint32;

  /** @returns {number} Next float in [0, 1). */
  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,

    /**
     * Float in [min, max).
     * @param {number} min Inclusive lower bound.
     * @param {number} max Exclusive upper bound.
     * @returns {number} Drawn float.
     */
    float(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
        throw new RangeError(`rng.float: invalid range [${min}, ${max})`);
      }
      return min + next() * (max - min);
    },

    /**
     * Integer in [min, max], both ends inclusive.
     * @param {number} min Inclusive lower bound.
     * @param {number} max Inclusive upper bound.
     * @returns {number} Drawn integer.
     */
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`rng.int: invalid inclusive range [${min}, ${max}]`);
      }
      const span = max - min + 1;
      return Math.min(max, min + Math.floor(next() * span));
    },

    /**
     * Uniform pick from a non-empty array.
     * @template T
     * @param {T[]} items Items to pick from.
     * @returns {T} The picked item.
     */
    pick(items) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new TypeError('rng.pick: needs a non-empty array');
      }
      return items[this.int(0, items.length - 1)];
    },

    /**
     * True with probability p.
     * @param {number} p Probability in [0, 1].
     * @returns {boolean} Draw outcome.
     */
    chance(p) {
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        throw new RangeError(`rng.chance: probability must be in [0, 1], got ${p}`);
      }
      return next() < p;
    },

    /**
     * Derive an independent child stream from this stream's current state
     * and a label. The parent does not advance. Two forks with the same
     * label from the same state give the same child — use distinct labels
     * per phase (and fork in a fixed order) to keep generation
     * deterministic.
     * @param {string} label Label mixed into the child seed.
     * @returns {Rng} Child stream.
     */
    fork(label) {
      const childSeed =
        (Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ hashStringToUint32(String(label))) >>> 0;
      return createRng(childSeed);
    },

    /** @returns {number} Current internal uint32 state (read-only). */
    state() {
      return a >>> 0;
    },
  };
}
