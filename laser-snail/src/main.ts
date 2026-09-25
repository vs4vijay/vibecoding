import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { Sfx } from './audio/Sfx';
import { GameState, type GameStateName } from './core/GameState';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { SaveService } from './core/Save';
import type { Entity } from './entities/Entity';
import {
  checkFall,
  findHit,
  findRingPass,
  isContactType,
  isGroundHazard,
  PLAYER_RADIUS,
} from './systems/Collision';
import { ParticleSystem } from './systems/Particles';
import { ProjectileSystem, type ProjectileHit } from './systems/Projectiles';
import { Health, MAX_PIPS } from './systems/Health';
import { Score } from './systems/Score';
import { SpeedModifiers } from './systems/SpeedMods';
import { Spawner } from './systems/Spawner';
import {
  bombTargets,
  hazardPoints,
  passesThrough,
  WeaponLadder,
  BOMB_WINDOW,
} from './systems/Weapons';
import { Controller } from './player/Controller';
import { ChaseCamera, type ChaseTarget } from './player/ChaseCamera';
import { createSnail } from './player/Snail';
import { SpeedTrail } from './player/SpeedTrail';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, TONE_MAPPING_EXPOSURE } from './render/tuning';
import { loadBundledLevels, type LevelDefinition } from './track/LevelLoader';
import { TrackCurve } from './track/TrackCurve';
import { TrackGaps, POD_FLIGHT_TIME, POD_PEAK_HEIGHT } from './track/TrackGaps';
import { createTrackMesh, type TrackMesh } from './track/TrackMesh';
import { HUD } from './ui/HUD';
import { Screens, type ResultsData } from './ui/Screens';
import {
  buildLevelSelectEntries,
  clampSelection,
  defaultSelectionIndex,
  moveSelection,
  selectableEntryAt,
  type LevelSelectEntry,
} from './ui/LevelSelectModel';
import { countLevelPackages, medalFor, medalPoints, parSeconds } from './systems/Medal';
import { createLighting } from './world/Lighting';
import { createStarfield } from './world/Starfield';

const BACKGROUND_COLOR = 0x05060f;
const FOG_DENSITY = 0.0045;
const MAX_PIXEL_RATIO = 2;
const ROAD_HALF_WIDTH = 7;
/** Knock-off animation length (slug contact → game-over screen). */
const KNOCKOFF_DURATION = 0.9;
/** Asteroid contact: −40% speed for 2 s (spec 3.2), applied via speed mods. */
const ASTEROID_SLOW_MULTIPLIER = 0.6;
const ASTEROID_SLOW_DURATION = 2;
/** Red-ring trap: −60% speed for 3 s (spec 3.2) — brutal right before a gap. */
const RED_RING_MULTIPLIER = 0.4;
const RED_RING_DURATION = 3;
/** Projectiles spawn this far ahead of Turbo's center (the shell's bore). */
const FIRE_ORIGIN_AHEAD = 1.4;
/** Speed-trail ramp: full ribbon at cruise, dead below 90% of cruise. */
const TRAIL_RAMP_START = 0.9;

/** Everything that exists per level: curve, road, gaps, entities, player sim. */
interface LevelWorld {
  readonly definition: LevelDefinition;
  readonly track: TrackCurve;
  readonly mesh: TrackMesh;
  readonly gaps: TrackGaps;
  readonly spawner: Spawner;
  readonly projectiles: ProjectileSystem;
  readonly controller: Controller;
  readonly length: number;
}

type RunPhase = 'running' | 'knockoff';
/** Why the run ended visually: a slug fling or a drop through a gap. */
type KnockoffKind = 'hit' | 'fall';

function bootstrap(): void {
  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) throw new Error('#app container missing from index.html');

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    container.innerHTML = `
      <div class="webgl-fallback">
        <h1>LASER SNAIL</h1>
        <p>This browser can't create a WebGL context, which the neon highway needs.</p>
        <p>Try a current version of Chrome, Firefox, Edge, or Safari with hardware acceleration enabled.</p>
      </div>`;
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);
  scene.fog = new THREE.FogExp2(BACKGROUND_COLOR, FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);

  // Neon look: scene → bloom → output pass (applies tone mapping + color space).
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: 4, // MSAA in the composer's offscreen target
    }),
  );
  composer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    ),
  );
  composer.addPass(new OutputPass());

  scene.add(createLighting());
  const starfield = createStarfield();
  scene.add(starfield.points);

  // -- Services: save (mute persists from first boot), synth SFX, input. -----
  const save = new SaveService();
  const sfx = new Sfx();
  sfx.setMuted(save.data.muted);
  const input = new Input();

  // -- Campaign: every bundled level, sorted by id; start at the save's unlock. --
  const levels = [...loadBundledLevels().values()].sort((a, b) => a.id - b.id);
  let currentLevelIndex = 0;
  let currentLevel = levels[0];
  // Level-select cursor: points at the save's newest unlock whenever the
  // screen opens, then follows the keyboard (up/down) and mouse clicks.
  let levelSelectIndex = 0;
  let levelSelectEntries: LevelSelectEntry[] = [];

  const snail = createSnail();
  scene.add(snail.group);
  const chaseCamera = new ChaseCamera(camera);
  const hud = new HUD();
  const screens = new Screens();
  const game = new GameState();

  const score = new Score();
  const health = new Health();
  // Mouse path into a level: clicking an unlocked row selects and starts it
  // directly (the row swallows the pointer event, so no confirm edge leaks).
  screens.onLevelClick = (levelId) => {
    if (game.name !== 'levelSelect') return; // ignore stray clicks during the fade-out
    const index = levelSelectEntries.findIndex((entry) => entry.id === levelId);
    if (index < 0) return;
    levelSelectIndex = index;
    sfx.resume();
    startSelectedLevel();
  };
  // Phase 3 combat state: the ladder, the timed speed mods (wired through the
  // Controller), the pooled particles, and per-run fire cadence. Phase 4 adds
  // the speed trail riding the shell's jetpack wake.
  const weapons = new WeaponLadder();
  const speedMods = new SpeedModifiers();
  const particles = new ParticleSystem();
  scene.add(particles.points);
  const trail = new SpeedTrail();
  scene.add(trail.mesh);
  let runTime = 0;
  let runPhase: RunPhase = 'running';
  let fireCooldown = 0;
  /** Previous sim-step s, for the ring plane-crossing check. */
  let prevPlayerS = 0;

  // -- Knock-off animation state (slug contact / gap fall): tumble ~0.9 s. ---
  const knockoffBasePosition = new THREE.Vector3();
  const knockoffBaseQuaternion = new THREE.Quaternion();
  const knockoffSpinQuat = new THREE.Quaternion();
  const knockoffRight = new THREE.Vector3();
  const LOCAL_UP = new THREE.Vector3(0, 1, 0);
  const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
  let knockoffKind: KnockoffKind = 'hit';
  let knockoffTimer = 0;
  let knockoffSpin = 0;
  let knockoffFallVelocity = 0;
  let knockoffFall = 0;
  let knockoffDrift = 0;

  // Reused every frame: vector fields are stable references into the
  // controller, only the scalars get refreshed — zero render-loop allocation.
  const chaseTarget: ChaseTarget = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    x: 0,
    steering: 0,
    speedRatio: 1,
  };
  const refreshChaseTarget = (world: LevelWorld): ChaseTarget => {
    // Follow the *rendered* snail transform: the Controller's applyVisual
    // pose while running (which already carries the jump-arc lift and pitch),
    // and the knock-off/fall tumble once the sim has ended — so the camera
    // rides the drop into a chasm before the game-over screen.
    chaseTarget.position.copy(snail.group.position);
    chaseTarget.quaternion.copy(snail.group.quaternion);
    chaseTarget.x = world.controller.x;
    chaseTarget.steering = world.controller.smoothedSteering;
    chaseTarget.speedRatio = world.definition.cruiseSpeed > 0
      ? world.controller.speed / world.definition.cruiseSpeed
      : 1;
    return chaseTarget;
  };

  // -- Level construction / teardown. -----------------------------------------

  function buildLevel(definition: LevelDefinition): LevelWorld {
    const track = new TrackCurve(definition.controlPoints, { expectedLength: definition.length });
    // The gaps are the single source of truth: the same spans punch the mesh
    // holes, drive the fall check, and pair with jump-pod launches.
    const gaps = TrackGaps.fromFeatures(definition.features, definition.length);
    const mesh = createTrackMesh(track, { halfWidth: ROAD_HALF_WIDTH, gaps: gaps.spans });
    const spawner = new Spawner(track);
    spawner.load(definition);
    const projectiles = new ProjectileSystem(track);
    const controller = new Controller({
      track,
      snail,
      input,
      cruiseSpeed: definition.cruiseSpeed,
      roadHalfWidth: ROAD_HALF_WIDTH,
      speedModifiers: speedMods,
    });
    const world: LevelWorld = {
      definition,
      track,
      mesh,
      gaps,
      spawner,
      projectiles,
      controller,
      length: track.getCurveLength(),
    };
    scene.add(mesh.group, spawner.group, projectiles.group);
    return world;
  }

  function disposeWorld(world: LevelWorld): void {
    scene.remove(world.mesh.group, world.spawner.group, world.projectiles.group);
    // Track geometry is unique per build; entity visuals share module-level
    // singletons (never disposed). Materials here are few and per-build.
    world.mesh.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }

  // -- Run lifecycle. -----------------------------------------------------------

  let world: LevelWorld = buildLevel(currentLevel);

  /** Restarts the current level from the start line: sim, pool, HUD. */
  function resetRun(): void {
    world.controller.reset();
    world.controller.applyVisual(1);
    chaseCamera.snap(refreshChaseTarget(world));
    world.spawner.reset(0);
    world.projectiles.clear();
    particles.clear();
    trail.clear();
    score.reset();
    health.reset();
    weapons.reset();
    speedMods.clear();
    runTime = 0;
    runPhase = 'running';
    fireCooldown = 0;
    prevPlayerS = 0;
    knockoffTimer = 0;
    knockoffSpin = 0;
    knockoffFall = 0;
    knockoffFallVelocity = 0;
    knockoffDrift = 0;
    hud.setScore(runScore());
    hud.setPips(MAX_PIPS);
    hud.setProgress(0, world.length);
    hud.setWeapon(weapons.name, { invincible: weapons.isInvincible() });
    hud.setDanger(false);
  }

  /** The HUD score line: packages + destruction bonus. */
  function runScore(): number {
    return score.packagePoints + score.bonus;
  }

  /** Ensures the right level is built, then starts a run (menu / retry / next). */
  function startRun(): void {
    if (world.definition.id !== currentLevel.id) {
      disposeWorld(world);
      world = buildLevel(currentLevel);
    }
    resetRun();
    game.start();
  }

  /** Level select → race: only callable for an unlocked level (guarded below). */
  function startSelectedLevel(): void {
    const entry = selectableEntryAt(levelSelectEntries, levelSelectIndex);
    if (!entry) return; // locked row — never start an unearned level
    const index = levels.findIndex((level) => level.id === entry.id);
    if (index < 0) return;
    currentLevelIndex = index;
    currentLevel = levels[index];
    startRun();
  }

  /** Index of the level the save lets the player start (id may exceed the bundle). */
  function indexOfUnlocked(): number {
    const unlockedId = Math.min(save.data.unlockedLevel, levels[levels.length - 1].id);
    const exact = levels.findIndex((level) => level.id === unlockedId);
    if (exact >= 0) return exact;
    let nearest = 0;
    for (let i = 0; i < levels.length; i += 1) {
      if (levels[i].id <= unlockedId) nearest = i;
    }
    return nearest;
  }

  /** Quits to the menu, pointing it at the save's current unlock. */
  function enterMenu(): void {
    currentLevelIndex = indexOfUnlocked();
    currentLevel = levels[currentLevelIndex];
    game.toMenu(); // onChange('menu') rebuilds + shows the menu screen
  }

  /** results → next level, or back to the menu after the last one. */
  function advanceAfterComplete(): void {
    if (currentLevelIndex + 1 < levels.length) {
      currentLevelIndex += 1;
      currentLevel = levels[currentLevelIndex];
      startRun();
    } else {
      enterMenu();
    }
  }

  // -- Gameplay events. ---------------------------------------------------------

  function handleHit(entity: Entity): void {
    switch (entity.type) {
      case 'package': {
        world.spawner.kill(entity);
        score.collectPackage();
        hud.setScore(runScore(), true); // pulse — feedback well under 100 ms
        entity.visual?.pop?.();
        particles.burst(world.track, entity.s, entity.x, { count: 8, color: 0x6df2ff, life: 0.45, speed: 5 });
        sfx.pickup();
        break;
      }
      case 'heart': {
        world.spawner.kill(entity);
        const restored = health.restore(1);
        if (restored > 0) hud.setPips(health.pips, health.pips - 1);
        entity.visual?.pop?.();
        sfx.heart();
        break;
      }
      case 'slug': {
        // Top-tier invincibility: slugs phase past harmlessly (spec section 4).
        if (passesThrough(entity, weapons.tier)) {
          entity.visual?.pop?.();
          particles.burst(world.track, entity.s, entity.x, { count: 6, color: 0xfff3b0, life: 0.35, speed: 4 });
          break;
        }
        beginKnockoff();
        break;
      }
      case 'asteroid': {
        crashIntoAsteroid(entity);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Asteroid contact: Turbo smashes through — the rock shatters, Turbo loses
   * a pip and crawls at −40% speed for 2 s (the FOV dip sells the slowdown),
   * and the camera takes a small hit shake.
   */
  function crashIntoAsteroid(entity: Entity): void {
    world.spawner.kill(entity);
    speedMods.apply('asteroid', ASTEROID_SLOW_MULTIPLIER, ASTEROID_SLOW_DURATION);
    particles.burst(world.track, entity.s, entity.x, { count: 18, color: 0xff5fd8, life: 0.7, speed: 9 });
    particles.burst(world.track, entity.s, entity.x, { count: 8, color: 0x8a7aa8, life: 0.9, speed: 5, hover: 1.6 });
    health.damage(1);
    hud.setPips(health.pips);
    hud.flashDamage();
    sfx.explosion();
    sfx.damage();
    chaseCamera.shake(0.45);
    if (health.isDepleted) beginKnockoff();
  }

  /** Projectile-enemy contacts from the pool system: destroy + score. */
  function handleProjectileHits(hits: readonly ProjectileHit[]): void {
    for (const { entity } of hits) {
      if (!entity.alive) continue;
      world.spawner.kill(entity);
      const points = hazardPoints(entity.type);
      score.addBonus(points);
      hud.setScore(runScore(), true);
      particles.burst(world.track, entity.s, entity.x, {
        count: entity.type === 'asteroid' ? 16 : 10,
        color: entity.type === 'asteroid' ? 0xff5fd8 : 0xff8ae0,
        life: 0.65,
        speed: 8,
      });
      sfx.explosion();
      chaseCamera.shake(entity.type === 'asteroid' ? 0.22 : 0.12);
    }
  }

  /** Pass-through s-plane crossings this step: rings, the trap, jump pods. */
  function handleRingPass(entity: Entity): void {
    world.spawner.kill(entity);
    entity.visual?.pop?.();
    switch (entity.type) {
      case 'whiteRing': {
        if (weapons.ladderUp()) {
          hud.setWeapon(weapons.name, { flash: true, invincible: weapons.isInvincible() });
          sfx.ladderUp();
          chaseCamera.shake(0.1);
        }
        particles.burst(world.track, entity.s, world.controller.x, { count: 10, color: 0xffffff, life: 0.5, speed: 6 });
        break;
      }
      case 'yellowRing': {
        detonateSmartBomb();
        break;
      }
      case 'redRing': {
        // The trap: instant alarm + red vignette + heavy speed cut. The FOV
        // squeeze comes free through the camera's speed-ratio dip.
        speedMods.apply('redRing', RED_RING_MULTIPLIER, RED_RING_DURATION);
        sfx.alarm();
        hud.setDanger(true);
        chaseCamera.shake(0.35);
        particles.burst(world.track, entity.s, entity.x, { count: 12, color: 0xff2a54, life: 0.6, speed: 7 });
        break;
      }
      case 'jumpPod': {
        // Launch over the gap the pod precedes. launch() no-ops mid-flight,
        // so a stray pod can never chain-launch an airborne snail.
        const span = world.gaps.spanForPod(entity.s);
        if (span && world.controller.launch({ duration: POD_FLIGHT_TIME, peakHeight: POD_PEAK_HEIGHT })) {
          snail.stretch(1);
          sfx.whoosh();
          chaseCamera.shake(0.08);
          particles.burst(world.track, entity.s, entity.x, {
            count: 10,
            color: 0x6df2ff,
            life: 0.4,
            speed: 5,
            upBias: 1,
            hover: 0.4,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /** Yellow ring: destroy every destructible enemy within the bomb window. */
  function detonateSmartBomb(): void {
    const targets = bombTargets(world.spawner.entities, world.controller.s, BOMB_WINDOW);
    for (const target of targets) {
      world.spawner.kill(target);
      score.addBonus(hazardPoints(target.type));
      particles.burst(world.track, target.s, target.x, {
        count: target.type === 'asteroid' ? 16 : 10,
        color: 0xffe066,
        life: 0.8,
        speed: 10,
      });
    }
    if (targets.length > 0) hud.setScore(runScore(), true);
    hud.flashBomb();
    sfx.bomb();
    chaseCamera.shake(1.0); // medium-source shake — the whole road just cleared
  }

  /** Held-fire cadence: one volley per tier cooldown while Z/Space is down. */
  function tryFire(dt: number): void {
    fireCooldown -= dt;
    if (fireCooldown > 0 || !input.isFireHeld) return;
    const tier = weapons.tier;
    const fired = world.projectiles.fire(tier, world.controller.s + FIRE_ORIGIN_AHEAD, world.controller.x);
    if (fired === 0) return; // pool exhausted this tick — stay quiet
    fireCooldown = tier.cooldown;
    snail.spinShell(0.7);
    snail.flashMuzzle();
    sfx.shoot(tier.kind);
  }

  /**
   * Run-ending animation: a slug fling (spin off sideways) or the gap fall
   * (pitch over the cliff lip and drop straight down the chasm).
   */
  function beginKnockoff(kind: KnockoffKind = 'hit'): void {
    runPhase = 'knockoff';
    knockoffKind = kind;
    knockoffTimer = 0;
    knockoffSpin = 0;
    knockoffFall = 0;
    knockoffFallVelocity = kind === 'fall' ? 2 : 3.5;
    knockoffDrift = kind === 'fall' ? 0 : world.controller.x >= 0 ? 1 : -1;
    // Start from the *rendered* pose — mid-flight falls drop from the arc.
    knockoffBasePosition.copy(snail.group.position);
    knockoffBaseQuaternion.copy(snail.group.quaternion);
    knockoffRight.set(1, 0, 0).applyQuaternion(knockoffBaseQuaternion);
    sfx.damage();
    sfx.death();
    hud.flashDamage();
  }

  function advanceKnockoff(dt: number): void {
    knockoffTimer += dt;
    knockoffSpin += 13 * dt;
    knockoffFallVelocity += (knockoffKind === 'fall' ? 34 : 26) * dt;
    knockoffFall -= knockoffFallVelocity * dt;
    knockoffDrift *= 1 - Math.min(1, 2.2 * dt);
    if (knockoffTimer >= KNOCKOFF_DURATION && game.isPlaying) {
      game.gameOver();
    }
  }

  /** Applies the knock-off pose to the snail (render rate; sim owns the scalars). */
  function applyKnockoffVisual(): void {
    snail.group.position.copy(knockoffBasePosition);
    snail.group.position.y += knockoffFall;
    snail.group.position.addScaledVector(knockoffRight, knockoffDrift * 3.2);
    snail.group.quaternion.copy(knockoffBaseQuaternion);
    if (knockoffKind === 'fall') {
      // Gap fall: tumble head-over-heels forward, into the chasm.
      knockoffSpinQuat.setFromAxisAngle(LOCAL_RIGHT, -knockoffSpin * 0.55);
    } else {
      knockoffSpinQuat.setFromAxisAngle(LOCAL_UP, knockoffSpin);
    }
    snail.group.quaternion.multiply(knockoffSpinQuat);
  }

  function showResults(): void {
    const breakdown = score.breakdown(currentLevel.id, health.pips);
    // Medal rule (systems/Medal.ts): packages 45 + pips 30 + time-vs-par 25,
    // tiers at 90/75/60. Par = level length / cruise × 1.1.
    const par = parSeconds(currentLevel.length, currentLevel.cruiseSpeed);
    const medal = medalFor(
      medalPoints({
        packagesCollected: breakdown.packagesCollected,
        packagesAvailable: countLevelPackages(currentLevel.features),
        pips: health.pips,
        maxPips: MAX_PIPS,
        timeSeconds: runTime,
        parSeconds: par,
      }),
    );

    const unlockedBefore = save.data.unlockedLevel;
    const result = save.recordResult(currentLevel.id, runTime, breakdown.total);
    const justUnlocked = result.unlockedLevel > unlockedBefore;
    const unlockBanner = justUnlocked
      ? result.unlockedLevel > levels[levels.length - 1].id
        ? 'CAMPAIGN COMPLETE!'
        : `LEVEL ${currentLevel.id + 1} UNLOCKED!`
      : null;

    const data: ResultsData = {
      levelName: currentLevel.name,
      packagesCollected: breakdown.packagesCollected,
      packagesAvailable: countLevelPackages(currentLevel.features),
      packagePoints: breakdown.packagePoints,
      bonus: breakdown.bonus,
      finish: breakdown.finish,
      health: breakdown.health,
      total: breakdown.total,
      time: runTime,
      parSeconds: par,
      medal,
      newBestTime: result.newBestTime,
      newBestScore: result.newBestScore,
      hasNextLevel: currentLevelIndex + 1 < levels.length,
      unlockBanner,
    };
    screens.showResults(data);
    sfx.finish(medal);
    // The celebration jingle lands right after the fanfare resolves.
    if (justUnlocked) sfx.unlock(0.7);
  }

  // -- State entry. ---------------------------------------------------------------

  game.onChange((state: GameStateName) => {
    switch (state) {
      case 'menu': {
        if (world.definition.id !== currentLevel.id) {
          disposeWorld(world);
          world = buildLevel(currentLevel);
        }
        resetRun();
        hud.setVisible(false);
        screens.showMenu(currentLevel.id, currentLevel.name, { muted: save.data.muted });
        break;
      }
      case 'levelSelect': {
        hud.setVisible(false);
        // Fresh rows every entry: lock state and bests come straight from the
        // save, and the cursor lands on the newest unlock.
        levelSelectEntries = buildLevelSelectEntries(levels, save.data);
        levelSelectIndex = defaultSelectionIndex(levelSelectEntries);
        screens.showLevelSelect(levelSelectEntries, levelSelectIndex);
        break;
      }
      case 'playing': {
        hud.setVisible(true);
        screens.hide();
        break;
      }
      case 'paused': {
        screens.showPause();
        break;
      }
      case 'complete': {
        showResults();
        break;
      }
      case 'gameover': {
        screens.showGameOver(score.packagePoints);
        break;
      }
    }
  });

  // -- Fixed-timestep loop. ---------------------------------------------------------

  function handleConfirm(): void {
    sfx.resume(); // every confirm is a user gesture → audio unlocks here
    switch (game.name) {
      case 'menu':
      case 'gameover':
        startRun();
        break;
      case 'paused':
        game.resume();
        break;
      case 'complete':
        advanceAfterComplete();
        break;
      case 'playing':
        break;
    }
  }

  function handlePause(): void {
    if (game.isPlaying && runPhase === 'running') {
      game.pause();
    } else if (
      game.name === 'paused' ||
      game.name === 'gameover' ||
      game.name === 'complete' ||
      game.name === 'levelSelect'
    ) {
      enterMenu();
    }
  }

  function toggleMute(): void {
    const muted = !save.data.muted;
    save.setMuted(muted);
    sfx.setMuted(muted);
    hud.setMuteHint(muted);
    // The HUD hint is hidden on the fullscreen overlays — keep the menu's
    // hint line honest too.
    if (game.name === 'menu') {
      screens.showMenu(currentLevel.id, currentLevel.name, { muted });
    }
  }

  // Track the real render delta for the render-rate camera damping.
  let lastRenderTime = performance.now();
  const renderDelta = (): number => {
    const now = performance.now();
    const delta = Math.min((now - lastRenderTime) / 1000, 0.1);
    lastRenderTime = now;
    return delta;
  };

  const loop = new Loop({
    update(dt) {
      // Always alive: sky drift, the snail's idle bob and any live particle
      // bursts run in every state (breakup debris keeps settling while the
      // knock-off plays out).
      starfield.update(dt);
      snail.update(dt);
      particles.update(dt);

      // Consume edges once per step so a queued key can never leak across a
      // state change (e.g. a stray click auto-retrying a fresh death).
      const confirmPressed = input.consumeConfirm();
      const pausePressed = input.consumePause();
      if (input.consumeMute()) toggleMute();

      switch (game.name) {
        case 'menu': {
          if (confirmPressed) {
            handleConfirm();
          } else if (pausePressed) {
            handlePause();
          } else if (input.consumeBack()) {
            // nothing to back out of on the title screen
          } else if (input.consumeNavigate() !== 0) {
            // any menu arrow opens the campaign list
            sfx.resume();
            sfx.move();
            game.toLevelSelect();
          }
          break;
        }
        case 'levelSelect': {
          if (confirmPressed) {
            sfx.resume();
            startSelectedLevel();
          } else if (pausePressed || input.consumeBack()) {
            sfx.resume();
            enterMenu();
          } else {
            const nav = input.consumeNavigate();
            if (nav !== 0) {
              sfx.resume();
              levelSelectIndex = moveSelection(levelSelectEntries, levelSelectIndex, nav);
              sfx.move();
              screens.updateLevelSelectSelection(clampSelection(levelSelectEntries, levelSelectIndex));
            }
          }
          break;
        }
        case 'paused':
        case 'complete':
        case 'gameover': {
          if (confirmPressed) handleConfirm();
          if (pausePressed) handlePause();
          break;
        }
        case 'playing': {
          if (pausePressed) {
            handlePause();
            break;
          }
          if (runPhase === 'running') {
            runTime += dt;
            prevPlayerS = world.controller.s;
            const wasAirborne = world.controller.airborne;
            world.controller.update(dt);
            world.spawner.update(world.controller.s, dt);
            tryFire(dt);
            const projectileHits = world.projectiles.update(dt, world.spawner.entities, world.controller.s);
            handleProjectileHits(projectileHits);

            // Pass-through crossings first: a jump pod may launch Turbo this
            // very step, turning the snail airborne before the fall check.
            const ring = findRingPass(world.spawner.entities, prevPlayerS, world.controller.s, world.controller.x);
            if (ring) handleRingPass(ring);

            // Gap fall: grounded over open air (a pod arc is immune; landing
            // inside a gap is not — `airborne` is already false by then).
            if (checkFall(world.gaps, prevPlayerS, world.controller.s, world.controller.airborne)) {
              beginKnockoff('fall');
            } else {
              // Ground hazards (slugs/asteroids) sit on the road — airborne
              // Turbo sails over them; pickups and rings are always live.
              const hit = findHit(
                world.spawner.entities,
                world.controller.s,
                world.controller.x,
                PLAYER_RADIUS,
                undefined,
                (entity) => isContactType(entity) && !(world.controller.airborne && isGroundHazard(entity)),
              );
              if (hit) handleHit(hit);
            }

            // Touchdown juice: airborne → grounded this step and still alive.
            if (wasAirborne && !world.controller.airborne && runPhase === 'running') {
              snail.squash(1);
              sfx.land();
              chaseCamera.shake(0.14);
              particles.burst(world.track, world.controller.s, world.controller.x, {
                count: 14,
                color: 0x9fd8e8,
                life: 0.5,
                speed: 4.5,
                upBias: 1.4,
                hover: 0.35,
              });
            }

            // Red-ring vignette rides the trap modifier's remaining timer.
            hud.setDanger(speedMods.isActive('redRing'));

            if (runPhase === 'running') {
              hud.setProgress(world.controller.s, world.length);
              if (world.controller.s >= world.length) game.complete();
            }
          } else {
            advanceKnockoff(dt);
          }
          break;
        }
      }
    },
    render() {
      if (runPhase === 'running') {
        // Interpolate the snail between the last two sim steps, then let the
        // camera damp toward it at render rate — no 60 Hz judder on 120 Hz+.
        const alpha = Math.min(1, loop.pendingTime / loop.step);
        world.controller.applyVisual(alpha);
        // Speed trail: full ribbon at cruise, dying as the speed drops (a
        // red-ring crawl loses its wake, which sells the slow-down).
        const ratio = world.definition.cruiseSpeed > 0
          ? world.controller.speed / world.definition.cruiseSpeed
          : 1;
        const intensity = game.isPlaying ? Math.min(1, Math.max(0, (ratio - TRAIL_RAMP_START) / (1 - TRAIL_RAMP_START))) : 0;
        trail.update(snail.group.position, snail.group.quaternion, intensity);
      } else {
        trail.clear();
        applyKnockoffVisual();
      }
      chaseCamera.update(renderDelta(), refreshChaseTarget(world));
      composer.render();
    },
  });

  // -- Focus loss: auto-pause + input hygiene. --------------------------------
  // Tabbing away mid-race pauses immediately (the sim stops, so nothing can
  // hit you while you are gone). Held keys are dropped: a keyup that happens
  // outside the window never reaches us, and Turbo would steer/fire forever.
  // Queued confirm edges are dropped with them — refocusing must never count
  // as a click. Menu/loading states are untouched; audio is not resumed here
  // (the next real user gesture unlocks it, as always).
  window.addEventListener('blur', () => {
    input.releaseAll();
    if (game.isPlaying && runPhase === 'running') game.pause();
  });
  // Same hygiene for tab switches (blur does not fire on every platform).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      input.releaseAll();
      if (game.isPlaying && runPhase === 'running') game.pause();
    }
  });

  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Re-clamp the pixel ratio too: zooming or moving the window to another
    // monitor changes devicePixelRatio, and resize is when the browser tells us.
    const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
  });

  // Initial state: menu over the freshly built first level.
  hud.setMuteHint(save.data.muted);
  hud.setVisible(false);
  screens.showMenu(currentLevel.id, currentLevel.name, { muted: save.data.muted });
  resetRun();
  loop.start();
}

bootstrap();
