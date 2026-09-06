// tests/rng.test.ts
import { describe, expect, it } from "vitest";
import { RNG } from "../src/core/RNG";

describe("RNG", () => {
  it("same seed → same sequence", () => {
    const a = new RNG(42);
    const b = new RNG(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("different seeds → different sequences", () => {
    const a = new RNG(1);
    const b = new RNG(2);
    expect(a.next()).not.toBe(b.next());
  });
  it("serialize/deserialize roundtrips state", () => {
    const a = new RNG(7);
    a.next(); a.next(); a.next();
    const b = RNG.deserialize(a.serialize());
    expect(b.next()).toBe(a.next());
  });
  it("nextInt is in range", () => {
    const r = new RNG(99);
    for (let i = 0; i < 1000; i++) {
      const n = r.nextInt(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });
});
