import { describe, expect, test } from "bun:test";
import {
  approach,
  clamp,
  easeInOut,
  easeIn,
  easeOut,
  invLerp,
  lerp,
  wrap,
} from "../src/core/math";

describe("math", () => {
  test("clamp", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clamp(1.5, 0, 3)).toBe(1.5);
  });

  test("lerp / invLerp round-trip", () => {
    expect(lerp(10, 20, 0.25)).toBeCloseTo(12.5);
    expect(invLerp(10, 20, 12.5)).toBeCloseTo(0.25);
    expect(invLerp(5, 5, 1)).toBe(0); // degenerate range
  });

  test("approach never overshoots", () => {
    expect(approach(0, 10, 4)).toBe(4);
    expect(approach(0, 10, 40)).toBe(10);
    expect(approach(10, 0, 40)).toBe(0);
  });

  test("eases hit endpoints", () => {
    for (const e of [easeIn, easeOut, easeInOut]) {
      expect(e(0, 10, 0)).toBe(0);
      expect(e(0, 10, 1)).toBeCloseTo(10);
    }
  });

  test("wrap handles negatives", () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(11, 10)).toBe(1);
    expect(wrap(5, 10)).toBe(5);
  });
});
