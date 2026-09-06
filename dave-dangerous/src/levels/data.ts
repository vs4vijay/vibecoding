// src/levels/data.ts
import type { LevelData } from "../core/types";

export function validateLevel(l: LevelData): LevelData {
  if (!l.screens || l.screens.length === 0) throw new Error("level needs ≥1 screen");
  if (l.startScreen < 0 || l.startScreen >= l.screens.length) throw new Error("bad startScreen");
  for (const [i, s] of l.screens.entries()) {
    if (s.width <= 0 || s.height <= 0 || s.tiles.length !== s.width * s.height) {
      throw new Error(`screen ${i}: tile array length mismatch`);
    }
    if (!s.entities.some(e => e.type === "dave")) throw new Error(`screen ${i}: missing dave spawn`);
  }
  return l;
}
