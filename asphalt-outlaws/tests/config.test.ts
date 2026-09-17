import { describe, expect, test } from "bun:test";
import { BIKES, ECONOMY, HUD, LEVELS, RIVAL_COLORS, RIVAL_NAMES } from "../src/config";
import { SIM } from "../src/config";
import { MAX_SPEED } from "../src/config";

describe("config sanity", () => {
  test("max speed is one segment per tick", () => {
    expect(MAX_SPEED).toBeCloseTo(SIM.segmentLength / SIM.step);
  });

  test("five levels, all qualified fields in range", () => {
    expect(LEVELS).toHaveLength(5);
    for (const l of LEVELS) {
      expect(l.lengthSegs).toBeGreaterThan(1000);
      expect(l.curves >= 0 && l.curves <= 1).toBe(true);
      expect(l.hills >= 0 && l.hills <= 1).toBe(true);
      expect(l.rivalSkill >= 0 && l.rivalSkill <= 1).toBe(true);
      expect(l.qualifyPlace).toBeGreaterThanOrEqual(2);
      expect(l.qualifyPlace).toBeLessThanOrEqual(l.rivalCount + 1);
      expect(l.prize).toBeGreaterThan(0);
      expect(l.palette.skyTop).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // difficulty ramps
    expect(LEVELS[0]!.rivalSkill).toBeLessThan(LEVELS[4]!.rivalSkill);
    expect(LEVELS[0]!.prize).toBeLessThan(LEVELS[4]!.prize);
  });

  test("three bikes with sane multipliers", () => {
    expect(BIKES).toHaveLength(3);
    for (const b of BIKES) {
      expect(b.topSpeedMul).toBeGreaterThan(0.5);
      expect(b.topSpeedMul).toBeLessThan(1.5);
      expect(b.weight).toBeGreaterThan(0);
    }
  });

  test("enough names and colors for the grid", () => {
    expect(RIVAL_NAMES.length).toBeGreaterThanOrEqual(LEVELS[0]!.rivalCount);
    expect(RIVAL_COLORS.length).toBeGreaterThanOrEqual(LEVELS[0]!.rivalCount);
    expect(HUD.countdownTime).toBeGreaterThan(3);
    expect(ECONOMY.startMoney).toBeGreaterThanOrEqual(0);
  });
});
