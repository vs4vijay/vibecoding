// tests/sprites.test.ts
import { describe, expect, it } from "vitest";
import { PALETTE_0, PALETTE_1, SPRITES } from "../src/render/sprites";

describe("sprites", () => {
  it("palette constants match spec", () => {
    expect(PALETTE_0).toEqual([0x000000, 0x00aa00, 0xaa00aa, 0xaaaaaa]);
    expect(PALETTE_1).toEqual([0x000000, 0xaa0000, 0x00aaaa, 0xffffff]);
  });
  it("every sprite is 16×16 and uses palette indices 0-3", () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      expect(rows.length, name).toBe(16);
      for (const row of rows) {
        expect(row.length, name).toBe(16);
        for (const ch of row) {
          expect(Number(ch), name).toBeGreaterThanOrEqual(0);
          expect(Number(ch), name).toBeLessThanOrEqual(3);
        }
      }
    }
  });
  it("has all required names", () => {
    const required = ["dave_stand", "dave_walk1", "dave_walk2", "dave_jump", "tile_ground", "trophy", "door_open", "bullet"];
    for (const n of required) expect(SPRITES[n], n).toBeDefined();
  });
});
