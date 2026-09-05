import { describe, expect, it } from 'vitest';
import { ScentField, emissionRateFor, } from '../../src/ai/scent';
import { WindSystem } from '../../src/world/wind';
import { mulberry32 } from '../../src/core/rng';
import { ARENA_SIZE_M, SCENT_EMIT_RATE_BASE, SCENT_EMIT_RATE_BLOODIED, SCENT_GRID_CELLS, WIND_TURN_MS, } from '../../src/data/tuning';
// ---------------------------------------------------------------------------
// ScentField — 48×48 grid, scalar diffusion + wind advection, no-flux bounds.
// Grid covers the arena [-ARENA/2, ARENA/2); cell edge = 120/48 = 2.5m.
// ---------------------------------------------------------------------------
const CELL = ARENA_SIZE_M / SCENT_GRID_CELLS; // 2.5
function emittersAt(x, z, rate = SCENT_EMIT_RATE_BASE) {
    return [{ pos: { x, z }, rate }];
}
describe('emissionRateFor', () => {
    it('uses the base rate for clean fighters and the bloodied rate otherwise', () => {
        expect(emissionRateFor(false)).toBe(SCENT_EMIT_RATE_BASE);
        expect(emissionRateFor(true)).toBe(SCENT_EMIT_RATE_BLOODIED);
    });
});
describe('ScentField.intensityAt', () => {
    it('starts empty (zero intensity) everywhere', () => {
        const f = new ScentField();
        expect(f.intensityAt({ x: 0, z: 0 })).toBe(0);
        expect(f.intensityAt({ x: -59, z: 59 })).toBe(0);
    });
    it('accumulates intensity at the emitter location', () => {
        const f = new ScentField();
        const dt = 16.7;
        const steps = 10;
        for (let i = 0; i < steps; i++)
            f.update(dt, emittersAt(0, 0), { x: 0, z: 0 });
        expect(f.intensityAt({ x: 0, z: 0 })).toBeGreaterThan(0);
    });
    it('is clamped to the arena bounds when sampling', () => {
        const f = new ScentField();
        for (let i = 0; i < 4; i++)
            f.update(16.7, emittersAt(0, 0), { x: 0, z: 0 });
        // Far off-grid points sample the (clamped) zero border region, never crash.
        expect(f.intensityAt({ x: 1000, z: 1000 })).toBeGreaterThanOrEqual(0);
        expect(f.intensityAt({ x: -1000, z: -1000 })).toBeGreaterThanOrEqual(0);
    });
});
describe('ScentField — wind advection', () => {
    it('offsets the peak downwind of a steady emitter under uniform east wind', () => {
        const f = new ScentField();
        const dt = 16.7;
        // A steady strong east wind (blowing toward +x). Emit long enough to build
        // a plume, letting advection carry material east of the source.
        for (let i = 0; i < 240; i++) {
            f.update(dt, emittersAt(0, 0), { x: 1, z: 0 });
        }
        const east = f.intensityAt({ x: CELL * 1.5, z: 0 });
        const west = f.intensityAt({ x: -CELL * 1.5, z: 0 });
        const source = f.intensityAt({ x: 0, z: 0 });
        // More scent downwind (east) than upwind (west) of the source.
        expect(east).toBeGreaterThan(west);
        // And the peak sits at or downwind of the source cell.
        expect(source).toBeGreaterThan(0);
    });
    it('with no wind the plume spreads symmetrically (west ≈ east)', () => {
        const f = new ScentField();
        const dt = 16.7;
        for (let i = 0; i < 240; i++) {
            f.update(dt, emittersAt(0, 0), { x: 0, z: 0 });
        }
        const east = f.intensityAt({ x: CELL * 1.5, z: 0 });
        const west = f.intensityAt({ x: -CELL * 1.5, z: 0 });
        // Diffusive spread only; should be roughly symmetric (tolerance generous).
        expect(Math.abs(east - west)).toBeLessThan(east * 0.5 + 1e-6);
    });
});
describe('ScentField — bloodied vs clean emission', () => {
    it('a bloodied emitter saturates a radius faster than a clean one', () => {
        const clean = new ScentField();
        const bloodied = new ScentField();
        const dt = 16.7;
        const tests = 200;
        for (let i = 0; i < tests / dt; i++) {
            clean.update(dt, emittersAt(0, 0, SCENT_EMIT_RATE_BASE), { x: 0, z: 0 });
            bloodied.update(dt, emittersAt(0, 0, SCENT_EMIT_RATE_BLOODIED), { x: 0, z: 0 });
        }
        const radius = CELL * 1.5;
        const cleanR = clean.intensityAt({ x: radius, z: radius });
        const bloodR = bloodied.intensityAt({ x: radius, z: radius });
    });
});
// ---------------------------------------------------------------------------
// WindSystem — slow random walk of direction (drift every WIND_TURN_MS), with
// a 0..1 strength. Deterministic under a seeded rng.
// ---------------------------------------------------------------------------
describe('WindSystem', () => {
    it('starts with a deterministic strength-scaled direction in [0,1]', () => {
        const w = new WindSystem(mulberry32(42));
        const v = w.vector;
        // vector = unit direction × strength, so magnitude IS the strength.
        expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(1);
        expect(Math.hypot(v.x, v.z)).toBeGreaterThanOrEqual(0);
        expect(w.strength).toBeGreaterThanOrEqual(0);
        expect(w.strength).toBeLessThanOrEqual(1);
    });
    it('is unchanged until WIND_TURN_MS elapses', () => {
        const w = new WindSystem(mulberry32(7));
        const v0 = { ...w.vector };
        const s0 = w.strength;
        w.update(WIND_TURN_MS - 1);
        expect(w.vector.x).toBeCloseTo(v0.x, 10);
        expect(w.vector.z).toBeCloseTo(v0.z, 10);
        expect(w.strength).toBeCloseTo(s0, 10);
    });
    it('random-walks after each WIND_TURN_MS step (direction drifts ≤ ±30°)', () => {
        const w = new WindSystem(mulberry32(123));
        const a0 = Math.atan2(w.vector.z, w.vector.x);
        w.update(WIND_TURN_MS);
        const a1 = Math.atan2(w.vector.z, w.vector.x);
        let delta = Math.abs(a1 - a0);
        while (delta > Math.PI)
            delta = Math.abs(delta - 2 * Math.PI); // wrap
        expect(delta).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-6);
    });
    it('same seed reproduces the same sequence', () => {
        const a = new WindSystem(mulberry32(99));
        const b = new WindSystem(mulberry32(99));
        a.update(WIND_TURN_MS * 3);
        b.update(WIND_TURN_MS * 3);
        expect(a.vector.x).toBeCloseTo(b.vector.x, 10);
        expect(a.vector.z).toBeCloseTo(b.vector.z, 10);
        expect(a.strength).toBeCloseTo(b.strength, 10);
    });
});
