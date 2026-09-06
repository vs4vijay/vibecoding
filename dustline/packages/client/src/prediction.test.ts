import { describe, it, expect } from 'bun:test';
import { createPredictor, MAX_PENDING_INPUTS } from './prediction.js';
import { CORRECTION_LERP_MS } from '@dustline/shared';

interface TestState {
  x: number;
}

interface TestInput {
  delta: number;
}

/** Controllable clock so easing tests are deterministic (no real timers). */
function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const addDelta = (state: TestState, input: TestInput): TestState => ({
  x: state.x + input.delta,
});

const clone = (state: TestState): TestState => ({ ...state });

describe('createPredictor', () => {
  it('returns the server state when there are no unacked inputs', () => {
    const predictor = createPredictor<TestState, TestInput>(addDelta, clone);
    const authoritative: TestState = { x: 42 };

    predictor.onServerSnapshot(authoritative, 0);

    expect(predictor.getRenderState()).toEqual({ x: 42 });
    expect(predictor.pendingCount()).toBe(0);
  });

  it('advances the server state through exactly the unacked inputs, in order', () => {
    const applied: number[] = [];
    const predictor = createPredictor<TestState, TestInput>(
      (state, input) => {
        applied.push(input.delta);
        return { x: state.x + input.delta };
      },
      clone,
    );

    predictor.onServerSnapshot({ x: 100 }, 0);

    predictor.pushLocalInput(1, { delta: 1 });
    predictor.pushLocalInput(2, { delta: 2 });
    predictor.pushLocalInput(3, { delta: 4 });

    // Inputs are predicted immediately on push
    expect(predictor.getRenderState()).toEqual({ x: 107 });

    // A fresh snapshot with nothing newly acked replays all pending inputs in seq order
    applied.length = 0;
    predictor.onServerSnapshot({ x: 100 }, 0);
    expect(applied).toEqual([1, 2, 4]);
    expect(predictor.getRenderState()).toEqual({ x: 107 });

    // Partial ack: only inputs after the acked seq are replayed
    applied.length = 0;
    predictor.onServerSnapshot({ x: 103 }, 2); // server processed deltas 1 + 2
    expect(applied).toEqual([4]);
    expect(predictor.getRenderState()).toEqual({ x: 107 });
  });

  it('converges to the authoritative state under simulated RTT; zero drift once all inputs are acked', () => {
    const clock = makeClock();
    const predictor = createPredictor<TestState, TestInput>(addDelta, clone, clock.now);

    // The first snapshot establishes the baseline before any input is sent
    predictor.onServerSnapshot({ x: 0 }, 0);

    // Client sends 5 inputs; they are predicted immediately
    for (let seq = 1; seq <= 5; seq++) {
      predictor.pushLocalInput(seq, { delta: 1 });
    }
    expect(predictor.getRenderState()).toEqual({ x: 5 });

    // Snapshot round 1: nothing processed yet (inputs still in flight)
    predictor.onServerSnapshot({ x: 0 }, 0);
    expect(predictor.pendingCount()).toBe(5);

    // Snapshot round 2 (one RTT later): the server processed 3 inputs.
    // The server moves slower than the client (delta * 0.5) so there is drift.
    clock.advance(50);
    predictor.onServerSnapshot({ x: 1.5 }, 3);
    expect(predictor.pendingCount()).toBe(2); // seq 4 and 5 still pending

    // All inputs finally acked: nothing left to replay, so the predicted
    // state IS the authoritative state — zero drift.
    clock.advance(CORRECTION_LERP_MS);
    predictor.onServerSnapshot({ x: 2.5 }, 5);
    expect(predictor.pendingCount()).toBe(0);
    clock.advance(CORRECTION_LERP_MS);
    expect(predictor.getRenderState()).toEqual({ x: 2.5 });
  });

  it('ignores stale snapshots whose ackedSeq is older than the last processed one', () => {
    const applied: number[] = [];
    const predictor = createPredictor<TestState, TestInput>(
      (state, input) => {
        applied.push(input.seq);
        return { x: state.x + input.delta };
      },
      clone,
    );

    predictor.onServerSnapshot({ x: 0 }, 0);
    predictor.pushLocalInput(1, { delta: 1 });
    predictor.pushLocalInput(2, { delta: 2 });
    predictor.onServerSnapshot({ x: 1 }, 1); // acked seq 1

    expect(predictor.getRenderState()).toEqual({ x: 3 }); // 1 + replay(2)
    expect(predictor.pendingCount()).toBe(1);

    const appliedBefore = applied.length;
    predictor.onServerSnapshot({ x: 0.5 }, 0); // stale: older ack, older state

    // No regression: state, queue and replay activity are untouched
    expect(predictor.getRenderState()).toEqual({ x: 3 });
    expect(predictor.pendingCount()).toBe(1);
    expect(applied.length).toBe(appliedBefore);
  });

  it('trims the input queue after acks and bounds its memory', () => {
    const predictor = createPredictor<TestState, TestInput>(addDelta, clone);

    predictor.onServerSnapshot({ x: 0 }, 0);
    for (let seq = 1; seq <= 10; seq++) {
      predictor.pushLocalInput(seq, { delta: 1 });
    }
    expect(predictor.pendingCount()).toBe(10);

    predictor.onServerSnapshot({ x: 4 }, 4);
    expect(predictor.pendingCount()).toBe(6); // seq 5..10 remain

    predictor.onServerSnapshot({ x: 10 }, 10);
    expect(predictor.pendingCount()).toBe(0);

    // Hard cap: the queue never grows beyond MAX_PENDING_INPUTS
    for (let seq = 11; seq <= 500; seq++) {
      predictor.pushLocalInput(seq, { delta: 0 });
    }
    expect(predictor.pendingCount()).toBe(MAX_PENDING_INPUTS);
  });

  it('eases server corrections over CORRECTION_LERP_MS instead of snapping', () => {
    const clock = makeClock();
    const predictor = createPredictor<TestState, TestInput>(addDelta, clone, clock.now);

    predictor.onServerSnapshot({ x: 0 }, 0);
    predictor.pushLocalInput(1, { delta: 10 });
    expect(predictor.getRenderState()).toEqual({ x: 10 }); // pure prediction

    // Server disagrees: authoritative x is 4 after acking seq 1
    predictor.onServerSnapshot({ x: 4 }, 1);

    // No snap at the moment of correction
    expect(predictor.getRenderState()).toEqual({ x: 10 });

    clock.advance(CORRECTION_LERP_MS / 2);
    const mid = predictor.getRenderState()!.x;
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(10);

    clock.advance(CORRECTION_LERP_MS / 2);
    expect(predictor.getRenderState()).toEqual({ x: 4 });

    // Bounded: stays converged afterwards, no permanent divergence
    clock.advance(CORRECTION_LERP_MS);
    expect(predictor.getRenderState()).toEqual({ x: 4 });
  });
});
