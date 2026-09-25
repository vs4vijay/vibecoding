import { describe, expect, it } from 'vitest';

import { GameState } from '../src/core/GameState';
import type { LateralInput } from '../src/core/Input';
import { SaveService, type StorageLike } from '../src/core/Save';
import { Controller } from '../src/player/Controller';
import { createSnail } from '../src/player/Snail';
import { checkFall, findHit, findRingPass } from '../src/systems/Collision';
import { Health } from '../src/systems/Health';
import { medalFor, medalPoints, parSeconds, countLevelPackages } from '../src/systems/Medal';
import { Score } from '../src/systems/Score';
import { SpeedModifiers } from '../src/systems/SpeedMods';
import { Spawner } from '../src/systems/Spawner';
import { BOMB_WINDOW, bombTargets, WeaponLadder } from '../src/systems/Weapons';
import { TrackCurve } from '../src/track/TrackCurve';
import { POD_FLIGHT_TIME, POD_PEAK_HEIGHT, TrackGaps } from '../src/track/TrackGaps';
import { loadBundledLevels, type LevelDefinition } from '../src/track/LevelLoader';

/**
 * Full-campaign headless smoke (Phase 5 acceptance): a fresh save runs the
 * real bundled levels 1→10 through the exact main.ts playing-branch wiring —
 * fixed-step Controller sim, Spawner streaming, ring plane-crossings (pods
 * launch, red rings slow, white rings ladder up, yellow rings bomb), the gap
 * fall check, pickup contacts, then finish → recordResult → unlock chain.
 *
 * Difficulty knob: the harness Turbo is *immune to lethal contacts* (slugs
 * phase past, asteroids never crash) — steering AI is out of scope for a
 * headless suite, and everything that decides finish/unlock (pods, gaps,
 * rings, pickups, the FSM, the save) stays fully live. A gap fall here would
 * mean a level-design invariant broke, so it fails the test loudly.
 */

const STEP = 1 / 60;
/** Asteroid/red-ring speed-mod constants mirrored from main.ts. */
const RED_RING_MULTIPLIER = 0.4;
const RED_RING_DURATION = 3;

/** In-memory localStorage stand-in (fresh save per test run). */
function makeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

interface CampaignHarness {
  game: GameState;
  controller: Controller;
  spawner: Spawner;
  gaps: TrackGaps;
  speedMods: SpeedModifiers;
  weapons: WeaponLadder;
  score: Score;
  health: Health;
  level: LevelDefinition;
  length: number;
  landedAfterFlight: number;
  fell: boolean;
}

function makeHarness(level: LevelDefinition): CampaignHarness {
  const track = new TrackCurve(level.controlPoints, { expectedLength: level.length });
  const gaps = TrackGaps.fromFeatures(level.features, level.length);
  const speedMods = new SpeedModifiers();
  const input: LateralInput = { lateral: 0 };
  const controller = new Controller({
    track,
    snail: createSnail(),
    input,
    cruiseSpeed: level.cruiseSpeed,
    roadHalfWidth: 7,
    speedModifiers: speedMods,
  });
  const spawner = new Spawner(track);
  spawner.load(level);
  spawner.reset(0);
  return {
    game: new GameState(),
    controller,
    spawner,
    gaps,
    speedMods,
    weapons: new WeaponLadder(),
    score: new Score(),
    health: new Health(),
    level,
    length: track.getCurveLength(),
    landedAfterFlight: 0,
    fell: false,
  };
}

/**
 * One sim step — main.ts's `playing`/`running` branch, headless: rings and
 * pods first (a pod launch this step turns the snail airborne before the
 * fall check), then gap falls, then contacts. Slugs/asteroids are dropped
 * from the contact filter (the immunity knob); pickups stay live, even
 * mid-flight, exactly like main.ts's airborne rule.
 */
function stepCampaign(harness: CampaignHarness): void {
  const { controller, spawner, gaps, speedMods, weapons, game } = harness;
  const prevS = controller.s;
  const wasAirborne = controller.airborne;
  controller.update(STEP);
  spawner.update(controller.s, STEP);

  const ring = findRingPass(spawner.entities, prevS, controller.s, controller.x);
  if (ring) {
    spawner.kill(ring);
    switch (ring.type) {
      case 'jumpPod': {
        const span = gaps.spanForPod(ring.s);
        if (span) controller.launch({ duration: POD_FLIGHT_TIME, peakHeight: POD_PEAK_HEIGHT });
        break;
      }
      case 'redRing':
        speedMods.apply('redRing', RED_RING_MULTIPLIER, RED_RING_DURATION);
        break;
      case 'whiteRing':
        weapons.ladderUp();
        break;
      case 'yellowRing':
        for (const target of bombTargets(spawner.entities, controller.s, BOMB_WINDOW)) {
          spawner.kill(target);
        }
        break;
    }
  }

  if (checkFall(gaps, prevS, controller.s, controller.airborne)) {
    harness.fell = true;
    if (game.isPlaying) game.gameOver();
    return;
  }

  const pickup = findHit(
    spawner.entities,
    controller.s,
    controller.x,
    undefined,
    undefined,
    (entity) => entity.type === 'package' || entity.type === 'heart',
  );
  if (pickup) {
    spawner.kill(pickup);
    if (pickup.type === 'package') harness.score.collectPackage();
    else harness.health.restore(1);
  }

  if (wasAirborne && !controller.airborne) harness.landedAfterFlight += 1;

  if (controller.s >= harness.length && game.isPlaying) game.complete();
}

describe('full-campaign smoke (headless): fresh save → levels 1→10 → unlock chain complete', () => {
  it(
    'finishes every level in order, unlocking the next, until the campaign is done',
    { timeout: 180_000 },
    () => {
      const save = new SaveService(makeStorage());
      const levels = [...loadBundledLevels().values()].sort((a, b) => a.id - b.id);
      expect(levels).toHaveLength(10);
      expect(save.data.unlockedLevel).toBe(1); // fresh save: only level 1 playable

      for (const level of levels) {
        // Sequential unlock chain: level N is only ever played once unlocked.
        expect(save.data.unlockedLevel, `level ${level.id} unlocked before play`).toBeGreaterThanOrEqual(level.id);

        const harness = makeHarness(level);
        harness.game.start();

        // Budget: straight cruise time + 60% slack (red-ring eats) + padding.
        const maxSteps = Math.ceil((harness.length / level.cruiseSpeed) * 60 * 1.6) + 600;
        let steps = 0;
        for (; steps < maxSteps && harness.game.isPlaying; steps += 1) {
          stepCampaign(harness);
        }

        expect(harness.game.name, `level ${level.id} (${level.name}) finished`).toBe('complete');
        expect(harness.fell, `level ${level.id}: never fell into a gap (pod coverage holds)`).toBe(false);

        // Levels with gaps must have flown and landed at least once.
        if (harness.gaps.count > 0) {
          expect(harness.landedAfterFlight, `level ${level.id} pod flights landed`).toBeGreaterThanOrEqual(1);
        }

        const time = steps * STEP;
        const breakdown = harness.score.breakdown(level.id, harness.health.pips);

        // The medal rule evaluates on real campaign data without throwing
        // and lands inside the documented tier set.
        const par = parSeconds(level.length, level.cruiseSpeed);
        const medal = medalFor(
          medalPoints({
            packagesCollected: breakdown.packagesCollected,
            packagesAvailable: countLevelPackages(level.features),
            pips: harness.health.pips,
            maxPips: 3,
            timeSeconds: time,
            parSeconds: par,
          }),
        );
        expect(['gold', 'silver', 'bronze', 'none']).toContain(medal);

        const result = save.recordResult(level.id, time, breakdown.total);
        expect(result.unlockedLevel, `finishing level ${level.id} unlocks ${level.id + 1}`).toBe(level.id + 1);
        expect(result.newBestTime).toBe(true);
        expect(result.newBestScore).toBe(true);
      }

      // The chain ran to the end: finishing level 10 marks the campaign done
      // (unlockedLevel = 10 + 1) and every best time/score persisted.
      expect(save.data.unlockedLevel).toBe(11);
      for (const level of levels) {
        expect(save.data.bestTimes[level.id], `best time for level ${level.id}`).toBeGreaterThan(0);
        expect(save.data.bestScores[level.id], `best score for level ${level.id}`).toBeGreaterThan(0);
      }

      // Replaying level 1 on the completed save never locks anything back.
      const replay = save.recordResult(1, 999, 0);
      expect(replay.unlockedLevel).toBe(11);
      expect(replay.newBestTime).toBe(false);
      expect(replay.newBestScore).toBe(false);
    },
  );
});
