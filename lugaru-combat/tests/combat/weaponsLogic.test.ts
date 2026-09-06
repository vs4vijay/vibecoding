import { describe, expect, it } from 'vitest';
import { FighterSim, type FighterSimWorld, type FighterState } from '../../src/combat/stateMachine';
import { applyHit, findHit } from '../../src/combat/hitdetect';
import {
  cleanBlade,
  heldWeapon,
  onReversalVsArmed,
  throwKnife,
  thrownKnifeHit,
  tryClash,
} from '../../src/combat/weaponsLogic';
import type { WeaponId } from '../../src/data/weapons';
import { WEAPONS } from '../../src/data/weapons';
import { MOVES } from '../../src/data/moves';
import {
  CLASH_BREAK_CHANCE,
  CLASH_KNOCK_SPEED_MPS,
  CLASH_WEAR_PER_CLASH,
  THROWN_KNIFE_SPEED_MPS,
} from '../../src/data/tuning';
import { resolveAction } from '../../src/combat/resolver';
import type { CombatantSnapshot, WorldContext } from '../../src/combat/types';
import type { InputFrame } from '../../src/core/input';

// ---------------------------------------------------------------------------
// Hand-crafted plain states — weaponsLogic is pure functions over
// FighterState snapshots; no sim class, no three/Rapier.
// ---------------------------------------------------------------------------

function makeFighter(over: Partial<FighterState> = {}): FighterState {
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

/**
 * Two fighters mid-active on `slash`, facing each other across `dist`
 * (default 0.6 m — inside every weapon's reach). `a` at the origin facing
 * +x, `b` on the +x axis facing back.
 */
function makeArmedPair(
  aWeapon: WeaponId | null,
  bWeapon: WeaponId | null,
  dist = 0.6,
  over: Partial<FighterState> = {},
): { a: FighterState; b: FighterState } {
  const a = makeFighter({
    weapon: aWeapon,
    ...(aWeapon === 'staff' ? { durability: WEAPONS.staff.durability } : {}),
    phase: { t: 'active', moveId: 'slash', phaseMsLeft: MOVES.slash.activeMs },
    currentMove: MOVES.slash,
    ...over,
  });
  const b = makeFighter({
    id: 'bandit',
    species: 'wolf',
    team: 1,
    hp: 160,
    maxHp: 160,
    weapon: bWeapon,
    ...(bWeapon === 'staff' ? { durability: WEAPONS.staff.durability } : {}),
    pos: { x: dist, y: 0, z: 0 },
    heading: Math.PI / 2, // faces −x, back at `a`
    phase: { t: 'active', moveId: 'slash', phaseMsLeft: MOVES.slash.activeMs },
    currentMove: MOVES.slash,
    ...over,
  });
  return { a, b };
}

/** Deterministic rng fakes: never below the break chance / always below. */
const calm = () => 0.99;
const jinxed = () => 0.0;

// ---------------------------------------------------------------------------
// Weapon table [brief Task 13]
// ---------------------------------------------------------------------------

describe('WEAPONS table', () => {
  it('knife: reach 0.8, damage 10, bleeding blade, throwable', () => {
    expect(WEAPONS.knife.reachM).toBe(0.8);
    expect(WEAPONS.knife.damage).toBe(10);
    expect(WEAPONS.knife.bleedOnHit).toBe(true);
    expect(WEAPONS.knife.throwable).toBe(true);
    expect(WEAPONS.knife.throwDamage).toBe(60);
  });

  it('sword: reach 1.5, damage 22, bleeding blade, not throwable', () => {
    expect(WEAPONS.sword.reachM).toBe(1.5);
    expect(WEAPONS.sword.damage).toBe(22);
    expect(WEAPONS.sword.bleedOnHit).toBe(true);
    expect(WEAPONS.sword.throwable).toBe(false);
  });

  it('staff: reach 1.3, damage 14, no bleed, durability 6', () => {
    expect(WEAPONS.staff.reachM).toBe(1.3);
    expect(WEAPONS.staff.damage).toBe(14);
    expect(WEAPONS.staff.bleedOnHit).toBe(false);
    expect(WEAPONS.staff.durability).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// tryClash — simultaneous armed swings beat damage
// ---------------------------------------------------------------------------

describe('tryClash', () => {
  it('two active sword swings facing each other clash: both shoved to recovery', () => {
    const { a, b } = makeArmedPair('sword', 'sword');
    const res = tryClash(a, b, calm);
    expect(res).not.toBeNull();
    expect(a.phase.t).toBe('recovery');
    expect(b.phase.t).toBe('recovery');
    expect(a.phase.phaseMsLeft).toBe(MOVES.slash.recoveryMs);
    expect(a.moveElapsedMs).toBe(MOVES.slash.startupMs + MOVES.slash.activeMs);
    // Neither blade drew blood: hp untouched, no drops on a calm roll.
    expect(a.hp).toBe(100);
    expect(b.hp).toBe(160);
    expect(res!.drops).toHaveLength(0);
  });

  it('clash takes precedence over damage: findHit answers nothing afterwards', () => {
    const { a, b } = makeArmedPair('sword', 'sword');
    tryClash(a, b, calm);
    expect(findHit(a, [b])).toHaveLength(0);
    expect(findHit(b, [a])).toHaveLength(0);
  });

  it('needs both swings active: an idle/startup/recovery fighter never clashes', () => {
    const { a, b } = makeArmedPair('sword', 'sword');
    a.phase = { t: 'startup', moveId: 'slash', phaseMsLeft: MOVES.slash.startupMs };
    expect(tryClash(a, b, calm)).toBeNull();
    a.phase = { t: 'recovery', moveId: 'slash', phaseMsLeft: MOVES.slash.recoveryMs };
    expect(tryClash(a, b, calm)).toBeNull();
    a.phase = { t: 'idle', phaseMsLeft: Infinity };
    expect(tryClash(a, b, calm)).toBeNull();
  });

  it('unarmed swings never clash', () => {
    const { a, b } = makeArmedPair(null, 'sword');
    expect(tryClash(a, b, calm)).toBeNull();
    const pair2 = makeArmedPair('sword', null);
    expect(tryClash(pair2.a, pair2.b, calm)).toBeNull();
  });

  it('needs both fighters facing each other inside their swing arc', () => {
    const { a, b } = makeArmedPair('sword', 'sword');
    b.heading = -Math.PI / 2; // b now faces +x, away from a
    expect(tryClash(a, b, calm)).toBeNull();
  });

  it('blades too far apart never clash', () => {
    const { a, b } = makeArmedPair('sword', 'sword', 3.0);
    expect(tryClash(a, b, calm)).toBeNull();
  });

  it('staff wears CLASH_WEAR_PER_CLASH per clash and breaks at 0 (drop event)', () => {
    const { a, b } = makeArmedPair('staff', 'sword');
    const rearm = (): void => {
      // Each iteration simulates a FRESH swing: tryClash cancels the prior
      // one into recovery, so restore active-phase state before re-clashing.
      for (const f of [a, b]) {
        f.phase.t = 'active';
        f.phase.moveId = 'slash';
        f.phase.phaseMsLeft = MOVES.slash.activeMs;
        f.moveElapsedMs = MOVES.slash.startupMs;
      }
    };
    rearm();
    for (let i = WEAPONS.staff.durability! - 1; i > 0; i--) {
      const res = tryClash(a, b, calm);
      expect(res!.drops).toHaveLength(0);
      expect(a.durability).toBe(i);
      rearm();
    }
    // Final clash: durability hits 0 → the staff flies off, the sword stays.
    const res = tryClash(a, b, calm);
    expect(a.durability).toBe(0);
    expect(a.weapon).toBeNull();
    expect(b.weapon).toBe('sword');
    expect(res!.drops).toHaveLength(1);
    const drop = res!.drops[0];
    expect(drop.type).toBe('drop');
    expect(drop.reason).toBe('clash');
    expect(drop.weaponClass).toBe('staff');
    expect(drop.fromId).toBe(a.id);
    expect(drop.pos.x).toBeCloseTo(a.pos.x, 5);
    expect(drop.pos.y).toBeCloseTo(a.pos.y, 5);
    expect(drop.pos.z).toBeCloseTo(a.pos.z, 5);
  });

  it('a weapon also flies off on an unlucky roll (< CLASH_BREAK_CHANCE, seeded rng)', () => {
    const { a, b } = makeArmedPair('sword', 'sword');
    const res = tryClash(a, b, jinxed);
    expect(res!.drops).toHaveLength(2); // both blades knocked loose
    expect(a.weapon).toBeNull();
    expect(b.weapon).toBeNull();
    for (const d of res!.drops) {
      expect(d.reason).toBe('clash');
      expect(d.weaponClass).toBe('sword');
    }
    // Knock direction: away from the opponent.
    const aDrop = res!.drops.find((d) => d.fromId === a.id)!;
    const bDrop = res!.drops.find((d) => d.fromId === b.id)!;
    expect(aDrop.vel.x).toBeLessThan(0); // a knocked toward −x, away from b
    expect(bDrop.vel.x).toBeGreaterThan(0);
    const speed = Math.hypot(aDrop.vel.x, aDrop.vel.z);
    expect(speed).toBeCloseTo(CLASH_KNOCK_SPEED_MPS, 5);
  });

  it('weapons without durability survive a calm roll unscathed', () => {
    const { a, b } = makeArmedPair('sword', 'sword');
    tryClash(a, b, calm);
    expect(a.weapon).toBe('sword');
    expect(b.weapon).toBe('sword');
    expect(a.durability).toBeUndefined();
  });

  it('consumes the seeded rng deterministically: same seed → same outcome', () => {
    const run = (seed: number): number => {
      const { a, b } = makeArmedPair('staff', 'staff');
      let seq = seed;
      const rng = (): number => {
        seq = (seq * 1103515245 + 12345) % 2147483648;
        return seq / 2147483648;
      };
      let broken = 0;
      for (let i = 0; i < 12; i++) {
        const res = tryClash(a, b, rng);
        // Both fighters recover out of active, so re-arm them each clash.
        a.phase = { t: 'active', moveId: 'slash', phaseMsLeft: MOVES.slash.activeMs };
        b.phase = { t: 'active', moveId: 'slash', phaseMsLeft: MOVES.slash.activeMs };
        broken += res?.drops.length ?? 0;
      }
      return broken;
    };
    expect(run(1234)).toBe(run(1234));
  });
});

// ---------------------------------------------------------------------------
// onReversalVsArmed — reversal always disarms
// ---------------------------------------------------------------------------

describe('onReversalVsArmed', () => {
  it('disarms the armed victim: drop spawns beside them, hand empties', () => {
    const { a, b } = makeArmedPair('sword', 'staff');
    a.phase = { t: 'idle', phaseMsLeft: Infinity }; // reverser is done swinging
    const ev = onReversalVsArmed(a, b);
    expect(ev).not.toBeNull();
    expect(ev!.reason).toBe('disarm');
    expect(ev!.weaponClass).toBe('staff');
    expect(ev!.fromId).toBe(b.id);
    expect(ev!.pos.x).toBeCloseTo(b.pos.x, 5);
    expect(b.weapon).toBeNull();
    expect(b.durability).toBeUndefined();
    // Knocked away from the reverser.
    expect(ev!.vel.x).toBeGreaterThan(0);
  });

  it('an unarmed victim cannot be disarmed', () => {
    const { a, b } = makeArmedPair('sword', null);
    expect(onReversalVsArmed(a, b)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Thrown knives — launcher + analytic ballistic result
// ---------------------------------------------------------------------------

describe('throwKnife', () => {
  it('a knife holder launches the blade: hand empties, event carries flight data', () => {
    const f = makeFighter({ weapon: 'knife' });
    const ev = throwKnife(f, { x: 3, z: -4 });
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('throw');
    expect(ev!.weaponClass).toBe('knife');
    expect(ev!.fromId).toBe(f.id);
    expect(ev!.speed).toBe(THROWN_KNIFE_SPEED_MPS);
    // Direction normalized to a unit vector.
    expect(ev!.dir.x).toBeCloseTo(0.6, 5);
    expect(ev!.dir.z).toBeCloseTo(-0.8, 5);
    expect(f.weapon).toBeNull();
  });

  it('non-throwable weapons and bare hands cannot throw', () => {
    expect(throwKnife(makeFighter({ weapon: 'sword' }), { x: 0, z: -1 })).toBeNull();
    expect(throwKnife(makeFighter({ weapon: 'staff' }), { x: 0, z: -1 })).toBeNull();
    expect(throwKnife(makeFighter(), { x: 0, z: -1 })).toBeNull();
  });
});

describe('thrownKnifeHit', () => {
  it('unarmored victim: one-hit kill, blade sticks, wound bleeds', () => {
    const thrower = makeFighter({ weapon: null });
    const victim = makeFighter({
      id: 'wolf1',
      species: 'wolf',
      team: 1,
      hp: 160,
      maxHp: 160,
    });
    const out = thrownKnifeHit(victim, thrower);
    expect(out.fatal).toBe(true);
    expect(out.damageDealt).toBe(160);
    expect(victim.hp).toBe(0);
    expect(victim.phase.t).toBe('ko');
    expect(victim.flags.unconscious).toBe(true);
    expect(victim.stuckIn).toBe(true);
    expect(victim.flags.bleeding).toBe(true);
    expect(out.stuckIn).toBe('wolf1');
    expect(out.thrownBy).toBe(thrower.id);
  });

  it('armored victim: WEAPONS.knife.throwDamage instead of instant death', () => {
    const thrower = makeFighter();
    const victim = makeFighter({
      id: 'wolf1',
      species: 'wolf',
      team: 1,
      hp: 160,
      maxHp: 160,
      flags: { bleeding: false, limping: false, unconscious: false, invulnerableAirFlipMs: 0, armored: true },
    });
    const out = thrownKnifeHit(victim, thrower);
    expect(out.fatal).toBe(false);
    expect(victim.hp).toBe(160 - WEAPONS.knife.throwDamage);
    expect(victim.flags.unconscious).toBe(false);
    expect(victim.stuckIn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Armed swings in findHit/applyHit — damage and reach resolve from WEAPONS
// ---------------------------------------------------------------------------

describe('slash resolution', () => {
  it('reach comes from the held weapon: sword connects at 1.2 m, knife whiffs', () => {
    const swordSwing = makeArmedPair('sword', null, 1.2);
    expect(findHit(swordSwing.a, [swordSwing.b])).toHaveLength(1);
    const knifeSwing = makeArmedPair('knife', null, 1.2);
    expect(findHit(knifeSwing.a, [knifeSwing.b])).toHaveLength(0);
    const knifeClose = makeArmedPair('knife', null, 0.7);
    expect(findHit(knifeClose.a, [knifeClose.b])).toHaveLength(1);
  });

  it('damage comes from the held weapon and blades bleed their wielder', () => {
    const { a, b } = makeArmedPair('sword', null, 0.6);
    const events = findHit(a, [b]);
    expect(events).toHaveLength(1);
    applyHit(events[0], [a, b]);
    expect(b.hp).toBe(160 - WEAPONS.sword.damage);
    expect(b.flags.bleeding).toBe(true);
    expect(a.bloodiedWeapon).toBe(true);
  });

  it('staff hits bleed nothing: no bloodied blade, no bleeding victim', () => {
    const { a, b } = makeArmedPair('staff', null, 0.6);
    const events = findHit(a, [b]);
    expect(events).toHaveLength(1);
    applyHit(events[0], [a, b]);
    expect(b.hp).toBe(160 - WEAPONS.staff.damage);
    expect(b.flags.bleeding).toBe(false);
    expect(a.bloodiedWeapon).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cleanBlade
// ---------------------------------------------------------------------------

describe('cleanBlade', () => {
  it('clears the bloodied flag exactly once', () => {
    const f = makeFighter({ weapon: 'sword', bloodiedWeapon: true });
    expect(cleanBlade(f)).toBe(true);
    expect(f.bloodiedWeapon).toBe(false);
    expect(cleanBlade(f)).toBe(false);
  });

  it('a clean blade has nothing to clean', () => {
    const f = makeFighter({ weapon: 'sword' });
    expect(cleanBlade(f)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resolver — armed fighters swing instead of punching
// ---------------------------------------------------------------------------

describe('resolver armed attack', () => {
  const ctx: WorldContext = {
    downedBodyNearby: false,
    weaponOnGroundNearby: false,
    airborneSelf: false,
  };

  function snap(over: Partial<CombatantSnapshot>): CombatantSnapshot {
    return {
      id: 'player',
      stance: 'standing',
      isRunning: false,
      crouchHeldMs: 999,
      pos: { x: 0, y: 0, z: 0 },
      heading: 0,
      hasWeapon: null,
      wallProximityM: Infinity,
      nearestTarget: {
        id: 'wolf1',
        dist: 1.0,
        relAngle: 0,
        stance: 'standing',
        isDowned: false,
        airborne: false,
        facingMe: true,
        unaware: false,
      },
      ...over,
    };
  }

  it('an armed fighter swings their weapon at an in-reach target', () => {
    // Target inside the SHORTEST weapon's reach (knife 0.8m) so every
    // weapon class resolves the slash.
    const base = snap({
      nearestTarget: {
        id: 'wolf1',
        dist: 0.7,
        relAngle: 0,
        stance: 'standing',
        isDowned: false,
        airborne: false,
        facingMe: true,
        unaware: false,
      },
    });
    for (const weapon of ['sword', 'knife', 'staff'] as const) {
      expect(resolveAction({ button: 'attack' }, { ...base, hasWeapon: weapon }, ctx)).toEqual({
        kind: 'move',
        id: 'slash',
      });
    }
  });

  it('out of the weapon reach an armed press does nothing', () => {
    const base = snap({});
    const far = {
      ...base,
      hasWeapon: 'knife' as const,
      nearestTarget: { ...base.nearestTarget!, dist: 1.2 },
    };
    expect(resolveAction({ button: 'attack' }, far, ctx)).toBeNull();
  });

  it('unarmed fighters still punch', () => {
    expect(resolveAction({ button: 'attack' }, snap({}), ctx)).toEqual({
      kind: 'move',
      id: 'punch',
    });
  });
});

// ---------------------------------------------------------------------------
// FighterSim integration — reversal disarms, KO drops, quiet steps stay quiet
// ---------------------------------------------------------------------------

const STEP_MS = 1000 / 60;

function makeInput(over: Partial<InputFrame> = {}): InputFrame {
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

interface Pair {
  player: FighterSim;
  dummy: FighterSim;
  world: FighterSimWorld;
}

function makePair(dist = 1.2): Pair {
  const player = new FighterSim('rabbit', 'player', true);
  const dummy = new FighterSim('wolf', 'wolf1', false);
  player.state.pos.x = 0;
  player.state.heading = -Math.PI / 2;
  dummy.state.pos.x = dist;
  dummy.state.heading = Math.PI / 2;
  const world: FighterSimWorld = {
    fighters: [player.state, dummy.state],
    downedBodyNearby: false,
    weaponOnGroundNearby: false,
  };
  return { player, dummy, world };
}

function run(sim: FighterSim, n: number, input: InputFrame | null, world: FighterSimWorld): void {
  for (let i = 0; i < n; i++) sim.update(STEP_MS, input, world);
}

describe('FighterSim weapon events (T13)', () => {
  it('a successful reversal vs an armed attacker disarms them', () => {
    const { player, dummy, world } = makePair();
    dummy.state.weapon = 'sword';

    // Wolf begins its armed swing.
    run(dummy, 1, makeInput({ pressed: { attack: true, jump: false, crouch: false } }), world);
    expect(dummy.state.phase.moveId).toBe('slash');
    // Wait into the reversal window (same recipe as the T9 score test).
    let stepped = 0;
    while (dummy.state.moveElapsedMs < 48 && stepped++ < 100) {
      dummy.update(STEP_MS, makeInput(), world);
    }
    // Player crouch press inside the window → reversal fires, blade flies.
    player.update(STEP_MS, makeInput({ pressed: { attack: false, jump: false, crouch: true } }), world);
    expect(player.state.pendingReverseOf).toBe('wolf1');
    expect(dummy.state.weapon).toBeNull();

    const drops = player.lastCombatEvents.filter((e) => e.type === 'drop');
    expect(drops).toHaveLength(1);
    const drop = drops[0];
    if (drop.type !== 'drop') throw new Error('unreachable');
    expect(drop.reason).toBe('disarm');
    expect(drop.weaponClass).toBe('sword');
    expect(drop.fromId).toBe('wolf1');
  });

  it('a KO releases the held weapon as a drop event, exactly once', () => {
    const { player, dummy, world } = makePair();
    player.state.weapon = 'staff';
    player.state.durability = WEAPONS.staff.durability;
    player.state.hp = 5;

    applyHit(
      {
        attackerId: 'wolf1',
        victimId: 'player',
        moveId: 'punch',
        dirVector: { x: 0, z: 0 },
      },
      world.fighters,
    );
    expect(player.state.phase.t).toBe('ko');

    player.update(STEP_MS, null, world);
    const drops = player.lastCombatEvents.filter((e) => e.type === 'drop');
    expect(drops).toHaveLength(1);
    if (drops[0].type !== 'drop') throw new Error('unreachable');
    expect(drops[0].weaponClass).toBe('staff');
    expect(drops[0].reason).toBe('ko');
    expect(player.state.weapon).toBeNull();

    // The next quiet step republishes nothing.
    player.update(STEP_MS, null, world);
    expect(player.lastCombatEvents).toHaveLength(0);
  });

  it('quiet steps share an empty event list', () => {
    const { player, world } = makePair();
    run(player, 3, makeInput(), world);
    expect(player.lastCombatEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// shared guard
// ---------------------------------------------------------------------------

describe('heldWeapon', () => {
  it('normalizes null and none to unarmed', () => {
    expect(heldWeapon(makeFighter())).toBeNull();
    expect(heldWeapon(makeFighter({ weapon: 'none' }))).toBeNull();
    expect(heldWeapon(makeFighter({ weapon: 'knife' }))).toBe('knife');
  });
});
