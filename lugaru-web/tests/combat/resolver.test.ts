import { describe, expect, it } from 'vitest';
import { MOVES } from '../../src/data/moves';
import { FLIP_STUN_MS } from '../../src/data/tuning';
import { resolveAction } from '../../src/combat/resolver';
import type {
  CombatantSnapshot,
  MoveId,
  ResolveResult,
  TargetSnapshot,
  WorldContext,
} from '../../src/combat/resolver';

// ---------------------------------------------------------------------------
// Snapshot builders — plain objects only; the resolver is importable headless
// (no three/Rapier anywhere under src/combat or src/data).
// ---------------------------------------------------------------------------

const NO_CTX: WorldContext = {
  downedBodyNearby: false,
  weaponOnGroundNearby: false,
  airborneSelf: false,
};

function makeActor(over: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    id: 'player',
    stance: 'standing',
    isRunning: false,
    crouchHeldMs: 0,
    pos: { x: 0, y: 0, z: 0 },
    heading: 0,
    hasWeapon: null,
    wallProximityM: Infinity,
    nearestTarget: null,
    ...over,
  };
}

function makeTarget(
  over: Partial<TargetSnapshot> = {},
): TargetSnapshot {
  return {
    id: 'wolf1',
    dist: 1.2, // inside punch.rangeM (1.4), the tightest gate
    relAngle: 0, // dead ahead
    stance: 'standing',
    isDowned: false,
    airborne: false,
    facingMe: true,
    unaware: false,
    ...over,
  };
}


/** Assert the action is a plain move with `id`. */
function expectMove(a: ResolveResult | null, id: MoveId): void {
  expect(a).toEqual({ kind: 'move', id });
}

/** Assert `a` is the reverse action against `targetId`. */
function expectReverse(a: ResolveResult | null, targetId: string): void {
  expect(a).toEqual({ kind: 'reverse', targetId });
}

describe('attack button', () => {
  it('standing with in-range target → punch', () => {
    expectMove(
      resolveAction({ button: 'attack' }, makeActor({ nearestTarget: makeTarget() }), NO_CTX),
      'punch',
    );
  });

  it('running → runningKick', () => {
    expectMove(resolveAction({ button: 'attack' }, makeActor({ isRunning: true }), NO_CTX), 'runningKick');
  });

  it('crouched → legSweep', () => {
    expectMove(resolveAction({ button: 'attack' }, makeActor({ stance: 'crouched' }), NO_CTX), 'legSweep');
  });

  it('held attack during first punch recovery chains doublePunch (crouch not held)', () => {
    const a = resolveAction(
      { button: 'attack', heldAttack: true },
      makeActor({ currentMove: { id: 'punch', phase: 'recovery', phaseMsElapsed: 10 } }),
      NO_CTX,
    );
    expectMove(a, 'doublePunch');
  });

  it('doublePunch does NOT chain when crouch is held (reverse intent wins)', () => {
    const a = resolveAction(
      { button: 'attack', heldAttack: true },
      makeActor({
        stance: 'crouched',
        crouchHeldMs: 100,
        currentMove: { id: 'punch', phase: 'recovery', phaseMsElapsed: 10 },
      }),
      NO_CTX,
    );
    expectMove(a, 'legSweep');
  });

  it('enemy downed in front → soccerKick', () => {
    expectMove(
      resolveAction(
        { button: 'attack' },
        makeActor({ nearestTarget: makeTarget({ dist: 2.2, isDowned: true }) }),
        NO_CTX,
      ),
      'soccerKick',
    );
  });

  it('enemy airborne overhead → airGrab', () => {
    expectMove(
      resolveAction(
        { button: 'attack' },
        makeActor({ nearestTarget: makeTarget({ dist: 1.8, airborne: true }) }),
        NO_CTX,
      ),
      'airGrab',
    );
  });

  it('wall within 0.9m → wallKick', () => {
    expectMove(
      resolveAction(
        { button: 'attack' },
        makeActor({ wallProximityM: 0.7 }),
        NO_CTX,
      ),
      'wallKick',
    );
  });

  it('wall beyond 0.9m falls through to normal attack resolution', () => {
    const a = resolveAction(
      { button: 'attack' },
      makeActor({ wallProximityM: 1.4, nearestTarget: makeTarget() }),
      NO_CTX,
    );
    expectMove(a, 'punch');
  });

  it('behind-unaware LIVING target beats wall context moves [T18: live row]', () => {
    // Every competing context true at once — stealthKill must win.
    // (T18 semantics: the victim is alive — a downed body is soccerKick's,
    // and tryStealthKill whiffs any kill offered on one.)
    const a = resolveAction(
      { button: 'attack' },
      makeActor({
        wallProximityM: 0.5,
        nearestTarget: makeTarget({ relAngle: Math.PI, dist: 1.0, facingMe: false, unaware: true }),
      }),
      NO_CTX,
    );
    expectMove(a, 'stealthKill');
  });

  it('downed unaware target behind → soccerKick, NOT the stealth kill [T18]', () => {
    const a = resolveAction(
      { button: 'attack' },
      makeActor({
        nearestTarget: makeTarget({ relAngle: Math.PI, dist: 1.0, facingMe: false, unaware: true, isDowned: true }),
      }),
      NO_CTX,
    );
    expectMove(a, 'soccerKick');
  });

  it('unaware target NOT behind → normal punch (stealth needs behind)', () => {
    const a = resolveAction(
      { button: 'attack' },
      makeActor({ nearestTarget: makeTarget({ unaware: true }) }),
      NO_CTX,
    );
    expectMove(a, 'punch');
  });

  it('out-of-range standing target → nothing (punch range gate)', () => {
    const a = resolveAction(
      { button: 'attack' },
      makeActor({ nearestTarget: makeTarget({ dist: 99 }) }),
      NO_CTX,
    );
    expect(a).toBeNull();
  });
});

describe('jump button', () => {
  it('grounded standing → jump', () => {
    expectMove(resolveAction({ button: 'jump' }, makeActor(), NO_CTX), 'jump');
  });

  it('airborne + jump pressed → flip', () => {
    expectMove(
      resolveAction(
        { button: 'jump' },
        makeActor({ stance: 'airborne' }),
        { ...NO_CTX, airborneSelf: true },
      ),
      'flip',
    );
  });

  it('grounded jump does NOT flip (airborne gate, not button)', () => {
    expectMove(resolveAction({ button: 'jump' }, makeActor(), NO_CTX), 'jump');
  });

  it('crouched → hop (low hop, no full jump)', () => {
    expectMove(resolveAction({ button: 'jump' }, makeActor({ stance: 'crouched' }), NO_CTX), 'hop');
  });

  it('running near target → legCannon', () => {
    const a = resolveAction(
      { button: 'jump' },
      makeActor({
        isRunning: true,
        nearestTarget: makeTarget({ dist: 2.6, facingMe: false, unaware: false }),
      }),
      NO_CTX,
    );
    expectMove(a, 'legCannon');
  });

  it('running but target out of range → plain jump', () => {
    expectMove(
      resolveAction(
        { button: 'jump' },
        makeActor({ isRunning: true, nearestTarget: makeTarget({ dist: 30 }) }),
        NO_CTX,
      ),
      'jump',
    );
  });

  it('running away from target → plain jump (needs target ahead)', () => {
    const a = resolveAction(
      { button: 'jump' },
      makeActor({ isRunning: true, nearestTarget: makeTarget({ relAngle: Math.PI }) }),
      NO_CTX,
    );
    expectMove(a, 'jump');
  });
});

describe('crouch button — reverse / context / slide-stop', () => {
  it('timed press vs incoming punch startup → reverse', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({
        nearestTarget: makeTarget({
          incomingAttack: {
            attackerId: 'wolf1',
            moveId: 'punch',
            phase: 'startup',
            phaseMsElapsed: 60,
          },
          facingMe: true,
        }),
      }),
      NO_CTX,
    );
    expect(a).toEqual({ kind: 'reverse', targetId: 'wolf1' });
  });

  it('too early in window (39ms < 48ms open) → whiffed duck, no move (null)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({
        stance: 'crouched',
        crouchHeldMs: 50,
        nearestTarget: makeTarget({
          incomingAttack: { attackerId: 'wolf1', moveId: 'punch', phase: 'startup', phaseMsElapsed: 39 },
          facingMe: true,
        }),
      }),
      NO_CTX,
    );
    // Too-early duck is just a duck: controller enters crouch stance.
    expect(a).toBeNull();
  });

  it('too late (active over by 20ms) → hit lands; no reverse offered', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({
        nearestTarget: makeTarget({
          incomingAttack: { attackerId: 'wolf1', moveId: 'punch', phase: 'active', phaseMsElapsed: 90 },
          facingMe: true,
        }),
      }),
      NO_CTX,
    );
    expect(a).toBeNull();
  });

  it('not facing me → cannot reverse; whiffed duck only (null)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({
        stance: 'crouched',
        crouchHeldMs: 50,
        nearestTarget: makeTarget({
          incomingAttack: { attackerId: 'wolf1', moveId: 'punch', phase: 'startup', phaseMsElapsed: 60 },
          facingMe: false,
        }),
      }),
      NO_CTX,
    );
    expect(a).toBeNull();
  });

  it('crouched + press over ground weapon → pickupOrContext', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200, hasWeapon: null }),
      { downedBodyNearby: false, weaponOnGroundNearby: true, airborneSelf: false },
    );
    expectMove(a, 'pickupOrContext');
  });

  it('crouched + press over downed body → bodyThrow', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200, hasWeapon: null }),
      { downedBodyNearby: true, weaponOnGroundNearby: false, airborneSelf: false },
    );
    expectMove(a, 'bodyThrow');
  });

  it('weapon+body both nearby → weapon pickup wins', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200, hasWeapon: null }),
      { downedBodyNearby: true, weaponOnGroundNearby: true, airborneSelf: false },
    );
    expectMove(a, 'pickupOrContext');
  });

  it('holding bloody blade + press → cleanBlade (lowest context priority)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200, hasWeapon: 'knife', bladeBloody: true }),
      NO_CTX,
    );
    expectMove(a, 'cleanBlade');
  });

  it('clean blade but no ground weapon underfoot → still cleans own blade', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200, hasWeapon: 'sword', bladeBloody: true }),
      { downedBodyNearby: false, weaponOnGroundNearby: false, airborneSelf: false },
    );
    expectMove(a, 'cleanBlade');
  });

  it('clean priority: pickup > body > clean (all contexts at once)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200, hasWeapon: 'knife', bladeBloody: true }),
      { downedBodyNearby: true, weaponOnGroundNearby: true, airborneSelf: false },
    );
    expectMove(a, 'pickupOrContext');
  });

  it('crouch pressed while running → slideStop', () => {
    expectMove(
      resolveAction({ button: 'crouch' }, makeActor({ isRunning: true }), NO_CTX),
      'slideStop',
    );
  });

  it('crouched idle press with no context → nothing to do (null)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'crouched', crouchHeldMs: 200 }),
      NO_CTX,
    );
    expect(a).toBeNull();
  });

  it('long-held crouch (>250ms) is sneak state, never a reverse attempt (null)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({
        stance: 'crouched',
        crouchHeldMs: 300,
        nearestTarget: makeTarget({
          incomingAttack: { attackerId: 'wolf1', moveId: 'punch', phase: 'startup', phaseMsElapsed: 60 },
          facingMe: true,
        }),
      }),
      NO_CTX,
    );
    expect(a).toBeNull();
  });

  it('airborne + crouch pressed → flip (second canonical trigger path)', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({ stance: 'airborne' }),
      { ...NO_CTX, airborneSelf: true },
    );
    expectMove(a, 'flip');
  });

  it('grounded crouch press does NOT flip (airborne gate)', () => {
    // Grounded standing crouch with no context is a null duck, never a flip.
    const a = resolveAction({ button: 'crouch' }, makeActor(), NO_CTX);
    expect(a).toBeNull();
  });
});

describe('resolver ordering and purity', () => {
  it('nothing applies: attack with no target/context → null (never throws)', () => {
    const a = resolveAction({ button: 'attack' }, makeActor(), NO_CTX);
    expect(a).toBeNull();
  });

  it('stealthKill beats other attack resolutions (priority order)', () => {
    const a = resolveAction(
      { button: 'attack' },
      makeActor({
        nearestTarget: makeTarget({ relAngle: Math.PI, dist: 1.0, facingMe: false, unaware: true }),
      }),
      NO_CTX,
    );
    expectMove(a, 'stealthKill');
  });

  it('reverse outranks pickup/body/clean context moves', () => {
    const a = resolveAction(
      { button: 'crouch' },
      makeActor({
        stance: 'crouched',
        crouchHeldMs: 50,
        hasWeapon: 'knife',
        bladeBloody: true,
        nearestTarget: makeTarget({
          incomingAttack: { attackerId: 'wolf1', moveId: 'punch', phase: 'startup', phaseMsElapsed: 60 },
          facingMe: true,
        }),
      }),
      { downedBodyNearby: true, weaponOnGroundNearby: true, airborneSelf: false },
    );
    expect(a).toEqual({ kind: 'reverse', targetId: 'wolf1' });
  });

  it('pure: same inputs → same output (sampled across truth table)', () => {
    for (let i = 0; i < 3; i++) {
      expect(
        resolveAction({ button: 'attack' }, makeActor({ nearestTarget: makeTarget() }), NO_CTX),
      ).toEqual({ kind: 'move', id: 'punch' });
    }
  });
});

describe('MOVES table integrity', () => {
  it('every resolver-emitted move id exists in the table', () => {
    const emitted: MoveId[] = [
      'punch', 'doublePunch', 'runningKick', 'legSweep', 'wallKick', 'soccerKick',
      'airGrab', 'legCannon', 'jump', 'hop', 'flip', 'tackle', 'pickupOrContext',
      'slideStop', 'stealthKill', 'bodyThrow', 'cleanBlade',
    ];
    for (const id of emitted) expect(MOVES[id]).toBeDefined();
    // reverseAttempt is in the union but has no table row (outcome, not clip).
    expect(MOVES.reverseAttempt).toBeUndefined();
  });

  it('timing phases sum to the documented total per combat move', () => {
    const totals: Record<string, number> = {
      punch: 350, runningKick: 450, legSweep: 500, wallKick: 550,
      soccerKick: 400, airGrab: 600, legCannon: 700, doublePunch: 500,
    };
    for (const [id, total] of Object.entries(totals)) {
      const m = MOVES[id]!;
      expect(`${id}=${m.startupMs + m.activeMs + m.recoveryMs}`).toBe(`${id}=${total}`);
    }
  });

  it('non-combat moves carry no startup/active frames (context/loco only)', () => {
    // jump/hop resolve to controller impulses; context moves only commit
    // the actor's recovery time. None of them swing a hitbox.
    for (const id of ['jump', 'hop', 'pickupOrContext', 'stealthKill', 'cleanBlade'] as const) {
      const m = MOVES[id]!;
      expect(m.startupMs).toBe(0);
      expect(m.activeMs).toBe(0);
    }
    // Mobility/context moves that do commit time declare it in recovery.
    expect(MOVES.slideStop.activeMs).toBeGreaterThan(0); // slide duration
    expect(MOVES.bodyThrow.startupMs + MOVES.bodyThrow.recoveryMs).toBeGreaterThan(0);
    expect(MOVES.pickupOrContext.recoveryMs).toBeGreaterThan(0);
    expect(MOVES.stealthKill.recoveryMs).toBeGreaterThan(0);
  });

  it('windows stay inside startup+active for every reversal-capable move', () => {
    for (const id of ['punch', 'doublePunch', 'runningKick', 'legSweep'] as const) {
      const m = MOVES[id]!;
      const w = m.reversalWindow!;
      expect(w.from).toBeGreaterThanOrEqual(0);
      expect(w.to).toBeLessThanOrEqual(m.startupMs + m.activeMs);
    }
  });

  it('counter windows sit around reversal impact (±120ms)', () => {
    for (const id of ['punch', 'doublePunch', 'runningKick', 'legSweep'] as const) {
      const w = MOVES[id]!.counterWindow!;
      expect(w.to - w.from).toBe(240);
    }
  });

  it('damage values match the tuning table', () => {
    const dmg: Record<string, number> = {
      punch: 8, doublePunch: 7, runningKick: 14, legSweep: 10, wallKick: 25,
      soccerKick: 12, airGrab: 20, legCannon: 30, tackle: 5,
    };
    for (const [id, expected] of Object.entries(dmg)) {
      expect(MOVES[id]!.damage).toBe(expected);
    }
  });
});

describe('tuning constants', () => {
  it('flip stun duration is the canonical 1500ms from tuning.ts', () => {
    expect(FLIP_STUN_MS).toBe(1500);
    // The flip table row must NOT smuggle the stun into its timing phases.
    expect(MOVES.flip.recoveryMs).not.toBe(FLIP_STUN_MS);
  });
});
