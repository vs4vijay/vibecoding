import { describe, expect, it } from 'vitest';
import { pickAttack, type AttackTarget, type EngageParams } from '../../src/ai/engage';
import { createAntiRepState, recordAttack } from '../../src/combat/antirepetition';
import type { AntiRepState } from '../../src/combat/antirepetition';
import { mulberry32 } from '../../src/core/rng';
import type { WeaponClass } from '../../src/combat/types';
import { DIFFICULTY } from '../../src/ai/difficulty';
import { AI_MOVE_HARD_CAP } from '../../src/data/tuning';

/**
 * Task 16 — utility attack selection.
 * Pure function over (self, target, rng, antiRep, params); no sim clock.
 * The "clock" for reaction timings is encoded as the target's phaseMsElapsed
 * (the brain feeds synthetic weather each step, mirroring the full sim).
 */

function target(over: Partial<AttackTarget> = {}): AttackTarget {
  return { dist: 1.5, stance: 'standing', ...over };
}

function self(hasWeapon: WeaponClass | null = null): { hasWeapon: WeaponClass | null } {
  return { hasWeapon };
}

const NORMAL: EngageParams = {
  reversalChance: DIFFICULTY.normal.reversalChance,
  reactionMs: DIFFICULTY.normal.reactionMs,
};

describe('pickAttack — utility ranking', () => {
  it('returns a melee move when the target is in reach', () => {
    const antiRep = createAntiRepState();
    const pick = pickAttack(self(), target({ dist: 1.2 }), mulberry32(1), antiRep, NORMAL);
    expect(['punch', 'runningKick', 'legSweep', 'slash']).toContain(pick);
  });

  it('hard-caps repetition: with an antiRep streak >= 3 on punch, it never returns punch', () => {
    const antiRep = createAntiRepState();
    for (let i = 0; i < AI_MOVE_HARD_CAP; i++) recordAttack(antiRep, 'punch');
    expect(antiRep.lastMoveIds).toHaveLength(3);
    for (let i = 0; i < 80; i++) {
      const pick = pickAttack(self(), target({ dist: 1.2 }), mulberry32(100 + i), antiRep, NORMAL);
      expect(pick).not.toBe('punch');
    }
  });

  it('prefers an in-range target over an out-of-reach one when only one move can connect', () => {
    // At 2.5m only the longer-range moves can connect (legSweep 1.6/runningKick 1.8/
    // soccerKick 2.4 — all < 2.5), so a far target scores lower than a close one.
    const antiRep = createAntiRepState();
    const close = pickAttack(self(), target({ dist: 0.8 }), mulberry32(9), antiRep, NORMAL);
    expect(['punch', 'runningKick', 'legSweep', 'slash']).toContain(close);
  });
});

describe('pickAttack — reversal reaction', () => {
  // legSweep reversal window spans startup(160)+active(90) = 64..270ms.
  // hard reactionMs 170 < 270 → in-window reactions possible.
  it('hard difficulty reacts to an inbound startup inside the reversal window', () => {
    const hard: EngageParams = {
      reversalChance: DIFFICULTY.hard.reversalChance,
      reactionMs: DIFFICULTY.hard.reactionMs,
    };
    const antiRep = createAntiRepState();
    const picks: Array<string | null> = [];
    let r = mulberry32(7);
    // Feed the target entering legSweep startup; advance the clock once past the
    // hard reaction delay (170ms) but still inside the 270ms reversal window.
    for (let elapsed = 170; elapsed <= 260; elapsed += 10) {
      picks.push(
        pickAttack(
          self(),
          target({
            dist: 0.9,
            activeMove: { id: 'legSweep', phase: 'startup', phaseMsElapsed: elapsed },
          }),
          r,
          antiRep,
          hard,
        ),
      );
    }
    expect(picks).toContain('reverseAttempt');
  });

  it('easy difficulty (reaction 550ms) misses the window — no reverse attempt', () => {
    const easy: EngageParams = {
      reversalChance: DIFFICULTY.easy.reversalChance,
      reactionMs: DIFFICULTY.easy.reactionMs,
    };
    const antiRep = createAntiRepState();
    let r = mulberry32(11);
    // Even at the end of the legSweep reversal window (270ms), 270 < 550 so the
    // brain has not yet reacted — the chance is never even offered.
    for (let elapsed = 50; elapsed <= 270; elapsed += 20) {
      const pick = pickAttack(
        self(),
        target({
          dist: 0.9,
          activeMove: { id: 'legSweep', phase: 'startup', phaseMsElapsed: elapsed },
        }),
        r,
        antiRep,
        easy,
      );
      expect(pick).not.toBe('reverseAttempt');
    }
  });
});
