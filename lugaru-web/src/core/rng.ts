/**
 * Seeded PRNG (mulberry32) — the sanctioned randomness primitive for sim code.
 *
 * Returns a closure; EACH CALL ADVANCES INTERNAL STATE, so successive calls
 * yield the next number of the sequence. Same seed -> identical sequence;
 * deterministic across platforms (pure 32-bit int math, no Math.random()).
 * @param seed any 32-bit unsigned integer
 * @returns uniform float in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded PRNG closure: each call returns the next uniform value in [0,1). */
export type Rng = () => number;
