import { describe, it, expect } from 'vitest';
import { FixedLoop } from '../../src/core/loop';

describe('FixedLoop', () => {
  it('executes one step per accumulated stepMs', () => {
    let steps = 0;
    const loop = new FixedLoop(16.667, () => { steps++; });
    loop.advance(16.667); loop.advance(16.667);
    expect(steps).toBe(2);
  });
  it('clamps catch-up to 4 steps after a long freeze', () => {
    let steps = 0;
    const loop = new FixedLoop(16.667, () => { steps++; });
    loop.advance(500); // 30 steps worth
    expect(steps).toBe(4);
  });
  it('carries remainder across frames', () => {
    let steps = 0;
    const loop = new FixedLoop(10, () => { steps++; });
    loop.advance(15); loop.advance(15); // 1 + 2 steps (5ms carried twice -> second frame 20ms)
    expect(steps).toBe(3);
  });
});
