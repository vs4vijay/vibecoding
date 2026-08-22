import { describe, expect, it } from "vitest";
import { knobsForLevel, levelForScore, scoreForLevel } from "../src/game/difficulty";

describe("difficulty", () => {
  it("score thresholds follow 400*(n-1)^1.35 and grow monotonically", () => {
    expect(scoreForLevel(1)).toBe(0);
    expect(scoreForLevel(2)).toBe(400);
    expect(scoreForLevel(3)).toBe(Math.round(400 * Math.pow(2, 1.35)));
    for (let n = 1; n < 30; n++) expect(scoreForLevel(n + 1)).toBeGreaterThan(scoreForLevel(n));
  });
  it("levelForScore inverts the curve", () => {
    expect(levelForScore(0)).toBe(1);
    expect(levelForScore(399)).toBe(1);
    expect(levelForScore(400)).toBe(2);
    expect(levelForScore(scoreForLevel(7))).toBe(7);
  });
  it("knobs ramp and respect hard caps", () => {
    const l1 = knobsForLevel(1);
    expect(l1).toMatchObject({ spawnIntervalMs: 1600, maxZombies: 2, cruiseSpeed: 28, leapAccuracy: 0.55, obstacleDensity: 0.4 });
    expect(l1.types).toEqual(["walker"]);
    expect(knobsForLevel(2).types).toEqual(["walker", "runner"]);
    expect(knobsForLevel(3).types).toEqual(["walker", "runner", "brute"]);
    const capped = knobsForLevel(99);
    expect(capped.spawnIntervalMs).toBe(450);
    expect(capped.maxZombies).toBe(8);
    expect(capped.leapAccuracy).toBe(0.95);
    expect(capped.cruiseSpeed).toBe(52);
    expect(capped.obstacleDensity).toBe(1);
  });
});
