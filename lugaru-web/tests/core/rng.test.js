import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
describe('mulberry32', () => {
    it('returns numbers in [0, 1)', () => {
        const rng = mulberry32(42);
        for (let i = 0; i < 1000; i++) {
            const x = rng();
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(1);
        }
    });
    it('is deterministic for the same seed', () => {
        const a = mulberry32(1234);
        const b = mulberry32(1234);
        for (let i = 0; i < 100; i++)
            expect(a()).toBe(b());
    });
    it('different seeds give different sequences', () => {
        const a = mulberry32(1);
        const b = mulberry32(2);
        let differ = false;
        for (let i = 0; i < 10; i++)
            if (a() !== b())
                differ = true;
        expect(differ).toBe(true);
    });
});
