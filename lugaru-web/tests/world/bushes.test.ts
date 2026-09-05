/**
 * Task 17 — BushField: seeded scatter + rustle tells.
 *
 * Covers the pure layer: scatter constraints (count, spawn clearance,
 * bounds, determinism) and rustleCheck's gait encoding (loud run, quiet
 * crouch-walk, silent stand). A brain-integration test proves the
 * game.ts wire format (rustle → senses.heard → investigate).
 */
import { describe, expect, it } from 'vitest';
import { BushField } from '../../src/world/bushes';
import type { SpawnPoint } from '../../src/world/bushes';
import { mulberry32 } from '../../src/core/rng';
import {
  ARENA_SIZE_M,
  BUSH_COUNT,
  BUSH_MIN_SPAWN_CLEARANCE_M,
  BUSH_RADIUS_M,
  BUSH_RUSTLE_CROUCH_LOUDNESS,
  BUSH_SCATTER_MARGIN_M,
} from '../../src/data/tuning';
import { HEARING_LOUDNESS } from '../../src/ai/perception';
import { FighterSim } from '../../src/combat/stateMachine';
import { Brain } from '../../src/ai/brain';
import { DIFFICULTY } from '../../src/ai/difficulty';

const SPAWNS: SpawnPoint[] = [
  { x: 0, z: 0 },
  { x: 0, z: -3 },
];

/** First bush of a fixed field — tests walk straight through its center. */
function firstBushCenter() {
  const field = new BushField(mulberry32(7), SPAWNS);
  return { field, bush: field.bushes[0] };
}

describe('bush scatter', () => {
  it('is seed-reproducible (same seed → identical positions)', () => {
    const a = new BushField(mulberry32(1234), SPAWNS);
    const b = new BushField(mulberry32(1234), SPAWNS);
    expect(a.bushes).toEqual(b.bushes);
  });

  it('places the full bush count with the sight-blocking radius', () => {
    const field = new BushField(mulberry32(7), SPAWNS);
    expect(field.bushes.length).toBe(BUSH_COUNT);
    for (const bush of field.bushes) expect(bush.radius).toBe(BUSH_RADIUS_M);
  });

  it('keeps every bush BUSH_MIN_SPAWN_CLEARANCE_M from both spawns and inside the arena', () => {
    const field = new BushField(mulberry32(99), SPAWNS);
    const half = ARENA_SIZE_M / 2 - BUSH_SCATTER_MARGIN_M;
    for (const bush of field.bushes) {
      for (const s of SPAWNS) {
        const d = Math.hypot(bush.pos.x - s.x, bush.pos.z - s.z);
        expect(d).toBeGreaterThanOrEqual(BUSH_MIN_SPAWN_CLEARANCE_M);
      }
      expect(Math.abs(bush.pos.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(bush.pos.z)).toBeLessThanOrEqual(half);
    }
  });
});

describe('rustleCheck', () => {
  it('a running crossing emits a loud bushRustle sourced at the bush', () => {
    const { field, bush } = firstBushCenter();
    const prev = { x: bush.pos.x - 1, z: bush.pos.z };
    const pos = { x: bush.pos.x, z: bush.pos.z }; // prev outside, now inside
    const e = field.rustleCheck(pos, prev, true);
    expect(e).not.toBeNull();
    expect(e!.kind).toBe('bushRustle');
    expect(e!.pos).toEqual({ x: bush.pos.x, z: bush.pos.z });
    expect(e!.loudness).toBe(HEARING_LOUDNESS.bushRustle);
  });

  it('a crouch-walk crossing is a quiet BUSH_RUSTLE_CROUCH_LOUDNESS event', () => {
    const { field, bush } = firstBushCenter();
    const prev = { x: bush.pos.x - 1, z: bush.pos.z };
    const pos = { x: bush.pos.x, z: bush.pos.z };
    const e = field.rustleCheck(pos, prev, false);
    expect(e).not.toBeNull();
    expect(e!.loudness).toBe(BUSH_RUSTLE_CROUCH_LOUDNESS);
  });

  it('standing still inside a canopy never rustles', () => {
    const { field, bush } = firstBushCenter();
    const p = { x: bush.pos.x, z: bush.pos.z };
    expect(field.rustleCheck(p, p, true)).toBeNull();
  });

  it('a walk-through fires exactly once (entry only)', () => {
    const { field, bush } = firstBushCenter();
    let events = 0;
    // 5 cm steps along x, from 2 m west to 2 m east of the bush center.
    let x = bush.pos.x - 2;
    const z = bush.pos.z;
    for (let i = 0; i < 80; i++) {
      const prev = { x, z };
      x += 0.05;
      if (field.rustleCheck({ x, z }, prev, true) !== null) events++;
    }
    expect(events).toBe(1);
  });

  it('reports null far from every bush', () => {
    const { field } = firstBushCenter();
    const e = field.rustleCheck({ x: 5000, z: 5000 }, { x: 4999, z: 5000 }, true);
    expect(e).toBeNull();
  });
});

describe('rustle → brain investigate (game.ts wire format)', () => {
  it('a wolf brain that hears the rustle investigates the bush', () => {
    const { field, bush } = firstBushCenter();
    const wolf = new FighterSim('wolf', 'wolf1', false);
    // Wolf 5 m away — inside a running rustle's 0.6 × 14 m hearing radius,
    // with no visible target (empty enemy roster) so investigate wins.
    wolf.state.pos.x = bush.pos.x + 5;
    wolf.state.pos.z = bush.pos.z;
    const brain = new Brain(wolf, DIFFICULTY.normal, mulberry32(3));

    // The exact event shape game.ts emits when a runner crosses the bush.
    const rustle = field.rustleCheck(
      { x: bush.pos.x, z: bush.pos.z },
      { x: bush.pos.x - 1, z: bush.pos.z },
      true,
    );
    expect(rustle).not.toBeNull();

    const senses = { heard: [rustle!], wind: { vector: { x: 0, z: 0 } }, scent: null };
    const world = { enemies: [] as FighterSim['state'][], allies: [], bushes: field.bushes };
    const frame = brain.update(1000 / 60, senses, world);

    expect(brain.state).toBe('investigate');
    expect(brain.lastHeard).toEqual({ x: bush.pos.x, z: bush.pos.z });
    // The produced frame actually steers toward the sound (nonzero move).
    expect(Math.hypot(frame.moveX, frame.moveZ)).toBeGreaterThan(0.1);
  });
});
