// Task 2.1 verification: fixed-timestep loop advances exactly 60 steps/s
// regardless of display refresh rate. Stubs rAF with simulated clocks at
// 60/120/144 Hz and counts executed sim steps.

import assert from 'node:assert/strict';
import { createLoop } from '../../src/engine/loop.js';

function simulateRefreshHz(hz, simulatedSeconds) {
  let now = 0;
  let cb = null;
  globalThis.requestAnimationFrame = (fn) => {
    cb = fn;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => now };

  let steps = 0;
  const loop = createLoop({ hz: 60, update: () => steps++, render: () => {} });
  loop.start();

  const frameDt = 1000 / hz;
  const frames = Math.round((simulatedSeconds * 1000) / frameDt);
  for (let i = 0; i < frames; i++) {
    now += frameDt;
    const fn = cb;
    cb = null;
    fn(now);
  }
  loop.stop();
  return steps;
}

const t60 = simulateRefreshHz(60, 2);
const t120 = simulateRefreshHz(120, 2);
const t144 = simulateRefreshHz(144, 2);
const long120 = simulateRefreshHz(120, 10);

console.log(`refresh 60Hz  -> ${t60} steps in 2s`);
console.log(`refresh 120Hz -> ${t120} steps in 2s`);
console.log(`refresh 144Hz -> ${t144} steps in 2s`);
console.log(`refresh 120Hz -> ${long120} steps in 10s`);

// one frame-boundary of slack per 2s window (accumulator float rounding);
// over longer windows the rate must converge on exactly 60/s.
assert.ok(Math.abs(t60 - 120) <= 1, '60Hz ~120 steps in 2s');
assert.ok(Math.abs(t120 - 120) <= 1, '120Hz ~120 steps in 2s');
assert.ok(Math.abs(t144 - 120) <= 1, '144Hz ~120 steps in 2s');
assert.ok(Math.abs(long120 - 600) <= 2, '120Hz converges on 600 steps in 10s');
console.log('loop.test: OK — sim rate is 60/s at every refresh rate');
