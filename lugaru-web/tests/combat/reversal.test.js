/**
 * Timed reversal windows, counter-reversals, and FighterSim wiring [spec §3.2].
 * tryReversal/startCounter are pure over plain states; integration tests drive
 * real FighterSim.update steps. Boundary pinning is REQUIRED here: window
 * edges (from/to) and the facing cone edge are pinned inclusive/exclusive.
 */
import { describe, expect, it } from 'vitest';
import { startCounter, tryReversal } from '../../src/combat/reversal';
import { angleDiff, applyHit } from '../../src/combat/hitdetect';
import { penaltyFor } from '../../src/combat/antirepetition';
import { FighterSim } from '../../src/combat/stateMachine';
import { MOVES } from '../../src/data/moves';
import { COUNTER_WINDOW_MS, REVERSE_DAMAGE, REVERSAL_HALF_ANGLE_RAD, REVERSE_PRESS_WINDOW_MS, } from '../../src/data/tuning';
// ---------------------------------------------------------------------------
// Hand-crafted plain states — pure-function surface.
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
        heading: -Math.PI / 2, // facing +x (facing vector = (−sin h, −cos h))
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
/** Defender at origin facing +x; attacker 1.2m ahead mid-`moveId`. */
function makeIncoming(moveId, elapsedMs) {
    const def = MOVES[moveId];
    const attacker = makeFighter({
        id: 'wolf1',
        species: 'wolf',
        team: 1,
        maxHp: 160,
        pos: { x: 1.2, y: 0, z: 0 },
        heading: Math.PI / 2, // facing back at the defender (−x)
        currentMove: def,
        moveElapsedMs: elapsedMs,
        phase: { t: 'active', moveId, phaseMsLeft: def.activeMs },
    });
    const defender = makeFighter();
    return { attacker, defender, def };
}
describe('angleDiff', () => {
    it('zero for equal headings, π for opposite, wraps shortest arc', () => {
        expect(angleDiff(0.3, 0.3)).toBeCloseTo(0);
        expect(angleDiff(-Math.PI / 2, Math.PI / 2)).toBeCloseTo(Math.PI);
        expect(angleDiff(Math.PI - 0.01, -Math.PI + 0.01)).toBeCloseTo(0.02);
        expect(angleDiff(-Math.PI, Math.PI)).toBeCloseTo(0);
    });
});
describe('tryReversal', () => {
    it('punch elapsed 60ms inside window {48..200}, facing → success', () => {
        const { attacker, defender, def } = makeIncoming('punch', 60);
        expect(def.reversalWindow.from).toBeLessThanOrEqual(60);
        expect(60).toBeLessThanOrEqual(def.reversalWindow.to);
        expect(tryReversal(defender, { attacker, def, elapsedMs: 60 })).toBe('success');
    });
    it('elapsed 20ms before window opens → early', () => {
        const { attacker, defender, def } = makeIncoming('punch', 20);
        expect(20).toBeLessThan(MOVES.punch.reversalWindow.from);
        expect(tryReversal(defender, { attacker, def, elapsedMs: 20 })).toBe('early');
    });
    it('elapsed 220ms after window closed → late', () => {
        const { attacker, defender, def } = makeIncoming('punch', 220);
        expect(220).toBeGreaterThan(MOVES.punch.reversalWindow.to);
        expect(tryReversal(defender, { attacker, def, elapsedMs: 220 })).toBe('late');
    });
    it('defender heading away from the attacker → notFacing (even mid-window)', () => {
        const { attacker, defender, def } = makeIncoming('punch', 60);
        defender.heading = Math.PI / 2; // facing −x, away from the wolf
        expect(tryReversal(defender, { attacker, def, elapsedMs: 60 })).toBe('notFacing');
    });
    it('boundary pinned: elapsed === window.from succeeds (inclusive open)', () => {
        const win = MOVES.punch.reversalWindow;
        const { attacker, defender, def } = makeIncoming('punch', win.from);
        expect(tryReversal(defender, { attacker, def, elapsedMs: win.from })).toBe('success');
    });
    it('boundary pinned: one ms before window.from → early (exclusive)', () => {
        const win = MOVES.punch.reversalWindow;
        const { attacker, defender, def } = makeIncoming('punch', win.from - 1);
        expect(win.from).toBeGreaterThanOrEqual(1); // −1 stays a valid timestamp
        expect(tryReversal(defender, { attacker, def, elapsedMs: win.from - 1 })).toBe('early');
    });
    it('boundary pinned: elapsed === window.to succeeds (inclusive close)', () => {
        const win = MOVES.punch.reversalWindow;
        const { attacker, defender, def } = makeIncoming('punch', win.to);
        expect(tryReversal(defender, { attacker, def, elapsedMs: win.to })).toBe('success');
    });
    it('boundary pinned: window.to + 1 → late (exclusive)', () => {
        const win = MOVES.punch.reversalWindow;
        const { attacker, defender, def } = makeIncoming('punch', win.to + 1);
        expect(tryReversal(defender, { attacker, def, elapsedMs: win.to + 1 })).toBe('late');
    });
    it('facing cone boundary pinned: just inside REVERSAL_HALF_ANGLE_RAD faces', () => {
        const { attacker, defender, def } = makeIncoming('punch', 60);
        // Defender→attacker bearing is −90° in heading space; sit just inside
        // the cone edge (brief: success iff angleDiff strictly < 100°).
        defender.heading = -Math.PI / 2 + REVERSAL_HALF_ANGLE_RAD - 0.001;
        expect(angleDiff(defender.heading, -Math.PI / 2)).toBeLessThan(REVERSAL_HALF_ANGLE_RAD);
        expect(tryReversal(defender, { attacker, def, elapsedMs: 60 })).toBe('success');
    });
    it('facing cone boundary pinned: exactly REVERSAL_HALF_ANGLE_RAD is NOT facing', () => {
        const { attacker, defender, def } = makeIncoming('punch', 60);
        // Strict inequality at the edge: 100.000° fails the < 100° test.
        defender.heading = -Math.PI / 2 + REVERSAL_HALF_ANGLE_RAD;
        expect(angleDiff(defender.heading, -Math.PI / 2)).toBeCloseTo(REVERSAL_HALF_ANGLE_RAD);
        expect(tryReversal(defender, { attacker, def, elapsedMs: 60 })).toBe('notFacing');
    });
    it('moves without a reversalWindow are never reversible → late', () => {
        const { attacker, defender } = makeIncoming('soccerKick', 10);
        expect(MOVES.soccerKick.reversalWindow).toBeUndefined();
        expect(tryReversal(defender, { attacker, def: MOVES.soccerKick, elapsedMs: 10 })).toBe('late');
    });
});
// ---------------------------------------------------------------------------
// Counter-reversal — startCounter returns an applyHit-ready effect.
// ---------------------------------------------------------------------------
describe('startCounter', () => {
    it('within counterWindow → true + effect downs the reverser through applyHit', () => {
        // Rabbit attacker keeps punchDmgMult at 1.0 so the applied damage is
        // exactly the table's REVERSE_DAMAGE (15) [brief Step-1 pin]; wolves
        // scale every strike by 1.6 per the shared species rule.
        const originalAttacker = makeFighter({ id: 'wolf1' });
        const reverser = makeFighter({
            id: 'player',
            phase: { t: 'hitstun', phaseMsLeft: 100 },
        });
        originalAttacker.phase = { t: 'hitstun', phaseMsLeft: COUNTER_WINDOW_MS };
        expect(REVERSE_DAMAGE).toBe(15);
        const res = startCounter(originalAttacker, reverser.id);
        expect(res.granted).toBe(true);
        expect(res.effect).toBeDefined();
        const effect = res.effect;
        expect(effect.attackerId).toBe(originalAttacker.id);
        expect(effect.victimId).toBe(reverser.id);
        expect(effect.moveId).toBe('counterThrow');
        // Feed the returned effect through the production hit pipeline.
        const deltas = applyHit(effect, [originalAttacker, reverser]);
        expect(deltas.length).toBe(1);
        expect(deltas[0].id).toBe(reverser.id);
        expect(reverser.hp).toBe(100 - REVERSE_DAMAGE); // exactly 15 dmg
        expect(reverser.phase.t).toBe('downed'); // the throw DOWNs the reverser
        expect(reverser.stance).toBe('downed');
    });
    it('counter effect carries the dedicated counterThrow row semantics', () => {
        expect(MOVES.counterThrow.knockdown).toBe(true); // downs any standing victim
        expect(MOVES.counterThrow.damage).toBe(REVERSE_DAMAGE); // data, not magic
    });
    it('outside counterWindow → granted:false and no effect object', () => {
        const originalAttacker = makeFighter({ id: 'wolf1', species: 'wolf', team: 1 });
        const reverser = makeFighter({ id: 'player' });
        // Attacker already recovered from the reversal hitstun → no counter.
        originalAttacker.phase = { t: 'recovery', phaseMsLeft: 10 };
        const res = startCounter(originalAttacker, reverser.id);
        expect(res.granted).toBe(false);
        expect(res.effect).toBeUndefined();
        expect(reverser.hp).toBe(100);
    });
    it('boundary pinned: full window remaining grants; drained timer does not', () => {
        const originalAttacker = makeFighter({ id: 'wolf1', species: 'wolf', team: 1 });
        const reverser = makeFighter({ id: 'player' });
        originalAttacker.phase = { t: 'hitstun', phaseMsLeft: COUNTER_WINDOW_MS };
        expect(startCounter(originalAttacker, reverser.id).granted).toBe(true);
        const expired = makeFighter({ id: 'wolf2', species: 'wolf', team: 1 });
        expired.phase = { t: 'hitstun', phaseMsLeft: COUNTER_WINDOW_MS - 1 };
        expect(startCounter(expired, reverser.id).granted).toBe(true);
        const spent = makeFighter({ id: 'wolf3', species: 'wolf', team: 1 });
        spent.phase = { t: 'hitstun', phaseMsLeft: 0 };
        expect(spent.phase.phaseMsLeft <= 0).toBe(true);
        expect(startCounter(spent, reverser.id).granted).toBe(false);
    });
    it('attacker never left hitstun (already recovered/acting) cannot counter', () => {
        const originalAttacker = makeFighter({ id: 'wolf1', species: 'wolf', team: 1 });
        const reverser = makeFighter({ id: 'player' });
        originalAttacker.phase = { t: 'startup', moveId: 'punch', phaseMsLeft: 50 };
        expect(startCounter(originalAttacker, reverser.id).granted).toBe(false);
    });
});
/** Rabbit player at origin facing +x; wolf dummy 1.2m ahead facing back. */
function makePair() {
    const player = new FighterSim('rabbit', 'player', true);
    const dummy = new FighterSim('wolf', 'wolf1', false);
    player.state.pos.x = 0;
    player.state.heading = -Math.PI / 2;
    dummy.state.pos.x = 1.2;
    dummy.state.heading = Math.PI / 2;
    const world = {
        fighters: [player.state, dummy.state],
        downedBodyNearby: false,
        weaponOnGroundNearby: false,
    };
    return { player, dummy, world };
}
const STEP_MS = 1000 / 60;
function makeInput(over = {}) {
    return {
        moveX: 0,
        moveZ: 0,
        lookDX: 0,
        lookDY: 0,
        pressed: { attack: false, jump: false, crouch: false },
        held: { attack: false, jump: false, crouch: false },
        ...over,
    };
}
function clickCrouch() {
    return makeInput({ pressed: { attack: false, jump: false, crouch: true } });
}
function run(sim, n, input, world) {
    for (let i = 0; i < n; i++)
        sim.update(STEP_MS, input, world);
}
/** Step in fixed chunks until predicate holds or budget runs out. */
function runUntil(sim, input, world, pred, maxSteps = 400) {
    for (let i = 0; i < maxSteps && !pred(); i++)
        sim.update(STEP_MS, input, world);
    return pred();
}
describe('FighterSim reversal wiring', () => {
    it('crouch press during wolf punch startup reverses: attacker cancels to hitstun, defender enters reverseAttempt', () => {
        const { player, dummy, world } = makePair();
        const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
        run(dummy, 1, wolfClick, world); // wolf begins its punch
        expect(dummy.state.phase.moveId).toBe('punch');
        // Ride ~60ms into the punch (inside reversalWindow {48..200}), then duck.
        const pressed = runUntil(dummy, makeInput(), world, () => {
            return dummy.state.moveElapsedMs >= 48;
        });
        expect(pressed).toBe(true);
        player.update(STEP_MS, clickCrouch(), world);
        expect(player.state.phase.t).toBe('reverseAttempt');
        expect(player.state.pendingReverseOf).toBe('wolf1');
        // The attacker's incoming move must be cancelled — no active frames land.
        expect(dummy.state.pendingReverseOf).toBe('player');
        expect(dummy.state.phase.t).toBe('hitstun');
        expect(dummy.collectHits([player.state]).length).toBe(0);
    });
    it('too-early duck (before reversalWindow opens) is just a duck — no reverseAttempt', () => {
        const { player, dummy, world } = makePair();
        const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
        run(dummy, 1, wolfClick, world); // punch starts, elapsed ≈ 16.7ms < 48
        player.update(STEP_MS, clickCrouch(), world);
        expect(player.state.phase.t).not.toBe('reverseAttempt');
        expect(player.state.pendingReverseOf).toBeUndefined();
    });
    it('reverseAttempt resolves after its animation without touching hp', () => {
        const { player, dummy, world } = makePair();
        const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
        run(dummy, 1, wolfClick, world);
        runUntil(dummy, makeInput(), world, () => dummy.state.moveElapsedMs >= 48);
        player.update(STEP_MS, clickCrouch(), world);
        const hpBefore = player.state.hp;
        expect(player.state.phase.t).toBe('reverseAttempt');
        const resolved = runUntil(player, makeInput(), world, () => player.state.phase.t === 'idle');
        expect(resolved).toBe(true);
        expect(player.state.hp).toBe(hpBefore); // success ≠ damage either way
        expect(player.state.pendingReverseOf).toBeUndefined();
    });
    it('antiRep initializes on first fired attack and counts consecutive punches', () => {
        const { player, world } = makePair();
        run(player, 1, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
        expect(player.state.antiRep).toBeDefined();
        expect(player.state.antiRep.lastMoveIds).toEqual(['punch']);
        expect(penaltyFor(player.state.antiRep, 'punch')).toBe(1);
    });
    it('exposes antiRep streak so T16 AI can read it', () => {
        const { player, world } = makePair();
        for (let i = 0; i < 3; i++) {
            run(player, 1, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
            runUntil(player, makeInput(), world, () => player.state.phase.t === 'idle');
        }
        expect(player.state.antiRep.lastMoveIds.length).toBeGreaterThanOrEqual(3);
        // Three straight punches → damage scale ≈ 1.4 (the pressure signal).
        expect(penaltyFor(player.state.antiRep, 'punch')).toBeCloseTo(1.4, 5);
    });
    it('REVERSE_PRESS_WINDOW_MS stays the timed-press threshold (250)', () => {
        expect(REVERSE_PRESS_WINDOW_MS).toBe(250);
    });
    it('F1: reversed attacker pressing attack within the counter window downs the reverser', () => {
        const { player, dummy, world } = makePair();
        const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
        // 1. Wolf punches; player reverses inside the window.
        run(dummy, 1, wolfClick, world);
        runUntil(dummy, makeInput(), world, () => dummy.state.moveElapsedMs >= 48);
        player.update(STEP_MS, clickCrouch(), world);
        expect(player.state.phase.t).toBe('reverseAttempt');
        expect(dummy.state.phase.t).toBe('hitstun'); // the counter window itself
        // 2. Within COUNTER_WINDOW_MS, the original attacker presses ATTACK.
        const hpBefore = player.state.hp;
        dummy.update(STEP_MS, wolfClick, world);
        // The counter throw fired: player (reverser) is DOWN. Damage follows
        // the shared species rule — wolf attacker scales counterThrow's base
        // 15 by punchDmgMult 1.6 = 24.
        expect(player.state.phase.t).toBe('downed');
        expect(player.state.stance).toBe('downed');
        expect(player.state.hp).toBe(hpBefore - Math.round(REVERSE_DAMAGE * 1.6));
        expect(dummy.state.pendingReverseOf).toBeUndefined(); // window consumed
    });
    it('F1: attack press after the counter window expired behaves normally (no throw)', () => {
        const { player, dummy, world } = makePair();
        const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
        run(dummy, 1, wolfClick, world);
        runUntil(dummy, makeInput(), world, () => dummy.state.moveElapsedMs >= 48);
        player.update(STEP_MS, clickCrouch(), world);
        expect(dummy.state.phase.t).toBe('hitstun');
        // Let the counter window fully drain before any press.
        const drained = runUntil(dummy, makeInput(), world, () => dummy.state.phase.t === 'idle');
        expect(drained).toBe(true);
        const hpBefore = player.state.hp;
        // Now a normal attack press: buffered/normal behavior, no downing.
        run(dummy, 1, wolfClick, world);
        expect(player.state.phase.t).not.toBe('downed');
        expect(player.state.hp).toBe(hpBefore);
        expect(dummy.state.phase.moveId).toBe('punch'); // fresh punch started
    });
});
