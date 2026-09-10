import { describe, test, expect } from "bun:test";
import { mulberry32 } from "../../src/sim/rng";

describe("mulberry32", () => {
  test("same seed → identical sequence", () => {
    const a = mulberry32(1234); const b = mulberry32(1234);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test("different seed → different sequence", () => {
    const a = mulberry32(1)(); const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  test("values in [0,1), roughly uniform", () => {
    const g = mulberry32(42);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) { const v = g(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); sum += v; }
    expect(Math.abs(sum / 10_000 - 0.5)).toBeLessThan(0.02);
  });
});
