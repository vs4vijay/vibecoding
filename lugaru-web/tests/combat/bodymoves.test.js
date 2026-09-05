import { describe, expect, it } from 'vitest';
import { applySpecial, isSpecialMove, } from '../../src/combat/bodymoves';
import { FighterSim } from '../../src/combat/stateMachine';
import { applyHit } from '../../src/combat/hitdetect';
import { MOVES } from '../../src/data/moves';
import { BODY_THROW_IMPACT_DAMAGE, BODY_THROW_SPEED_MPS, FLIP_STUN_MS, KNOCKDOWN_VELY, LEG_CANNON_KNOCK_SPEED_MPS, WALL_KICK_LAUNCH_MPS, } from '../../src/data/tuning';
import { ScoreLedger } from '../../src/combat/scoring';
// ---------------------------------------------------------------------------
// Hand-crafted plain states — bodymoves.applySpecial is a pure dispatcher
// over FighterState snapshots; no sim class, no three/Rapier.
// ---------------------------------------------------------------------------
/** Fixed-step cadence mirrored from the production loop (60Hz). */
const STEP_MS = 1000 / 60;
function makeFighter(over = {}) {
    return {
        id: 'player',
        species: 'rabbit',
        team: 0,
        hp: 100,
        maxHp: 100,
        pos: { x: 0, y: 0, z: 0 },
        velY: 0,
        heading: -Math.PI / 2, // facing vector = (-sin h, -cos h) → +x
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
/** Wolf enemy `dist` ahead on +x (default inside every special's reach). */
function makeEnemy(dist = 1.2, over = {}) {
    return makeFighter({
        id: 'wolf1',
        species: 'wolf',
        team: 1,
        hp: 160,
        maxHp: 160,
        pos: { x: dist, y: 0, z: 0 },
        heading: Math.PI / 2, // faces back at the player
        ...over,
    });
}
const OPEN_CTX = { wallProximityM: Infinity, crouchHeld: false };
/**
 * Table-driven gate/effect matrix [brief Task 14 step 1]: craft attacker /
 * target states, call applySpecial, assert the effect fields.
 */
const ROWS = [
    {
        name: 'tackle downs a nearby target for the row’s low damage',
        move: 'tackle',
        attacker: makeFighter(),
        target: makeEnemy(1.2),
        ctx: OPEN_CTX,
        want: { damage: MOVES.tackle.damage, knockdown: true },
    },
    {
        name: 'tackle disarms when crouch is held (pin on top)',
        move: 'tackle',
        attacker: makeFighter(),
        target: makeEnemy(1.2),
        ctx: { wallProximityM: Infinity, crouchHeld: true },
        want: { damage: MOVES.tackle.damage, knockdown: true, disarm: true },
    },
    {
        name: 'soccerKick lands on a downed target (unblockable: no reversal row)',
        move: 'soccerKick',
        attacker: makeFighter(),
        target: makeEnemy(1.2, { phase: { t: 'downed', phaseMsLeft: 500 }, stance: 'downed' }),
        ctx: OPEN_CTX,
        want: { damage: MOVES.soccerKick.damage },
    },
    {
        name: 'soccerKick is rejected vs a standing target',
        move: 'soccerKick',
        attacker: makeFighter(),
        target: makeEnemy(1.2),
        ctx: OPEN_CTX,
        want: null,
    },
    {
        name: 'airGrab slams an airborne target and downs BOTH parties',
        move: 'airGrab',
        attacker: makeFighter(),
        target: makeEnemy(1.2, { stance: 'airborne', pos: { x: 1.2, y: 1.5, z: 0 } }),
        ctx: OPEN_CTX,
        want: {
            damage: MOVES.airGrab.damage,
            knockdown: true,
            selfKnockdown: true,
            impulse: { x: 0, y: -KNOCKDOWN_VELY, z: 0 },
        },
    },
    {
        name: 'airGrab is rejected vs a standing target',
        move: 'airGrab',
        attacker: makeFighter(),
        target: makeEnemy(1.2),
        ctx: OPEN_CTX,
        want: null,
    },
    {
        name: 'airGrab is cancelled by a mid-air flipping target',
        move: 'airGrab',
        attacker: makeFighter(),
        target: makeEnemy(1.2, {
            stance: 'airborne',
            flags: { bleeding: false, limping: false, unconscious: false, invulnerableAirFlipMs: 900 },
        }),
        ctx: OPEN_CTX,
        want: null,
    },
    {
        name: 'wallKick launches off a wall within 0.9m, style-bonus kill hook',
        move: 'wallKick',
        attacker: makeFighter(),
        target: makeEnemy(1.8),
        ctx: {
            wallProximityM: 0.5,
            wallAwayDir: { x: 1, z: 0 },
            crouchHeld: false,
        },
        want: {
            damage: MOVES.wallKick.damage,
            knockdown: true,
            attackerImpulse: { x: WALL_KICK_LAUNCH_MPS, y: 0, z: 0 },
            killScoreEvent: { type: 'STYLE_WALLKICK' },
        },
    },
    {
        name: 'wallKick requires the wall inside requiresWallWithinM',
        move: 'wallKick',
        attacker: makeFighter(),
        target: makeEnemy(1.8),
        ctx: OPEN_CTX, // open field: Infinity ≫ 0.9
        want: null,
    },
    {
        name: 'legCannon launches the victim away with massive knockback',
        move: 'legCannon',
        attacker: makeFighter(),
        target: makeEnemy(2.0),
        ctx: OPEN_CTX,
        want: {
            damage: MOVES.legCannon.damage,
            knockdown: true,
            impulse: { x: LEG_CANNON_KNOCK_SPEED_MPS, y: KNOCKDOWN_VELY, z: 0 },
            scoreEvent: { type: 'LEG_CANNON' },
        },
    },
    {
        name: 'bodyThrow launches a downed corpse as a projectile',
        move: 'bodyThrow',
        attacker: makeFighter(),
        target: makeEnemy(1.2, { phase: { t: 'ko', phaseMsLeft: Infinity }, stance: 'downed' }),
        ctx: OPEN_CTX,
        want: {
            corpseLaunch: true,
            impulse: { x: BODY_THROW_SPEED_MPS, y: KNOCKDOWN_VELY, z: 0 },
        },
    },
    {
        name: 'bodyThrow refuses a live standing target as ammo',
        move: 'bodyThrow',
        attacker: makeFighter(),
        target: makeEnemy(1.2),
        ctx: OPEN_CTX,
        want: null,
    },
    {
        name: 'bodyThrow corpse impact deals tuning damage and emits NICE_AIM',
        move: 'bodyThrow',
        attacker: makeFighter(),
        target: makeEnemy(3.0),
        ctx: { wallProximityM: Infinity, crouchHeld: false, corpseImpact: true },
        want: { damage: BODY_THROW_IMPACT_DAMAGE, scoreEvent: { type: 'NICE_AIM' } },
    },
    {
        name: 'flip stuns a nearby enemy for FLIP_STUN_MS',
        move: 'flip',
        attacker: makeFighter({ stance: 'airborne' }),
        target: makeEnemy(1.2),
        ctx: OPEN_CTX,
        want: { stunMs: FLIP_STUN_MS },
    },
    {
        name: 'flip ignores enemies beyond its 3m stun radius',
        move: 'flip',
        attacker: makeFighter({ stance: 'airborne' }),
        target: makeEnemy(3.5),
        ctx: OPEN_CTX,
        want: null,
    },
    {
        name: 'flip never stuns a KO’d body',
        move: 'flip',
        attacker: makeFighter({ stance: 'airborne' }),
        target: makeEnemy(1.2, { phase: { t: 'ko', phaseMsLeft: Infinity } }),
        ctx: OPEN_CTX,
        want: null,
    },
];
describe('applySpecial — pure effect table (T14)', () => {
    for (const row of ROWS) {
        it(row.name, () => {
            expect(applySpecial(row.move, row.attacker, row.target, row.ctx)).toEqual(row.want);
        });
    }
    it('tackle/soccerKick/airGrab/wallKick/legCannon/bodyThrow/flip are the special set', () => {
        for (const id of [
            'tackle',
            'soccerKick',
            'airGrab',
            'wallKick',
            'legCannon',
            'bodyThrow',
            'flip',
        ]) {
            expect(isSpecialMove(id)).toBe(true);
        }
        expect(isSpecialMove('punch')).toBe(false);
        expect(isSpecialMove('slash')).toBe(false);
    });
});
/** Player at origin facing +x, dummy `dist` ahead facing back. */
function makePair(dist = 1.2) {
    const player = new FighterSim('rabbit', 'player', true);
    const dummy = new FighterSim('wolf', 'wolf1', false);
    player.state.heading = -Math.PI / 2;
    dummy.state.pos.x = dist;
    dummy.state.heading = Math.PI / 2;
    const world = {
        fighters: [player.state, dummy.state],
        downedBodyNearby: false,
        weaponOnGroundNearby: false,
    };
    return { player, dummy, world };
}
/** Advance `n` fixed steps with the same frame. */
function run(sim, n, input, world) {
    for (let i = 0; i < n; i++)
        sim.update(STEP_MS, input, world);
}
/** Step until predicate holds or the budget runs out. */
function runUntil(sim, input, world, pred, maxSteps = 400) {
    for (let i = 0; i < maxSteps; i++) {
        if (pred())
            return true;
        sim.update(STEP_MS, input, world);
    }
    return pred();
}
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
describe('FighterSim applies special effects (T14)', () => {
    it('legCannon hit: 30 damage, knockdown, massive knockback push, LEG_CANNON award', () => {
        const { player, dummy, world } = makePair(2.0);
        const ledger = new ScoreLedger();
        player.setScoreLedger(ledger);
        // Sprint into range, then the running jump-attack.
        const runInput = makeInput({ moveZ: -1 });
        expect(runUntil(player, runInput, world, () => player.state.stance === 'running')).toBe(true);
        let fired = false;
        for (let i = 0; i < 60 && !fired; i++) {
            player.update(STEP_MS, { ...runInput, pressed: { ...runInput.pressed, jump: true } }, world);
            fired = player.state.phase.moveId === 'legCannon';
        }
        expect(fired).toBe(true);
        // Ride startup → active and land the strike through the sim surface.
        const hits = strikeUntil(player, [dummy.state], world);
        expect(hits.length).toBe(1);
        expect(dummy.state.hp).toBe(160 - MOVES.legCannon.damage); // rabbit mult 1.0
        expect(dummy.state.phase.t).toBe('downed');
        expect(dummy.state.pushX).toBeCloseTo(LEG_CANNON_KNOCK_SPEED_MPS, 5);
        expect(ledger.total()).toBe(100); // SCORE_LEG_CANNON landed on the hit
        // The launch rides the shared state: the victim's own sim carries it.
        const x0 = dummy.state.pos.x;
        for (let i = 0; i < 60; i++)
            dummy.update(STEP_MS, null, world);
        expect(dummy.state.pos.x).toBeGreaterThan(x0 + 2);
    });
    it('legCannon whiff: no target at strike time → the attacker eats dirt', () => {
        const { player, dummy, world } = makePair(2.0);
        const runInput = makeInput({ moveZ: -1 });
        expect(runUntil(player, runInput, world, () => player.state.stance === 'running')).toBe(true);
        let fired = false;
        for (let i = 0; i < 60 && !fired; i++) {
            player.update(STEP_MS, { ...runInput, pressed: { ...runInput.pressed, jump: true } }, world);
            fired = player.state.phase.moveId === 'legCannon';
        }
        expect(fired).toBe(true);
        // The target slips away mid-startup (dodged) — nobody in range to hit.
        dummy.state.pos.x += 10;
        // Game-like loop through the whole timeline: active must end empty and
        // the attacker self-downs.
        let playerHitApplied = false;
        for (let i = 0; i < 200 && player.state.phase.t !== 'downed'; i++) {
            player.update(STEP_MS, makeInput(), world);
            playerHitApplied = player.collectHits([dummy.state]).length > 0 || playerHitApplied;
        }
        expect(playerHitApplied).toBe(false);
        expect(player.state.phase.t).toBe('downed');
        expect(player.state.stance).toBe('downed');
    });
    it('lethal wallKick KOs and awards STYLE_WALLKICK; the attacker launches off the wall', () => {
        const { player, dummy, world } = makePair(1.6);
        world.wall = { proximityM: 0.5, awayX: 1, awayZ: 0 };
        dummy.state.hp = 20; // 25 base damage finishes the wolf
        const ledger = new ScoreLedger();
        player.setScoreLedger(ledger);
        run(player, 1, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
        expect(player.state.phase.moveId).toBe('wallKick'); // resolver offers it near a wall
        const hits = strikeUntil(player, [dummy.state], world);
        expect(hits.length).toBe(1);
        expect(dummy.state.phase.t).toBe('ko');
        expect(ledger.total()).toBe(150); // SCORE_STYLE_WALLKICK
        expect(player.state.pushX).toBeCloseTo(WALL_KICK_LAUNCH_MPS, 5);
    });
    it('airGrab pulls the airborne target down and downs BOTH parties', () => {
        const { player, dummy, world } = makePair(1.6);
        // Loft the dummy into the air.
        dummy.state.pos.y += 1.2;
        run(dummy, 2, null, world);
        expect(dummy.state.stance).toBe('airborne');
        run(player, 1, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
        expect(player.state.phase.moveId).toBe('airGrab');
        const hits = strikeUntil(player, [dummy.state], world);
        expect(hits.length).toBe(1);
        expect(dummy.state.phase.t).toBe('downed');
        expect(dummy.state.velY).toBeCloseTo(-KNOCKDOWN_VELY, 5); // slammed downward
        expect(player.state.phase.t).toBe('downed'); // attacker falls too
    });
    it('mid-air flip stuns the nearby dummy for FLIP_STUN_MS and cancels grabs', () => {
        const { player, dummy, world } = makePair(1.6);
        // Leave the ground, then flip mid-air (crouch-air trigger).
        run(player, 1, makeInput({ pressed: { attack: false, jump: true, crouch: false } }), world);
        expect(player.state.stance).toBe('airborne');
        player.update(STEP_MS, makeInput({ pressed: { attack: false, jump: false, crouch: true } }), world);
        expect(player.state.phase.t).toBe('idle'); // flip is a zero-timeline effect
        expect(player.state.flags.invulnerableAirFlipMs).toBeGreaterThan(0);
        expect(dummy.state.phase.t).toBe('hitstun');
        expect(dummy.state.phase.phaseMsLeft).toBeGreaterThan(FLIP_STUN_MS - 100);
        // While the flip invulnerability holds, airGrab refuses the target.
        expect(applySpecial('airGrab', makeFighter(), makeEnemy(1.2, { stance: 'airborne', flags: { ...makeFighter().flags, invulnerableAirFlipMs: 100 } }), OPEN_CTX)).toBeNull();
    });
    it('soccerKick vs a downed dummy deals its unblockable 12', () => {
        const { player, dummy, world } = makePair(1.6);
        dummy.state.phase = { t: 'downed', phaseMsLeft: 500 };
        dummy.state.stance = 'downed';
        run(player, 1, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
        expect(player.state.phase.moveId).toBe('soccerKick');
        const hits = strikeUntil(player, [dummy.state], world);
        expect(hits.length).toBe(1);
        expect(dummy.state.hp).toBe(160 - MOVES.soccerKick.damage);
        expect(dummy.state.phase.t).toBe('downed'); // stays down, timer refreshed
    });
    it('bodyThrow: corpse launch emits a bridge event; the corpse impact awards NICE_AIM', () => {
        const { player, dummy, world } = makePair(1.2);
        const ledger = new ScoreLedger();
        player.setScoreLedger(ledger);
        dummy.state.hp = 0;
        dummy.state.phase = { t: 'ko', phaseMsLeft: Infinity };
        dummy.state.flags.unconscious = true;
        dummy.state.stance = 'downed';
        // Crouch-context body throw at the corpse (downedBodyNearby derives from the roster).
        const crouch = makeInput({ pressed: { attack: false, jump: false, crouch: true } });
        run(player, 3, makeInput({ held: { attack: false, jump: false, crouch: true } }), world);
        player.update(STEP_MS, crouch, world);
        expect(player.state.phase.moveId).toBe('bodyThrow');
        let launched = false;
        for (let i = 0; i < 60 && !launched; i++) {
            player.update(STEP_MS, makeInput(), world);
            for (const hit of player.collectHits([dummy.state])) {
                player.applySpecialStrike(hit, world.fighters);
            }
            launched = player.lastCombatEvents.some((e) => e.type === 'corpseThrow');
        }
        expect(launched).toBe(true);
        const ev = player.lastCombatEvents.find((e) => e.type === 'corpseThrow');
        expect(ev).toBeDefined();
        if (ev?.type === 'corpseThrow') {
            expect(ev.victimId).toBe('wolf1');
            expect(ev.speed).toBe(BODY_THROW_SPEED_MPS);
        }
        // Second stage: the flying corpse connects with another enemy.
        const enemy2 = new FighterSim('wolf', 'wolf2', false);
        enemy2.state.pos.x = 5;
        enemy2.state.heading = Math.PI / 2;
        world.fighters.push(enemy2.state);
        const effect = player.applyCorpseImpact('wolf2', world.fighters);
        expect(effect).not.toBeNull();
        expect(enemy2.state.hp).toBe(160 - BODY_THROW_IMPACT_DAMAGE);
        expect(ledger.total()).toBe(150); // SCORE_NICE_AIM on the corpse hit
    });
    it('applyThrownKnifeImpact: fatal thrown knife awards NINJA_THROW to the thrower’s ledger', () => {
        const { player, dummy } = makePair(6);
        const ledger = new ScoreLedger();
        player.setScoreLedger(ledger);
        const out = player.applyThrownKnifeImpact(dummy.state, player.state);
        expect(out).not.toBeNull();
        expect(out.fatal).toBe(true); // unarmored wolf: blade to the vitals
        expect(dummy.state.phase.t).toBe('ko');
        expect(dummy.state.stuckIn).toBe(true);
        expect(ledger.total()).toBe(60); // SCORE_NINJA_THROW
        // Attribution guard: a non-thrower’s sim never awards.
        const stranger = new FighterSim('rabbit', 'stranger', true);
        expect(stranger.applyThrownKnifeImpact(dummy.state, player.state)).toBeNull();
    });
    it('a reversal whose counter throw KOs awards REVERSAL_KO', () => {
        const playerLedger = new ScoreLedger();
        const wolfLedger = new ScoreLedger();
        const { player, dummy, world } = makePair(1.2);
        player.setScoreLedger(playerLedger);
        dummy.setScoreLedger(wolfLedger);
        player.state.hp = 10; // the counter throw (15 base) finishes the reverser
        // Wolf begins a punch; the player reverses inside the window (T9 recipe).
        const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
        run(dummy, 1, wolfClick, world);
        expect(runUntil(dummy, makeInput(), world, () => dummy.state.moveElapsedMs >= 48)).toBe(true);
        player.update(STEP_MS, makeInput({ pressed: { attack: false, jump: false, crouch: true } }), world);
        expect(player.state.pendingReverseOf).toBe('wolf1'); // reversal fired
        expect(playerLedger.total()).toBe(30);
        // The wolf answers within its counter window; the throw KOs the player.
        dummy.update(STEP_MS, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
        expect(player.state.phase.t).toBe('ko');
        expect(wolfLedger.total()).toBe(100); // SCORE_REVERSAL_KO
    });
    it('disarm tackle: crouch-held strike strips the victim’s weapon into a drop event', () => {
        const { player, dummy, world } = makePair(1.2);
        dummy.state.weapon = 'sword';
        player.state.phase = {
            t: 'active',
            moveId: 'tackle',
            phaseMsLeft: MOVES.tackle.activeMs,
        };
        player.state.currentMove = MOVES.tackle;
        const hits = strikeUntil(player, [dummy.state], world, makeInput({ held: { attack: false, jump: false, crouch: true } }));
        expect(hits.length).toBe(1);
        expect(dummy.state.weapon).toBeNull();
        expect(dummy.state.phase.t).toBe('downed');
        player.update(STEP_MS, makeInput(), world); // publish the step's combat events
        const ev = player.lastCombatEvents.find((e) => e.type === 'drop');
        expect(ev).toBeDefined();
    });
});
/**
 * Game-loop strike ride: step until the swing connects, routing every hit
 * exactly like game.ts (specials → applySpecialStrike, plain → applyHit).
 */
function strikeUntil(attacker, victims, world, input = makeInput()) {
    let landed = [];
    for (let i = 0; i < 200 && landed.length === 0; i++) {
        attacker.update(STEP_MS, input, world);
        const hits = attacker.collectHits(victims);
        for (const hit of hits) {
            if (isSpecialMove(hit.moveId))
                attacker.applySpecialStrike(hit, world.fighters);
            else
                applyHit(hit, world.fighters);
        }
        if (hits.length > 0)
            landed = hits;
    }
    return landed;
}
