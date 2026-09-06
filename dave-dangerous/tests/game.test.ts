// tests/game.test.ts
import { describe, expect, it } from "vitest";
import { GAME_FLOW, GAME_FLOW_KEYS, respawnPos } from "../src/game";
import { World } from "../src/world/World";
import { GameState } from "../src/state/GameState";
import { RNG } from "../src/core/RNG";
import { LEVEL_1 } from "../src/levels/levels";
import { clearAll } from "../src/core/Events";
describe("game flow", () => {
  it("GAME_FLOW declares playing and gameover", () => {
    expect(GAME_FLOW).toContain("playing");
    expect(GAME_FLOW).toContain("gameover");
    expect(GAME_FLOW_KEYS).toEqual(expect.objectContaining({ playing: "playing", gameover: "gameover" }));
  });
});


describe("respawn", () => {
  it("respawnPos returns the level's dave spawn in pixels (floor top)", () => {
    expect(respawnPos(LEVEL_1)).toEqual({ x: 48, y: 160 });
  });

  it("dave at respawnPos moves freely under held right input (no floor wedge)", () => {
    clearAll();
    const w = new World(LEVEL_1, new GameState());
    w.dave.pos = respawnPos(LEVEL_1);
    const holdRight = { left: false, right: true, jump: false, jetpack: false, fire: false };
    const rng = new RNG(7);
    for (let i = 0; i < 60; i++) w.update(holdRight, rng);
    expect(w.dave.alive).toBe(true);
    expect(w.dave.pos.x).toBeGreaterThan(60); // old y=176 respawn froze x at ~44
  });
});