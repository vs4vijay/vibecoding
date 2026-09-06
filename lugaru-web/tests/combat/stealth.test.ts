import { describe, expect, it } from 'vitest';
import {
  FighterSim,
  type FighterSimWorld,
  type FighterState,
} from '../../src/combat/stateMachine';
import { tryStealthKill } from '../../src/combat/stealth';
import { forwardXZ } from '../../src/combat/hitdetect';
import { ScoreLedger } from '../../src/combat/scoring';
import { MOVES } from '../../src/data/moves';
import { SCORE_STEALTH_KILL } from '../../src/data/tuning';
import { Brain, type BrainSenses } from '../../src/ai/brain';
import { DIFFICULTY } from '../../src/ai/difficulty';
import { mulberry32 } from '../../src/core/rng';

/**
 * Task 18 — stealth kills.
 *
 * tryStealthKill is the pure gate + weapon-shaped outcome; the FighterSim
 * (fireStealthKill) owns application, kill attribution and the STEALTH_KILL
 * award — the same split as bodymoves' applySpecial.
 */

function wolfVictim(): FighterSim {
  const v = new FighterSim('wolf', 'wolf1', false);
  v.state.heading = 0; // forward = (0, -1): the wolf stares toward -Z
  return v;
}

function attacker(): FighterSim {
  const a = new FighterSim('rabbit', 'player', true);
  return a;
}

/** Place `a` `distM` behind `v` (rotated `offRearRad` off the tail), facing its back. */
function placeBehind(a: FighterSim, v: FighterState, distM: number, offRearRad = 0): void {
  const f = forwardXZ(v.heading);
  const rx = -f.x;
  const rz = -f.z; // rear unit vector
  const dx = rx * Math.cos(offRearRad) - rz * Math.sin(offRearRad);
  const dz = rx * Math.sin(offRearRad) + rz * Math.cos(offRearRad);
  a.state.pos.x = v.pos.x + dx * distM;
  a.state.pos.z = v.pos.z + dz * distM;
  a.state.pos.y = v.pos.y;
  a.state.heading = Math.atan2(-dx, -dz); // face the victim's back
}

const ATTACK_PRESS = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  pressed: { attack: true, jump: false, crouch: false },
  held: { attack: false, jump: false, crouch: false },
};

function simWorld(...fighters: FighterSim[]): FighterSimWorld {
  return {
    fighters: fighters.map((f) => f.state),
    downedBodyNearby: false,
    weaponOnGroundNearby: false,
  };
}

function emptySenses(): BrainSenses {
  return { heard: [], wind: { vector: { x: 0, z: 0 } }, scent: null };
}

describe('tryStealthKill — gate table', () => {
  it('unaware victim, directly behind, standing attacker → spineCrusher (unarmed)', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    const r = tryStealthKill(a.state, v.state);
    expect(r).not.toBeNull();
    expect(r!.moveName).toBe('spineCrusher');
    expect(r!.damage).toBe(35);
    expect(r!.instantKill).toBe(false);
    expect(r!.knockdown).toBe(true);
  });

  it('the attacker sits in the rear ±60° cone of the victim: ±40° off the tail works', () => {
    for (const off of [-(40 * Math.PI) / 180, (40 * Math.PI) / 180]) {
      const v = wolfVictim();
      const a = attacker();
      placeBehind(a, v.state, 0.9, off);
      expect(tryStealthKill(a.state, v.state)).not.toBeNull();
    }
  });

  it('90° off to a side of the victim is NOT behind', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9, Math.PI / 2);
    expect(tryStealthKill(a.state, v.state)).toBeNull();
  });

  it('victim facing the attacker (front approach) → null', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9, Math.PI); // dead ahead of the victim
    expect(tryStealthKill(a.state, v.state)).toBeNull();
  });

  it('range: beyond the stealthKill row reach → null, inside → ok', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, MOVES.stealthKill.rangeM + 0.05);
    expect(tryStealthKill(a.state, v.state)).toBeNull();
    placeBehind(a, v.state, MOVES.stealthKill.rangeM - 0.05);
    expect(tryStealthKill(a.state, v.state)).not.toBeNull();
  });

  it('alerted victim (investigate/engage/…) → null; patrol (no flag) → window open', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    v.state.alerted = true;
    expect(tryStealthKill(a.state, v.state)).toBeNull();
    v.state.alerted = false;
    expect(tryStealthKill(a.state, v.state)).not.toBeNull();
  });

  it('attacker must be standing (crouched/running/airborne → null)', () => {
    const v = wolfVictim();
    for (const stance of ['crouched', 'running', 'airborne'] as const) {
      const a = attacker();
      placeBehind(a, v.state, 0.9);
      a.state.stance = stance;
      expect(tryStealthKill(a.state, v.state)).toBeNull();
    }
  });

  it('a downed or KO victim cannot be stealth-killed (that is soccerKick meat)', () => {
    const a = attacker();
    const v = wolfVictim();
    placeBehind(a, v.state, 0.9);
    v.state.stance = 'downed';
    v.state.phase = { t: 'downed', phaseMsLeft: 500 };
    expect(tryStealthKill(a.state, v.state)).toBeNull();
    v.state.phase = { t: 'ko', phaseMsLeft: Infinity };
    expect(tryStealthKill(a.state, v.state)).toBeNull();
  });
});

describe('tryStealthKill — weapon-shaped results', () => {
  it('knife → tracheotomy, instant kill', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.8);
    a.state.weapon = 'knife';
    const r = tryStealthKill(a.state, v.state)!;
    expect(r.moveName).toBe('tracheotomy');
    expect(r.instantKill).toBe(true);
  });

  it('sword → backstabber, instant kill', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 1.0);
    a.state.weapon = 'sword';
    const r = tryStealthKill(a.state, v.state)!;
    expect(r.moveName).toBe('backstabber');
    expect(r.instantKill).toBe(true);
  });

  it('staff (blunt) falls back to the spineCrusher', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    a.state.weapon = 'staff';
    expect(tryStealthKill(a.state, v.state)!.moveName).toBe('spineCrusher');
  });

  it('spineCrusher KOs a weakened victim (hp < 30) outright', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    v.state.hp = 29;
    const r = tryStealthKill(a.state, v.state)!;
    expect(r.instantKill).toBe(true);
  });

  it('spineCrusher vs hp exactly 30 does NOT flag an instant kill (35 dmg still lands)', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    v.state.hp = 30;
    const r = tryStealthKill(a.state, v.state)!;
    expect(r.instantKill).toBe(false);
    expect(r.damage).toBe(35);
  });
});

describe('FighterSim application — fire-time stealth kill', () => {
  it('unarmed backstab downs a full-hp wolf for 35, no award (not a kill)', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    const ledger = new ScoreLedger();
    a.setScoreLedger(ledger);

    a.update(16, ATTACK_PRESS, simWorld(a, v));

    expect(a.state.phase.moveId).toBe('stealthKill'); // the resolver offered it
    expect(a.state.phase.t).toBe('recovery'); // 400ms kill-animation lock
    expect(v.state.hp).toBe(160 - 35);
    expect(v.state.phase.t).toBe('downed');
    expect(ledger.total()).toBe(0);
  });

  it('knife tracheotomy KOs outright and awards STEALTH_KILL 100', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.8);
    a.state.weapon = 'knife';
    const ledger = new ScoreLedger();
    a.setScoreLedger(ledger);

    a.update(16, ATTACK_PRESS, simWorld(a, v));

    expect(v.state.hp).toBe(0);
    expect(v.state.flags.unconscious).toBe(true);
    expect(v.state.phase.t).toBe('ko');
    expect(ledger.total()).toBe(SCORE_STEALTH_KILL);
  });

  it('spineCrusher on a weakened wolf (hp < 30) kills and awards', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    v.state.hp = 25;
    const ledger = new ScoreLedger();
    a.setScoreLedger(ledger);

    a.update(16, ATTACK_PRESS, simWorld(a, v));

    expect(v.state.phase.t).toBe('ko');
    expect(ledger.total()).toBe(SCORE_STEALTH_KILL);
  });

  it('the kill is SILENT: no scream from the victim brain and no emitted events', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.8);
    a.state.weapon = 'knife';
    const victimBrain = new Brain(v, DIFFICULTY.normal, mulberry32(7));

    a.update(16, ATTACK_PRESS, simWorld(a, v));
    expect(v.state.phase.t).toBe('ko');

    // Step the victim's brain after death: downed disposition, no events —
    // no scream, no hearing event of any kind from the silent kill.
    victimBrain.update(16, emptySenses(), {
      enemies: [a.state],
      allies: [],
      bushes: [],
      allyEngageCount: 0,
    });
    expect(victimBrain.state).toBe('downed');
    expect(victimBrain.collectEvents()).toHaveLength(0);
  });

  it('an ALERTED wolf is not offered the stealth move (falls through to punch)', () => {
    const v = wolfVictim();
    const a = attacker();
    placeBehind(a, v.state, 0.9);
    v.state.alerted = true;

    a.update(16, ATTACK_PRESS, simWorld(a, v));

    expect(a.state.phase.moveId).toBe('punch');
  });

  it('teammates are never stealth-kill targets', () => {
    // Both wolves are team 1 — the attacker must never stealth-kill an ally.
    const v = new FighterSim('wolf', 'ally', false);
    const a = new FighterSim('wolf', 'wolf2', false);
    placeBehind(a, v.state, 0.9);
    const before = v.state.hp;

    a.update(16, ATTACK_PRESS, simWorld(a, v));

    expect(v.state.hp).toBe(before);
    expect(v.state.phase.t).not.toBe('ko');
  });
});
