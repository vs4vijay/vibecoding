// tests/projectile.test.ts
import { describe, expect, it } from "vitest";
import { Projectile } from "../src/entities/Projectile";
import { TileMap } from "../src/world/TileMap";
import type { ScreenMap } from "../src/core/types";

function map(): TileMap {
  const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities: [] };
  s.tiles[6 * 20 + 10] = 1; // wall at (10,6)
  return new TileMap(s);
}

describe("Projectile", () => {
  it("moves and stays alive in open space", () => {
    const p = new Projectile({ x: 50, y: 100 }, { x: 6, y: 0 }, "dave");
    const alive = p.update(map());
    expect(p.pos.x).toBeGreaterThan(50);
    expect(alive).toBe(true);
  });
  it("dies on solid collision", () => {
    const p = new Projectile({ x: 9 * 16 + 8, y: 6 * 16 + 4 }, { x: 6, y: 0 }, "dave");
    let alive = true;
    for (let i = 0; i < 10 && alive; i++) alive = p.update(map());
    expect(p.spent).toBe(true);
  });
});
