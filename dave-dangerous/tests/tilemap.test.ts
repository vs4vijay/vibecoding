// tests/tilemap.test.ts
import { describe, expect, it } from "vitest";
import { TileMap, TILE_DEFS } from "../src/world/TileMap";

function emptyScreen(w = 20, h = 13) {
  return { width: w, height: h, tiles: new Array(w * h).fill(0), entities: [] };
}

describe("TileMap", () => {
  it("exposes tile defs with expected flags", () => {
    expect(TILE_DEFS[0]!.flags).toEqual({ solid: false, climbable: false, lethal: false, warp: false, illusory: false });
    expect(TILE_DEFS[1]!.flags.solid).toBe(true);
    expect(TILE_DEFS[3]!.flags.lethal).toBe(true);
    expect(TILE_DEFS[4]!.flags.climbable).toBe(true);
    expect(TILE_DEFS[5]!.flags.illusory).toBe(true);
  });
  it("reports solid tiles within a rect", () => {
    const s = emptyScreen();
    s.tiles[10 * 20 + 5] = 1; // solid at (5,10)
    const m = new TileMap(s);
    expect(m.solidCollides({ x: 5 * 16, y: 10 * 16, w: 16, h: 16 })).not.toBeNull();
    expect(m.solidCollides({ x: 0, y: 0, w: 16, h: 16 })).toBeNull();
  });
  it("detects lethal tiles", () => {
    const s = emptyScreen();
    s.tiles[2 * 20 + 8] = 3; // lava at (8,2)
    const m = new TileMap(s);
    expect(m.isLethalAt(8 * 16 + 2, 2 * 16 + 2)).toBe(true);
    expect(m.isLethalAt(0, 0)).toBe(false);
  });
  it("out-of-bounds is solid (walls)", () => {
    const m = new TileMap(emptyScreen());
    expect(m.tileIndexAt(-1, 0)).toBe(-1);
    expect(m.tileIndexAt(0, -1)).toBe(-1);
    expect(m.solidCollides({ x: -10, y: 0, w: 16, h: 16 })).not.toBeNull();
  });
});
