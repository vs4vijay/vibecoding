import * as THREE from 'three';
import { FixedLoop } from './core/loop';
import { Timescale } from './core/timescale';
import { ChaseCamera } from './render/camera';
import { createScene, type SceneBundle } from './render/scene';
import { DebugStats } from './render/debugStats';
import { FxParticles, HEAVY_LAND_MIN_FALL_MPS, WindParticles, PickupVisuals } from './render/fx';
import { addBoulders, addBushes, addGrassTufts, type SwayField } from './render/scene';
import { SPECIES } from './data/species';
import { buildRig, type Rig } from './actors/skeleton';
import { ClipPlayer } from './actors/clips';
import { CharacterController } from './actors/controller';
import {
  FighterSim,
  type FighterSimWorld,
  type FighterState,
  type HitEvent,
} from './combat/stateMachine';
import { isSpecialMove } from './combat/bodymoves';
import { applyHit, applyLethalState, forwardXZ } from './combat/hitdetect';
import { ScoreLedger } from './combat/scoring';
import { throwKnife } from './combat/weaponsLogic';
import {
  CONTEXT_CROUCH_PICKUP_MS,
  HITSTOP_MS,
  KO_SLOWMO_SCALE,
  KO_SLOWMO_MS,
  WORLD_RNG_SEED,
  PICKUP_REACH_M,
  RUN_STANCE_SPEED,
  THROWN_KNIFE_SPEED_MPS,
} from './data/tuning';
import { WEAPONS } from './data/weapons';
import { heightAt } from './world/terrain';
import { PhysicsWorld } from './world/physics';
import { WindSystem } from './world/wind';
import { InputManager, type InputFrame } from './core/input';
import { BushField, type SpawnPoint } from './world/bushes';
import { BOULDER_WALLS, nearestWall, type WallProbe } from './world/walls';
import { WeaponDrops, Projectiles, type WeaponDropClass } from './world/projectiles';
import { spawnPickups } from './world/pickups';
import { emitHearing, type HearingEvent } from './ai/perception';
import { Brain, type BrainSenses, type BrainWorld } from './ai/brain';
import { DIFFICULTY } from './ai/difficulty';
import { mulberry32 } from './core/rng';
import { spawnRagdoll, type RagdollHandle } from './actors/ragdoll';

import type { Difficulty } from './types';
import { WAVES } from './data/waves';
import { MenuOverlay, type MenuChoice } from './ui/menu';
import { Tutorial, type TutorialEvent } from './ui/tutorial';
import { ResultsOverlay } from './ui/results';
import { PauseOverlay } from './ui/pause';
import { loadBests, saveBest } from './ui/persistence';

// ---------------------------------------------------------------------------
// MoveId → CLIPS key
// ---------------------------------------------------------------------------

const MOVE_CLIP: Record<string, string> = {
  punch: 'punchR',
  doublePunch: 'punchL',
  runningKick: 'kickFront',
  legSweep: 'sweep',
  bodyThrow: 'hurt',
  counterThrow: 'hurt',
  flip: 'hurt',
  tackle: 'hurt',
  stealthKill: 'punchR',
};

function moveClipKey(moveId: string): string {
  return MOVE_CLIP[moveId] ?? 'idle';
}

// ---------------------------------------------------------------------------
// EnemyActor — flexible actor type for arena waves + tutorial scripting
// ---------------------------------------------------------------------------

interface EnemyActor {
  sim: FighterSim;
  ctrl: CharacterController;
  rig: Rig;
  brain: Brain | null;
  /** Persistent nearest-wall probe swapped into world.wall for this actor. */
  wall: WallProbe;
  /** Last-step position for the rustle segment check. */
  prev: { x: number; z: number };
  /** KO transition consumed (slow-mo + ragdoll fired once). */
  koHandled: boolean;
  /** Scripted tutorial attacker: punch cycle timer/cadence (ms). */
  attackTimerMs: number;
  attackCycleMs: number;
  scripted: boolean;
}

function createEnemyActor(
  species: 'wolf' | 'rabbit',
  id: string,
  pos: { x: number; z: number },
  heading: number,
  makeBrain: ((sim: FighterSim) => Brain | null) | null,
  scene: THREE.Scene,
  opts?: { scripted?: boolean; attackCycleMs?: number },
): EnemyActor {
  const rig = buildRig(SPECIES[species]);
  scene.add(rig.root);
  const ctrl = new CharacterController(rig, SPECIES[species], new ClipPlayer(rig));
  const sim = new FighterSim(species, id, false);
  sim.state.pos.x = pos.x;
  sim.state.pos.z = pos.z;
  sim.state.pos.y = heightAt(pos.x, pos.z);
  sim.state.heading = heading;
  return {
    sim,
    ctrl,
    rig,
    brain: makeBrain ? makeBrain(sim) : null,
    wall: { proximityM: Infinity, awayX: 1, awayZ: 0 },
    prev: { x: pos.x, z: pos.z },
    koHandled: false,
    attackTimerMs: 0,
    attackCycleMs: opts?.attackCycleMs ?? 2500,
    scripted: opts?.scripted ?? false,
  };
}

function removeEnemyActor(scene: THREE.Scene, actor: EnemyActor): void {
  scene.remove(actor.rig.root);
  actor.rig.root.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}

// ---------------------------------------------------------------------------
// Game mode state machine
// ---------------------------------------------------------------------------

type GameMode = 'menu' | 'tutorial' | 'arena' | 'results' | 'paused' | 'dead';

/** Rise above the terrain for the tutorial marker ring. */
const MARKER_LIFT_M = 0.1;
/** Slow-mo ragdoll duration before the "You died" overlay (ms). */
const DEATH_SLOWMO_MS = 2000;
/** Banner duration between waves (ms). */
const WAVE_CLEAR_BANNER_MS = 3000;
/** Spawn ring radius for wave enemies (m). */
const WAVE_SPAWN_RADIUS_M = 10;
/** Distance the tutorial knife spawns in front of the player (m). */
const TUTORIAL_KNIFE_DIST_M = 3;

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly input: InputManager;
  private readonly sceneBundle: SceneBundle;
  private readonly camera3d: THREE.PerspectiveCamera;
  private readonly chaseCam: ChaseCamera;
  private readonly debug: DebugStats | null;

  private readonly fx: FxParticles;

  private readonly playerSim: FighterSim;
  private readonly playerRig: Rig;
  private readonly playerCtrl: CharacterController;
  private readonly ledger = new ScoreLedger();

  private readonly simLoop: FixedLoop;
  private readonly timescale: Timescale;
  private readonly world: FighterSimWorld;

  private physics: PhysicsWorld | null = null;
  private projectiles: Projectiles | null = null;
  private readonly ragdolls: RagdollHandle[] = [];
  /** The player's own ragdoll handle — dropped on respawn so a settled
   *  corpse never overwrites the revived rig's matrices. */
  private playerRagdoll: RagdollHandle | null = null;
  private lastHitDir = { x: 0, y: 0.4, z: -1 };

  private frame: InputFrame;
  private clickHandler: (() => void) | null = null;
  private animationId = 0;
  private resizeHandler: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private blurHandler: (() => void) | null = null;
  private pointerLockHandler: (() => void) | null = null;

  private lastMs = 0;
  private running = false;

  // --- Mode machine ---
  private mode: GameMode = 'menu';
  private paused = false;
  private suspendedMode: GameMode = 'menu'; // mode we paused from
  private difficulty: Difficulty = 'normal';
  private godMode = false;

  // --- Arena state ---
  private enemies: EnemyActor[] = [];
  private waveIndex = 0;
  private waveState: 'spawning' | 'fighting' | 'cleared' = 'spawning';
  private clearedTimerMs = 0;
  private runElapsedMs = 0;
  private drops: WeaponDrops | null = null;

  // --- Tutorial ---
  private tutorialActors: EnemyActor[] = [];
  private tutorialEvents: TutorialEvent[] = [];
  private lastPlayerPhase = 'idle';
  private prevPlayerWeapon: string | null = null;

  // --- Death state ---
  private deathState: 'none' | 'slowmo' | 'dead' = 'none';
  private deathTimerMs = 0;
  private playerKoHandled = false;

  // --- UI overlays ---
  private readonly menuOverlay: MenuOverlay;
  private readonly tutorialOverlay: Tutorial;
  private readonly resultsOverlay: ResultsOverlay;
  private readonly pauseOverlay: PauseOverlay;
  private readonly deathOverlay: HTMLDivElement;
  private readonly clearedBanner: HTMLDivElement;
  private readonly markerMesh: THREE.Mesh;

  // --- Arena dressing ---
  private readonly wind: WindSystem;
  readonly bushField: BushField;
  private readonly heardEvents: HearingEvent[] = [];
  private readonly senses: BrainSenses;
  private readonly brainWorld: BrainWorld;
  private readonly wallPlayer: WallProbe = { proximityM: Infinity, awayX: 1, awayZ: 0 };
  private readonly prevPlayerPos = { x: 0, z: 0 };
  private readonly dropProbe: {
    id: number;
    weaponClass: WeaponDropClass;
    pos: { x: number; y: number; z: number };
  } = { id: 0, weaponClass: 'knife', pos: { x: 0, y: 0, z: 0 } };
  private lastPlayerMoveId: string | undefined = undefined;
  private crouchHoldMs = 0;
  private crouchContextArmed = true;
  private readonly synthFrame: InputFrame = {
    moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
    pressed: { attack: false, jump: false, crouch: false },
    held: { attack: false, jump: false, crouch: false },
  };

  private readonly bushSway: SwayField;
  private readonly grassSway: SwayField;
  private readonly windFx: WindParticles;
  private readonly pickupFx: PickupVisuals;
  private visualTimeSec = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // --- Scene & camera ---
    this.sceneBundle = createScene(canvas);
    this.camera3d = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    this.chaseCam = new ChaseCamera(this.camera3d);

    this.wind = new WindSystem(mulberry32(WORLD_RNG_SEED));
    const spawns: SpawnPoint[] = [
      { x: 0, z: 0 },
      { x: 0, z: -3 },
      { x: -6, z: -3 },
    ];
    this.bushField = new BushField(mulberry32(WORLD_RNG_SEED + 1), spawns);
    addBoulders(this.sceneBundle.scene);
    this.bushSway = addBushes(this.sceneBundle.scene, this.bushField.bushes, mulberry32(WORLD_RNG_SEED + 3));
    this.grassSway = addGrassTufts(this.sceneBundle.scene, mulberry32(WORLD_RNG_SEED + 4));
    this.windFx = new WindParticles(this.sceneBundle.scene);
    this.pickupFx = new PickupVisuals(this.sceneBundle.scene);

    this.debug = import.meta.env.DEV
      ? new DebugStats(
          document.getElementById('app')!,
          () => this.playerSim.scoreTotal,
          () => this.debugInfo(),
        )
      : null;

    this.fx = new FxParticles(this.sceneBundle.scene);

    // --- Input ---
    this.input = new InputManager();
    this.input.attach(canvas);
    this.clickHandler = () => {
      // Only lock the pointer while actually fighting.
      if ((this.mode === 'arena' || this.mode === 'tutorial') && !this.paused && this.deathState === 'none') {
        this.input.requestPointerLock();
      }
    };
    canvas.addEventListener('click', this.clickHandler);

    // --- Player (rabbit) ---
    this.playerRig = buildRig(SPECIES.rabbit);
    this.sceneBundle.scene.add(this.playerRig.root);
    this.playerCtrl = new CharacterController(this.playerRig, SPECIES.rabbit, new ClipPlayer(this.playerRig));
    this.playerSim = new FighterSim('rabbit', 'player', true);
    this.playerSim.setScoreLedger(this.ledger);

    // --- Shared world snapshot ---
    this.world = {
      fighters: [this.playerSim.state],
      downedBodyNearby: false,
      weaponOnGroundNearby: false,
    };
    this.senses = { heard: this.heardEvents, wind: this.wind, scent: null };
    this.brainWorld = {
      enemies: [this.playerSim.state],
      allies: [],
      bushes: this.bushField.bushes,
      allyEngageCount: 0,
    };
    this.simLoop = new FixedLoop(1000 / 60, (dt) => this.simStep(dt));
    this.timescale = new Timescale();
    this.frame = this.input.sample();

    // --- UI overlays ---
    const uiRoot = document.getElementById('ui-root')!;
    this.menuOverlay = new MenuOverlay(uiRoot);
    this.tutorialOverlay = new Tutorial();
    this.tutorialOverlay.hide();
    this.resultsOverlay = new ResultsOverlay(uiRoot);
    this.pauseOverlay = new PauseOverlay(uiRoot);

    this.deathOverlay = document.createElement('div');
    this.deathOverlay.className = 'lg-overlay lg-backdrop hidden';
    const deathText = document.createElement('div');
    deathText.className = 'lg-death';
    deathText.textContent = 'You died';
    this.deathOverlay.appendChild(deathText);
    const deathHint = document.createElement('div');
    deathHint.className = 'lg-hint';
    deathHint.textContent = 'R — restart wave  |  Esc — menu';
    this.deathOverlay.appendChild(deathHint);
    uiRoot.appendChild(this.deathOverlay);

    this.clearedBanner = document.createElement('div');
    this.clearedBanner.className = 'lg-banner hidden';
    this.clearedBanner.textContent = 'Wave cleared';
    uiRoot.appendChild(this.clearedBanner);

    const markerGeo = new THREE.RingGeometry(0.4, 0.6, 32);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x50ff80, side: THREE.DoubleSide });
    this.markerMesh = new THREE.Mesh(markerGeo, markerMat);
    this.markerMesh.rotation.x = -Math.PI / 2;
    this.markerMesh.visible = false;
    this.sceneBundle.scene.add(this.markerMesh);

    // --- Resize ---
    this.resizeHandler = this.resize.bind(this);
    window.addEventListener('resize', this.resizeHandler);
    this.resize();

    // --- Global key / blur / pointer-lock handlers ---
    this.keyHandler = this.onKey.bind(this);
    window.addEventListener('keydown', this.keyHandler);
    this.blurHandler = this.onBlur.bind(this);
    window.addEventListener('blur', this.blurHandler);
    this.pointerLockHandler = this.onPointerLockChange.bind(this);
    document.addEventListener('pointerlockchange', this.pointerLockHandler);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.sceneBundle.renderer.setSize(w, h, false);
    this.sceneBundle.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera3d.aspect = w / h;
    this.camera3d.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(mode: 'menu' | 'sandbox' = 'menu'): Promise<void> {
    if (this.running) return;
    this.physics = await PhysicsWorld.create(heightAt);
    for (const box of BOULDER_WALLS) this.physics.addBox(box.center, box.halfExtents);
    this.drops = new WeaponDrops(this.physics);
    this.projectiles = new Projectiles(this.physics);
    this.godMode = new URLSearchParams(window.location.search).get('debug') === 'god';
    this.running = true;
    this.lastMs = performance.now();

    if (mode === 'sandbox') {
      // Legacy sandbox for dev verification: two patrolling wolves + pickups.
      spawnPickups(this.drops);
      this.spawnSandboxEnemies();
      this.setMode('arena');
    } else {
      this.setMode('menu');
    }

    this.tick();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationId);
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
      this.blurHandler = null;
    }
    if (this.pointerLockHandler) {
      document.removeEventListener('pointerlockchange', this.pointerLockHandler);
      this.pointerLockHandler = null;
    }
    this.input.detach();
    this.fx.dispose();
    this.windFx.dispose();
    this.pickupFx.dispose();
    this.bushSway.dispose();
    this.grassSway.dispose();
    this.sceneBundle.renderer.dispose();
    this.sceneBundle.scene.clear();
    this.tutorialOverlay.dispose();
  }

  // -------------------------------------------------------------------------
  // Mode machine
  // -------------------------------------------------------------------------
  private setMode(m: GameMode): void {
    // Remember what we're pausing from.
    if (m === 'paused' && (this.mode === 'arena' || this.mode === 'tutorial')) {
      this.suspendedMode = this.mode;
    }
    this.mode = m;
    switch (m) {
      case 'menu':
        this.menuOverlay.show((choice) => {
          this.difficulty = choice.difficulty;
          if (choice.mode === 'tutorial') this.startTutorial();
          else this.startArena();
        });
        this.tutorialOverlay.hide();
        this.resultsOverlay.hide();
        this.pauseOverlay.hide();
        this.deathOverlay.classList.add('hidden');
        this.clearedBanner.classList.add('hidden');
        this.markerMesh.visible = false;
        this.clearAllActors();
        break;
      case 'tutorial':
        this.menuOverlay.hide();
        this.resultsOverlay.hide();
        this.pauseOverlay.hide();
        this.deathOverlay.classList.add('hidden');
        this.clearedBanner.classList.add('hidden');
        break;
      case 'arena':
        this.menuOverlay.hide();
        this.tutorialOverlay.hide();
        this.resultsOverlay.hide();
        this.pauseOverlay.hide();
        this.deathOverlay.classList.add('hidden');
        break;
      case 'results':
        this.menuOverlay.hide();
        this.tutorialOverlay.hide();
        this.pauseOverlay.hide();
        this.deathOverlay.classList.add('hidden');
        this.clearedBanner.classList.add('hidden');
        this.markerMesh.visible = false;
        break;
      case 'paused':
        this.pauseOverlay.show(
          () => this.resume(),
          () => { this.exitPointerLock(); this.startArena(); },
          () => { this.exitPointerLock(); this.setMode('menu'); },
        );
        break;
      case 'dead':
        break;
    }
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.paused = false;
    this.pauseOverlay.hide();
    // Return to the mode we suspended (arena or tutorial).
    const resumeMode = this.suspendedMode;
    this.suspendedMode = 'menu';
    if (resumeMode === 'tutorial' && this.tutorialOverlay.done) {
      this.startArena();
    } else {
      this.setMode(resumeMode);
    }
    if (resumeMode === 'arena' || resumeMode === 'tutorial') {
      this.input.requestPointerLock();
    }
  }


  private exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // -------------------------------------------------------------------------
  // Arena start / wave management
  // -------------------------------------------------------------------------

  private startArena(): void {
    this.exitPointerLock();
    this.waveIndex = 0;
    this.runElapsedMs = 0;
    this.deathState = 'none';
    this.deathTimerMs = 0;
    this.playerKoHandled = false;
    this.clearedBanner.classList.add('hidden');
    this.playerSim.setScoreLedger(new ScoreLedger());
    this.resetPlayer();
    this.clearAllActors();
    if (this.drops) spawnPickups(this.drops);
    this.startWave(0);
    this.setMode('arena');
  }

  private startWave(index: number): void {
    this.clearActors(this.enemies);
    this.enemies = [];
    this.waveState = 'spawning';
    this.clearedTimerMs = 0;

    const cfg = WAVES[index];
    let spawnIndex = 0;
    const totalEnemies = cfg.enemies.reduce((s, e) => s + e.count, 0);
    for (const entry of cfg.enemies) {
      for (let i = 0; i < entry.count; i++) {
        const angle = (spawnIndex / Math.max(totalEnemies, 1)) * Math.PI * 2 + 0.3;
        const x = Math.cos(angle) * WAVE_SPAWN_RADIUS_M;
        const z = Math.sin(angle) * WAVE_SPAWN_RADIUS_M;
        const id = `${cfg.id}_${spawnIndex}`;
        this.enemies.push(
          createEnemyActor(
            entry.species, id, { x, z }, Math.atan2(-x, -z),
            (sim) => new Brain(sim, DIFFICULTY[this.difficulty], mulberry32(WORLD_RNG_SEED + 100 + index * 10 + spawnIndex)),
            this.sceneBundle.scene,
          ),
        );
        this.fx.spawnDustRing({ x, y: heightAt(x, z), z });
        spawnIndex++;
      }
    }
    this.rebuildWorld();
  }

  private isWaveCleared(): boolean {
    return this.enemies.length > 0 && this.enemies.every((e) => e.sim.state.phase.t === 'ko');
  }

  private advanceToNextWave(): void {
    this.clearedBanner.classList.add('hidden');
    this.waveIndex++;
    if (this.waveIndex >= WAVES.length) {
      this.showResults();
    } else {
      this.startWave(this.waveIndex);
    }
  }

  private showResults(): void {
    saveBest(this.difficulty, this.ledger.total());
    this.resultsOverlay.show(
      {
        total: this.ledger.total(),
        breakdown: this.ledger.breakdown(),
        elapsedMs: this.runElapsedMs,
        bests: loadBests(),
        difficulty: this.difficulty,
      },
      () => { this.exitPointerLock(); this.startArena(); },
      () => { this.exitPointerLock(); this.setMode('menu'); },
    );
    this.setMode('results');
  }

  // -------------------------------------------------------------------------
  // Tutorial
  // -------------------------------------------------------------------------

  private startTutorial(): void {
    this.exitPointerLock();
    this.resetPlayer();
    this.clearAllActors();
    this.tutorialEvents = [];
    this.lastPlayerPhase = 'idle';
    this.prevPlayerWeapon = null;
    this.tutorialOverlay.show();
    this.setMode('tutorial');
  }

  private spawnTutorialActors(stepId: string): void {
    this.clearActors(this.tutorialActors);
    this.tutorialActors = [];

    switch (stepId) {
      case 'punch':
      case 'legCannon': {
        // Standing dummy at a fixed position, facing the player spawn.
        this.tutorialActors.push(
          createEnemyActor('wolf', 'tut_dummy', { x: 3, z: 3 }, Math.PI, null, this.sceneBundle.scene),
        );
        break;
      }
      case 'reversal': {
        // Scripted attacker that telegraphs punches on a slow cycle.
        this.tutorialActors.push(
          createEnemyActor(
            'wolf', 'tut_attacker', { x: 0, z: -3 }, Math.PI,
            null, this.sceneBundle.scene,
            { scripted: true, attackCycleMs: 2600 },
          ),
        );
        break;
      }
      case 'knife': {
        const px = this.playerSim.state.pos.x;
        const pz = this.playerSim.state.pos.z;
        const kx = px + TUTORIAL_KNIFE_DIST_M;
        this.drops?.spawnDrop('knife', { x: kx, y: heightAt(kx, pz) + 0.4, z: pz });
        break;
      }
      case 'stealth': {
        // Brainless sleeper: unaware so the stealth window stays open, and
        // standing still facing -Z means the player must approach from +Z.
        this.tutorialActors.push(
          createEnemyActor('wolf', 'tut_sleeper', { x: 0, z: 5 }, 0, null, this.sceneBundle.scene),
        );
        break;
      }
    }
    this.rebuildWorld();
  }

  // -------------------------------------------------------------------------
  // Death handling
  // -------------------------------------------------------------------------

  private handlePlayerDeath(): void {
    if (this.deathState !== 'none') return;
    this.deathState = 'slowmo';
    this.deathTimerMs = 0;
    this.timescale.slowmo(KO_SLOWMO_SCALE, KO_SLOWMO_MS);
    if (this.physics) {
      this.playerRagdoll = spawnRagdoll(this.physics, this.playerRig, {
        dir: this.lastHitDir,
        force: SPECIES.rabbit.massKg * 1.5,
      });
      this.ragdolls.push(this.playerRagdoll);
    }
    this.fx.spawnDustRing(this.playerSim.state.pos);
  }

  private resetPlayer(): void {
    const s = this.playerSim.state;
    s.hp = SPECIES.rabbit.maxHp;
    s.pos.x = 0;
    s.pos.z = 0;
    s.pos.y = heightAt(0, 0);
    s.heading = 0;
    s.velY = 0;
    s.phase = { t: 'idle', phaseMsLeft: Infinity };
    s.weapon = null;
    s.durability = undefined;
    s.bloodiedWeapon = undefined;
    s.flags = { bleeding: false, limping: false, unconscious: false, invulnerableAirFlipMs: 0 };
    // Drop the previous ragdoll handle so a settled corpse can't keep
    // writing the revived rig's bone matrices.
    if (this.playerRagdoll) {
      const i = this.ragdolls.indexOf(this.playerRagdoll);
      if (i >= 0) this.ragdolls.splice(i, 1);
      this.playerRagdoll = null;
    }
    this.playerKoHandled = false;
    this.deathState = 'none';
    this.deathTimerMs = 0;
    this.deathOverlay.classList.add('hidden');
    this.lastPlayerMoveId = undefined;
    this.lastPlayerPhase = 'idle';
    this.prevPlayerWeapon = null;
  }

  // -------------------------------------------------------------------------
  // Global input (Esc / R / blur / pointer-lock)
  // -------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (this.mode === 'arena' || this.mode === 'tutorial') {
        if (this.deathState === 'dead') {
          this.exitPointerLock();
          this.setMode('menu');
        } else if (this.deathState === 'slowmo') {
          return; // don't cancel the death cinematic
        } else if (this.mode === 'tutorial') {
          this.tutorialOverlay.skipAll(); // ESC skips all tutorial steps
        } else {
          this.exitPointerLock();
          this.paused = true;
          this.setMode('paused');
        }
      } else if (this.mode === 'paused') {
        this.resume();
      }
    }
    if (e.code === 'KeyR') {
      if (this.deathState === 'dead') {
        if (this.mode === 'tutorial') {
          this.startTutorial();
        } else {
          this.resetPlayer();
          this.startWave(this.waveIndex);
        }
      }
    }
  }

  private onBlur(): void {
    if ((this.mode === 'arena' || this.mode === 'tutorial') && !this.paused && this.deathState === 'none') {
      this.exitPointerLock();
      this.paused = true;
      this.setMode('paused');
    }
  }

  private onPointerLockChange(): void {
    if (!this.input.isLocked && (this.mode === 'arena' || this.mode === 'tutorial') && !this.paused && this.deathState === 'none') {
      this.paused = true;
      this.setMode('paused');
    }
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

  private tick(): void {
    if (!this.running) return;
    this.animationId = requestAnimationFrame(() => this.tick());

    const nowMs = performance.now();
    const realDtMs = Math.min(nowMs - this.lastMs, 100);
    this.lastMs = nowMs;

    this.frame = this.input.sample();
    const scale = this.timescale.update(realDtMs);

    if (!this.paused && this.deathState !== 'dead' && this.mode !== 'menu' && this.mode !== 'results') {
      this.simLoop.advance(realDtMs * scale);
    }

    const dtSec = (realDtMs * scale) / 1000;
    if (this.physics && dtSec > 0) {
      this.physics.step(dtSec);
      for (const rd of this.ragdolls) rd.update();
    }

    // Knife flight bridge (Rapier projectiles → combat sim).
    if (this.projectiles && dtSec > 0) {
      const knifeEvents = this.projectiles.step(dtSec * 1000, this.world.fighters);
      for (const ev of knifeEvents) {
        if (ev.type === 'hit' && ev.targetId !== undefined) {
          const victim = this.world.fighters.find((f) => f.id === ev.targetId);
          if (victim) this.playerSim.applyThrownKnifeImpact(victim, this.playerSim.state);
        } else if (ev.type === 'rest' && ev.at) {
          this.drops?.spawnDrop('knife', ev.at);
        }
      }
    }

    this.fx.update(realDtMs * scale);

    // Death slow-mo → "You died" overlay.
    if (this.deathState === 'slowmo') {
      this.deathTimerMs += realDtMs;
      if (this.deathTimerMs >= DEATH_SLOWMO_MS) {
        this.deathState = 'dead';
        this.deathOverlay.classList.remove('hidden');
      }
    }

    // Wave-clear banner countdown.
    if (this.waveState === 'cleared' && this.mode === 'arena') {
      this.clearedTimerMs += realDtMs;
      if (this.clearedTimerMs >= WAVE_CLEAR_BANNER_MS) {
        this.advanceToNextWave();
      }
    }

    if (this.mode === 'arena' && !this.paused && this.deathState === 'none' && this.waveState !== 'cleared') {
      this.runElapsedMs += realDtMs;
    }

    // Dressing animation (scaled clock — hitstop freezes the sway).
    this.visualTimeSec += dtSec;
    const windVec = this.wind.vector;
    this.bushSway.update(this.visualTimeSec, windVec);
    this.grassSway.update(this.visualTimeSec, windVec);
    this.windFx.update(realDtMs * scale, windVec, this.playerSim.state.pos);
    if (this.drops !== null) this.pickupFx.update(this.visualTimeSec, this.drops);

    // Tutorial marker.
    if (this.mode === 'tutorial') {
      const marker = this.tutorialOverlay.marker;
      if (marker) {
        const mh = heightAt(marker.x, marker.z);
        this.markerMesh.position.set(marker.x, mh + MARKER_LIFT_M, marker.z);
        this.markerMesh.rotation.z = this.visualTimeSec * 2;
        this.markerMesh.visible = true;
      } else {
        this.markerMesh.visible = false;
      }
    } else {
      this.markerMesh.visible = false;
    }

    this.updateRender(realDtMs * scale);
    this.debug?.frame(realDtMs);
    this.sceneBundle.renderer.render(this.sceneBundle.scene, this.camera3d);
  }

  // -------------------------------------------------------------------------
  // Sim step (fixed 60 Hz)
  // -------------------------------------------------------------------------

  private simStep(dtMs: number): void {
    const playerVy = this.playerSim.state.velY;
    const enemyVys = this.enemies.map((e) => e.sim.state.velY);

    this.playerSim.state.alerted = true;
    this.wind.update(dtMs);

    this.heardEvents.length = 0;
    this.rustleFor(this.playerSim.state, this.prevPlayerPos, dtMs);
    for (const e of this.enemies) this.rustleFor(e.sim.state, e.prev, dtMs);
    for (const a of this.tutorialActors) this.rustleFor(a.sim.state, a.prev, dtMs);

    for (const e of this.enemies) {
      if (e.brain) {
        for (const evt of e.brain.collectEvents()) {
          evt.sourceId = e.sim.state.id;
          emitHearing(this.heardEvents, evt);
        }
      }
    }
    for (const a of this.tutorialActors) {
      if (a.brain) {
        for (const evt of a.brain.collectEvents()) {
          evt.sourceId = a.sim.state.id;
          emitHearing(this.heardEvents, evt);
        }
      }
    }

    // Player step.
    this.world.wall = this.probeWall(this.playerSim.state.pos, this.wallPlayer);
    this.playerSim.update(dtMs, this.playerInput(dtMs), this.world);

    // Tutorial event detection on the player.
    if (this.mode === 'tutorial') {
      const nowPhase = this.playerSim.state.phase.t;
      if (nowPhase === 'reverseAttempt' && this.lastPlayerPhase !== 'reverseAttempt') {
        this.tutorialEvents.push({ type: 'reversal' });
      }
      const nowWeapon = this.playerSim.state.weapon;
      if (nowWeapon === 'knife' && this.prevPlayerWeapon !== 'knife') {
        this.tutorialEvents.push({ type: 'knifePicked' });
      }
      this.lastPlayerPhase = nowPhase;
      this.prevPlayerWeapon = nowWeapon;

      // Knife throw: crouch-tap while holding a knife (context button).
      if (
        this.tutorialOverlay.currentStepId === 'knife' &&
        this.frame.pressed.crouch &&
        this.playerSim.isCrouching &&
        this.playerSim.state.weapon === 'knife'
      ) {
        const fwd = forwardXZ(this.playerSim.state.heading);
        const ev = throwKnife(this.playerSim.state, fwd);
        if (ev) {
          this.playerSim.state.weapon = null;
          this.playerSim.state.durability = undefined;
          if (this.projectiles) {
            this.projectiles.throwKnife(ev.from, { x: fwd.x, y: 0.3, z: fwd.z }, THROWN_KNIFE_SPEED_MPS);
          }
          this.tutorialEvents.push({ type: 'knifeThrown' });
        }
      }
    }

    // God-mode invulnerability (dev cheat).
    if (this.godMode) this.playerSim.state.hp = SPECIES.rabbit.maxHp;

    // Enemy brains + scripted or dummy updates.
    for (const e of this.enemies) this.updateEnemyStep(e, dtMs);
    for (const a of this.tutorialActors) this.updateEnemyStep(a, dtMs);

    // Collect + apply hits: player → all non-player fighters.
    const allTargets = [...this.enemies, ...this.tutorialActors];
    const allTargetStates = allTargets.map((t) => t.sim.state);
    this.world.wall = this.probeWall(this.playerSim.state.pos, this.wallPlayer);
    const pHits = this.playerSim.collectHits(allTargetStates);
    for (const hit of pHits) this.landHit(hit, this.playerSim);

    for (const e of this.enemies) {
      this.world.wall = this.probeWall(e.sim.state.pos, e.wall);
      const hits = e.sim.collectHits([this.playerSim.state]);
      for (const hit of hits) this.landHit(hit, e.sim);
    }
    for (const a of this.tutorialActors) {
      this.world.wall = this.probeWall(a.sim.state.pos, a.wall);
      const hits = a.sim.collectHits([this.playerSim.state]);
      for (const hit of hits) this.landHit(hit, a.sim);
    }

    this.updatePlayerPickup();

    this.prevPlayerPos.x = this.playerSim.state.pos.x;
    this.prevPlayerPos.z = this.playerSim.state.pos.z;
    for (const e of this.enemies) {
      e.prev.x = e.sim.state.pos.x;
      e.prev.z = e.sim.state.pos.z;
    }
    for (const a of this.tutorialActors) {
      a.prev.x = a.sim.state.pos.x;
      a.prev.z = a.sim.state.pos.z;
    }

    if (playerVy <= -HEAVY_LAND_MIN_FALL_MPS && this.playerSim.state.velY === 0) {
      this.fx.spawnDustRing(this.playerSim.state.pos);
    }
    for (let i = 0; i < this.enemies.length; i++) {
      if (enemyVys[i] <= -HEAVY_LAND_MIN_FALL_MPS && this.enemies[i].sim.state.velY === 0) {
        this.fx.spawnDustRing(this.enemies[i].sim.state.pos);
      }
    }

    // Enemy/tutorial-actor KO → slow-mo + ragdoll.
    for (const e of allTargets) {
      if (e.koHandled || e.sim.state.phase.t !== 'ko') continue;
      e.koHandled = true;
      this.timescale.slowmo(KO_SLOWMO_SCALE, KO_SLOWMO_MS);
      if (this.physics) {
        const rd = spawnRagdoll(this.physics, e.rig, {
          dir: this.lastHitDir,
          force: SPECIES[e.sim.state.species].massKg * 1.5,
        });
        this.ragdolls.push(rd);
        this.fx.spawnDustRing(e.sim.state.pos);
      }
    }

    // Player KO → death cinematic.
    if (this.playerSim.state.phase.t === 'ko' && !this.playerKoHandled) {
      this.playerKoHandled = true;
      this.handlePlayerDeath();
    }

    // Wave state transitions (arena only).
    if (this.mode === 'arena') {
      if (this.waveState === 'spawning') {
        if (this.isWaveCleared()) {
          this.showClearedBanner();
        } else {
          this.waveState = 'fighting';
        }
      } else if (this.waveState === 'fighting' && this.isWaveCleared()) {
        this.showClearedBanner();
      }
    }

    // God-mode one-hit kills (dev verify).
    if (this.godMode) {
      for (const e of this.enemies) {
        if (e.sim.state.hp < SPECIES[e.sim.state.species].maxHp && e.sim.state.phase.t !== 'ko') {
          applyLethalState(e.sim.state);
        }
      }
    }

    // Tutorial progression.
    if (this.mode === 'tutorial') {
      const prevStep = this.tutorialOverlay.currentStepIndex;
      const result = this.tutorialOverlay.update(
        this.tutorialEvents,
        { x: this.playerSim.state.pos.x, z: this.playerSim.state.pos.z },
        this.playerSim.state.weapon,
      );
      this.tutorialEvents = [];
      if (result.done || this.tutorialOverlay.done) {
        this.startArena();
        return;
      }
      if (this.tutorialOverlay.currentStepIndex !== prevStep) {
        this.spawnTutorialActors(this.tutorialOverlay.currentStepId);
      }
    }
  }

  /** One brain/scripted/dummy enemy's fixed step. */
  private updateEnemyStep(actor: EnemyActor, dtMs: number): void {
    if (actor.brain) {
      const aiFrame = actor.brain.update(dtMs, this.senses, this.brainWorld);
      actor.sim.state.alerted = actor.brain.state !== 'patrol';
      this.world.wall = this.probeWall(actor.sim.state.pos, actor.wall);
      actor.sim.update(dtMs, aiFrame, this.world);
    } else {
      this.world.wall = this.probeWall(actor.sim.state.pos, actor.wall);
      actor.sim.update(dtMs, null, this.world);
      // Scripted tutorial attacker: slow telegraph cycle.
      if (actor.scripted && actor.sim.state.phase.t === 'idle') {
        actor.attackTimerMs += dtMs;
        if (actor.attackTimerMs >= actor.attackCycleMs) {
          actor.attackTimerMs = 0;
          const dx = this.playerSim.state.pos.x - actor.sim.state.pos.x;
          const dz = this.playerSim.state.pos.z - actor.sim.state.pos.z;
          actor.sim.state.heading = Math.atan2(-dx, -dz);
          const frame: InputFrame = {
            moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
            pressed: { attack: true, jump: false, crouch: false },
            held: { attack: false, jump: false, crouch: false },
          };
          actor.sim.update(dtMs, frame, this.world);
        }
      }
    }
  }

  private showClearedBanner(): void {
    this.clearedTimerMs = 0;
    this.waveState = 'cleared';
    this.clearedBanner.classList.remove('hidden');
  }

  private rustleFor(state: FighterState, prev: { x: number; z: number }, dtMs: number): void {
    const speed = Math.hypot(state.pos.x - prev.x, state.pos.z - prev.z) / (dtMs / 1000);
    const event = this.bushField.rustleCheck(state.pos, prev, speed > RUN_STANCE_SPEED);
    if (event !== null) {
      event.sourceId = state.id;
      emitHearing(this.heardEvents, event);
    }
  }

  private probeWall(pos: { x: number; z: number }, out: WallProbe): WallProbe | undefined {
    return nearestWall(pos, BOULDER_WALLS, out) ? out : undefined;
  }

  private updatePlayerPickup(): void {
    if (this.drops === null) return;
    const s = this.playerSim.state;
    const found = this.drops.nearestInto(s.pos, PICKUP_REACH_M, this.dropProbe);
    this.world.weaponOnGroundNearby = found;

    const moveId = s.phase.moveId;
    const dispatched = moveId === 'pickupOrContext' && this.lastPlayerMoveId !== 'pickupOrContext';
    this.lastPlayerMoveId = moveId;
    if (!found || !dispatched) return;

    this.drops.remove(this.dropProbe.id);
    const def = WEAPONS[this.dropProbe.weaponClass];
    s.weapon = def.id;
    s.durability = def.durability;
  }

  private playerInput(dtMs: number): InputFrame {
    const f = this.frame;
    if (!f.held.crouch) {
      this.crouchHoldMs = 0;
      this.crouchContextArmed = true;
      return f;
    }
    this.crouchHoldMs += dtMs;
    if (
      !this.crouchContextArmed ||
      this.crouchHoldMs < CONTEXT_CROUCH_PICKUP_MS ||
      !this.playerSim.isCrouching ||
      !this.world.weaponOnGroundNearby ||
      f.pressed.crouch
    ) {
      return f;
    }
    const s = this.synthFrame;
    s.moveX = f.moveX;
    s.moveZ = f.moveZ;
    s.lookDX = f.lookDX;
    s.lookDY = f.lookDY;
    s.pressed.attack = f.pressed.attack;
    s.pressed.jump = f.pressed.jump;
    s.pressed.crouch = true;
    s.held.attack = f.held.attack;
    s.held.jump = f.held.jump;
    s.held.crouch = true;
    this.crouchContextArmed = false;
    return s;
  }

  private debugInfo(): string {
    const w = this.wind.vector;
    const deg = ((Math.atan2(w.z, w.x) * 180) / Math.PI + 360) % 360;
    const wall = this.wallPlayer;
    const wallLine = wall.proximityM < Infinity
      ? `${wall.proximityM.toFixed(2)}m away(${wall.awayX.toFixed(2)}, ${wall.awayZ.toFixed(2)})`
      : 'open';
    const enemyLine = this.enemies
      .map((e) => `${e.sim.state.id}${e.brain ? '=' + e.brain.state : ''}${e.sim.state.alerted ? '!' : ''}`)
      .join(' ');
    return [
      `mode: ${this.mode} diff: ${this.difficulty}${this.godMode ? ' GOD' : ''}`,
      `wind: ${deg.toFixed(0)}deg str ${this.wind.strength.toFixed(2)}  wall: ${wallLine}`,
      `enemies: ${enemyLine}`,
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Hit application
  // -------------------------------------------------------------------------

  private landHit(hit: HitEvent, attackerSim: FighterSim): void {
    const fighters = this.world.fighters;
    let victim: FighterState | undefined;
    for (let i = 0; i < fighters.length && victim === undefined; i++) {
      if (fighters[i].id === hit.victimId) victim = fighters[i];
    }
    if (victim === undefined) return;
    const wasBleeding = victim.flags.bleeding;
    let applied = true;
    if (isSpecialMove(hit.moveId)) {
      applied = attackerSim.applySpecialStrike(hit, this.world.fighters) !== null;
    } else {
      applyHit(hit, this.world.fighters);
    }
    if (!applied) return;
    this.lastHitDir = { x: hit.dirVector.x, y: 0, z: hit.dirVector.z };
    this.timescale.hitstop(HITSTOP_MS);
    if (victim.flags.bleeding && !wasBleeding) this.fx.spawnBloodPuff(victim.pos);

    if (this.mode === 'tutorial' && hit.attackerId === this.playerSim.state.id) {
      if (hit.moveId === 'punch' || hit.moveId === 'doublePunch') {
        this.tutorialEvents.push({ type: 'punch' });
      } else if (hit.moveId === 'legCannon') {
        this.tutorialEvents.push({ type: 'legCannon' });
      } else if (hit.moveId === 'stealthKill') {
        this.tutorialEvents.push({ type: 'stealthKill' });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Render sync
  // -------------------------------------------------------------------------

  private updateRender(dtMs: number): void {
    if (!this.playerKoHandled) {
      this.copySimToCtrl(this.playerSim.state, this.playerCtrl, this.playerSim);
      this.applyPhaseClip(this.playerSim.state, this.playerCtrl);
      this.playerCtrl.updateFromSim(dtMs, this.chaseCam.yaw);
    }
    this.chaseCam.update(
      dtMs / 1000,
      this.playerSim.state.pos,
      this.playerSim.state.heading,
      this.frame.lookDX,
      this.frame.lookDY,
    );

    for (const e of this.enemies) {
      if (e.koHandled) continue;
      this.copySimToCtrl(e.sim.state, e.ctrl, e.sim);
      this.applyPhaseClip(e.sim.state, e.ctrl);
      e.ctrl.updateFromSim(dtMs, 0);
    }
    for (const a of this.tutorialActors) {
      if (a.koHandled) continue;
      this.copySimToCtrl(a.sim.state, a.ctrl, a.sim);
      this.applyPhaseClip(a.sim.state, a.ctrl);
      a.ctrl.updateFromSim(dtMs, 0);
    }
  }

  private copySimToCtrl(sim: FighterState, ctrl: CharacterController, simRef: FighterSim): void {
    ctrl.pos.set(sim.pos.x, sim.pos.y, sim.pos.z);
    ctrl.vel.set(simRef.horizontalVelX, sim.velY, simRef.horizontalVelZ);
    ctrl.heading = sim.heading;
    ctrl.stance = sim.stance === 'downed' ? 'standing' : sim.stance;
    ctrl.grounded = sim.stance !== 'airborne' && sim.stance !== 'downed';
    ctrl.crouching = simRef.isCrouching;
    ctrl.downed = sim.phase.t === 'downed';
  }

  private applyPhaseClip(sim: FighterState, ctrl: CharacterController): void {
    const phase = sim.phase.t;
    const moveId = sim.phase.moveId;
    switch (phase) {
      case 'startup':
      case 'active':
      case 'recovery':
        if (moveId) ctrl.setPhaseOverride(moveClipKey(moveId));
        else ctrl.clearPhaseOverride();
        break;
      case 'hitstun':
      case 'downed':
      case 'reverseAttempt':
        ctrl.setPhaseOverride('hurt');
        break;
      case 'ko':
        ctrl.setPhaseOverride('koFlail');
        break;
      default:
        ctrl.clearPhaseOverride();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Actor management
  // -------------------------------------------------------------------------

  private clearActors(arr: EnemyActor[]): void {
    for (const a of arr) removeEnemyActor(this.sceneBundle.scene, a);
    arr.length = 0;
  }

  private clearAllActors(): void {
    this.clearActors(this.enemies);
    this.clearActors(this.tutorialActors);
    this.rebuildWorld();
  }

  private spawnSandboxEnemies(): void {
    // Legacy sandbox: two patrolling wolves (Task 17/18 verify layout).
    this.enemies.push(
      createEnemyActor(
        'wolf', 'dummy', { x: 0, z: -3 }, Math.PI,
        (sim) => new Brain(sim, DIFFICULTY.normal, mulberry32(WORLD_RNG_SEED + 2)),
        this.sceneBundle.scene,
      ),
      createEnemyActor(
        'wolf', 'wolf2', { x: -6, z: -3 }, Math.PI,
        (sim) => new Brain(sim, DIFFICULTY.normal, mulberry32(WORLD_RNG_SEED + 5)),
        this.sceneBundle.scene,
      ),
    );
    this.rebuildWorld();
  }

  private rebuildWorld(): void {
    this.world.fighters = [
      this.playerSim.state,
      ...this.enemies.map((e) => e.sim.state),
      ...this.tutorialActors.map((a) => a.sim.state),
    ];
    this.brainWorld.allies = this.enemies.filter((e) => e.brain !== null).map((e) => e.sim.state);
    this.brainWorld.enemies = [this.playerSim.state];
  }

  // -------------------------------------------------------------------------
  // Dev handles
  // -------------------------------------------------------------------------

  get devHandles(): {
    chaseCam: ChaseCamera;
    playerSim: FighterSim;
    dummySim: FighterSim | undefined;
    timescale: Timescale;
    ragdolls: readonly RagdollHandle[];
    world: FighterSimWorld;
    fx: FxParticles;
    wind: WindSystem;
    bushField: BushField;
    brain: Brain | undefined;
    drops: WeaponDrops | null;
    enemies: readonly EnemyActor[];
    /** Arena mode switch for browser tooling. */
    startArena: () => void;
    startTutorial: () => void;
  } {
    return {
      chaseCam: this.chaseCam,
      playerSim: this.playerSim,
      dummySim: this.enemies[0]?.sim,
      timescale: this.timescale,
      ragdolls: this.ragdolls,
      world: this.world,
      fx: this.fx,
      wind: this.wind,
      bushField: this.bushField,
      brain: this.enemies[0]?.brain ?? undefined,
      drops: this.drops,
      enemies: this.enemies,
      startArena: () => this.startArena(),
      startTutorial: () => this.startTutorial(),
    };
  }
}