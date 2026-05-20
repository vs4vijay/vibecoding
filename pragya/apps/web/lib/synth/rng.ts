// Deterministic mulberry32-based RNG with normal/uniform/choice helpers.

export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  normal(mean = 0, std = 1): number {
    // Box-Muller. Cache the second sample for the next call.
    if (this._spare !== undefined) {
      const s = this._spare;
      this._spare = undefined;
      return mean + s * std;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2 * Math.PI * v);
    const z1 = mag * Math.sin(2 * Math.PI * v);
    this._spare = z1;
    return mean + z0 * std;
  }
  private _spare: number | undefined;
  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  bool(p: number): boolean {
    return this.next() < p;
  }
  intRange(min: number, max: number): number {
    // inclusive
    return Math.floor(this.uniform(min, max + 1));
  }
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
