// Seeded RNG (mulberry32) for deterministic combat, travel rolls, and price
// drift. Combat replayability + future multiplayer determinism depend on this.

export function createRng(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(min, max) {
      return min + next() * (max - min);
    },
    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
  };
}

// murmur3 fmix32 — full avalanche so related inputs (day+1, trip+1) produce
// unrelated streams. Without this, consecutive trip rolls correlate badly.
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashSeed(...parts) {
  // FNV-1a over each part, avalanched per part, then a final avalanche over
  // the combined value.
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = fmix32(h);
  }
  return fmix32(h ^ parts.length);
}
