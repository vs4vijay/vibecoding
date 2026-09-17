// Seeded RNG (mulberry32). Every race creates one RNG from its seed; all sim
// randomness must flow through it so runs are reproducible (GAMES.md gotcha:
// seed per race, never per page load).

export class RNG {
  private s: number;

  constructor(seed: number) {
    // Fold the seed so small integers still spread across the state space.
    this.s = (seed | 0) + 0x6d2b79f5;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("RNG.pick on empty array");
    return arr[this.int(0, arr.length)] as T;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Independent child stream (does not advance this one). */
  fork(seed: number): RNG {
    return new RNG((this.s ^ Math.imul(seed + 1, 0x9e3779b9)) >>> 0);
  }
}
