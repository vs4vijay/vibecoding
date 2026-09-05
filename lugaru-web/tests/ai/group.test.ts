import { describe, expect, it } from 'vitest';
import { Brain, type BrainSenses, type BrainWorld } from '../../src/ai/brain';
import { FighterSim } from '../../src/combat/stateMachine';
import { DIFFICULTY } from '../../src/ai/difficulty';
import { AI_ENGAGE_RANGE_M } from '../../src/data/tuning';
import { mulberry32 } from '../../src/core/rng';
import { heightAt } from '../../src/world/terrain';

/**
 * Task 18 — group engagement gate.
 *
 * The game layer computes, immediately before each brain's update, how many
 * OTHER ally brains are in 'engage' (greedy first-come slot allocation).
 * A brain at/over its difficulty engageLimit stays in 'circle' instead of
 * engaging [spec §7: circle members never attack in v1].
 */

const senses: BrainSenses = { heard: [], wind: { vector: { x: 0, z: 0 } }, scent: null };

/** A pack of wolves ringed 2 m around the rabbit at the origin, all staring at it. */
function pack(
  difficulty: 'easy' | 'normal' | 'hard',
  count = 3,
): { brains: Brain[]; wolves: FighterSim[]; world: BrainWorld } {
  const player = new FighterSim('rabbit', 'player', true);
  const wolves: FighterSim[] = [];
  for (let i = 0; i < count; i++) {
    const w = new FighterSim('wolf', `wolf${i + 1}`, false);
    const ang = (i / count) * Math.PI * 2;
    w.state.pos.x = Math.cos(ang) * 2;
    w.state.pos.z = Math.sin(ang) * 2;
    w.state.pos.y = heightAt(w.state.pos.x, w.state.pos.z);
    // Face the origin: forwardXZ(h) = (−sin h, −cos h).
    w.state.heading = Math.atan2(-(-w.state.pos.x), -(-w.state.pos.z));
    wolves.push(w);
  }
  const brains = wolves.map((w) => new Brain(w, DIFFICULTY[difficulty], mulberry32(42)));
  const world: BrainWorld = {
    enemies: [player.state],
    allies: wolves.map((w) => w.state),
    bushes: [],
    allyEngageCount: 0,
  };
  return { brains, wolves, world };
}

/** One frame exactly as game.ts steps a pack: greedy per-brain slot counts. */
function stepPack(brains: Brain[], world: BrainWorld): void {
  for (const b of brains) {
    world.allyEngageCount = brains.filter((o) => o !== b && o.state === 'engage').length;
    b.update(16, senses, world);
  }
}

describe('group engagement gate', () => {
  it(`easy (limit 1): exactly one wolf engages within ${AI_ENGAGE_RANGE_M} m, the rest circle`, () => {
    const { brains, world } = pack('easy');
    stepPack(brains, world);
    expect(brains.filter((b) => b.state === 'engage')).toHaveLength(1);
    expect(brains.filter((b) => b.state === 'circle')).toHaveLength(2);
  });

  it('normal (limit 2): exactly two engage', () => {
    const { brains, world } = pack('normal');
    stepPack(brains, world);
    expect(brains.filter((b) => b.state === 'engage')).toHaveLength(2);
    expect(brains.filter((b) => b.state === 'circle')).toHaveLength(1);
  });

  it('hard (limit 3): the whole pack engages', () => {
    const { brains, world } = pack('hard');
    stepPack(brains, world);
    expect(brains.filter((b) => b.state === 'engage')).toHaveLength(3);
  });

  it('the allocation is stable frame over frame (no engage/circle oscillation)', () => {
    const { brains, world } = pack('easy');
    for (let i = 0; i < 60; i++) stepPack(brains, world);
    expect(brains.filter((b) => b.state === 'engage')).toHaveLength(1);
    expect(brains.filter((b) => b.state === 'circle')).toHaveLength(2);
  });

  it('a freed slot is taken: when the engager drops, a circler engages next frame', () => {
    const { brains, wolves, world } = pack('easy');
    stepPack(brains, world);
    const engager = brains.findIndex((b) => b.state === 'engage');
    expect(engager).toBeGreaterThanOrEqual(0);

    // The engager goes down (downed overrides every other state).
    wolves[engager].state.phase = { t: 'downed', phaseMsLeft: 10_000 };
    stepPack(brains, world);

    expect(brains[engager].state).toBe('downed');
    expect(brains.filter((b) => b.state === 'engage')).toHaveLength(1);
    expect(brains.filter((b) => b.state === 'circle')).toHaveLength(1);
  });

  it('the gate never blocks circle: a wolf outside melee range circles with free slots', () => {
    const { brains, wolves, world } = pack('easy');
    // Push wolf1 beyond the chase band's engage threshold, inside circle range.
    wolves[0].state.pos.x = 5;
    wolves[0].state.pos.z = 0;
    wolves[0].state.heading = Math.atan2(-(-5), -(0)); // still stares at the rabbit
    stepPack(brains, world);
    expect(brains[0].state).toBe('circle');
  });
});
