import { describe, expect, it } from 'vitest';
import { Brain, type BrainSenses, type BrainWorld } from '../../src/ai/brain';
import { FighterSim, type FighterSimWorld } from '../../src/combat/stateMachine';
import type { FighterState } from '../../src/combat/stateMachine';
import { DIFFICULTY } from '../../src/ai/difficulty';
import type { DifficultyDef } from '../../src/ai/difficulty';
import { mulberry32 } from '../../src/core/rng';
import type { HearingEvent } from '../../src/ai/perception';
import type { InputFrame } from '../../src/core/input';
import { heightAt } from '../../src/world/terrain';
import {
  AI_FLEE_HP_FRACTION,
  AI_MEMORY_TIMEOUT_MS,
} from '../../src/data/tuning';

/**
 * Task 16 — enemy brain FSM.
 * The Brain drives a FighterSim via the same InputFrame shape a human uses;
 * the sim cannot tell them apart (core design invariant).
 */

const IDLE: InputFrame = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  pressed: { attack: false, jump: false, crouch: false },
  held: { attack: false, jump: false, crouch: false },
};

function wolfAt(x: number, z: number): FighterSim {
  const w = new FighterSim('wolf', 'wolf', false);
  w.state.pos.x = x;
  w.state.pos.z = z;
  w.state.pos.y = heightAt(x, z);
  return w;
}

function rabbitAt(x: number, z: number, heading = 0): FighterSim {
  const r = new FighterSim('rabbit', 'player', true);
  r.state.pos.x = x;
  r.state.pos.z = z;
  r.state.pos.y = heightAt(x, z);
  r.state.heading = heading;
  return r;
}

function emptySenses(): BrainSenses {
  return { heard: [], wind: { vector: { x: 0, z: 0 } }, scent: null };
}

function world(enemies: FighterSim[], allies: FighterSim[] = []): BrainWorld {
  return {
    enemies: enemies.map((e) => e.state),
    allies: allies.map((a) => a.state),
    bushes: [],
  };
}

/** Real sim world for stepping the wolf's FighterSim with brain output. */
function simWorld(...fighters: FighterSim[]): FighterSimWorld {
  return {
    fighters: fighters.map((f) => f.state),
    downedBodyNearby: false,
    weaponOnGroundNearby: false,
  };
}


function makeBrain(wolf: FighterSim, difficulty: DifficultyDef = DIFFICULTY.normal): Brain {
  return new Brain(wolf, difficulty, mulberry32(42));
}


describe('Brain FSM — patrol', () => {
  it('an idle brain far from a silent player stays in patrol', () => {
    const wolf = wolfAt(0, 0);
    const player = rabbitAt(50, 50);
    const brain = makeBrain(wolf);
    const out = brain.update(16, emptySenses(), world([player]));
    expect(brain.state).toBe('patrol');
    // Patrol produces some movement or a brief pause; never attack input.
    expect(out.pressed.attack).toBe(false);
    expect(out.pressed.crouch).toBe(false);
    expect(out.pressed.jump).toBe(false);
  });
});

describe('Brain FSM — investigate', () => {
  it('hearing a loud landThud within radius sends the brain to investigate the source', () => {
    const wolf = wolfAt(0, 0);
    const brain = makeBrain(wolf);
    const thudPos = { x: 8, z: 8 }; // within wolf hearing radius (0.9*14 = 12.6m)
    const thud: HearingEvent = { kind: 'landThud', pos: thudPos, loudness: 0.9 };
    // No visible enemy — pure investigate toward the heard source. The
    // brain's output is APPLIED to the wolf sim so it actually walks.
    let out = brain.update(
      16,
      { heard: [thud], wind: { vector: { x: 0, z: 0 } }, scent: null },
      world([]),
    );
    expect(brain.state).toBe('investigate');
    const before = Math.hypot(wolf.state.pos.x - thudPos.x, wolf.state.pos.z - thudPos.z);
    for (let i = 0; i < 30; i++) {
      out = brain.update(16, { heard: [], wind: { vector: { x: 0, z: 0 } }, scent: null }, world([]));
      wolf.update(16, out, simWorld());
    }
    const after = Math.hypot(wolf.state.pos.x - thudPos.x, wolf.state.pos.z - thudPos.z);
    expect(after).toBeLessThan(before);
  });
});

describe('Brain FSM — engage', () => {
  it('seeing a player within engage range switches to engage and attacks', () => {
    const wolf = wolfAt(0, 0);
    const player = rabbitAt(2, 0); // 2m ahead at +X
    wolf.state.heading = -Math.PI / 2; // forward +X, looking at player
    const brain = makeBrain(wolf);
    const first = brain.update(16, emptySenses(), world([player]));
    expect(brain.state).toBe('engage');
    // A committed attack press appears within the engage steps. The wolf's
    // output is APPLIED to its sim so it closes from 2m into punch range.
    let attacked = false;
    for (let i = 0; i < 40; i++) {
      const f = brain.update(16, emptySenses(), world([player]));
      wolf.update(16, f, simWorld(player));
      if (f.pressed.attack) attacked = true;
    }
    expect(attacked).toBe(true);
  });
});

describe('Brain FSM — flee', () => {
  it('at hp < 25% the brain flees toward the nearest ally and screams exactly once', () => {
    const wolf = wolfAt(0, 0);
    wolf.state.hp = Math.floor(wolf.state.maxHp * AI_FLEE_HP_FRACTION) - 1;
    const ally = rabbitAt(0, 12);
    const brain = makeBrain(wolf);
    // First update triggers flee + scream.
    const out = brain.update(16, emptySenses(), world([], [ally]));
    expect(brain.state).toBe('flee');
    const first = brain.collectEvents();
    expect(first.filter((e) => e.kind === 'scream')).toHaveLength(1);
    // Subsequent flee updates must NOT emit another scream (exactly one).
    for (let i = 0; i < 30; i++) brain.update(16, emptySenses(), world([], [ally]));
    const rest = brain.collectEvents();
    expect(rest.filter((e) => e.kind === 'scream')).toHaveLength(0);
  });
});

describe('Brain FSM — downed', () => {
  it('a downed fighter outputs no inputs and reports the downed state', () => {
    const wolf = wolfAt(0, 0);
    const player = rabbitAt(1.5, 0);
    const brain = makeBrain(wolf);
    wolf.state.phase = { t: 'downed', phaseMsLeft: 1000 };
    const out = brain.update(16, emptySenses(), world([player]));
    expect(brain.state).toBe('downed');
    expect(out).toEqual(IDLE);
  });
});
