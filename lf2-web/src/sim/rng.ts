// spec §2.5 verbatim
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One mulberry32 state transition without materializing the closure.
 * WorldState.rngState is the stored stream position (spec §2.5); draw sites
 * pair mulberry32(state)() for the value with this helper for the advance:
 *   const v = mulberry32(w.rngState)();
 *   w.rngState = stepMulberry32(w.rngState);
 * Must stay byte-identical to the `seed` update inside mulberry32 above.
 */
export function stepMulberry32(state: number): number {
  return ((state | 0) + 0x6D2B79F5) | 0;
}
