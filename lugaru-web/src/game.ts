import * as THREE from 'three';
import { FixedLoop } from './core/loop';
import { Timescale } from './core/timescale';
import { InputManager } from './core/input';
import { ChaseCamera } from './render/camera';
import { createScene } from './render/scene';
import { DebugStats } from './render/debugStats';
import { SPECIES } from './data/species';
import { buildRig } from './actors/skeleton';
import { ClipPlayer } from './actors/clips';
import { CharacterController } from './actors/controller';
import { FighterSim, type FighterSimWorld } from './combat/stateMachine';
import { applyHit } from './combat/hitdetect';
/**
 * Map a move's clip name to the CLIPS key actually available in clipsData.
 * The move table uses generic names ('punch', 'kick') while the animation
 * library has specific variants ('punchR', 'kickFront').  This lookup falls
 * back to 'idle' for unmapped clips so the rig never freezes on an unknown
 * pose.
 */
function moveClipKey(moveId: string): string {
  const m: Record<string, string> = {
    punch: 'punchR',
    doublePunch: 'punchL',
    kick: 'kickFront',
    runningKick: 'kickFront',
    sweep: 'sweep',
  };
  return m[moveId] ?? 'idle';
}

/**
 * Game — owns the combat simulation loop, rendering, and input.
 *
 * The renderer is read-only over sim state: FighterSim owns positions,
 * headings, stances, and phases; Game copies them into CharacterController
 * for display each frame.  No backflow from renderer → FighterSim.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly input: InputManager;
  private readonly sceneBundle: ReturnType<typeof createScene>;
  private readonly camera3d: THREE.PerspectiveCamera;
  private readonly chaseCam: ChaseCamera;
  private readonly debug: DebugStats | null;

  private readonly playerSim: FighterSim;
  private readonly dummySim: FighterSim;
  private readonly playerCtrl: CharacterController;
  private readonly dummyCtrl: CharacterController;

  private readonly simLoop: FixedLoop;
  private readonly timescale: Timescale;
  private readonly world: FighterSimWorld;

  private frame: ReturnType<InputManager['sample']>;
  private lastMs = 0;
  private running = false;
  private animationId = 0;
  private resizeHandler: (() => void) | null = null;

  // Track previous KO state to fire slow-mo once per transition.
  private dummyWasKO = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // --- Scene & camera ---
    this.sceneBundle = createScene(canvas);
    this.camera3d = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    this.chaseCam = new ChaseCamera(this.camera3d);

    // --- Debug stats (dev only) ---
    this.debug = import.meta.env.DEV
      ? new DebugStats(document.getElementById('app')!)
      : null;

    // --- Input ---
    this.input = new InputManager();
    this.input.attach(canvas);

    // --- Player (rabbit) ---
    const playerRig = buildRig(SPECIES.rabbit);
    this.sceneBundle.scene.add(playerRig.root);
    const playerClip = new ClipPlayer(playerRig);
    this.playerCtrl = new CharacterController(playerRig, SPECIES.rabbit, playerClip);
    this.playerSim = new FighterSim('rabbit', 'player', true);

    // --- Dummy (wolf) — static, null input ---
    const dummyRig = buildRig(SPECIES.wolf);
    this.sceneBundle.scene.add(dummyRig.root);
    const dummyClip = new ClipPlayer(dummyRig);
    this.dummyCtrl = new CharacterController(dummyRig, SPECIES.wolf, dummyClip);
    this.dummySim = new FighterSim('wolf', 'dummy', false);

    // Pointer lock on click — Game owns its canvas.
    canvas.addEventListener('click', () => this.input.requestPointerLock());
    // Place dummy 3 m in front of player (player faces -Z at heading 0).
    this.dummySim.state.pos.z = -3;
    this.dummySim.state.heading = Math.PI; // face +Z toward player

    // Shared world snapshot (mutated in-place each step — no allocation).
    this.world = {
      fighters: [this.playerSim.state, this.dummySim.state],
      downedBodyNearby: false,
      weaponOnGroundNearby: false,
    };

    // --- Sim loop (60 Hz fixed) ---
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

  /** Start the game loop. */
  start(): void {
    if (this.running) return;
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
    this.input.detach();
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
    this.simLoop.advance(realDtMs * scale);

    // Render: copy sim → controller → rig (read-only).
    this.updateRender(realDtMs);

    this.debug?.frame(realDtMs);
    this.sceneBundle.renderer.render(this.sceneBundle.scene, this.camera3d);
  }

  // --- sim step (called by FixedLoop) ------------------------------------

  private simStep(dtMs: number): void {
    // Player: use sampled input; dummy: null (stands still).
    this.playerSim.update(dtMs, this.frame, this.world);
    this.dummySim.update(dtMs, null, this.world);

    // Collect + apply hits (player → dummy).
    const pHits = this.playerSim.collectHits([this.dummySim.state]);
    for (const hit of pHits) {
      applyHit(hit, [this.playerSim.state, this.dummySim.state]);
      this.timescale.hitstop(90);
    }

    // Collect + apply hits (dummy → player — usually empty for a null-input dummy).
    const dHits = this.dummySim.collectHits([this.playerSim.state]);
    for (const hit of dHits) {
      applyHit(hit, [this.playerSim.state, this.dummySim.state]);
      this.timescale.hitstop(90);
    }

    // KO slow-mo: fire once per transition into KO.
    if (!this.dummyWasKO && this.dummySim.state.phase.t === 'ko') {
      this.timescale.slowmo(0.25, 900);
      this.dummyWasKO = true;
    }
  }

  // --- render sync -------------------------------------------------------

  private updateRender(dtMs: number): void {
    // Player
    this.copySimToCtrl(this.playerSim.state, this.playerCtrl);
    this.applyPhaseClip(this.playerSim.state, this.playerCtrl);
    this.playerCtrl.updateFromSim(dtMs, this.chaseCam.yaw);
    this.chaseCam.update(
      dtMs / 1000,
      this.playerSim.state.pos,
      this.playerSim.state.heading,
      this.frame.lookDX,
      this.frame.lookDY,
    );

    // Dummy
    this.copySimToCtrl(this.dummySim.state, this.dummyCtrl);
    this.applyPhaseClip(this.dummySim.state, this.dummyCtrl);
    this.dummyCtrl.updateFromSim(dtMs, 0);
  }

  /** Copy FighterSim state into CharacterController for rendering (read-only). */
  private copySimToCtrl(sim: FighterSim['state'], ctrl: CharacterController): void {
    ctrl.pos.set(sim.pos.x, sim.pos.y, sim.pos.z);
    ctrl.vel.set(0, sim.velY, 0);
    ctrl.heading = sim.heading;
  ctrl.stance = sim.stance === 'downed' ? 'standing' : sim.stance;
    ctrl.grounded = sim.stance !== 'airborne' && sim.stance !== 'downed';
  }

  /** Map FighterSim phase → combat clip override on the controller. */
  private applyPhaseClip(sim: FighterSim['state'], ctrl: CharacterController): void {
    const phase = sim.phase.t;
    const moveId = sim.phase.moveId;

    switch (phase) {
      case 'startup':
      case 'active':
      case 'recovery':
        if (moveId) ctrl.setPhaseOverride(moveClipKey(moveId), false);
        else ctrl.clearPhaseOverride();
        break;
      case 'hitstun':
        ctrl.setPhaseOverride('hurt', false);
        break;
      case 'downed':
        ctrl.setPhaseOverride('hurt', false);
        break;
      case 'ko':
        ctrl.setPhaseOverride('koFlail', true);
        break;
      case 'reverseAttempt':
        ctrl.setPhaseOverride('hurt', false);
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
  } {
    return {
      chaseCam: this.chaseCam,
      playerSim: this.playerSim,
      dummySim: this.dummySim,
      timescale: this.timescale,
    };
  }
}
