// tests/item.test.ts
import { describe, expect, it } from "vitest";
import { Item } from "../src/entities/Item";
import { GameState } from "../src/state/GameState";
import { Dave } from "../src/entities/Dave";
import { TileMap } from "../src/world/TileMap";
import type { ScreenMap } from "../src/core/types";

function mapAt(x: number, y: number, id = 1): TileMap {
  const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities: [] };
  s.tiles[y * 20 + x] = id;
  return new TileMap(s);
}

describe("Item", () => {
  it("orb adds 50 points and marks collected", () => {
    const item = new Item({ type: "orb", x: 5, y: 10 });
    const st = new GameState();
    const d = new Dave(5 * 16, 10 * 16);
    const hit = item.tryCollect(d, st);
    expect(hit).toBe(true);
    expect(st.score).toBe(50);
    expect(item.collected).toBe(true);
  });
  it("gun pickup grants gun", () => {
    const item = new Item({ type: "gun", x: 5, y: 10 });
    const st = new GameState();
    const d = new Dave(5 * 16, 10 * 16);
    item.tryCollect(d, st);
    expect(st.hasGun).toBe(true);
  });
  it("jetpack pickup refuels to 60", () => {
    const item = new Item({ type: "jetpack", x: 5, y: 10 });
    const st = new GameState();
    const d = new Dave(5 * 16, 10 * 16);
    item.tryCollect(d, st);
    expect(st.jetpackFuel).toBe(60);
  });
  it("does not collect when far away", () => {
    const item = new Item({ type: "orb", x: 5, y: 10 });
    const st = new GameState();
    const d = new Dave(0, 0);
    expect(item.tryCollect(d, st)).toBe(false);
    expect(st.score).toBe(0);
  });
});
