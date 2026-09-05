/**
 * Injury model [spec §3.4 diegetic health; plan Task 9]. updateInjuries is a
 * pure tick over plain FighterState — no clock, no RNG, no sim class. The
 * tests pin every boundary named in the brief: bleed drain rate and its
 * 1hp floor (bleed alone never kills), the limp flip point (<40% maxHp,
 * strictly), KO transitions (hp ≤ 0 OR unconscious already set) and event
 * emission semantics ('bled' on every step hp actually drains — the
 * renderer's continuous drip signal; 'limped'/'knockedOut' exactly once).
 */
import { describe, expect, it } from 'vitest';
import { updateInjuries } from '../../src/combat/injury';
import { BLEED_DPS } from '../../src/data/tuning';
// ---------------------------------------------------------------------------
// Hand-crafted plain states — same shape as the reversal/stateMachine suites.
// ---------------------------------------------------------------------------
function makeFighter(over = {}) {
    return {
        id: 'player',
        species: 'rabbit',
        team: 0,
        hp: 100,
        maxHp: 100,
        pos: { x: 0, y: 0, z: 0 },
        velY: 0,
        heading: 0,
        stance: 'standing',
        phase: { t: 'idle', phaseMsLeft: Infinity },
        currentMove: undefined,
        moveElapsedMs: 0,
        weapon: null,
        flags: { bleeding: false, limping: false, unconscious: false, invulnerableAirFlipMs: 0 },
        pendingReverseOf: undefined,
        ...over,
    };
}
/** Advance one fighter through `totalMs` of fixed `stepMs` steps, tallying events. */
function tick(f, totalMs, stepMs = 1000 / 60) {
    const tally = { bled: 0, limped: 0, knockedOut: 0, steps: 0 };
    for (let left = totalMs; left > 0; left -= stepMs) {
        const dt = Math.min(stepMs, left);
        for (const e of updateInjuries(f, dt))
            tally[e.type]++;
        tally.steps++;
    }
    return tally;
}
/** One single-step tick returning the raw event list. */
function tickOnce(f) {
    return updateInjuries(f, 1000 / 60);
}
describe('bleeding', () => {
    it('drains ≈10hp over a 5000ms sim at BLEED_DPS', () => {
        const f = makeFighter({ flags: { ...makeFighter().flags, bleeding: true } });
        const t = tick(f, 5000);
        // Fractional accumulator: exact rate, not per-step rounding loss.
        expect(100 - f.hp).toBeCloseTo(5000 * (BLEED_DPS / 1000), 5);
        expect(f.hp).toBeCloseTo(90, 5);
        expect(f.flags.unconscious).toBe(false);
        expect(f.phase.t).toBe('idle');
    });
    it("emits 'bled' on every step hp actually drains", () => {
        const f = makeFighter({ flags: { ...makeFighter().flags, bleeding: true } });
        // Every iteration of the helper drained (float remainders make the
        // count 61, not a clean 60 — pinned as "all steps", not a magic 60).
        const t = tick(f, 1000);
        expect(t.bled).toBe(t.steps);
        expect(tickOnce(f)).toEqual([{ type: 'bled' }]);
    });
    it('quiet while not bleeding', () => {
        const f = makeFighter();
        expect(tickOnce(f)).toEqual([]);
        expect(tick(f, 2000)).toEqual({ bled: 0, limped: 0, knockedOut: 0, steps: 120 });
        expect(f.hp).toBe(100);
    });
    it('never kills via bleed alone — clamps at the 1hp floor', () => {
        const f = makeFighter({
            hp: 3,
            flags: { ...makeFighter().flags, bleeding: true },
        });
        // Far more than enough time to drain past zero if unclamped.
        const t = tick(f, 10000);
        expect(f.hp).toBe(1);
        expect(f.flags.bleeding).toBe(true); // wound persists, body survives
        expect(f.flags.unconscious).toBe(false);
        expect(f.phase.t).toBe('idle');
        expect(t.knockedOut).toBe(0);
        expect(t.limped).toBe(1); // crossed the limp line during the drain
        expect(updateInjuries(f, 16.667)).toEqual([]); // at the floor: quiet
    });
    it('a fighter sitting at the floor neither drains nor emits', () => {
        const f = makeFighter({ hp: 1, flags: { ...makeFighter().flags, bleeding: true } });
        expect(tick(f, 3000)).toEqual({ bled: 0, limped: 1, knockedOut: 0, steps: 181 });
        expect(f.hp).toBe(1);
    });
    it('a fresh hit can still finish a floor-clamped fighter (KO at hp ≤ 0)', () => {
        const f = makeFighter({ hp: 1, flags: { ...makeFighter().flags, bleeding: true } });
        f.hp = -5; // e.g. applyHit landed between injury ticks
        expect(tickOnce(f)).toEqual([{ type: 'knockedOut' }]);
        expect(f.flags.unconscious).toBe(true);
        expect(f.phase.t).toBe('ko');
    });
});
describe('limping', () => {
    it('flips at 39hp on a 100max fighter (strictly below 40%)', () => {
        const f = makeFighter({ hp: 40 });
        expect(tickOnce(f)).toEqual([]); // 40 is NOT < 40%
        expect(f.flags.limping).toBe(false);
        f.hp = 39;
        expect(tickOnce(f)).toEqual([{ type: 'limped' }]);
        expect(f.flags.limping).toBe(true);
    });
    it('uses maxHp fraction, not absolute hp', () => {
        // Wolf: maxHp 160 → limp threshold 63.99; 64 stands, 63 limps.
        const w = makeFighter({ species: 'wolf', id: 'wolf1', team: 1, hp: 64, maxHp: 160 });
        expect(tickOnce(w)).toEqual([]);
        expect(w.flags.limping).toBe(false);
        w.hp = 63;
        expect(tickOnce(w)).toEqual([{ type: 'limped' }]);
        expect(w.flags.limping).toBe(true);
    });
    it('does not re-emit limped while already limping', () => {
        const f = makeFighter({
            hp: 30,
            flags: { ...makeFighter().flags, limping: true },
        });
        expect(tick(f, 1000)).toEqual({ bled: 0, limped: 0, knockedOut: 0, steps: 61 });
    });
});
describe('knockout', () => {
    it('hp 0 → unconscious + ko phase + single knockedOut event', () => {
        const f = makeFighter({ hp: 0 });
        expect(tickOnce(f)).toEqual([{ type: 'knockedOut' }]);
        expect(f.flags.unconscious).toBe(true);
        expect(f.phase.t).toBe('ko');
        expect(f.stance).toBe('downed');
    });
    it('negative hp also knocks out', () => {
        const f = makeFighter({ hp: -12 });
        expect(tickOnce(f)).toEqual([{ type: 'knockedOut' }]);
        expect(f.flags.unconscious).toBe(true);
        expect(f.phase.t).toBe('ko');
    });
    it('already-unconscious fighters emit nothing further', () => {
        const f = makeFighter({
            hp: 0,
            stance: 'downed',
            phase: { t: 'ko', phaseMsLeft: Infinity },
            flags: { ...makeFighter().flags, unconscious: true },
        });
        expect(tick(f, 2000)).toEqual({ bled: 0, limped: 0, knockedOut: 0, steps: 120 });
        expect(f.hp).toBe(0);
    });
    it('bleeding + lethal external damage knocks out on the same tick', () => {
        const f = makeFighter({ hp: -2, flags: { ...makeFighter().flags, bleeding: true } });
        expect(tickOnce(f)).toEqual([{ type: 'knockedOut' }]);
        expect(f.flags.unconscious).toBe(true);
        expect(f.phase.t).toBe('ko');
    });
    it('KO wins over limp: a lethal drop never emits limped instead', () => {
        const f = makeFighter({ hp: 0 });
        const events = tickOnce(f);
        expect(events).toEqual([{ type: 'knockedOut' }]);
        expect(f.flags.limping).toBe(false);
    });
});
