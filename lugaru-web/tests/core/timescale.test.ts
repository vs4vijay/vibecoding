import { describe, it, expect } from 'vitest';
import { Timescale } from '../../src/core/timescale';

describe('Timescale', () => {
  it('defaults to 1', () => expect(new Timescale().update(16)).toBeCloseTo(1));
  it('hitstop returns 0 then recovers', () => {
    const ts = new Timescale();
    ts.hitstop(50);
    expect(ts.update(16)).toBe(0);
    expect(ts.update(40)).toBeCloseTo(1); // hitstop expired
  });
  it('slowmo scales then decays back to 1', () => {
    const ts = new Timescale();
    ts.slowmo(0.25, 400);
    expect(ts.update(16)).toBeCloseTo(0.25);
    ts.update(380);
    expect(ts.update(16)).toBeCloseTo(1, 1);
  });
});
