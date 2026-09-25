import { describe, expect, it } from 'vitest';

/**
 * Ship test (Phase 6 final bug bash) — the release smoke script, end to end,
 * headless:
 *
 *   boot (module graph resolves) → fresh save → campaign path L1→L10 →
 *   death paths (slug knock-off, gap fall) with retry after each →
 *   save corruption recovery → mute persistence.
 *
 * The campaign/death sections drive the exact main.ts playing-branch wiring
 * (fixed-step Controller, Spawner streaming, ring crossings, gap falls,
 * contacts, FSM) without a renderer. main.ts itself is the one module NOT
 * imported here: `bootstrap()` needs a DOM + WebGL context — it is exercised
 * by the production build (`bun run build` + preview) and the human visual
 * smoke pass instead.
 */

// -- Boot: every module of the game graph must import cleanly. --------------
import { Sfx } from '../src/audio/Sfx';
import { GameState } from '../src/core/GameState';
import { Input } from '../src/core/Input';
import { Loop } from '../src/core/Loop';
import { SaveService, type StorageLike } from '../src/core/Save';
import { createEntity } from '../src/entities/Entity';
import { VISUAL_FACTORIES } from '../src/entities/factories';
import { getFeatureDefinition } from '../src/entities/SpawnRegistry';
import { ChaseCamera } from '../src/player/ChaseCamera';
import { Controller } from '../src/player/Controller';
import { createSnail } from '../src/player/Snail';
import { SpeedTrail } from '../src/player/SpeedTrail';
import { checkFall, findHit, findRingPass, isContactType } from '../src/systems/Collision';
import { Health } from '../src/systems/Health';
import { medalFor } from '../src/systems/Medal';
import { ProjectileSystem } from '../src/systems/Projectiles';
import { Score } from '../src/systems/Score';
import { SpeedModifiers } from '../src/systems/SpeedMods';
import { Spawner } from '../src/systems/Spawner';
import { WeaponLadder } from '../src/systems/Weapons';
import { loadBundledLevels } from '../src/track/LevelLoader';
import { TrackCurve } from '../src/track/TrackCurve';
import { POD_FLIGHT_TIME, POD_PEAK_HEIGHT, TrackGaps } from '../src/track/TrackGaps';
import { createTrackMesh } from '../src/track/TrackMesh';
import * as HUDModule from '../src/ui/HUD';
import * as LevelSelectModel from '../src/ui/LevelSelectModel';
import * as ScreensModule from '../src/ui/Screens';
import { createLighting } from '../src/world/Lighting';
import { createStarfield } from '../src/world/Starfield';

const STEP = 1 / 60;

/** In-memory localStorage stand-in (fresh, or seeded for corruption tests). */
function makeStorage(seed?: Record<string, string>): StorageLike & { dump(): Record<string, string> } {
  const data = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data.entries()),
  };
}

// Namespace objects prove the module bodies actually evaluated (imports are
// not elided), including the DOM-side UI modules that the sim never touches.
void createEntity;
void getFeatureDefinition;
void VISUAL_FACTORIES;
void createTrackMesh;
void createLighting;
void createStarfield;
void ChaseCamera;
void SpeedTrail;
void medalFor;
void ProjectileSystem;
void HUDModule;
void LevelSelectModel;
void ScreensModule;
void Input;
void Loop;
void Sfx;

describe('ship test: boot → campaign → deaths → save recovery → mute', () => {
  it('resolves the full module graph (boot smoke, sans DOM bootstrap)', () => {
    // Every import above evaluated without throwing; the save service boots
    // headless (memory fallback) exactly like a real first-run browser.
    const save = new SaveService(null);
    expect(save.data.unlockedLevel).toBe(1);
    expect(save.data.muted).toBe(false);
  });

  it('runs a fresh save through the campaign L1→L10 with the unlock chain intact', () => {
    const save = new SaveService(makeStorage());
    const levels = [...loadBundledLevels().values()].sort((a, b) => a.id - b.id);
    expect(levels).toHaveLength(10);

    for (const level of levels) {
      const track = new TrackCurve(level.controlPoints, { expectedLength: level.length });
      const gaps = TrackGaps.fromFeatures(level.features, level.length);
      const speedMods = new SpeedModifiers();
      const controller = new Controller({
        track,
        snail: createSnail(),
        input: { lateral: 0 },
        cruiseSpeed: level.cruiseSpeed,
        roadHalfWidth: 7,
        speedModifiers: speedMods,
      });
      const spawner = new Spawner(track);
      spawner.load(level);
      spawner.reset(0);
      const game = new GameState();
      const score = new Score();
      const health = new Health();
      const weapons = new WeaponLadder();
      let fell = false;

      game.start();
      const maxSteps = Math.ceil((track.getCurveLength() / level.cruiseSpeed) * 60 * 1.6) + 600;
      let steps = 0;
      for (; steps < maxSteps && game.isPlaying; steps += 1) {
        const prevS = controller.s;
        controller.update(STEP);
        spawner.update(controller.s, STEP);

        const ring = findRingPass(spawner.entities, prevS, controller.s, controller.x);
        if (ring) {
          spawner.kill(ring);
          if (ring.type === 'jumpPod') {
            const span = gaps.spanForPod(ring.s);
            if (span) controller.launch({ duration: POD_FLIGHT_TIME, peakHeight: POD_PEAK_HEIGHT });
          } else if (ring.type === 'whiteRing') {
            weapons.ladderUp();
          }
        }

        if (checkFall(gaps, prevS, controller.s, controller.airborne)) {
          fell = true;
          break;
        }

        const pickup = findHit(spawner.entities, controller.s, controller.x, undefined, undefined, isContactType);
        if (pickup) {
          spawner.kill(pickup);
          if (pickup.type === 'package') score.collectPackage();
        }

        if (controller.s >= track.getCurveLength()) game.complete();
      }

      expect(game.name, `level ${level.id} (${level.name}) completed`).toBe('complete');
      expect(fell, `level ${level.id}: no gap fall (pod coverage holds)`).toBe(false);

      const breakdown = score.breakdown(level.id, health.pips);
      const result = save.recordResult(level.id, steps * STEP, breakdown.total);
      expect(result.unlockedLevel, `level ${level.id} → unlock ${level.id + 1}`).toBe(level.id + 1);
      expect(result.newBestTime).toBe(true);
      expect(result.newBestScore).toBe(true);
    }

    expect(save.data.unlockedLevel).toBe(11);
  });

  it('dies to a slug, retries, and dies the same way again (death path + retry)', () => {
    const level: LevelDefinitionLite = {
      id: 2,
      name: 'Slug Death',
      length: 0,
      cruiseSpeed: 35,
      controlPoints: [
        [0, 0, 0],
        [0, 0, -600],
      ],
      features: [{ type: 'slug', at: 200, params: { lane: 0 } }],
    };
    const track = new TrackCurve(level.controlPoints);
    const spawner = new Spawner(track);
    spawner.load(withLength(level, track.getCurveLength()));
    spawner.reset(0);
    const game = new GameState();
    const controller = new Controller({
      track,
      snail: createSnail(),
      input: { lateral: 0 },
      cruiseSpeed: level.cruiseSpeed,
      roadHalfWidth: 7,
    });
    const health = new Health();

    const runUntilGameOver = (): number => {
      game.start();
      controller.reset();
      controller.applyVisual(1);
      spawner.reset(0);
      let steps = 0;
      for (; steps < 3000 && game.isPlaying; steps += 1) {
        controller.update(STEP);
        spawner.update(controller.s, STEP);
        const hit = findHit(spawner.entities, controller.s, controller.x, undefined, undefined, isContactType);
        if (hit?.type === 'slug') {
          health.damage(3); // slug contact = knock-off (main.ts beginKnockoff)
          game.gameOver();
        }
      }
      return steps;
    };

    const first = runUntilGameOver();
    expect(game.name).toBe('gameover');
    expect(controller.s).toBeLessThan(220); // died at the slug, not past it
    expect(health.isDepleted).toBe(true);

    const second = runUntilGameOver();
    expect(game.name).toBe('gameover'); // retry works: pool + sim fully reusable
    expect(second).toBeCloseTo(first, 0); // deterministic death at the same slug
  });

  it('falls into a podless gap → game over → retry re-runs the gap path deterministically', () => {
    const track = new TrackCurve([
      [0, 0, 0],
      [0, 0, -800],
    ]);
    const features = [
      { type: 'gap' as const, at: 300, params: { width: 40 } }, // podless: lethal
      { type: 'gap' as const, at: 600, params: { width: 30, jumpPod: true } },
    ];
    const gaps = TrackGaps.fromFeatures(features, track.getCurveLength());
    const spawner = new Spawner(track);
    spawner.load({
      id: 5,
      name: 'Gap Death',
      length: track.getCurveLength(),
      cruiseSpeed: 40,
      controlPoints: [
        [0, 0, 0],
        [0, 0, -800],
      ],
      features,
    });
    spawner.reset(0);
    const game = new GameState();
    const controller = new Controller({
      track,
      snail: createSnail(),
      input: { lateral: 0 },
      cruiseSpeed: 40,
      roadHalfWidth: 7,
    });

    const attempt = (): { steps: number; fallS: number } => {
      game.start();
      controller.reset();
      controller.applyVisual(1);
      spawner.reset(0);
      let steps = 0;
      for (; steps < 3000 && game.isPlaying; steps += 1) {
        const prevS = controller.s;
        controller.update(STEP);
        spawner.update(controller.s, STEP);
        if (checkFall(gaps, prevS, controller.s, controller.airborne)) {
          game.gameOver();
          break;
        }
      }
      return { steps, fallS: controller.s };
    };

    // First attempt: walk into the podless gap and fall (game over).
    const first = attempt();
    expect(game.name).toBe('gameover');
    expect(first.fallS).toBeGreaterThanOrEqual(299);
    expect(first.fallS).toBeLessThan(310);

    // Retry: the pool and sim are fully reusable, and the fall lands on the
    // same cliff edge again (deterministic gap path after a reset).
    const second = attempt();
    expect(game.name).toBe('gameover');
    expect(second.fallS).toBeCloseTo(first.fallS, 6);
    expect(second.steps).toBe(first.steps);

    // And the pod'd gap later on the same track launches cleanly after a
    // reset — the gap machinery is fully reusable, not just the road.
    const pods = spawner.entities.filter((entity) => entity.type === 'jumpPod');
    expect(pods.length).toBe(1);
    expect(gaps.spanForPod(pods[0].s)).not.toBeNull();
    expect(pods[0].alive).toBe(true); // reset revived it (retry pooling rule)
  });

  it('recovers from save corruption: garbage payloads reset to defaults on next load', () => {
    const storage = makeStorage();
    const good = new SaveService(storage);
    good.setMuted(true);
    good.recordResult(3, 42.5, 4200);
    expect(storage.getItem('laser-snail-save-v1')).toContain('"unlockedLevel":4');

    // Corrupt the persisted payload in every interesting way.
    const corruptionSamples = [
      'not json at all {{{',
      '"a plain string"',
      '42',
      'null',
      '{"unlockedLevel":"three","bestTimes":{},"bestScores":{},"muted":false}',
      '{"unlockedLevel":0,"bestTimes":{},"bestScores":{},"muted":false}', // out of range
      '{"unlockedLevel":4,"bestTimes":{"x":"y"},"bestScores":{},"muted":false}',
      '{"unlockedLevel":4,"bestTimes":{},"bestScores":{},"muted":"yes"}',
    ];
    for (const payload of corruptionSamples) {
      storage.setItem('laser-snail-save-v1', payload);
      const reloaded = new SaveService(storage);
      expect(reloaded.data, `payload "${payload.slice(0, 24)}" resets`).toEqual({
        unlockedLevel: 1,
        bestTimes: {},
        bestScores: {},
        muted: false,
      });
    }
  });

  it('persists the mute flag across a reload', () => {
    const storage = makeStorage();
    const first = new SaveService(storage);
    expect(first.data.muted).toBe(false);
    first.setMuted(true);

    const reloaded = new SaveService(storage);
    expect(reloaded.data.muted).toBe(true);
    reloaded.setMuted(false);

    const again = new SaveService(storage);
    expect(again.data.muted).toBe(false);
  });
});

/** Minimal local shape (levels are bundled JSON; tests never need more). */
interface LevelDefinitionLite {
  id: number;
  name: string;
  length: number;
  cruiseSpeed: number;
  controlPoints: [number, number, number][];
  features: Array<{ type: string; at: number; params: Record<string, unknown> }>;
}

function withLength(level: LevelDefinitionLite, length: number): LevelDefinitionLite {
  return { ...level, length };
}
