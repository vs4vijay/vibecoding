// tests/gameloop.test.ts
import { describe, expect, it } from "vitest";
import { GameLoop } from "../src/core/GameLoop";

describe("GameLoop", () => {
  const DT = 1 / 60;
  it("calls update at fixed rate, accumulates remainder into alpha", () => {
    let updates = 0;
    let lastAlpha = 0;
    const cb = { update: () => { updates++; }, render: (a: number) => { lastAlpha = a; } };
    const loop = new GameLoop(cb, DT);
    loop.frame(0);            // t=0 (start)
    loop.frame(16.7);         // ~1 tick
    loop.frame(100.0);        // ~5 more ticks
    expect(updates).toBeGreaterThanOrEqual(6);
    expect(updates).toBeLessThanOrEqual(7);
    expect(lastAlpha).toBeGreaterThanOrEqual(0);
    expect(lastAlpha).toBeLessThan(1);
  });
  it("clamps huge deltas (no spiral of death)", () => {
    let updates = 0;
    const cb = { update: () => { updates++; }, render: () => {} };
    const loop = new GameLoop(cb, DT);
    loop.frame(0);
    loop.frame(60_000); // 60s gap
    expect(updates).toBeLessThanOrEqual(6);
  });
});
