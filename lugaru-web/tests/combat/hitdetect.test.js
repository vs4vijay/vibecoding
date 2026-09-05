import { describe, expect, it } from 'vitest';
import { applyHit, findHit, forwardXZ } from '../../src/combat/hitdetect';
import { MOVES } from '../../src/data/moves';
import { DOWNED_GROUND_MS, HITSTUN_MS, KNOCKDOWN_VELY } from '../../src/data/tuning';
// ---------------------------------------------------------------------------
// Hand-crafted plain states — findHit/applyHit are pure functions over
// FighterState snapshots; no sim class involved.
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
        heading: -Math.PI / 2, // facing +x (facing vector = (-sin h, -cos h))
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
/** Attacker mid-active on `moveId`; victim placed at polar offset. */
function makeSwing(moveId, victimOver = {}) {
    const attacker = makeFighter({
        phase: { t: 'active', moveId, phaseMsLeft: MOVES[moveId].activeMs },
        currentMove: MOVES[moveId],
    });
    const victim = makeFighter({ id: 'wolf1', species: 'wolf', team: 1, maxHp: 160, ...victimOver });
    return { attacker, victim };
}
describe('findHit geometry', () => {
    it('no event while the attacker is not in active frames', () => {
        const { attacker, victim } = makeSwing('punch');
        attacker.phase = { t: 'startup', moveId: 'punch', phaseMsLeft: 40 };
        expect(findHit(attacker, [victim])).toEqual([]);
    });
    it('out-of-range victim produces no event', () => {
        const { attacker, victim } = makeSwing('punch');
        victim.pos.x = 2.5; // punch.rangeM = 1.4
        expect(findHit(attacker, [victim])).toEqual([]);
    });
    it('range boundary is inclusive: exactly rangeM connects', () => {
        const { attacker, victim } = makeSwing('punch');
        victim.pos.x = MOVES.punch.rangeM;
        expect(findHit(attacker, [victim]).length).toBe(1);
    });
    it('victim behind the attacker (angle > arc/2) produces no event', () => {
        const { attacker, victim } = makeSwing('punch');
        victim.pos.x = -1.0; // directly behind a +x-facing attacker
        expect(findHit(attacker, [victim])).toEqual([]);
    });
    it('arc boundary is inclusive and off-cone angles miss', () => {
        const { attacker, victim } = makeSwing('punch'); // arc 1.0 rad → half 0.5
        // Victim direction = unit facing rotated by `ang` (rotation of the facing
        // vector, not the heading) — same convention findHit tests against.
        const rot = (ang) => {
            const f = forwardXZ(attacker.heading);
            return {
                x: f.x * Math.cos(ang) - f.z * Math.sin(ang),
                z: f.x * Math.sin(ang) + f.z * Math.cos(ang),
            };
        };
        const onEdge = rot(0.5);
        victim.pos.x = onEdge.x;
        victim.pos.z = onEdge.z; // dead on the cone edge
        expect(findHit(attacker, [victim]).length).toBe(1);
        const wide = makeSwing('punch');
        const outside = rot(0.9); // 0.9 rad > 0.5 half-angle
        wide.victim.pos.x = outside.x;
        wide.victim.pos.z = outside.z;
        expect(findHit(wide.attacker, [wide.victim])).toEqual([]);
    });
    it('two victims inside the arc are both hit exactly once', () => {
        const { attacker, victim: v1 } = makeSwing('legSweep');
        const v2 = makeFighter({ id: 'wolf2', species: 'wolf', team: 1, maxHp: 160 });
        v1.pos.x = 1.0;
        v2.pos.x = Math.cos(0.4);
        v2.pos.z = Math.sin(0.4);
        const events = findHit(attacker, [v1, v2]);
        expect(events.length).toBe(2);
        expect(new Set(events.map((e) => e.victimId))).toEqual(new Set(['wolf1', 'wolf2']));
    });
    it('findHit is stateless: same swing repeats events (dedup is FighterSim\'s job)', () => {
        const { attacker, victim } = makeSwing('punch');
        victim.pos.x = 1.0;
        expect(findHit(attacker, [victim]).length).toBe(1);
        expect(findHit(attacker, [victim]).length).toBe(1);
    });
    it('events carry ids, moveId and a normalized direction toward the victim', () => {
        // legSweep: arcRad 1.6 → half 0.8 > the π/4 diagonal; range 1.6 covers it.
        const { attacker, victim } = makeSwing('legSweep');
        victim.pos.x = 0.7;
        victim.pos.z = 0.7;
        const events = findHit(attacker, [victim]);
        expect(events.length).toBe(1);
        const e = events[0];
        expect(e.attackerId).toBe('player');
        expect(e.victimId).toBe('wolf1');
        expect(e.moveId).toBe('legSweep');
        const len = Math.hypot(e.dirVector.x, e.dirVector.z);
        expect(len).toBeCloseTo(1, 5);
        expect(e.dirVector.x).toBeCloseTo(Math.SQRT1_2, 4);
        expect(e.dirVector.z).toBeCloseTo(Math.SQRT1_2, 4);
    });
});
describe('applyHit damage and status rules', () => {
    function land(hitOver, victims) {
        applyHit({
            attackerId: 'player',
            victimId: 'wolf1',
            moveId: 'punch',
            dirVector: { x: 1, z: 0 },
            ...hitOver,
        }, victims);
    }
    it('damage scales by attacker species mult (rabbit ×1.0)', () => {
        const { attacker, victim } = makeSwing('punch');
        land({}, [attacker, victim]);
        expect(victim.hp).toBe(92); // 100 − punch 8 × rabbit mult 1.0
    });
    it('damage scales by wolf mult ×1.6', () => {
        const attacker = makeFighter({ id: 'wolfA', species: 'wolf', team: 1 });
        const victim = makeFighter({ id: 'rabbitB', team: 0 }); // 100 hp
        attacker.phase = { t: 'active', moveId: 'punch', phaseMsLeft: 80 };
        attacker.currentMove = MOVES.punch;
        land({ attackerId: 'wolfA', victimId: 'rabbitB' }, [attacker, victim]);
        expect(victim.hp).toBe(87); // Math.round(8 × 1.6) = 13
    });
    it('knockdown move downs a standing victim with velY impulse', () => {
        const { attacker, victim } = makeSwing('runningKick');
        land({ moveId: 'runningKick' }, [attacker, victim]);
        expect(victim.phase.t).toBe('downed');
        expect(victim.velY).toBe(KNOCKDOWN_VELY);
        expect(victim.stance).toBe('downed');
    });
    it('knockdown move vs crouched victim staggers instead (hitstun, no impulse)', () => {
        const { attacker, victim } = makeSwing('legSweep');
        victim.stance = 'crouched';
        land({ moveId: 'legSweep' }, [attacker, victim]);
        expect(victim.phase.t).toBe('hitstun');
        expect(victim.phase.phaseMsLeft).toBe(HITSTUN_MS);
        expect(victim.velY).toBe(0);
    });
    it('non-knockdown hit applies plain hitstun of 350ms', () => {
        const { attacker, victim } = makeSwing('punch');
        land({}, [attacker, victim]);
        expect(victim.phase.t).toBe('hitstun');
        expect(victim.phase.phaseMsLeft).toBe(HITSTUN_MS);
        expect(victim.phase.moveId).toBeUndefined();
    });
    it('blade-class weapons flag bleeding; unarmed never does', () => {
        const { attacker, victim } = makeSwing('punch');
        land({}, [attacker, victim]);
        expect(victim.flags.bleeding).toBe(false);
        const armed = makeSwing('punch');
        armed.attacker.weapon = 'sword'; // blade tier [spec §3.4]
        land({}, [armed.attacker, armed.victim]);
        expect(armed.victim.flags.bleeding).toBe(true);
    });
    it('lethal damage sets ko phase + unconscious and clamps hp at 0', () => {
        const { attacker, victim } = makeSwing('punch');
        victim.hp = 3;
        land({}, [attacker, victim]);
        expect(victim.hp).toBe(0);
        expect(victim.phase.t).toBe('ko');
        expect(victim.flags.unconscious).toBe(true);
    });
    it('a lethal blade hit still flags bleeding (bleed persists through death)', () => {
        const { attacker, victim } = makeSwing('punch');
        attacker.weapon = 'sword';
        victim.hp = 3;
        land({}, [attacker, victim]);
        expect(victim.phase.t).toBe('ko');
        expect(victim.flags.bleeding).toBe(true);
    });
    it('knockdown re-hit on a downed victim refreshes ground timer + impulse (OTG)', () => {
        const { attacker, victim } = makeSwing('runningKick');
        // Already on the ground, halfway through the stand-up timer.
        victim.stance = 'downed';
        victim.phase.t = 'downed';
        victim.phase.phaseMsLeft = DOWNED_GROUND_MS / 2;
        land({ moveId: 'runningKick' }, [attacker, victim]);
        expect(victim.phase.t).toBe('downed');
        expect(victim.phase.phaseMsLeft).toBe(DOWNED_GROUND_MS); // refreshed
        expect(victim.velY).toBe(KNOCKDOWN_VELY); // impulse re-applied
    });
    it('non-knockdown hit on a downed victim flips to standing hitstun', () => {
        const { attacker, victim } = makeSwing('punch');
        victim.stance = 'downed';
        victim.phase.t = 'downed';
        victim.velY = 0;
        land({}, [attacker, victim]);
        expect(victim.phase.t).toBe('hitstun');
        expect(victim.stance).toBe('standing'); // popped back up by the stagger
        expect(victim.velY).toBe(0); // no impulse for plain hits
    });
    it('returns a delta for the victim with knockdown impulse', () => {
        const { attacker, victim } = makeSwing('runningKick');
        const deltas = applyHit({ attackerId: 'player', victimId: 'wolf1', moveId: 'runningKick', dirVector: { x: 1, z: 0 } }, [attacker, victim]);
        expect(deltas.length).toBe(1);
        expect(deltas[0].id).toBe('wolf1');
        expect(deltas[0].hp).toBe(-14); // runningKick dmg 14 × rabbit mult 1.0
        expect(deltas[0].velY).toBe(KNOCKDOWN_VELY);
        expect(victim.velY).toBe(KNOCKDOWN_VELY);
    });
});
describe('tuning constants sanity', () => {
    it('exposes the dispatch-mandated numbers', () => {
        expect(HITSTUN_MS).toBe(350);
        expect(KNOCKDOWN_VELY).toBe(3.5);
        expect(DOWNED_GROUND_MS).toBeGreaterThan(300);
        expect(MOVES.runningKick.lungeSpeed).toBeGreaterThan(0);
    });
});
