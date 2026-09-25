import { describe, expect, it } from 'vitest';

import { GameState } from '../src/core/GameState';
import type { LateralInput } from '../src/core/Input';
import { Controller } from '../src/player/Controller';
import { createSnail } from '../src/player/Snail';
import {
  checkFall,
  findHit,
  findRingPass,
  isContactType,
  isGroundHazard,
} from '../src/systems/Collision';
import { Health } from '../src/systems/Health';
import { Score } from '../src/systems/Score';
import { SpeedModifiers } from '../src/systems/SpeedMods';
import { Spawner } from '../src/systems/Spawner';
import { ProjectileSystem } from '../src/systems/Projectiles';
import { hazardPoints, passesThrough, WeaponLadder } from '../src/systems/Weapons';
import { TrackCurve } from '../src/track/TrackCurve';
import { POD_FLIGHT_TIME, POD_PEAK_HEIGHT, TrackGaps } from '../src/track/TrackGaps';
import type { LevelDefinition, LevelFeature } from '../src/track/LevelLoader';

/**
 * Headless vertical-slice smoke test: the exact main.ts wiring — fixed-step
 * Controller sim, Spawner streaming, (s, x) collision, Score/Health, FSM —
 * driven without a renderer. A run collects a package (score up), grabs a
 * heart (pip back), and dies on a slug (gameover state); a clean run
 * finishes and produces the exact design-spec total. Phase 3 adds the
 * combat wiring: fire → projectile kill → destruction score → white-ring
 * ladder-up → invincible slug pass-through.
 */

interface Harness {
  game: GameState;
  controller: Controller;
  spawner: Spawner;
  score: Score;
  health: Health;
  track: TrackCurve;
  length: number;
}

const STEP = 1 / 60;

function makeHarness(features: LevelFeature[], speedMods?: SpeedModifiers): Harness {
  const controlPoints: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, -600],
  ];
  const track = new TrackCurve(controlPoints);
  const length = track.getCurveLength();
  const level: LevelDefinition = {
    id: 1,
    name: 'Smoke Run',
    length,
    cruiseSpeed: 30,
    controlPoints,
    features,
  };

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

  return { game: new GameState(), controller, spawner, score: new Score(), health: new Health(), track, length };
}

/** Steps the core loop exactly the way main.ts does while playing. */
function stepRun(harness: Harness, onHit: (type: string) => void): void {
  const { controller, spawner } = harness;
  controller.update(STEP);
  spawner.update(controller.s, STEP);
  const hit = findHit(spawner.entities, controller.s, controller.x, undefined, undefined, isContactType);
  if (hit) onHit(hit.type);
}

describe('core loop smoke (headless vertical slice)', () => {
  it('collects a package for +100, restores a pip via heart, then dies on a slug', () => {
    const harness = makeHarness([
      { type: 'package', at: 100, params: { lane: 0 } },
      { type: 'heart', at: 150, params: { lane: 0 } },
      { type: 'slug', at: 300, params: { lane: 0 } },
    ]);
    const { game, score, health, controller } = harness;
    health.damage(1); // start hurt so the heart has something to restore

    game.start();
    let collected = 0;
    let heartTaken = false;
    let slugType = '';
    const dead = new Set<string>();

    for (let i = 0; i < 2000 && game.isPlaying; i += 1) {
      stepRun(harness, (type) => {
        if (type === 'package' && !dead.has('package-100')) {
          const entity = harness.spawner.entities.find((e) => e.type === 'package')!;
          harness.spawner.kill(entity);
          dead.add('package-100');
          score.collectPackage();
          collected += 1;
        } else if (type === 'heart' && !heartTaken) {
          const entity = harness.spawner.entities.find((e) => e.type === 'heart')!;
          harness.spawner.kill(entity);
          heartTaken = true;
          health.restore(1);
        } else if (type === 'slug') {
          slugType = type;
          game.gameOver();
        }
      });
    }

    // Package picked up exactly once (dead entity never re-hits), score +100.
    expect(collected).toBe(1);
    expect(score.packagePoints).toBe(100);
    // Heart restored the lost pip (capped at 3).
    expect(health.pips).toBe(3);
    // Slug contact ended the run in the gameover state.
    expect(slugType).toBe('slug');
    expect(game.name).toBe('gameover');
    // The slug sits at s=300; the snail never got past it.
    expect(controller.s).toBeLessThan(320);
  });

  it('finishes a clean run and produces the exact design-spec score', () => {
    const harness = makeHarness([{ type: 'package', at: 100, params: { lane: 0 } }]);
    const { game, score, health, controller } = harness;
    game.start();

    let finished = false;
    for (let i = 0; i < 3000 && game.isPlaying; i += 1) {
      stepRun(harness, (type) => {
        if (type === 'package') {
          const entity = harness.spawner.entities.find((e) => e.type === 'package')!;
          harness.spawner.kill(entity);
          score.collectPackage();
        }
      });
      if (controller.s >= harness.length) {
        game.complete();
        finished = true;
        break;
      }
    }

    expect(finished).toBe(true);
    expect(game.name).toBe('complete');
    expect(score.packageCount).toBe(1);

    // 1 package + finish bonus (1000 × level 1) + full health bonus (250 × 3):
    const breakdown = score.breakdown(1, health.pips);
    expect(breakdown.total).toBe(100 + 1000 + 750);
    expect(breakdown.total).toBe(1850);
  });

  it('retrying after death rebuilds the pool and keeps the loop runnable', () => {
    const harness = makeHarness([{ type: 'slug', at: 200, params: { lane: 0 } }]);
    const { game, controller, spawner } = harness;
    game.start();

    // Die.
    for (let i = 0; i < 2000 && game.isPlaying; i += 1) {
      stepRun(harness, () => game.gameOver());
    }
    expect(game.name).toBe('gameover');

    // Retry: pool revives, sim restarts from the line.
    game.start();
    controller.reset();
    controller.applyVisual(1);
    spawner.reset(0);
    expect(controller.s).toBe(0);
    expect(spawner.entities.every((entity) => entity.alive)).toBe(true);

    // The same slug kills again — the loop is fully reusable.
    for (let i = 0; i < 2000 && game.isPlaying; i += 1) {
      stepRun(harness, () => game.gameOver());
    }
    expect(game.name).toBe('gameover');
  });
});

describe('Phase 3 combat smoke (headless)', () => {
  interface CombatHarness extends Harness {
    weapons: WeaponLadder;
    speedMods: SpeedModifiers;
    projectiles: ProjectileSystem;
    fireCooldown: number;
  }

  function makeCombatHarness(features: LevelFeature[]): CombatHarness {
    const speedMods = new SpeedModifiers();
    const harness = makeHarness(features, speedMods);
    const projectiles = new ProjectileSystem(harness.track);
    return { ...harness, speedMods, projectiles, weapons: new WeaponLadder(), fireCooldown: 0 };
  }

  /** One combat sim step: the main.ts loop's playing/running branch, headless. */
  function stepCombat(combat: CombatHarness, fire: boolean): void {
    const { controller, spawner, projectiles, weapons, speedMods, game, score, health } = combat;
    const prevS = controller.s;
    controller.update(STEP);
    spawner.update(controller.s, STEP);

    // Held-fire cadence, gated by the tier cooldown (main.ts's tryFire).
    combat.fireCooldown -= STEP;
    if (fire && combat.fireCooldown <= 0) {
      const fired = projectiles.fire(weapons.tier, controller.s + 1.4, controller.x);
      if (fired > 0) combat.fireCooldown = weapons.tier.cooldown;
    }

    // Projectile-enemy contacts; the caller applies kills and score.
    const hits = projectiles.update(STEP, spawner.entities, controller.s);
    for (const { entity } of hits) {
      if (!entity.alive) continue;
      spawner.kill(entity);
      score.addBonus(hazardPoints(entity.type));
    }

    // Ring plane crossings.
    const ring = findRingPass(spawner.entities, prevS, controller.s, controller.x);
    if (ring) {
      spawner.kill(ring);
      if (ring.type === 'whiteRing') weapons.ladderUp();
    }

    // Circle contacts (rings excluded — pass-through events).
    const hit = findHit(spawner.entities, controller.s, controller.x, undefined, undefined, isContactType);
    if (hit) {
      if (hit.type === 'slug') {
        if (!passesThrough(hit, weapons.tier)) game.gameOver();
      } else if (hit.type === 'asteroid') {
        spawner.kill(hit);
        speedMods.apply('asteroid', 0.6, 2);
        health.damage(1); // mirror main.ts's crashIntoAsteroid
      } else if (hit.type === 'package') {
        spawner.kill(hit);
        score.collectPackage();
      }
    }
  }

  it('fires, destroys an asteroid for +150, ladders up via the white ring, then finishes', () => {
    const combat = makeCombatHarness([
      { type: 'asteroid', at: 200, params: { lane: 0 } },
      { type: 'whiteRing', at: 320, params: {} },
      { type: 'slug', at: 450, params: { lane: 0 } },
      { type: 'package', at: 520, params: { lane: 0 } },
    ]);
    const { game, controller, spawner, score, weapons, speedMods } = combat;
    game.start();

    let slowed = false;
    for (let i = 0; i < 3000 && game.isPlaying; i += 1) {
      stepCombat(combat, true);
      if (speedMods.multiplier !== 1) slowed = true;
      if (controller.s >= combat.length) {
        game.complete();
        break;
      }
    }

    // The cannon cleared the road before contact: never slowed, never hurt.
    expect(slowed).toBe(false);
    const asteroid = spawner.entities.find((entity) => entity.type === 'asteroid')!;
    expect(asteroid.alive).toBe(false);
    const slug = spawner.entities.find((entity) => entity.type === 'slug')!;
    expect(slug.alive).toBe(false);

    // White ring crossed → exactly one ladder rung (Single → Double).
    expect(weapons.tierIndex).toBe(1);
    expect(weapons.name).toBe('Double');

    // Destruction bonus: asteroid 150 + slug 100; package also collected.
    expect(score.bonus).toBe(250);
    expect(score.packageCount).toBe(1);
    expect(game.name).toBe('complete');
  });

  it('an asteroid that reaches Turbo costs a pip and slows the run for 2 s', () => {
    const combat = makeCombatHarness([
      { type: 'asteroid', at: 200, params: { lane: 0 } },
      { type: 'whiteRing', at: 500, params: {} },
    ]);
    const { game, controller, spawner, speedMods, health } = combat;
    game.start();

    let slowdownSteps = 0;
    for (let i = 0; i < 3000 && game.isPlaying; i += 1) {
      stepCombat(combat, false); // cannon silent: Turbo smashes through
      if (speedMods.multiplier < 1) slowdownSteps += 1;
      if (controller.s >= combat.length) {
        game.complete();
        break;
      }
    }

    const asteroid = spawner.entities.find((entity) => entity.type === 'asteroid')!;
    expect(asteroid.alive).toBe(false); // smashed through, not dodged (straight line)
    expect(health.pips).toBe(2); // one pip of contact damage
    // −40% for 2 s ≈ 120 steps at 60 Hz (±1 frame of float boundary noise).
    expect(slowdownSteps).toBeGreaterThanOrEqual(120);
    expect(slowdownSteps).toBeLessThanOrEqual(122);
    expect(speedMods.multiplier).toBe(1); // restored to cruise afterwards
    expect(game.name).toBe('complete');
  });

  it('at the top tier slugs pass through harmlessly', () => {
    const combat = makeCombatHarness([{ type: 'slug', at: 300, params: { lane: 0 } }]);
    const { game, controller, weapons } = combat;
    game.start();

    for (let i = 0; i < 6; i += 1) weapons.ladderUp();
    expect(weapons.isInvincible()).toBe(true);

    for (let i = 0; i < 1200 && game.isPlaying; i += 1) {
      stepCombat(combat, false);
    }

    // Straight through the slug's lane — no knock-off, the run continues.
    expect(game.name).toBe('playing');
    expect(controller.s).toBeGreaterThan(340);
  });
});

describe('Phase 4 gap smoke (headless): pods carry, gaps kill, arcs fly clean', () => {
  interface GapHarness {
    game: GameState;
    controller: Controller;
    spawner: Spawner;
    gaps: TrackGaps;
    speedMods: SpeedModifiers;
    score: Score;
    health: Health;
    track: TrackCurve;
    length: number;
    launchCount: number;
    landings: number;
  }

  const GAP_STEP = 1 / 60;

  /** Harness mirrors makeHarness but with cruise 40 so pod arcs clear gaps. */
  function makeGapHarness(features: LevelFeature[]): GapHarness {
    const controlPoints: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, -800],
    ];
    const track = new TrackCurve(controlPoints);
    const length = track.getCurveLength();
    const level: LevelDefinition = {
      id: 5,
      name: 'Gap Smoke',
      length,
      cruiseSpeed: 40,
      controlPoints,
      features,
    };
    const input: LateralInput = { lateral: 0 };
    const speedMods = new SpeedModifiers();
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
    const gaps = TrackGaps.fromFeatures(level.features, level.length);
    return {
      game: new GameState(),
      controller,
      spawner,
      gaps,
      speedMods,
      score: new Score(),
      health: new Health(),
      track,
      length,
      launchCount: 0,
      landings: 0,
    };
  }

  /** One gap-sim step: exactly main.ts's playing/running branch, headless. */
  function stepGap(harness: GapHarness): void {
    const { controller, spawner, gaps, speedMods, game } = harness;
    const prevS = controller.s;
    const wasAirborne = controller.airborne;
    controller.update(GAP_STEP);
    spawner.update(controller.s, GAP_STEP);

    // Pass-through crossings first — pods launch here (main.ts's handleRingPass).
    const ring = findRingPass(spawner.entities, prevS, controller.s, controller.x);
    if (ring) {
      spawner.kill(ring);
      if (ring.type === 'jumpPod') {
        const span = gaps.spanForPod(ring.s);
        if (span && controller.launch({ duration: POD_FLIGHT_TIME, peakHeight: POD_PEAK_HEIGHT })) {
          harness.launchCount += 1;
        }
      } else if (ring.type === 'redRing') {
        speedMods.apply('redRing', 0.4, 3);
      }
    }

    // Gap fall (grounded over open air), then contacts with airborne immunity.
    if (checkFall(gaps, prevS, controller.s, controller.airborne)) {
      if (game.isPlaying) game.gameOver(); // beginKnockoff → gameover
    } else {
      // Ground hazards (slugs/asteroids) are dropped mid-flight; pickups stay
      // live — main.ts's handleHit, headless: packages score, hearts heal,
      // slugs knock off, asteroids crash (slow + 1 pip).
      const hit = findHit(
        spawner.entities,
        controller.s,
        controller.x,
        undefined,
        undefined,
        (entity) => isContactType(entity) && !(controller.airborne && isGroundHazard(entity)),
      );
      if (hit) {
        if (hit.type === 'package') {
          spawner.kill(hit);
          harness.score.collectPackage();
        } else if (hit.type === 'heart') {
          spawner.kill(hit);
          harness.health.restore(1);
        } else if (hit.type === 'slug') {
          if (game.isPlaying) game.gameOver(); // beginKnockoff → gameover
        } else if (hit.type === 'asteroid') {
          spawner.kill(hit);
          speedMods.apply('asteroid', 0.6, 2);
          harness.health.damage(1);
          if (harness.health.isDepleted && game.isPlaying) game.gameOver();
        }
      }
    }

    if (wasAirborne && !controller.airborne) harness.landings += 1;
  }

  it('a pod launch arcs over the gap: lands past the far edge, run continues', () => {
    const harness = makeGapHarness([
      { type: 'gap', at: 300, params: { width: 30, jumpPod: true } },
      { type: 'package', at: 330, params: { lane: 0 } }, // past the far edge
    ]);
    const { game, controller } = harness;
    game.start();

    for (let i = 0; i < 2000 && game.isPlaying; i += 1) stepGap(harness);

    expect(harness.launchCount).toBe(1);
    expect(harness.landings).toBeGreaterThanOrEqual(1);
    // Cruise 40 × 1.4 s = 56 units from the pod at 298 → lands at ~354,
    // clearing the 330-wide far edge (300 + 30) with margin.
    expect(controller.s).toBeGreaterThan(332);
    // The package past the far edge was collected mid-flight — pickups stay
    // live while airborne (spec: the arc gathers packages and rings).
    expect(harness.score.packagePoints).toBe(100);
    expect(game.name).toBe('playing'); // never fell, finished the straight
  });

  it('a gap without pod coverage drops a grounded Turbo into game over', () => {
    const harness = makeGapHarness([{ type: 'gap', at: 300, params: { width: 40 } }]);
    const { game, controller } = harness;
    game.start();

    for (let i = 0; i < 2000 && game.isPlaying; i += 1) stepGap(harness);

    expect(game.name).toBe('gameover');
    // Died right at the cliff edge — never crossed the open air.
    expect(controller.s).toBeGreaterThanOrEqual(299);
    expect(controller.s).toBeLessThan(305);
  });

  it('mid-flight Turbo is immune to ground hazards but still collects packages', () => {
    const harness = makeGapHarness([
      { type: 'gap', at: 300, params: { width: 30, jumpPod: true } },
      // Both float over the open air of the gap: lethal on the ground,
      // harmless (slug) while flying the arc.
      { type: 'slug', at: 315, params: { lane: 0 } },
    ]);
    const { game, controller, spawner, score } = harness;
    game.start();

    for (let i = 0; i < 2000 && game.isPlaying; i += 1) stepGap(harness);

    expect(harness.launchCount).toBe(1);
    expect(game.name).toBe('playing'); // the slug under the arc never touched
    const slug = spawner.entities.find((entity) => entity.type === 'slug')!;
    expect(slug.alive).toBe(true); // untouched — flown over, not destroyed
    expect(controller.s).toBeGreaterThan(340);
    expect(score.packagePoints).toBe(0);
  });

  it('the red trap ring slows the run for 3 s and restores cruise afterwards', () => {
    const harness = makeGapHarness([{ type: 'redRing', at: 200, params: { lane: 3.5 } }]);
    // Drive straight through the ring's coverage (lane 3.5, radius 4.2).
    const inputOverride: LateralInput = { lateral: 0 };
    harness.controller['input' as keyof Controller] as unknown; // typing guard only
    void inputOverride;
    const { game, controller, speedMods } = harness;
    game.start();

    let slowedSteps = 0;
    for (let i = 0; i < 1200 && game.isPlaying; i += 1) {
      stepGap(harness);
      if (speedMods.isActive('redRing')) slowedSteps += 1;
    }

    expect(slowedSteps).toBeGreaterThanOrEqual(179); // ~3 s at 60 Hz
    expect(slowedSteps).toBeLessThanOrEqual(182);
    expect(speedMods.multiplier).toBe(1);
    expect(game.name).toBe('playing');
    expect(controller.s).toBeGreaterThan(200);
  });
});
