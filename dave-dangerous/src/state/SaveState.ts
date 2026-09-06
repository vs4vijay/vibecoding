// src/state/SaveState.ts
export interface SaveData {
  lives: number;
  score: number;
  level: number;
  hasGun: boolean;
  jetpackFuel: number;
}

export class SaveState {
  static readonly KEY = "dave-dangerous-save";
  static load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SaveState.KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      if (typeof d.lives !== "number" || typeof d.score !== "number") return null;
      return d;
    } catch { return null; }
  }
  static persist(s: SaveData): void {
    try { localStorage.setItem(SaveState.KEY, JSON.stringify(s)); } catch { /* noop */ }
  }
  static clear(): void {
    try { localStorage.removeItem(SaveState.KEY); } catch { /* noop */ }
  }
}
