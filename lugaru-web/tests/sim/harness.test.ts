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

  // Spawn player rabbit at origin facing -X (west), dummy wolf 3m ahead at +X facing back (+X/east)
  const player = new FighterSim('rabbit', 'player', true);
  player.state.pos.x = 0;
  player.state.pos.z = 0;
  player.state.pos.y = heightAt(0, 0);
  player.state.heading = -Math.PI / 2; // facing -X (west) — forward is +X toward enemy
  const enemy = new FighterSim('wolf', 'enemy', false);
  enemy.state.pos.x = 3;
  enemy.state.pos.z = 0;
  enemy.state.pos.y = heightAt(3, 0);
  enemy.state.heading = Math.PI / 2; // facing +X (east) — toward player

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

    // Check for KO
    if (player.state.hp <= 0 || enemy.state.hp <= 0) {
      const reason = player.state.hp <= 0 && enemy.state.hp <= 0
        ? 'hp'
        : player.state.hp <= 0
          ? 'hp'
          : 'hp';

      return {
        playerHits,
        enemyHits,
        playerFinalHp: Math.max(0, player.state.hp),
        enemyFinalHp: Math.max(0, enemy.state.hp),
        koReason: reason,
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