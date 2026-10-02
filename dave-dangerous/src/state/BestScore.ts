// src/state/BestScore.ts
export class BestScore {
  static readonly KEY = "dave-dangerous-best";
  static load(): number {
    try {
      const raw = localStorage.getItem(BestScore.KEY);
      if (!raw) return 0;
      const n = JSON.parse(raw) as unknown;
      if (typeof n !== "number") return 0;
      return n;
    } catch { return 0; }
  }
  static save(n: number): void {
    try { localStorage.setItem(BestScore.KEY, JSON.stringify(n)); } catch { /* noop */ }
  }
  static submit(score: number): boolean {
    if (score > BestScore.load()) {
      BestScore.save(score);
      return true;
    }
    return false;
  }
}
