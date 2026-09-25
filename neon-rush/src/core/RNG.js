// mulberry32 — seeded PRNG. All world/gen randomness flows through one run RNG
// so warp() and realtime play produce identical streams for a given seed.
export function RNG(seed) {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r, min, max) => min + r() * (max - min);
export const int = (r, min, max) => Math.floor(min + r() * (max - min + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const chance = (r, p) => r() < p;

// entries: [[value, weight], ...]
export function weighted(r, entries) {
  let total = 0;
  for (let i = 0; i < entries.length; i++) total += entries[i][1];
  let x = r() * total;
  for (let i = 0; i < entries.length; i++) {
    x -= entries[i][1];
    if (x <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

export function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Weighted shuffle: repeatedly weighted-pick without replacement → order array.
export function weightedShuffle(r, entries) {
  const pool = entries.slice();
  const out = [];
  while (pool.length) {
    const v = weighted(r, pool);
    out.push(v);
    for (let i = 0; i < pool.length; i++) {
      if (pool[i][0] === v) { pool.splice(i, 1); break; }
    }
  }
  return out;
}
