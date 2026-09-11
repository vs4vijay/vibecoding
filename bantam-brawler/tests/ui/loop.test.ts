import { describe, test, expect } from "bun:test";
import { createLoop } from "../../src/ui/loop";

describe("fixed-timestep loop", () => {
  test("advances whole ticks only", () => {
    let updates = 0;
    const loop = createLoop({ tickMs: 1000 / 60, maxCatchUpMs: 250, update: () => updates++, render: () => {} });
    loop.tick(0);            // prime prev
    loop.tick(1000 / 60);    // exactly one tick
    expect(updates).toBe(1);
  });

  test("clamps tab-switch stalls (no spiral)", () => {
    let updates = 0;
    const loop = createLoop({ tickMs: 1000 / 60, maxCatchUpMs: 250, update: () => updates++, render: () => {} });
    loop.tick(0);
    loop.tick(10_000);       // 10s stall → clamped to 250ms → floor(250/16.67)=15 ticks
    expect(updates).toBe(15);
  });

  test("render receives alpha fraction", () => {
    let alpha = -1;
    const loop = createLoop({ tickMs: 100, maxCatchUpMs: 250, update: () => {}, render: (a) => (alpha = a) });
    loop.tick(0);
    loop.tick(50);           // half a tick elapsed, zero whole ticks
    expect(alpha).toBeCloseTo(0.5);
  });

  test("start() is idempotent (single rAF chain)", () => {
    const queue: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb) => { queue.push(cb); return queue.length; }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    try {
      let updates = 0;
      const loop = createLoop({ tickMs: 10, maxCatchUpMs: 250, update: () => updates++, render: () => {} });
      loop.start();
      loop.start();          // second start must NOT schedule another chain
      expect(queue.length).toBe(1);
      let frameCb = queue.shift()!;
      frameCb(1000);         // first frame primes prev
      frameCb = queue.shift()!;
      frameCb(1010);         // exactly one 10ms tick
      expect(updates).toBe(1);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
    }
  });
});
