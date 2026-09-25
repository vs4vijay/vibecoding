import { describe, expect, it, vi } from 'vitest';

import { Loop, type LoopOptions } from '../src/core/Loop';

interface LoopCounters {
  updates: number;
  renders: number;
}

function makeCountingLoop(
  step: number,
  overrides: Partial<LoopOptions> = {},
): { loop: Loop; counters: LoopCounters } {
  const counters: LoopCounters = { updates: 0, renders: 0 };
  const loop = new Loop({
    step,
    update: () => {
      counters.updates += 1;
    },
    render: () => {
      counters.renders += 1;
    },
    ...overrides,
  });
  return { loop, counters };
}

describe('Loop', () => {
  it('banks fractional frame time until a whole fixed step is available', () => {
    const { loop, counters } = makeCountingLoop(0.01);

    expect(loop.advance(0.004)).toBe(0);
    expect(loop.advance(0.004)).toBe(0);
    expect(loop.advance(0.004)).toBe(1); // 12 ms crosses one 10 ms step
    expect(counters.updates).toBe(1);
    expect(loop.pendingTime).toBeCloseTo(0.002, 5);

    expect(loop.advance(0.008)).toBe(1); // 2 ms banked + 8 ms completes the next step
    expect(counters.updates).toBe(2);
    expect(loop.pendingTime).toBeCloseTo(0, 5);
  });

  it('keeps simulated time consistent across uneven frame deltas', () => {
    const { loop, counters } = makeCountingLoop(1 / 60);

    const deltas = [0.016, 0.021, 0.009, 0.033, 0.014]; // sums to 0.093 s ≈ 5.58 steps
    let steps = 0;
    for (const delta of deltas) steps += loop.advance(delta);

    expect(steps).toBe(5);
    expect(counters.updates).toBe(5);

    // The ~9.7 ms leftover is still banked; an extra 8 ms completes one step.
    expect(loop.advance(0.008)).toBe(1);
    expect(counters.updates).toBe(6);
  });

  it('clamps huge frame deltas so a stall cannot spiral into unbounded catch-up', () => {
    const { loop, counters } = makeCountingLoop(1 / 60);

    const steps = loop.advance(10); // a 10-second frame
    expect(steps).toBe(loop.maxSteps);
    expect(steps).toBeLessThan(600);
    expect(counters.updates).toBe(loop.maxSteps);

    // The backlog was discarded: the next frame simulates exactly its own delta.
    expect(loop.advance(1 / 60)).toBe(1);
    expect(counters.updates).toBe(loop.maxSteps + 1);
  });

  it('ignores zero and negative deltas', () => {
    const { loop, counters } = makeCountingLoop(1 / 60);

    expect(loop.advance(0)).toBe(0);
    expect(loop.advance(-0.5)).toBe(0);
    expect(counters.updates).toBe(0);
  });

  it('hands every update step the exact fixed step length', () => {
    const seenDeltas: number[] = [];
    const loop = new Loop({
      step: 0.02,
      update: (dt) => {
        seenDeltas.push(dt);
      },
      render: () => {},
    });

    loop.advance(0.05); // 2 full 20 ms steps, 10 ms banked
    expect(seenDeltas).toEqual([0.02, 0.02]);
  });

  it('renders once per animation frame, after the update steps', () => {
    // Stub the RAF globals so this runs headless in Node.
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 1;
    const cancelledHandles: number[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      const handle = nextHandle;
      nextHandle += 1;
      frameCallbacks.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
      cancelledHandles.push(handle);
      frameCallbacks.delete(handle);
    });

    try {
      const { loop, counters } = makeCountingLoop(1 / 60);

      loop.start();
      expect(loop.isRunning).toBe(true);
      expect(frameCallbacks.size).toBe(1);

      const handle = 1;
      const frame = frameCallbacks.get(handle);
      expect(frame).toBeDefined();

      // Frame 1 at t=0: negative delta against start()'s real timestamp, so
      // zero steps run — but the frame still renders exactly once.
      frame?.(0);
      expect(counters.updates).toBe(0);
      expect(counters.renders).toBe(1);

      // Frame 2 exactly one step later: one update, one render.
      frame?.(1000 / 60);
      expect(counters.updates).toBe(1);
      expect(counters.renders).toBe(2);

      // Each invoked frame re-scheduled the next one, so stop() must cancel
      // the latest pending handle (stale handles 1..n-1 are artifacts of the
      // hand-driven stub and would have fired long ago in a real browser).
      const latestPendingHandle = Math.max(...frameCallbacks.keys());
      loop.stop();
      expect(loop.isRunning).toBe(false);
      expect(cancelledHandles).toContain(latestPendingHandle);
      expect(frameCallbacks.has(latestPendingHandle)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
