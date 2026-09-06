// tests/state.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { GameState, ITEM_VALUES } from "../src/state/GameState";
import { SaveState } from "../src/state/SaveState";
import type { SaveData } from "../src/state/SaveState";

describe("GameState", () => {
  let g: GameState;
  beforeEach(() => { g = new GameState(); });

  it("starts with 4 lives and 0 score", () => {
    expect(g.lives).toBe(4);
    expect(g.score).toBe(0);
  });
  it("adds item values (orb 50, trophy 1000)", () => {
    g.addScore(ITEM_VALUES.orb);
    g.addScore(ITEM_VALUES.trophy);
    expect(g.score).toBe(1050);
  });
  it("caps score at 99999", () => {
    g.addScore(99999 + 500);
    expect(g.score).toBe(99999);
  });
  it("loseLife decrements; returns false at 0", () => {
    g.lives = 2;
    expect(g.loseLife()).toBe(true);
    expect(g.loseLife()).toBe(false);
    expect(g.lives).toBe(0);
  });
  it("addScore 2000 at exit", () => {
    g.addScore(1000);
    g.addScore(2000);
    expect(g.score).toBe(3000);
  });
});

describe("SaveState", () => {
  // Node test env has no localStorage (node v24: undefined) — stub it so
  // SaveState's try/catch persistence round-trips instead of silently no-op'ing.
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeStorage());
  });

  it("persists and reloads", () => {
    SaveState.clear();
    expect(SaveState.load()).toBeNull();
    const s: SaveData = { lives: 3, score: 12345, level: 2, hasGun: true, jetpackFuel: 30 };
    SaveState.persist(s);
    expect(SaveState.load()).toEqual(s);
  });
});

// In-memory Storage stand-in: a fresh store per test keeps SaveState isolated.
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
