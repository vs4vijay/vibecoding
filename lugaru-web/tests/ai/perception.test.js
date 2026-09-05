import { describe, expect, it } from 'vitest';
import { canSee, emitHearing, hearingRadius, hear, } from '../../src/ai/perception';
import { BUSH_RADIUS_M, CROUCH_SIGHT_MULT, HEARING_BASE_RABBIT_M, HEARING_BASE_WOLF_M, SIGHT_RANGE_WOLF_M, } from '../../src/data/tuning';
// ---------------------------------------------------------------------------
// Sight — canSee(observer, target, world)
//
// Pure, headless, no three/Rapier. Heading uses the repo's forwardXZ
// convention: forward along heading h is (-sin h, -cos h); a dot-product
// FOV test is convention-agnostic.
// ---------------------------------------------------------------------------
function sighter(over = {}) {
    return { pos: { x: 0, z: 0 }, heading: 0, species: 'wolf', ...over };
}
function target(over = {}) {
    // heading 0 -> forward is -z, so default target dead ahead along -z.
    return { pos: { x: 0, z: -5 }, heading: 0, species: 'rabbit', crouched: false, ...over };
}
const EMPTY = { bushes: [] };
describe('canSee — range', () => {
    it('sees a standing target just inside wolf sight range', () => {
        expect(canSee(sighter(), target({ pos: { x: 0, z: -SIGHT_RANGE_WOLF_M + 1 } }), EMPTY)).toBe(true);
    });
    it('fails to see beyond the observer\'s sight range', () => {
        expect(canSee(sighter(), target({ pos: { x: 0, z: -(SIGHT_RANGE_WOLF_M + 1) } }), EMPTY)).toBe(false);
    });
    it('uses the rabbit\'s shorter sight range', () => {
        const rabbit = { pos: { x: 0, z: 0 }, heading: 0, species: 'rabbit' };
        // 15m is within wolf (18) but beyond rabbit (14).
        expect(canSee(rabbit, target({ pos: { x: 0, z: -15 } }), EMPTY)).toBe(false);
        expect(canSee(rabbit, target({ pos: { x: 0, z: -13 } }), EMPTY)).toBe(true);
    });
});
describe('canSee — crouch halves range', () => {
    it('fails to see a crouched target beyond the halved range', () => {
        const range = SIGHT_RANGE_WOLF_M;
        const half = range * CROUCH_SIGHT_MULT;
        // Standing target at 13m is visible (13 < 18).
        expect(canSee(sighter(), target({ pos: { x: 0, z: -13 }, crouched: false }), EMPTY)).toBe(true);
        // Same 13m but crouched: 13 >= 9 -> blocked.
        expect(canSee(sighter(), target({ pos: { x: 0, z: -13 }, crouched: true }), EMPTY)).toBe(false);
        // Crouched just inside the halved range is still seen.
        expect(canSee(sighter(), target({ pos: { x: 0, z: -(half - 0.5) }, crouched: true }), EMPTY)).toBe(true);
    });
});
describe('canSee — field of view', () => {
    it('sees a target dead ahead within the FOV', () => {
        expect(canSee(sighter(), target({ pos: { x: 0, z: -5 } }), EMPTY)).toBe(true);
    });
    it('fails to see a target 90° to the side (outside 120° FOV)', () => {
        // 5m straight to the +x side of the observer = 90° off the -z forward.
        expect(canSee(sighter(), target({ pos: { x: 5, z: 0 } }), EMPTY)).toBe(false);
    });
    it('sees a target at exactly 50° off-axis (inside FOV)', () => {
        const ang = (50 * Math.PI) / 180;
        const d = 5;
        const t = target({
            pos: { x: -Math.sin(ang) * d, z: -Math.cos(ang) * d },
        });
        expect(canSee(sighter(), t, EMPTY)).toBe(true);
    });
    it('fails to see a target behind the observer', () => {
        expect(canSee(sighter(), target({ pos: { x: 0, z: 5 } }), EMPTY)).toBe(false);
    });
});
describe('canSee — bush blocking', () => {
    const bushAt = (x, z) => ({ pos: { x, z }, radius: BUSH_RADIUS_M });
    it('sees through fewer than two interfering bushes', () => {
        const world = { bushes: [bushAt(0, -2.5)] };
        expect(canSee(sighter(), target(), world)).toBe(true);
    });
    it('is blocked when two bushes intersect the sight line', () => {
        const world = { bushes: [bushAt(0, -2), bushAt(0, -3.5)] };
        expect(canSee(sighter(), target({ pos: { x: 0, z: -10 } }), world)).toBe(false);
    });
    it('is not blocked by bushes off to the side', () => {
        const world = { bushes: [bushAt(4, -3), bushAt(5, -4)] };
        expect(canSee(sighter(), target({ pos: { x: 0, z: -10 } }), world)).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// Hearing — emitHearing / hearingRadius / hear
// ---------------------------------------------------------------------------
const LOUDNESS_BUSH_RUSTLE = 0.6;
describe('hearingRadius', () => {
    it('is loudness times the listener species base', () => {
        expect(hearingRadius('bushRustle', 'rabbit')).toBeCloseTo(LOUDNESS_BUSH_RUSTLE * HEARING_BASE_RABBIT_M);
        expect(hearingRadius('bushRustle', 'wolf')).toBeCloseTo(LOUDNESS_BUSH_RUSTLE * HEARING_BASE_WOLF_M);
    });
});
describe('hear', () => {
    it('lets a rabbit hear a bush rustle at 10m but not a wolf (rabbit hears farther)', () => {
        const rs = { pos: { x: 0, z: 0 }, species: 'rabbit' };
        const wf = { pos: { x: 0, z: 0 }, species: 'wolf' };
        const e = { kind: 'bushRustle', loudness: LOUDNESS_BUSH_RUSTLE, pos: { x: 0, z: -10 } };
        expect(hear(rs, e)).toBe(true);
        expect(hear(wf, e)).toBe(false);
    });
    it('records lastHeardPos on a heard event', () => {
        const l = { pos: { x: 0, z: 0 }, species: 'rabbit' };
        const e = { kind: 'scream', loudness: 1.5, pos: { x: 3, z: -4 } };
        expect(hear(l, e)).toBe(true);
        expect(l.lastHeardPos).toEqual({ x: 3, z: -4 });
    });
    it('does not record lastHeardPos when out of range', () => {
        const l = { pos: { x: 0, z: 0 }, species: 'wolf' };
        const e = { kind: 'bushRustle', loudness: LOUDNESS_BUSH_RUSTLE, pos: { x: 0, z: -100 } };
        expect(hear(l, e)).toBe(false);
        expect(l.lastHeardPos).toBeUndefined();
    });
    it('hears bigger events (scream) from farther away', () => {
        const l = { pos: { x: 0, z: 0 }, species: 'rabbit' };
        const scream = { kind: 'scream', loudness: 1.5, pos: { x: 0, z: -20 } };
        // 20m < rabbit scream radius (1.5 * 18 = 27).
        expect(hear(l, scream)).toBe(true);
        const rustle = { kind: 'bushRustle', loudness: LOUDNESS_BUSH_RUSTLE, pos: { x: 0, z: -20 } };
        expect(hear(l, rustle)).toBe(false);
    });
});
describe('emitHearing', () => {
    it('collects events into a shared buffer', () => {
        const events = [];
        emitHearing(events, { kind: 'landThud', loudness: 0.9, pos: { x: 1, z: 2 } });
        emitHearing(events, { kind: 'roll', loudness: 1.2, pos: { x: 3, z: 4 } });
        expect(events).toHaveLength(2);
        expect(events[1].kind).toBe('roll');
    });
});
