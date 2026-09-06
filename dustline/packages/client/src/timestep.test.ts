import { describe, it, expect } from 'bun:test';
import { createTicker, MAX_TICKS_PER_FRAME, FRAME_DELTA_MAX_MS } from './timestep.js';

// Same period the client derives from SIMULATION_DT (× 1000).
const TICK_MS = 1000 / 60;

describe('createTicker', () => {
  it('runs exactly 60 steps over 1000 ms of 60 Hz frames', () => {
    let steps = 0;
    const ticker = createTicker(() => {
      steps++;
    }, TICK_MS);

    for (let i = 0; i < 60; i++) {
      ticker.advance(TICK_MS);
    }

    expect(steps).toBe(60);
  });

  it('accumulates sub-tick frame deltas and steps on crossing', () => {
    let steps = 0;
    const ticker = createTicker(() => {
      steps++;
    }, TICK_MS);

    ticker.advance(10); // 10 ms < ~16.67 ms — no step yet
    expect(steps).toBe(0);

    ticker.advance(10); // 20 ms accumulated — crosses one tick
    expect(steps).toBe(1);

    ticker.advance(10); // ~3.33 ms carried over — still short of a tick
    expect(steps).toBe(1);

    ticker.advance(10); // ~13.33 + 10 ms — crosses the next tick
    expect(steps).toBe(2);
  });

  it('caps catch-up at MAX_TICKS_PER_FRAME and discards the excess', () => {
    let steps = 0;
    const ticker = createTicker(() => {
      steps++;
    }, TICK_MS);

    ticker.advance(1000); // a full second delivered in one frame
    expect(steps).toBe(MAX_TICKS_PER_FRAME);

    // The excess was discarded, not banked: if the ~916 ms remainder had been
    // kept, this normal frame would burst past the cap again instead of
    // producing exactly one step.
    ticker.advance(TICK_MS);
    expect(steps).toBe(MAX_TICKS_PER_FRAME + 1);
  });

  it('clamps huge deltas to FRAME_DELTA_MAX_MS', () => {
    let steps = 0;
    // 100 ms period so a clamped frame yields fewer steps than the cap.
    const ticker = createTicker(() => {
      steps++;
    }, 100);

    ticker.advance(FRAME_DELTA_MAX_MS + 60_000); // e.g. an hour in the background
    expect(steps).toBe(Math.floor(FRAME_DELTA_MAX_MS / 100)); // 250 ms → 2 steps, not a burst

    // The clamped-away excess is discarded too: the next normal frame steps
    // exactly once (the 50 ms in-tick remainder carries over as usual).
    ticker.advance(100);
    expect(steps).toBe(3);
  });

  it('keeps long-run drift within ±1 step of elapsed time', () => {
    let steps = 0;
    const ticker = createTicker(() => {
      steps++;
    }, TICK_MS);

    // 60k jittered frames (~8–32 ms each, ≈20 minutes of play) — a
    // deterministic pattern so the assertion is stable.
    let elapsedMs = 0;
    for (let i = 0; i < 60_000; i++) {
      const delta = 8 + ((i * 37) % 25);
      ticker.advance(delta);
      elapsedMs += delta;
    }

    expect(steps).toBeGreaterThanOrEqual(elapsedMs / TICK_MS - 1);
    expect(steps).toBeLessThanOrEqual(elapsedMs / TICK_MS + 1);
  });

  it('reset() clears the accumulator so returning never bursts', () => {
    let steps = 0;
    const ticker = createTicker(() => {
      steps++;
    }, TICK_MS);

    ticker.advance(15); // just under one tick — pending
    expect(steps).toBe(0);

    ticker.reset(); // input went inactive

    ticker.advance(10); // without reset, 15 + 10 ms would have crossed a tick
    expect(steps).toBe(0);
  });

  it('ignores zero and negative frame deltas', () => {
    let steps = 0;
    const ticker = createTicker(() => {
      steps++;
    }, TICK_MS);

    ticker.advance(0);
    ticker.advance(-5);

    expect(steps).toBe(0);
  });
});
