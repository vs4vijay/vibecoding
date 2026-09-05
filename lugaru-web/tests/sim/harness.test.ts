import { describe, expect, it } from 'vitest';
import { FighterSim } from '../../src/combat/stateMachine';
import type { FighterState, FighterSimWorld, HitEvent } from '../../src/combat/stateMachine';
import type { InputFrame } from '../../src/core/input';
import { heightAt } from '../../src/world/terrain';
import { applyHit } from '../../src/combat/hitdetect';
import { STEP_MS } from '../combat/stateMachine.test';
import {
  makeFrame,
  forward,
  forwardAttackHeld,
  attackPress,
  attackHeld,
  none,
  repeatFrames,
} from './scriptedInputs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FightSummary {
  playerHits: number;
  enemyHits: number;
  playerFinalHp: number;
  enemyFinalHp: number;
  koReason: 'hp' | 'knockout' | 'timeout';
  stepsRun: number;
  maxPositionError: number;
}

/**
 * Run a scripted fight between a player rabbit and a dummy wolf.
 *
 * @param stepsMs - Array of step durations in ms (each step is 60Hz fixed step)
 * @param playerInputAt - Function returning InputFrame for player at step index i
 * @param aiInputs - Optional AI inputs for enemy (null = dummy stands still)
 * @returns FightSummary with results
 */
export function runScriptedFight(
  stepsMs: number[],
  playerInputAt: (i: number) => InputFrame | null,
  aiInputs: (i: number) => InputFrame | null = () => null
): FightSummary {
  const totalSteps = stepsMs.length;
  let playerHits = 0;
  let enemyHits = 0;
  let maxPositionError = 0;

  // Spawn player rabbit at origin; enemy wolf 3m ahead at +X.
  // forwardXZ(heading) = (-sin(h), -cos(h)); heading -PI/2 → forward (1,0) = +X toward enemy.
  // Enemy heading +PI/2 → forward (-1,0) = -X toward player at origin.
  const player = new FighterSim('rabbit', 'player', true);
  player.state.pos.x = 0;
  player.state.pos.z = 0;
  player.state.pos.y = heightAt(0, 0);
  player.state.heading = -Math.PI / 2; // forward +X, toward enemy
  const enemy = new FighterSim('wolf', 'enemy', false);
  enemy.state.pos.x = 3;
  enemy.state.pos.z = 0;
  enemy.state.pos.y = heightAt(3, 0);
  enemy.state.heading = Math.PI / 2; // forward -X, toward player

  // Score ledgers (optional, for completeness)
  // import { ScoreLedger } from '../../src/combat/scoring';
  // player.setScoreLedger(new ScoreLedger());
  // enemy.setScoreLedger(new ScoreLedger());

  // Sim loop
  for (let i = 0; i < totalSteps; i++) {
    const dtMs = Math.min(stepsMs[i], 50); // same clamp as FighterSim.update

    const pInput = playerInputAt(i);
    const eInput = aiInputs(i);

    // Build world view
    const world: FighterSimWorld = {
      fighters: [player.state, enemy.state],
      downedBodyNearby: false,
      weaponOnGroundNearby: false,
    };

    // Update both fighters
    player.update(dtMs, pInput, world);
    enemy.update(dtMs, eInput, world);

    // Collect hits from both sides
    const pHits = player.collectHits([enemy.state]);
    const eHits = enemy.collectHits([player.state]);
    // Apply hits
    const allFighters = [player.state, enemy.state];

    for (const hit of pHits) {
      applyHit(hit, allFighters);
      playerHits++;
    }
    for (const hit of eHits) {
      applyHit(hit, allFighters);
      enemyHits++;
    }

    // Track position error: y should never go below heightAt(x,z) - epsilon
    const epsilon = 0.001;
    for (const f of allFighters) {
      const groundY = heightAt(f.pos.x, f.pos.z);
      const error = groundY - f.pos.y;
      if (error > maxPositionError) maxPositionError = error;

      // Check for NaN
      if (
        Number.isNaN(f.pos.x) ||
        Number.isNaN(f.pos.y) ||
        Number.isNaN(f.pos.z) ||
        Number.isNaN(f.velY) ||
        Number.isNaN(f.heading)
      ) {
        throw new Error(`NaN detected in fighter ${f.id} at step ${i}`);
      }
    }
    // Check for KO via hp depletion
    if (player.state.hp <= 0 || enemy.state.hp <= 0) {
      return {
        playerHits,
        enemyHits,
        playerFinalHp: Math.max(0, player.state.hp),
        enemyFinalHp: Math.max(0, enemy.state.hp),
        koReason: 'hp',
        stepsRun: i + 1,
        maxPositionError,
      };
    }

    // Check for knockout (unconscious flag from injury)
    if (player.state.flags.unconscious || enemy.state.flags.unconscious) {
      return {
        playerHits,
        enemyHits,
        playerFinalHp: Math.max(0, player.state.hp),
        enemyFinalHp: Math.max(0, enemy.state.hp),
        koReason: 'knockout',
        stepsRun: i + 1,
        maxPositionError,
      };
    }
  }

  // Timeout - fight didn't end in KO
  return {
    playerHits,
    enemyHits,
    playerFinalHp: Math.max(0, player.state.hp),
    enemyFinalHp: Math.max(0, enemy.state.hp),
    koReason: 'timeout',
    stepsRun: totalSteps,
    maxPositionError,
  };
}

// ---------------------------------------------------------------------------
// Test: Scripted fight harness integration proof
// ---------------------------------------------------------------------------

describe('Headless scripted-fight harness (Task 10)', () => {
  it('spawns player rabbit + dummy wolf 3m apart; approach to within punch range, punch ×3; asserts ≥1 hit, enemy hp < max, no NaN, y ≥ heightAt, KO or timeout cleanly', () => {
    // Rabbit runSpeed = 6.2 m/s. Enemy at 3m. Punch range = 1.4m.
    // Approach 350ms → ~2.17m covered, leaving ~0.83m to enemy — well inside 1.4m range.
    // 800ms would overshoot (4.96m past the 3m enemy).
    const approachSteps = Math.round(350 / STEP_MS); // ~21 steps at 60Hz

    const inputSequence: Array<InputFrame | null> = [
      ...repeatFrames([[forward(), approachSteps]]),
      // Stop running - stand still for a moment
      ...repeatFrames([[makeFrame(), 5]]),
      // Punch 1: attack press, then hold for a few frames
      attackPress(),
      ...repeatFrames([[attackHeld(), 3]]),
      // Small gap
      ...repeatFrames([[makeFrame(), 10]]),
      // Punch 2
      attackPress(),
      ...repeatFrames([[attackHeld(), 3]]),
      ...repeatFrames([[makeFrame(), 10]]),
      // Punch 3
      attackPress(),
      ...repeatFrames([[attackHeld(), 3]]),
    ];

    // Pad to 20000 steps max
    const maxSteps = 20000;
    while (inputSequence.length < maxSteps) {
      inputSequence.push(makeFrame());
    }

    const stepsMs = inputSequence.map(() => STEP_MS);

    const summary = runScriptedFight(
      stepsMs,
      (i) => inputSequence[i] ?? makeFrame(),
      () => null // dummy AI = null input
    );

    // Assertions per brief
    expect(summary.playerHits).toBeGreaterThanOrEqual(1); // ≥1 HitEvent fired
    expect(summary.enemyFinalHp).toBeLessThan(160); // dummy hp < max (wolf maxHp = 160)
    expect(summary.maxPositionError).toBeLessThanOrEqual(0.001); // y ≥ heightAt - ε
    expect(summary.stepsRun).toBeLessThanOrEqual(20000); // within step budget
    expect(['hp', 'knockout', 'timeout']).toContain(summary.koReason); // valid KO reason

    // Additional: both fighters y-coordinates always ≥ heightAt(x,z) - ε
    // This is checked inside runScriptedFight and would throw if violated

    console.log('Fight Summary:', summary);
  }, 30000); // 30s timeout for 20k steps
});
// ---------------------------------------------------------------------------
// Task 16 — AI vs player: a Brain-driven wolf fights a scripted player.
// The fight must terminate (someone KOs) within 90 s of sim time across
// 5 seeds, with no NaN in any tracked quantity.
// ---------------------------------------------------------------------------

import { Brain } from '../../src/ai/brain';
import { DIFFICULTY } from '../../src/ai/difficulty';
import { mulberry32 } from '../../src/core/rng';

describe('AI vs player harness (Task 16)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: brain-driven wolf vs scripted player reaches KO within 90s, no NaN`, () => {
      const rng = mulberry32(seed);
      const player = new FighterSim('rabbit', 'player', true);
      const wolf = new FighterSim('wolf', 'wolf', false);
      player.state.pos.z = -6;
      wolf.state.pos.z = 0;
      wolf.state.heading = 0; // forward = (-sin h, -cos h) = (0, -1): faces the player at -z
      const brain = new Brain(wolf, DIFFICULTY.normal, rng);

      const world: FighterSimWorld = {
        fighters: [player.state, wolf.state],
        downedBodyNearby: false,
        weaponOnGroundNearby: false,
      };
      const brainWorld = {
        enemies: [player.state],
        allies: [] as FighterState[],
        bushes: [],
        allyEngageCount: 0,
      };
      const senses = { heard: [], wind: { vector: { x: 0, z: 0 } }, scent: null };

      const maxSteps = Math.ceil(90_000 / STEP_MS); // 90 s of sim time
      let koReason: 'hp' | 'timeout' = 'timeout';
      let stepsRun = 0;
      let cooldown = 0;

      for (let i = 0; i < maxSteps; i++) {
        stepsRun = i + 1;

        // Scripted player: face + approach the wolf, press attack on a
        // seeded cadence when within punch range.
        const dx = wolf.state.pos.x - player.state.pos.x;
        const dz = wolf.state.pos.z - player.state.pos.z;
        const dist = Math.hypot(dx, dz);
        const input = makeFrame();
        if (dist > 1.2) {
          // Steer toward the wolf: invert the sim's heading-relative input
          // mapping (fwd = (-sin h, -cos h), right = (-fwd.z, fwd.x)) so the
          // world-space direction (dx, dz) becomes local move inputs.
          const h = player.state.heading;
          const fx = -Math.sin(h);
          const fz = -Math.cos(h);
          const rx = -fz;
          const rz = fx;
          const nx = dx / (dist || 1);
          const nz = dz / (dist || 1);
          input.moveZ = -(nx * fx + nz * fz);
          input.moveX = nx * rx + nz * rz;
        } else if (cooldown <= 0) {
          input.pressed.attack = true;
          cooldown = 20; // ~0.33 s between presses
        }
        cooldown -= 1;

        player.update(STEP_MS, input, world);
        const aiFrame = brain.update(STEP_MS, senses, brainWorld);
        wolf.update(STEP_MS, aiFrame, world);

        // Hit application both directions.
        for (const hit of player.collectHits([wolf.state])) {
          applyHit(hit, world.fighters);
        }
        for (const hit of wolf.collectHits([player.state])) {
          applyHit(hit, world.fighters);
        }

        // No NaN anywhere, every step.
        for (const f of world.fighters) {
          expect(Number.isNaN(f.pos.x)).toBe(false);
          expect(Number.isNaN(f.pos.y)).toBe(false);
          expect(Number.isNaN(f.pos.z)).toBe(false);
          expect(Number.isNaN(f.velY)).toBe(false);
          expect(Number.isNaN(f.heading)).toBe(false);
          expect(Number.isNaN(f.hp)).toBe(false);
        }

        if (player.state.hp <= 0 || wolf.state.hp <= 0) {
          koReason = 'hp';
          break;
        }
      }

      console.log(`seed ${seed}: reason=${koReason} player=${player.state.hp} wolf=${wolf.state.hp} brain=${brain.state} dist=${Math.hypot(wolf.state.pos.x - player.state.pos.x, wolf.state.pos.z - player.state.pos.z).toFixed(1)}`);
      expect(koReason).toBe('hp'); // fight actually terminated
    }, 30_000);
  }
});
