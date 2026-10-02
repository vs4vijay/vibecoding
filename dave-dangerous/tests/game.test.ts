// tests/game.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { GAME_FLOW, GAME_FLOW_KEYS, respawnPos } from "../src/game";
import { World } from "../src/world/World";
import { GameState } from "../src/state/GameState";
import { BestScore } from "../src/state/BestScore";
import { RNG } from "../src/core/RNG";
import { LEVEL_1 } from "../src/levels/levels";
import { shouldConfirmNewGame } from "../src/render3d/ui/UI";
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

// Game builds a WebGL view, so node tests exercise the banking rule Game.bankBest()
// relies on through BestScore with stubbed storage; the persist side-effect is
// asserted via BestScore.load().
describe("best-score banking", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeStorage());
  });

  it("a run higher than the best banks as new best exactly once and persists (max seen)", () => {
    expect(BestScore.submit(1000)).toBe(true);
    expect(BestScore.load()).toBe(1000);
    expect(BestScore.submit(1000)).toBe(false); // same value again: not a new best
    expect(BestScore.load()).toBe(1000);
  });

  it("equal or lower run scores never bank", () => {
    BestScore.save(2000);
    expect(BestScore.submit(2000)).toBe(false);
    expect(BestScore.submit(1500)).toBe(false);
    expect(BestScore.load()).toBe(2000);
  });

  it("successive better runs raise the banked best", () => {
    BestScore.submit(500);
    BestScore.submit(1200);
    BestScore.submit(800);
    expect(BestScore.load()).toBe(1200);
  });
});

// In-memory Storage stand-in: a fresh store per test keeps BestScore isolated.
function makeFakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

// Task 4.2: the confirm gate is a pure rule; Game and UI need a browser
// (WebGL/DOM), so node coverage pins the rule only — the dialog wiring itself
// is verified by a browser walkthrough. UI.ts is imported at module scope with
// no DOM access, so this is node-safe (UI is never instantiated here).
describe("new game confirm gate", () => {
  it("no save → start immediately (CONTINUE is hidden anyway)", () => {
    expect(shouldConfirmNewGame(false)).toBe(false);
  });

  it("saved run → ask for confirmation before overwriting", () => {
    expect(shouldConfirmNewGame(true)).toBe(true);
  });
});