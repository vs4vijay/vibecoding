import * as THREE from 'three';
import { FixedLoop } from './core/loop';
import { Timescale } from './core/timescale';
import { ChaseCamera } from './render/camera';
import { createScene } from './render/scene';
import { DebugStats } from './render/debugStats';
import { FxParticles, HEAVY_LAND_MIN_FALL_MPS, WindParticles, PickupVisuals } from './render/fx';
import { addBoulders, addBushes, addGrassTufts, type SwayField } from './render/scene';
import { SPECIES } from './data/species';
import { buildRig, type Rig } from './actors/skeleton';
import { ClipPlayer } from './actors/clips';
import { CharacterController } from './actors/controller';
import { FighterSim, type FighterSimWorld, type HitEvent } from './combat/stateMachine';
import { isSpecialMove } from './combat/bodymoves';
import { applyHit } from './combat/hitdetect';
import { ScoreLedger } from './combat/scoring';
import { CONTEXT_CROUCH_PICKUP_MS, HITSTOP_MS, KO_SLOWMO_SCALE, KO_SLOWMO_MS, WORLD_RNG_SEED, PICKUP_REACH_M, RUN_STANCE_SPEED } from './data/tuning';
import { WEAPONS } from './data/weapons';
import { heightAt } from './world/terrain';
import { PhysicsWorld } from './world/physics';
import { WindSystem } from './world/wind';
import { InputManager, type InputFrame } from './core/input';
import { BushField, type SpawnPoint } from './world/bushes';
import { BOULDER_WALLS, nearestWall, type WallProbe } from './world/walls';
import { WeaponDrops, type WeaponDropClass } from './world/projectiles';
import { spawnPickups } from './world/pickups';
import { emitHearing, type HearingEvent } from './ai/perception';
import { Brain, type BrainSenses, type BrainWorld } from './ai/brain';
import { DIFFICULTY } from './ai/difficulty';
import { mulberry32 } from './core/rng';
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

  // --- [Task 17] Arena dressing + senses ---------------------------------
  /** Slow random-walk wind — drives drift particles, sway, and AI scent. */
  private readonly wind: WindSystem;
  /** Sight-blocking, rustle-emitting bush scatter. */
  readonly bushField: BushField;
  /** The dummy's brain — hears rustles through senses.heard. */
  private readonly brain: Brain;
  /** Weapon drops (physics-backed, created in start() after Rapier init). */
  private drops: WeaponDrops | null = null;

  /** Per-step rustle buffer — reused, read by the brain's senses. */
  private readonly heardEvents: HearingEvent[] = [];
  /** Reused sense/world frames the brain reads (no per-step allocation). */
  private readonly senses: BrainSenses;
  private readonly brainWorld: BrainWorld;

  // Per-fighter nearest-wall probes [Task 14-P1 hard carry]. Persistent
  // objects mutated in place by nearestWall, swapped into world.wall per
  // consumer phase — zero per-step allocation.
  private readonly wallPlayer: WallProbe = { proximityM: Infinity, awayX: 1, awayZ: 0 };
  private readonly wallDummy: WallProbe = { proximityM: Infinity, awayX: 1, awayZ: 0 };
  /** Last-step positions for the fighters' rustle segments. */
  private readonly prevPlayerPos = { x: 0, z: 0 };
  private readonly prevDummyPos = { x: 0, z: -3 };
  /** Scratch for the per-step nearest-drop probe. */
  private readonly dropProbe: {
    id: number;
    weaponClass: WeaponDropClass;
    pos: { x: number; y: number; z: number };
  } = { id: 0, weaponClass: 'knife', pos: { x: 0, y: 0, z: 0 } };
  /** The player's previous phase moveId — pickup consumption is once per dispatch. */
  private lastPlayerMoveId: string | undefined = undefined;
  /** Sneak-hold tracking for the synthetic context-crouch press (see playerInput). */
  private crouchHoldMs = 0;
  private crouchContextArmed = true;
  /** Reused synthetic frame — no per-step allocation. */
  private readonly synthFrame: InputFrame = {
    moveX: 0,
    moveZ: 0,
    lookDX: 0,
    lookDY: 0,
    pressed: { attack: false, jump: false, crouch: false },
    held: { attack: false, jump: false, crouch: false },
  };

  // Dressing animation handles + visual clock (scaled time — hitstop
  // freezes the sway too).
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
    // --- [Task 17] Arena dressing (seeded — same layout every run) ---
    this.wind = new WindSystem(mulberry32(WORLD_RNG_SEED));
    const spawns: SpawnPoint[] = [
      { x: 0, z: 0 }, // player spawn
      { x: 0, z: -3 }, // dummy spawn
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

    // --- Dummy (wolf) — brain-driven [Task 17] ---
    const dummyRig = buildRig(SPECIES.wolf);
    this.dummyRig = dummyRig;
    this.sceneBundle.scene.add(dummyRig.root);
    const dummyClip = new ClipPlayer(dummyRig);
    this.dummyCtrl = new CharacterController(dummyRig, SPECIES.wolf, dummyClip);
    this.dummySim = new FighterSim('wolf', 'dummy', false);
    // Place dummy 3 m in front of player (player faces -Z at heading 0).
    this.dummySim.state.pos.z = -3;
    this.dummySim.state.heading = Math.PI; // face +Z toward player

    // [Task 17] The wolf's brain: rustles/noises reach it through
    // senses.heard; bushes block its sight. Its RNG stream is offset from
    // the scatter streams so consumers stay independent.
    this.brain = new Brain(this.dummySim, DIFFICULTY.normal, mulberry32(WORLD_RNG_SEED + 2));
    this.senses = { heard: this.heardEvents, wind: this.wind, scent: null };
    this.brainWorld = {
      enemies: [this.playerSim.state],
      allies: [],
      bushes: this.bushField.bushes,
    };

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
    // [Task 17] Boulder colliders from the same layout the scene meshes
    // render, then the fixed pickup loadout near the player spawn.
    for (const box of BOULDER_WALLS) this.physics.addBox(box.center, box.halfExtents);
    this.drops = new WeaponDrops(this.physics);
    spawnPickups(this.drops);
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
    this.fx.dispose();
    this.windFx.dispose();
    this.pickupFx.dispose();
    this.bushSway.dispose();
    this.grassSway.dispose();
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

    // [Task 17] Arena dressing animation: bushes/grass lean along the
    // wind, drift particles ride it, pickups bob. Runs on the scaled
    // clock so hitstop freezes the sway too.
    this.visualTimeSec += dtSec;
    const windVec = this.wind.vector;
    this.bushSway.update(this.visualTimeSec, windVec);
    this.grassSway.update(this.visualTimeSec, windVec);
    this.windFx.update(realDtMs * scale, windVec, this.playerSim.state.pos);
    if (this.drops !== null) this.pickupFx.update(this.visualTimeSec, this.drops);

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

    // [Task 17] Wind random-walk (sim state: seeded, drives dressing + AI).
    this.wind.update(dtMs);

    // [Task 17] Bush rustles: this step checks the movement the fighters
    // made LAST step (prevPos → pos segment), then rolls prevPos forward
    // at the end. Events land in the reused buffer the brain reads below.
    this.heardEvents.length = 0;
    this.rustleFor(this.playerSim.state, this.prevPlayerPos, dtMs);
    this.rustleFor(this.dummySim.state, this.prevDummyPos, dtMs);

    // [Task 14-P1 hard carry] Populate the shared snapshot's wall probe
    // per consumer: each sim, and each attacker's hit application, must
    // read ITS OWN nearest-wall — the probe is swapped in before every
    // phase that can read it. Zero-alloc: persistent probe objects whose
    // fields nearestWall mutates in place.
    this.world.wall = this.probeWall(this.playerSim.state.pos, this.wallPlayer);
    this.playerSim.update(dtMs, this.playerInput(dtMs), this.world);

    // [Task 17] Dummy input comes from its brain (hears the rustle
    // buffer; investigates). Emitted screams are drained — the player has
    // no hearing consumer yet (Task 18 owns multi-AI hearing).
    this.brain.drainEvents();
    const aiFrame = this.brain.update(dtMs, this.senses, this.brainWorld);
    this.world.wall = this.probeWall(this.dummySim.state.pos, this.wallDummy);
    this.dummySim.update(dtMs, aiFrame, this.world);

    // Collect + apply hits (player → dummy) using pre-allocated arrays.
    // world.wall points at the ATTACKER's probe here — applySpecialStrike
    // reads it lazily (wallKick gate + away-direction launch).
    this.world.wall = this.probeWall(this.playerSim.state.pos, this.wallPlayer);
    const pHits = this.playerSim.collectHits(this.playerVictims);
    for (const hit of pHits) this.landHit(hit, this.playerSim);

    this.world.wall = this.probeWall(this.dummySim.state.pos, this.wallDummy);
    const dHits = this.dummySim.collectHits(this.dummyVictims);
    for (const hit of dHits) this.landHit(hit, this.dummySim);

    // [Task 17] Crouch-pickup bridge: the nearest-drop probe drives
    // weaponOnGroundNearby (resolver's pickupOrContext row) and consumes
    // the drop into the player's hand when the move dispatches.
    this.updatePlayerPickup();

    // Roll prev positions forward for the next step's rustle segment.
    const pp = this.playerSim.state.pos;
    this.prevPlayerPos.x = pp.x;
    this.prevPlayerPos.z = pp.z;
    const dp = this.dummySim.state.pos;
    this.prevDummyPos.x = dp.x;
    this.prevDummyPos.z = dp.z;

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
   * One fighter's bush-rustle check. The gait (loud run vs quiet ease) is
   * derived from actual displacement — any fast crossing counts, including
   * a fighter riding a knockback launch through a canopy.
   */
  private rustleFor(state: FighterSim['state'], prev: { x: number; z: number }, dtMs: number): void {
    const speed = Math.hypot(state.pos.x - prev.x, state.pos.z - prev.z) / (dtMs / 1000);
    const event = this.bushField.rustleCheck(state.pos, prev, speed > RUN_STANCE_SPEED);
    if (event !== null) emitHearing(this.heardEvents, event);
  }

  /**
   * Nearest-wall probe into a persistent scratch object, shaped for the
   * world snapshot: returns the probe, or undefined in the open field.
   */
  private probeWall(pos: { x: number; z: number }, out: WallProbe): WallProbe | undefined {
    return nearestWall(pos, BOULDER_WALLS, out) ? out : undefined;
  }

  /**
   * Player-side pickup logic [Task 17, per weaponsLogic's split]: the
   * per-step nearest-drop probe feeds weaponOnGroundNearby; when the
   * resolver's pickupOrContext move dispatches, the probed drop is removed
   * from the world and re-armed in the fighter's hand from WEAPONS.
   */
  private updatePlayerPickup(): void {
    if (this.drops === null) return;
    const s = this.playerSim.state;
    const found = this.drops.nearestInto(s.pos, PICKUP_REACH_M, this.dropProbe);
    this.world.weaponOnGroundNearby = found;

    // Consume exactly once per pickupOrContext dispatch (the move enters
    // recovery for 250 ms — without the edge detect the bent-over commit
    // would vacuum every drop in reach one per step).
    const moveId = s.phase.moveId;
    const dispatched = moveId === 'pickupOrContext' && this.lastPlayerMoveId !== 'pickupOrContext';
    this.lastPlayerMoveId = moveId;
    if (!found || !dispatched) return;

    this.drops.remove(this.dropProbe.id);
    const def = WEAPONS[this.dropProbe.weaponClass];
    s.weapon = def.id;
    s.durability = def.durability;
  }

  /**
   * Assemble the player's input frame for this step.
   *
   * [Task 17] Sneak-hold pickup: the resolver's context branch (crouched +
   * press edge → pickupOrContext) can never fire from raw DOM input — a
   * crouch press edge always arrives while still standing (the crouched
   * stance only exists while the key is HELD, and holding produces no new
   * edges). So when the player has sneak-held crouch next to a ground
   * weapon for CONTEXT_CROUCH_PICKUP_MS (past the reverse-press window —
   * a hold never reads as a reversal), the game layer injects exactly one
   * synthetic crouch press. The sim cannot tell it from a real keypress —
   * that is the game layer's input-assembly contract. Rearmed when the
   * key is released, so each hold picks up at most one drop.
   */
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
  /** F3 dev lines: wind, wall probe, brain state, last-heard marker. */
  private debugInfo(): string {
    const w = this.wind.vector;
    const deg = ((Math.atan2(w.z, w.x) * 180) / Math.PI + 360) % 360;
    // The persistent player probe (the shared world.wall swaps per phase —
    // reading it here would show the dummy's values half the time).
    const wall = this.wallPlayer;
    const heard = this.brain.lastHeard;
    const wallLine =
      wall !== undefined
        ? `${wall.proximityM.toFixed(2)}m away(${wall.awayX.toFixed(2)}, ${wall.awayZ.toFixed(2)})`
        : 'open';
    const heardLine = heard !== null ? ` heard(${heard.x.toFixed(1)}, ${heard.z.toFixed(1)})` : '';
    return [
      `wind: ${deg.toFixed(0)}deg str ${this.wind.strength.toFixed(2)} vec(${w.x.toFixed(2)}, ${w.z.toFixed(2)})`,
      `wall(player): ${wallLine}`,
      `ai: ${this.brain.state}${heardLine}`,
      `bushes: ${this.bushField.bushes.length}  pickups(on ground): ${this.world.weaponOnGroundNearby ? 'yes' : 'no'}`,
    ].join('\n');
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
    /** [Task 17] verification handles: wind, bush layout, wolf brain, drops. */
    wind: WindSystem;
    bushField: BushField;
    brain: Brain;
    drops: WeaponDrops | null;
  } {
    return {
      chaseCam: this.chaseCam,
      playerSim: this.playerSim,
      dummySim: this.dummySim,
      timescale: this.timescale,
      ragdolls: this.ragdolls,
      world: this.world,
      fx: this.fx,
      wind: this.wind,
      bushField: this.bushField,
      brain: this.brain,
      drops: this.drops,
    };
  }
}
