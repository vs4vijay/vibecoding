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
  it('retriggered shorter slowmo starts from its own duration', () => {
    const ts = new Timescale();
    ts.slowmo(0.5, 1000);
    let m = 0;
    for (let i = 0; i < 31; i++) m = ts.update(16); // ~496ms in, half-decayed
    expect(m).toBeGreaterThan(0.5); // sanity: decayed partway toward 1
    ts.slowmo(0.25, 100); // fresh, shorter effect must replace carried state
    expect(ts.update(16)).toBeCloseTo(0.25);
    for (let i = 0; i < 6; i++) {
      const m2 = ts.update(16);
      expect(m2).toBeGreaterThan(0);
      expect(m2).toBeGreaterThanOrEqual(0.25 - 1e-9);
    }
  });
  it('hitstop consumes real dt first; slowmo decays only across remainder', () => {
    const ts = new Timescale();
    ts.hitstop(10);
    ts.slowmo(0.25, 100);
    expect(ts.update(20)).toBeCloseTo(0.25); // frame splits: 10ms freeze + 10ms scaled
    // slowmo burned only the 10ms remainder -> elapsed 10ms, not 20ms
    expect(ts.update(16)).toBeCloseTo(0.325);
  });
});
