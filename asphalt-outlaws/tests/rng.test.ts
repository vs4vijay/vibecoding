import { describe, expect, test } from "bun:test";
import { RNG } from "../src/core/rng";

describe("RNG", () => {
  test("same seed => same sequence", () => {
    const a = new RNG(1234);
    const b = new RNG(1234);
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds diverge", () => {
    const a = new RNG(1);
    const b = new RNG(2);
    expect(Array.from({ length: 8 }, () => a.next())).not.toEqual(
      Array.from({ length: 8 }, () => b.next()),
    );
  });

  test("next() stays in [0,1)", () => {
    const r = new RNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  test("range respects bounds, int is integer in [min,max)", () => {
    const r = new RNG(99);
    for (let i = 0; i < 200; i++) {
      const v = r.range(5, 10);
      expect(v >= 5 && v < 10).toBe(true);
      const n = r.int(3, 6);
      expect(n >= 3 && n < 6 && Number.isInteger(n)).toBe(true);
    }
  });

  test("fork streams are independent of parent", () => {
    const r = new RNG(5);
    const f1 = r.fork(1);
    const f2 = r.fork(1);
    r.next();
    const s1 = Array.from({ length: 16 }, () => f1.next());
    const s2 = Array.from({ length: 16 }, () => f2.next());
    expect(s1).toEqual(s2);
  });
});
