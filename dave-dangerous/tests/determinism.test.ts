// tests/determinism.test.ts
import { describe, expect, it } from "vitest";
import { World } from "../src/world/World";
import { GameState } from "../src/state/GameState";
import { RNG } from "../src/core/RNG";
import { LEVEL_1 } from "../src/levels/levels";
import type { InputState } from "../src/core/types";

const IDLE: InputState = { left: false, right: false, jump: false, jetpack: false, fire: false };

function runTicks(seed: number, ticks: number) {
  const st = new GameState();
  const w = new World(LEVEL_1, st);
  w.spawnEnemies(new RNG(seed));
  const rng = new RNG(seed);
  for (let i = 0; i < ticks; i++) w.update(IDLE, rng);
  return {
    score: st.score,
    lives: st.lives,
    davePos: { ...w.dave.pos },
    rngState: rng.serialize(),
  };
}

describe("determinism", () => {
  it("same seed + same input → identical state", () => {
    const a = runTicks(0xdeadbeef, 600);
    const b = runTicks(0xdeadbeef, 600);
    expect(b).toEqual(a);
  });
  it("different seeds diverge", () => {
    const a = runTicks(1, 600);
    const b = runTicks(2, 600);
    expect(b.rngState).not.toBe(a.rngState);
  });
});
