/**
 * Combo scoring ledger [spec §3.6; plan Task 9]. ScoreLedger is pure data —
 * no DOM, no clock: registerComboHit takes nowMs so the caller injects the
 * time. The chain table (66→133→266→533→1066, then decay) and every award
 * constant are pinned here exactly as the brief lists them.
 */
import { describe, expect, it } from 'vitest';
import { ScoreLedger, registerComboHit, SCORE_EVENTS, } from '../../src/combat/scoring';
import { COMBO_WINDOW_MS } from '../../src/data/tuning';
describe('combo chain', () => {
    it('4 fast punches score 66+133+266+533', () => {
        const l = new ScoreLedger();
        let t = 0;
        const pts = [1, 2, 3, 4].map(() => registerComboHit(l, (t += 200)));
        expect(pts).toEqual([66, 133, 266, 533]);
        expect(l.total()).toBe(998);
    });
    it('5th hit lands the ×16 peak at 1066', () => {
        const l = new ScoreLedger();
        let t = 0;
        for (let i = 0; i < 5; i++)
            registerComboHit(l, (t += 200));
        expect(l.breakdown().find((b) => b.label === 'Combo')).toMatchObject({ count: 5 });
        expect(l.total()).toBe(66 + 133 + 266 + 533 + 1066);
    });
    it('a 3s gap resets the chain to hit one (66)', () => {
        const l = new ScoreLedger();
        registerComboHit(l, 0);
        registerComboHit(l, 100);
        // First hit past the window: chain restarts at 66.
        expect(registerComboHit(l, 100 + COMBO_WINDOW_MS + 500)).toBe(66);
        // And it chains onward from the fresh start.
        expect(registerComboHit(l, 100 + COMBO_WINDOW_MS + 700)).toBe(133);
    });
    it('hits spaced exactly COMBO_WINDOW_MS apart keep chaining', () => {
        const l = new ScoreLedger();
        const a = registerComboHit(l, 0);
        const b = registerComboHit(l, COMBO_WINDOW_MS); // exactly on the edge
        expect(a).toBe(66);
        expect(b).toBe(133); // still chained
    });
    it('decays past the 5th hit: 6th=533, 7th=355', () => {
        const l = new ScoreLedger();
        let t = 0;
        for (let i = 0; i < 7; i++)
            registerComboHit(l, (t += 200));
        const combo = l.breakdown().find((b) => b.label === 'Combo');
        // 66+133+266+533+1066 + 533 + 355 = 2952
        expect(combo.points).toBe(2952);
        expect(combo.count).toBe(7);
        expect(l.total()).toBe(2952);
    });
});
describe('bonus awards', () => {
    it('stealth kill awards exactly STEALTH_KILL once per event', () => {
        const l = new ScoreLedger();
        expect(l.award({ type: 'STEALTH_KILL' })).toBe(100);
        expect(l.award({ type: 'REVERSAL' })).toBe(30);
        expect(l.award({ type: 'REVERSAL_KO' })).toBe(100);
        expect(l.award({ type: 'LEG_CANNON' })).toBe(100);
        expect(l.award({ type: 'NICE_AIM' })).toBe(150);
        expect(l.award({ type: 'STYLE_WALLKICK' })).toBe(150);
        expect(l.award({ type: 'NINJA_THROW' })).toBe(60);
        expect(l.total()).toBe(100 + 30 + 100 + 100 + 150 + 150 + 60);
    });
    it('breakdown aggregates label, points and count; total matches sum', () => {
        const l = new ScoreLedger();
        l.award({ type: 'STEALTH_KILL' });
        l.award({ type: 'STEALTH_KILL' });
        registerComboHit(l, 10);
        registerComboHit(l, 20);
        const bd = l.breakdown();
        expect(bd).toHaveLength(2);
        expect(bd.find((b) => b.label === 'Stealth Kill')).toMatchObject({
            points: 200,
            count: 2,
        });
        expect(bd.find((b) => b.label === 'Combo')).toMatchObject({ points: 199, count: 2 });
        const sum = bd.reduce((acc, b) => acc + b.points, 0);
        expect(sum).toBe(l.total());
    });
    it('SCORE_EVENTS covers every brief-listed constant', () => {
        expect(SCORE_EVENTS.STEALTH_KILL).toBe(100);
        expect(SCORE_EVENTS.REVERSAL).toBe(30);
        expect(SCORE_EVENTS.REVERSAL_KO).toBe(100);
        expect(SCORE_EVENTS.LEG_CANNON).toBe(100);
        expect(SCORE_EVENTS.NICE_AIM).toBe(150);
        expect(SCORE_EVENTS.STYLE_WALLKICK).toBe(150);
        expect(SCORE_EVENTS.NINJA_THROW).toBe(60);
    });
    it('unknown award types are rejected loudly (typo safety)', () => {
        const l = new ScoreLedger();
        expect(() => l.award({ type: 'STELTH_KILL' })).toThrow(/unknown score event/i);
    });
});
