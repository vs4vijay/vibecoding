import { describe, expect, it } from "vitest";
import { Scoring } from "../src/game/scoring";

describe("Scoring", () => {
  it("awards base points and distance", () => {
    const s = new Scoring();
    s.addDistance(100);
    expect(s.registerKill("walker", false)).toBe(25);
    expect(s.registerKill("brute", false)).toBe(150);
    expect(s.score).toBe(175 + 100);
    expect(s.level()).toBe(1);
  });
  it("streak multipliers at tiers 3/6/9 and decay after 4s idle", () => {
    const s = new Scoring();
    for (let i = 0; i < 3; i++) s.registerKill("walker", false);
    expect(s.multiplier).toBe(2);
    for (let i = 0; i < 3; i++) s.registerKill("runner", false);
    expect(s.multiplier).toBe(3);
    for (let i = 0; i < 3; i++) s.registerKill("walker", false);
    expect(s.multiplier).toBe(4);
    s.update(4.01);
    expect(s.multiplier).toBe(1);
    expect(s.streak).toBe(0);
  });
  it("scrape kill doubles points", () => {
    const s = new Scoring();
    expect(s.registerKill("runner", true)).toBe(100);
  });
});
