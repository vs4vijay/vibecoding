// tests/world.test.ts
import { describe, expect, it } from "vitest";
import { World } from "../src/world/World";
import { GameState } from "../src/state/GameState";
import { RNG } from "../src/core/RNG";
import { LEVEL_1 } from "../src/levels/levels";
import { on, clearAll } from "../src/core/Events";
import type { EntitySpawn, LevelData, ScreenMap } from "../src/core/types";

function screenWith(entities: EntitySpawn[], mutate?: (s: ScreenMap) => void): ScreenMap {
  const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities, warps: [] };
  mutate?.(s);
  return s;
}
const withFloor = (s: ScreenMap) => { for (let c = 0; c < 20; c++) s.tiles[12 * 20 + c] = 1; };
const idle = { left: false, right: false, jump: false, jetpack: false, fire: false };

describe("World", () => {
  it("collects nearby item within pipeline", () => {
    clearAll();
    const st = new GameState();
    const w = new World(LEVEL_1, st);
    w.dave.pos = { x: 5 * 16, y: 8 * 16 }; // orb at (5,8)
    w.dave.grounded = true;
    const input = { left: false, right: false, jump: false, jetpack: false, fire: false };
    w.update(input, new RNG(1));
    expect(st.score).toBe(50);
  });
  it("trophy + exit door triggers level complete", () => {
    clearAll();
    let done = false;
    on("level:complete", () => { done = true; });
    const st = new GameState();
    const w = new World(LEVEL_1, st);
    w.door.opened = true;
    w.dave.pos = { x: 18 * 16 + 4, y: 11 * 16 }; // at door
    w.dave.grounded = true;
    const input = { left: false, right: false, jump: false, jetpack: false, fire: false };
    w.update(input, new RNG(1));
    expect(done).toBe(true);
  });
  it("lethal lava kills dave", () => {
    clearAll();
    const st = new GameState();
    const level: LevelData = {
      id: 3, name: "lava", startScreen: 0,
      screens: [screenWith(
        [{ type: "dave", x: 8, y: 2 }, { type: "exitDoor", x: 18, y: 11 }],
        s => { s.tiles[2 * 20 + 8] = 3; }, // lava at (8,2)
      )],
    };
    const w = new World(level, st);
    w.update(idle, new RNG(1));
    expect(w.dave.alive).toBe(false);
  });
  it("jetpack pickup fills state fuel and burning drains it back", () => {
    clearAll();
    const st = new GameState();
    const level: LevelData = {
      id: 4, name: "fuel", startScreen: 0,
      screens: [screenWith(
        [{ type: "dave", x: 2, y: 11 }, { type: "jetpack", x: 4, y: 11 }, { type: "exitDoor", x: 18, y: 11 }],
        withFloor,
      )],
    };
    const w = new World(level, st);
    w.dave.pos = { x: 4 * 16, y: 11 * 16 };
    w.update(idle, new RNG(1));
    expect(st.jetpackFuel).toBe(60);
    const jet = { ...idle, jetpack: true };
    for (let i = 0; i < 15; i++) w.update(jet, new RNG(1));
    expect(st.jetpackFuel).toBeLessThan(60);
    expect(st.jetpackFuel).toBeGreaterThan(0);
  });
  it("emits dave:die exactly once when two enemies contact dave in one tick", () => {
    clearAll();
    let deaths = 0;
    on("dave:die", () => { deaths++; });
    const st = new GameState();
    const spider = { type: "spider" as const, x: 10, y: 11, props: { patrol: [10, 10], speed: 0 } };
    const level: LevelData = {
      id: 5, name: "contact", startScreen: 0,
      screens: [screenWith(
        [{ type: "dave", x: 10, y: 11 }, spider, { ...spider }, { type: "exitDoor", x: 18, y: 11 }],
        withFloor,
      )],
    };
    const w = new World(level, st);
    w.spawnEnemies(new RNG(1));
    w.update(idle, new RNG(1));
    expect(w.dave.alive).toBe(false);
    expect(deaths).toBe(1);
    expect(w.enemies[1]!.dead).toBe(false); // guard skips the second enemy entirely
  });
});
