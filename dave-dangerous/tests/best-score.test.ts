// tests/best-score.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { BestScore } from "../src/state/BestScore";

describe("BestScore", () => {
  // Node test env has no localStorage — stub it so BestScore's try/catch
  // persistence round-trips instead of silently no-op'ing.
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeStorage());
  });

  it("load on empty store returns 0", () => {
    expect(BestScore.load()).toBe(0);
  });

  it("save/load round-trips", () => {
    BestScore.save(1234);
    expect(BestScore.load()).toBe(1234);
  });

  it("submit higher score returns true and persists", () => {
    BestScore.save(100);
    expect(BestScore.submit(200)).toBe(true);
    expect(BestScore.load()).toBe(200);
  });

  it("submit same or lower score returns false and keeps the old best", () => {
    BestScore.save(200);
    expect(BestScore.submit(200)).toBe(false);
    expect(BestScore.submit(150)).toBe(false);
    expect(BestScore.load()).toBe(200);
  });

  it("a score is a new best exactly once: first run banks it, replay does not", () => {
    expect(BestScore.submit(500)).toBe(true);
    expect(BestScore.submit(500)).toBe(false);
    expect(BestScore.load()).toBe(500);
  });

  it("first-run score above 0 is a new best; score 0 never is", () => {
    expect(BestScore.submit(0)).toBe(false);
    expect(BestScore.load()).toBe(0);
    expect(BestScore.submit(10)).toBe(true);
    expect(BestScore.load()).toBe(10);
  });

  it("corrupt stored data loads as 0 and submit still works", () => {
    localStorage.setItem(BestScore.KEY, "not-json");
    expect(BestScore.load()).toBe(0);
    localStorage.setItem(BestScore.KEY, "{}");
    expect(BestScore.load()).toBe(0);
    expect(BestScore.submit(42)).toBe(true);
    expect(BestScore.load()).toBe(42);
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
