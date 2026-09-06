// tests/tiles.test.ts
import { describe, expect, it } from "vitest";
import { TILE_NAMES } from "../src/render/Tiles";
import { TILE_DEFS } from "../src/world/TileMap";
import { SPRITES } from "../src/render/sprites";

describe("Tiles", () => {
  it("every non-empty tile def has a sprite", () => {
    for (const [id, def] of Object.entries(TILE_DEFS)) {
      if (Number(id) === 0) continue;
      const name = TILE_NAMES[Number(id)];
      expect(name, `tile ${id}`).toBeDefined();
      expect(SPRITES[name!], `tile ${id} → ${name}`).toBeDefined();
    }
  });
});
