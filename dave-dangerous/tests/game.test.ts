// tests/game.test.ts
import { describe, expect, it } from "vitest";
import { GAME_FLOW, GAME_FLOW_KEYS } from "../src/game";

describe("game flow", () => {
  it("GAME_FLOW declares playing and gameover", () => {
    expect(GAME_FLOW).toContain("playing");
    expect(GAME_FLOW).toContain("gameover");
    expect(GAME_FLOW_KEYS).toEqual(expect.objectContaining({ playing: "playing", gameover: "gameover" }));
  });
});
