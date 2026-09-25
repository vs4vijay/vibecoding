import { describe, expect, it } from 'vitest';

import type { LateralInput } from '../src/core/Input';
import { Controller } from '../src/player/Controller';
import { createSnail } from '../src/player/Snail';
import { checkFall, findHit, findRingPass, isContactType } from '../src/systems/Collision';
import { ParticleSystem } from '../src/systems/Particles';
import { ProjectileSystem } from '../src/systems/Projectiles';
import { WeaponLadder } from '../src/systems/Weapons';
import { expandFeature, Spawner } from '../src/systems/Spawner';
import { TrackCurve } from '../src/track/TrackCurve';
import { POD_FLIGHT_TIME, POD_PEAK_HEIGHT, TrackGaps } from '../src/track/TrackGaps';
import { loadBundledLevels, type LevelDefinition } from '../src/track/LevelLoader';

/**
 * Performance smoke (Phase 6): step the exact main.ts playing-branch wiring
 * headlessly through the whole gauntlet of level 10 with the pools fully
 * engaged — held fire (projectiles in flight), particle bursts on every
 * impact, spawner window streaming — and assert:
 *
 *  1. Wall-clock sim cost stays far under budget per fixed step (catches
 *     gross regressions like unbounded O(n) scans; calibrated generously
 *     so CI scheduling jitter can never flake it).
 *  2. The active-entity window stays within the streaming budget no matter
 *     where in the level the player is (frame time stays flat L1 → L10).
 *  3. Every pool stays bounded — no hidden growth, no per-event allocation
 *     footprint creeping into the steady state.
 *
 * These are structural assertions, not microbenchmarks: the point is that a
 * regression large enough for a player to feel cannot slip past them.
 */

const STEP = 1 / 60;
/** Generous average per-step sim budget, in ms (typical headless cost: < 0.1). */
const AVG_STEP_BUDGET_MS = 2;
/** Hard spike budget for any single step — a pathological O(level) scan would blow through this. */
const MAX_STEP_BUDGET_MS = 50;
/** Entity streaming budget: max simultaneous active entities on any level. */
const ENTITY_WINDOW_BUDGET = 60;

/**
 * One sim step mirroring main.ts's `playing`/`running` branch (plus its
 * always-alive `particles.update`): controller, spawner stream, held-fire
 * cadence, projectile hits (kills + bursts), ring crossings (pods launch),
 * gap falls, contacts.
 */
function stepLevel10(
  track: TrackCurve,
  controller: Controller,
  spawner: Spawner,
  gaps: TrackGaps,
  projectiles: ProjectileSystem,
  weapons: WeaponLadder,
  particles: ParticleSystem,
  fireCooldownRef: { value: number },
): void {
  particles.update(STEP); // main.ts's always-alive branch (debris settles in every state)
  const prevS = controller.s;
  controller.update(STEP);
  spawner.update(controller.s, STEP);

  fireCooldownRef.value -= STEP;
  if (fireCooldownRef.value <= 0) {
    const fired = projectiles.fire(weapons.tier, controller.s + 1.4, controller.x);
    if (fired > 0) fireCooldownRef.value = weapons.tier.cooldown;
  }

  const hits = projectiles.update(STEP, spawner.entities, controller.s);
  for (const { entity } of hits) {
    if (!entity.alive) continue;
    spawner.kill(entity);
    particles.burst(track, entity.s, entity.x, { count: 12, color: 0xff5fd8, life: 0.6, speed: 8 });
  }

  const ring = findRingPass(spawner.entities, prevS, controller.s, controller.x);
  if (ring) {
    spawner.kill(ring);
    if (ring.type === 'jumpPod') {
      const span = gaps.spanForPod(ring.s);
      if (span) controller.launch({ duration: POD_FLIGHT_TIME, peakHeight: POD_PEAK_HEIGHT });
    }
  }

  if (checkFall(gaps, prevS, controller.s, controller.airborne)) return;

  const hit = findHit(
    spawner.entities,
    controller.s,
    controller.x,
    undefined,
    undefined,
    (entity) => isContactType(entity) && entity.type !== 'slug', // never die: keep the sweep running
  );
  if (hit) {
    // main.ts's handleHit side effects: pickups pop with a particle burst.
    if (hit.type === 'asteroid' || hit.type === 'package' || hit.type === 'heart') {
      spawner.kill(hit);
      particles.burst(track, hit.s, hit.x, {
        count: hit.type === 'asteroid' ? 16 : 8,
        color: hit.type === 'asteroid' ? 0xff5fd8 : 0x6df2ff,
        life: 0.65,
        speed: 8,
      });
    }
  }
}

describe('performance smoke (headless, level 10 gauntlet)', () => {
  it(
    'keeps the fixed step cheap, the entity window inside budget, and every pool bounded',
    { timeout: 120_000 },
    () => {
      const levels = [...loadBundledLevels().values()].sort((a, b) => a.id - b.id);
      const level: LevelDefinition = levels[levels.length - 1]; // level 10 — the densest
      expect(level.id).toBe(10);

      const track = new TrackCurve(level.controlPoints, { expectedLength: level.length });
      const gaps = TrackGaps.fromFeatures(level.features, level.length);
      const input: LateralInput = { lateral: 0 };
      const controller = new Controller({
        track,
        snail: createSnail(),
        input,
        cruiseSpeed: level.cruiseSpeed,
        roadHalfWidth: 7,
      });
      const spawner = new Spawner(track);
      spawner.load(level);
      spawner.reset(0);
      const projectiles = new ProjectileSystem(track);
      const weapons = new WeaponLadder();
      const particles = new ParticleSystem();
      const fireCooldown = { value: 0 };

      // Budget: straight cruise time + 60% slack (speed mods) + padding — the
      // sweep covers the whole level, not just its opening stretch.
      const maxSteps = Math.ceil((track.getCurveLength() / level.cruiseSpeed) * 60 * 1.6) + 600;
      let totalTimeMs = 0;
      let steps = 0;
      const stepTimesMs: number[] = [];
      let maxActiveEntities = 0;
      let maxProjectiles = 0;
      let maxParticles = 0;

      // JIT warmup, excluded from the measurement: the first ~2 sim-seconds
      // pay one-time optimization costs that would otherwise dominate the
      // worst-step statistic.
      for (let i = 0; i < 120 && controller.s < track.getCurveLength(); i += 1) {
        stepLevel10(track, controller, spawner, gaps, projectiles, weapons, particles, fireCooldown);
      }

      for (let i = 0; i < maxSteps && controller.s < track.getCurveLength(); i += 1) {
        const start = performance.now();
        stepLevel10(track, controller, spawner, gaps, projectiles, weapons, particles, fireCooldown);
        const elapsedMs = performance.now() - start;

        totalTimeMs += elapsedMs;
        steps += 1;
        stepTimesMs.push(elapsedMs);
        maxActiveEntities = Math.max(maxActiveEntities, spawner.activeCount);
        maxProjectiles = Math.max(maxProjectiles, projectiles.activeCount);
        maxParticles = Math.max(maxParticles, particles.activeCount);
      }

      // 1. Frame-time stability: the average sim step must be far inside
      //    budget (generously calibrated — this only fails on gross
      //    regressions like unbounded entity scans per step).
      const avgStepMs = totalTimeMs / maxSteps;
      // p99 rather than max: a shared/hosted test machine periodically
      // preempts the process for 100+ ms regardless of what the sim does,
      // so a raw max assertion is flaky by construction. Real regressions
      // (O(n) scans, lost pooling) inflate the whole distribution and show
      // up in p99; OS jitter lands in <1% of steps and washes out.
      stepTimesMs.sort((a, b) => a - b);
      const p99StepMs = stepTimesMs[Math.min(stepTimesMs.length - 1, Math.floor(stepTimesMs.length * 0.99))];
      const worstStepMs = stepTimesMs[stepTimesMs.length - 1];
      // Logged so a human can watch the trend across runs/refactors.
      console.log(
        `[perf] L10 sweep: ${steps} steps, avg ${(totalTimeMs / steps).toFixed(3)} ms/step, ` +
          `p99 ${p99StepMs.toFixed(2)} ms, worst ${worstStepMs.toFixed(2)} ms, ` +
          `max active entities ${maxActiveEntities}, ` +
          `max projectiles ${maxProjectiles}, max particles ${maxParticles}`,
      );
      expect(avgStepMs, `avg sim step ${avgStepMs.toFixed(3)} ms`).toBeLessThan(AVG_STEP_BUDGET_MS);
      expect(p99StepMs, `p99 sim step ${p99StepMs.toFixed(3)} ms`).toBeLessThan(MAX_STEP_BUDGET_MS);
      // Catastrophic-only sanity net: catches "one step effectively hung"
      // (e.g. an accidental unbounded loop) without flaking on scheduler
      // preemption, which tops out around ~300 ms here.
      expect(worstStepMs, `worst sim step ${worstStepMs.toFixed(3)} ms`).toBeLessThan(1000);

      // 2. Entity streaming budget holds through the whole level: the active
      //    window never balloons (flat frame time L1 → L10).
      expect(maxActiveEntities, `max active entities ${maxActiveEntities}`).toBeLessThanOrEqual(ENTITY_WINDOW_BUDGET);

      // 3. Pools are hard-bounded: projectiles recycle within the fixed pool,
      //    particles within the fixed buffer, and the entity list itself never
      //    grows after load (no per-event record allocation).
      expect(maxProjectiles).toBeLessThanOrEqual(48);
      expect(maxParticles).toBeLessThanOrEqual(320);
      // The roster is pooled exactly once from the level features and reused
      // forever — no record growth during play.
      const expectedRoster = level.features.reduce(
        (sum, feature) => sum + (expandFeature(feature, level.length)?.length ?? 0),
        0,
      );
      expect(spawner.entityCount).toBe(expectedRoster);
      expect(controller.s).toBeGreaterThan(0); // the sweep actually moved
    },
  );

  it('keeps every level 1–10 inside the entity window budget over a full cruise', () => {
    const levels = [...loadBundledLevels().values()].sort((a, b) => a.id - b.id);
    expect(levels).toHaveLength(10);

    for (const level of levels) {
      const track = new TrackCurve(level.controlPoints, { expectedLength: level.length });
      const spawner = new Spawner(track);
      spawner.load(level);
      spawner.reset(0);

      let maxActive = 0;
      // Coarse sweep: 6 Hz sampling of the window over the whole level is
      // plenty to catch any window bulge (the window moves smoothly).
      const coarseStep = STEP * 10;
      for (let s = 0; s <= track.getCurveLength(); s += level.cruiseSpeed * coarseStep) {
        spawner.update(s, 0);
        maxActive = Math.max(maxActive, spawner.activeCount);
      }

      expect(
        maxActive,
        `level ${level.id} (${level.name}) peaks at ${maxActive} active entities`,
      ).toBeLessThanOrEqual(ENTITY_WINDOW_BUDGET);
    }
  });
});
