import * as THREE from 'three';
import { FixedLoop } from './core/loop';
import { Timescale } from './core/timescale';
import { InputManager } from './core/input';
import { ChaseCamera } from './render/camera';
import { createScene } from './render/scene';
import { DebugStats } from './render/debugStats';
import { FxParticles, HEAVY_LAND_MIN_FALL_MPS } from './render/fx';
import { SPECIES } from './data/species';
import { buildRig, type Rig } from './actors/skeleton';
import { ClipPlayer } from './actors/clips';
import { CharacterController } from './actors/controller';
import { FighterSim, type FighterSimWorld, type HitEvent } from './combat/stateMachine';
import { isSpecialMove } from './combat/bodymoves';
import { applyHit } from './combat/hitdetect';
import { ScoreLedger } from './combat/scoring';
import { HITSTOP_MS, KO_SLOWMO_SCALE, KO_SLOWMO_MS } from './data/tuning';
import { heightAt } from './world/terrain';
import { PhysicsWorld } from './world/physics';
import { spawnRagdoll, type RagdollHandle } from './actors/ragdoll';

/**
 * MoveId → CLIPS key. MoveIds without a matching CLIPS entry fall back to
 * 'idle'. 'legSweep' → 'sweep'; 'runningKick' → 'kickFront'; 'punch'/
 * 'doublePunch' → 'punchR'/'punchL'; reversal/stun animations share the
 * 'hurt' pose as a placeholder.
 */
const MOVE_CLIP: Record<string, string> = {
  punch: 'punchR',
  doublePunch: 'punchL',
  runningKick: 'kickFront',
  legSweep: 'sweep',
  bodyThrow: 'hurt',
  counterThrow: 'hurt',
  flip: 'hurt',
  tackle: 'hurt',
};

function moveClipKey(moveId: string): string {
  return MOVE_CLIP[moveId] ?? 'idle';
}

/**
 * Game — owns the combat simulation loop, rendering, and input.
 *
 * The renderer is read-only over sim state: FighterSim owns positions,
 * headings, stances, and phases; Game copies them into CharacterController
 * for display each frame. No backflow from renderer → FighterSim.
 *
 * Rapier (Task 12) provides cosmetic dynamics only — KO ragdolls. It is
 * initialised asynchronously in start() before the first frame renders.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly input: InputManager;
  private readonly sceneBundle: ReturnType<typeof createScene>;
  private readonly camera3d: THREE.PerspectiveCamera;
  private readonly chaseCam: ChaseCamera;
  private readonly debug: DebugStats | null;

  /** [Task 14] Preallocated combat particles (blood puffs, dust rings). */
  private readonly fx: FxParticles;

  private readonly playerSim: FighterSim;
  private readonly dummySim: FighterSim;
  private readonly playerCtrl: CharacterController;
  private readonly dummyCtrl: CharacterController;
  private readonly dummyRig: Rig;

  private readonly simLoop: FixedLoop;
  private readonly timescale: Timescale;
  private readonly world: FighterSimWorld;
  // Reusable hit-victim arrays to avoid per-step allocation.
  private readonly playerVictims: [FighterSim['state']];
  private readonly dummyVictims: [FighterSim['state']];

  // Rapier cosmetic dynamics. Created async in start() because Rapier WASM
  // initialisation is asynchronous.
  private physics: PhysicsWorld | null = null;
  private readonly ragdolls: RagdollHandle[] = [];
  /** Direction of the most recent landed hit — ragdoll impulse uses it. */
  private lastHitDir = { x: 0, y: 0.4, z: -1 };

  private frame: ReturnType<InputManager['sample']>;
  private clickHandler: (() => void) | null = null;
  private animationId = 0;
  private resizeHandler: (() => void) | null = null;

  private lastMs = 0;
  private running = false;
  // Track previous KO state to fire slow-mo + ragdoll once per transition.
  private dummyWasKO = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // --- Scene & camera ---
    this.sceneBundle = createScene(canvas);
    this.camera3d = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    this.chaseCam = new ChaseCamera(this.camera3d);
    this.debug = import.meta.env.DEV
      ? new DebugStats(document.getElementById('app')!, () => this.playerSim.scoreTotal)
      : null;

    // [Task 14] Combat particles live in the render scene; the sim never
    // touches them — triggers are read off sim state each step.
    this.fx = new FxParticles(this.sceneBundle.scene);

    // --- Input ---
    this.input = new InputManager();
    this.input.attach(canvas);
    // Pointer lock on click — Game owns its canvas.
    this.clickHandler = () => this.input.requestPointerLock();
    canvas.addEventListener('click', this.clickHandler);

    // --- Player (rabbit) ---
    const playerRig = buildRig(SPECIES.rabbit);
    this.sceneBundle.scene.add(playerRig.root);
    const playerClip = new ClipPlayer(playerRig);
    this.playerCtrl = new CharacterController(playerRig, SPECIES.rabbit, playerClip);
    this.playerSim = new FighterSim('rabbit', 'player', true);
    // Score sink [Task 9/14]: every player award (reversals, style bonuses,
    // cannon/ninja/nice-aim) lands here; F3 shows the running total.
    this.playerSim.setScoreLedger(new ScoreLedger());

    // --- Dummy (wolf) — static, null input ---
    const dummyRig = buildRig(SPECIES.wolf);
    this.dummyRig = dummyRig;
    this.sceneBundle.scene.add(dummyRig.root);
    const dummyClip = new ClipPlayer(dummyRig);
    this.dummyCtrl = new CharacterController(dummyRig, SPECIES.wolf, dummyClip);
    this.dummySim = new FighterSim('wolf', 'dummy', false);
    // Place dummy 3 m in front of player (player faces -Z at heading 0).
    this.dummySim.state.pos.z = -3;
    this.dummySim.state.heading = Math.PI; // face +Z toward player

    // Shared world snapshot (mutated in-place each step — no allocation).
    this.world = {
      fighters: [this.playerSim.state, this.dummySim.state],
      downedBodyNearby: false,
      weaponOnGroundNearby: false,
    };
    // Reusable hit-victim arrays (no per-step allocation).
    this.playerVictims = [this.dummySim.state];
    this.dummyVictims = [this.playerSim.state];
    this.simLoop = new FixedLoop(1000 / 60, (dt) => this.simStep(dt));
    this.timescale = new Timescale();
    this.frame = this.input.sample();

    // --- Resize ---
    this.resizeHandler = this.resize.bind(this);
    window.addEventListener('resize', this.resizeHandler);
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.sceneBundle.renderer.setSize(w, h, false);
    this.sceneBundle.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera3d.aspect = w / h;
    this.camera3d.updateProjectionMatrix();
  }

  /**
   * Start the game loop. `mode` reserved for future use (sandbox/arena).
   * Async because Rapier WASM must initialise before the first frame; the
   * physics world powers KO ragdolls (cosmetic dynamics only).
   */
  async start(_mode: 'sandbox' = 'sandbox'): Promise<void> {
    if (this.running) return;
    this.physics = await PhysicsWorld.create(heightAt);
    this.running = true;
    this.lastMs = performance.now();
    this.tick();
  }

  /** Stop the game loop and release resources. */
  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationId);
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.clickHandler) {
      this.canvas.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
    this.input.detach();
    this.fx.dispose();
    this.sceneBundle.renderer.dispose();
    this.sceneBundle.scene.clear();
  }

  // --- render loop -------------------------------------------------------

  private tick(): void {
    if (!this.running) return;
    this.animationId = requestAnimationFrame(() => this.tick());

    const nowMs = performance.now();
    const realDtMs = Math.min(nowMs - this.lastMs, 100);
    this.lastMs = nowMs;

    // Sample input once per rendered frame; the fixed loop shares it.
    this.frame = this.input.sample();

    // Advance timescale (hitstop / slow-mo).
    const scale = this.timescale.update(realDtMs);

    // Step the combat sim with the scaled time (hitstop freezes, slow-mo
    // slows it).
    this.simLoop.advance(realDtMs * scale);

    // Step cosmetic physics with the same scaled time so ragdolls slow-mo
    // with the rest of the world.
    const dtSec = (realDtMs * scale) / 1000;
    if (this.physics && dtSec > 0) {
      this.physics.step(dtSec);
      for (const rd of this.ragdolls) rd.update();
    }

    // [Task 14] Combat particles tick with the same scaled time.
    this.fx.update(realDtMs * scale);

    // Render: copy sim → controller → rig (read-only), scaled by timescale
    // so hitstop freezes animation and slow-mo slows it.
    this.updateRender(realDtMs * scale);

    this.debug?.frame(realDtMs);
    this.sceneBundle.renderer.render(this.sceneBundle.scene, this.camera3d);
  }

  // --- sim step (called by FixedLoop) ------------------------------------

  private simStep(dtMs: number): void {
    // Capture pre-step velocities: a fighter whose fast fall the ground
    // eats this step just HEAVY-LANDED (Task 14 dust ring).
    const playerVy = this.playerSim.state.velY;
    const dummyVy = this.dummySim.state.velY;

    // Player: use sampled input; dummy: null (stands still).
    this.playerSim.update(dtMs, this.frame, this.world);
    this.dummySim.update(dtMs, null, this.world);

    // Collect + apply hits (player → dummy) using pre-allocated arrays.
    const pHits = this.playerSim.collectHits(this.playerVictims);
    for (const hit of pHits) this.landHit(hit, this.playerSim);

    // Collect + apply hits (dummy → player — usually empty for a null-input dummy).
    const dHits = this.dummySim.collectHits(this.dummyVictims);
    for (const hit of dHits) this.landHit(hit, this.dummySim);

    // [Task 14] Heavy land: downward velocity just eaten by the ground —
    // knockdown arcs and KO pops kick up a dust ring at the impact point.
    if (playerVy <= -HEAVY_LAND_MIN_FALL_MPS && this.playerSim.state.velY === 0) {
      this.fx.spawnDustRing(this.playerSim.state.pos);
    }
    if (dummyVy <= -HEAVY_LAND_MIN_FALL_MPS && this.dummySim.state.velY === 0) {
      this.fx.spawnDustRing(this.dummySim.state.pos);
    }

    // KO: slow-mo once per transition, then hand the body to a ragdoll so
    // it flops along the killing-blow direction.
    if (!this.dummyWasKO && this.dummySim.state.phase.t === 'ko') {
      this.timescale.slowmo(KO_SLOWMO_SCALE, KO_SLOWMO_MS);
      this.dummyWasKO = true;
      if (this.physics) {
        const dir = this.lastHitDir;
        const rd = spawnRagdoll(this.physics, this.dummyRig, {
          dir: { x: dir.x, y: 0.45, z: dir.z },
          force: SPECIES.wolf.massKg * 1.5,
        });
        this.ragdolls.push(rd);
        this.fx.spawnDustRing(this.dummySim.state.pos);
      }
    }
  }

  /**
   * Apply one collected hit [Task 14 routing]: specials flow through the
   * attacker sim's applySpecialStrike (uniform effect consumption + score
   * awards), plain hits through hitdetect.applyHit. Emits hit feedback:
   * hitstop on every landed strike, a blood puff when a blade opens a
   * fresh wound.
   */
  private landHit(hit: HitEvent, attackerSim: FighterSim): void {
    let victim: FighterSim['state'] | undefined;
    const fighters = this.world.fighters;
    for (let i = 0; i < fighters.length && victim === undefined; i++) {
      if (fighters[i].id === hit.victimId) victim = fighters[i];
    }
    if (victim === undefined) return;
    const wasBleeding = victim.flags.bleeding;
    let applied = true;
    if (isSpecialMove(hit.moveId)) {
      // A gate-rejected special (target left range/state mid-swing) is a
      // whiff: no hitstop, no camera kick, no blood.
      applied = attackerSim.applySpecialStrike(hit, this.world.fighters) !== null;
    } else {
      applyHit(hit, this.world.fighters);
    }
    if (!applied) return;
    this.lastHitDir = { x: hit.dirVector.x, y: 0, z: hit.dirVector.z };
    this.timescale.hitstop(HITSTOP_MS);
    if (victim.flags.bleeding && !wasBleeding) this.fx.spawnBloodPuff(victim.pos);
  }

  // --- render sync -------------------------------------------------------

  private updateRender(dtMs: number): void {
    // Player
    this.copySimToCtrl(this.playerSim.state, this.playerCtrl, this.playerSim);
    this.applyPhaseClip(this.playerSim.state, this.playerCtrl);
    this.playerCtrl.updateFromSim(dtMs, this.chaseCam.yaw);
    this.chaseCam.update(
      dtMs / 1000,
      this.playerSim.state.pos,
      this.playerSim.state.heading,
      this.frame.lookDX,
      this.frame.lookDY,
    );

    // Dummy — once ragdolled, the physics owns its bone matrices; skip the
    // controller/clip path so it doesn't fight the ragdoll for the rig.
    if (this.ragdolls.length === 0) {
      this.copySimToCtrl(this.dummySim.state, this.dummyCtrl, this.dummySim);
      this.applyPhaseClip(this.dummySim.state, this.dummyCtrl);
      this.dummyCtrl.updateFromSim(dtMs, 0);
    }
  }

  /** Copy FighterSim state into CharacterController for rendering (read-only). */
  private copySimToCtrl(sim: FighterSim['state'], ctrl: CharacterController, simRef: FighterSim): void {
    ctrl.pos.set(sim.pos.x, sim.pos.y, sim.pos.z);
    // Horizontal velocity from sim for locomotion clip selection (run vs idle).
    ctrl.vel.set(simRef.horizontalVelX, sim.velY, simRef.horizontalVelZ);
    ctrl.heading = sim.heading;
    ctrl.stance = sim.stance === 'downed' ? 'standing' : sim.stance;
    ctrl.grounded = sim.stance !== 'airborne' && sim.stance !== 'downed';
    ctrl.crouching = simRef.isCrouching;
    ctrl.downed = sim.phase.t === 'downed';
  }

  /** Map FighterSim phase → combat clip override on the controller. */
  private applyPhaseClip(sim: FighterSim['state'], ctrl: CharacterController): void {
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
      default: // idle, move
        ctrl.clearPhaseOverride();
        break;
    }
  }

  /** Dev-only verification handles (tree-shaken from production builds). */
  get devHandles(): {
    chaseCam: ChaseCamera;
    playerSim: FighterSim;
    dummySim: FighterSim;
    timescale: Timescale;
    ragdolls: readonly RagdollHandle[];
    /** Shared sim world — dev tools can probe wall/dummy state for verification. */
    world: FighterSimWorld;
    fx: FxParticles;
  } {
    return {
      chaseCam: this.chaseCam,
      playerSim: this.playerSim,
      dummySim: this.dummySim,
      timescale: this.timescale,
      ragdolls: this.ragdolls,
      world: this.world,
      fx: this.fx,
    };
  }
}
