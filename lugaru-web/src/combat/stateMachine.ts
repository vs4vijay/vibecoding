/**
 * FighterSim — the per-fighter state machine driving one combatant.
 *
 * Owns a plain, serializable FighterState snapshot (renderer/AI read it
 * directly); the sim never touches three/Rapier. Each fixed step:
 *
 *   input edge → resolveAction (Task 6 resolver) → move timeline
 *   startup → active (lunge) → recovery → idle, with hitstun/downed/ko
 *   overlays, then gravity/terrain integration — dummies included.
 *
 * Hit geometry lives in hitdetect.ts; this module consumes its events and
 * tracks swing identity so no victim is struck twice by one swing.
 */

import type { InputFrame } from '../core/input';
import { heightAt } from '../world/terrain';
import { SPECIES } from '../data/species';
import type { SpeciesDef } from '../data/species';
import {
  ACCEL,
  GRAVITY,
  INPUT_BUFFER_MS,
  JUMP_SPEED,
  RECOVERY_CHAIN_MIN_MS,
  RUN_STANCE_SPEED,
  TARGET_SENSE_RADIUS_M,
  TURN_RATE,
} from '../data/tuning';
import { MOVES } from '../data/moves';
import type {
  CombatantSnapshot,
  MoveDef,
  MoveId,
  MovePhase,
  Stance,
  TargetSnapshot,
  WeaponClass,
  WorldContext,
} from './types';
import { resolveAction } from './resolver';
import { applyHit, findHit, forwardXZ } from './hitdetect';

// ---------------------------------------------------------------------------
// Plain fighter state — serializable snapshot, no class instances inside.
// ---------------------------------------------------------------------------

/** One named stretch of the fighter's update loop. */
export interface FighterPhase {
  t: 'idle' | 'move' | 'startup' | 'active' | 'recovery' | 'hitstun' | 'downed' | 'ko';
  /** Move owning this phase (startup/active/recovery only). */
  moveId?: MoveId;
  /** ms remaining before the phase auto-transitions; Infinity while idle. */
  phaseMsLeft: number;
}

/** Anti-repetition bookkeeping — populated from Task 8 onward. */
export interface AntiRepState {
  lastMoveIds: string[];
}

/** Long-lived status flags; the injury model (Task 9) extends semantics. */
export interface FighterFlags {
  bleeding: boolean;
  limping: boolean;
  unconscious: boolean;
  invulnerableAirFlipMs: number;
}

/**
 * Everything one combatant is at a sim instant. Plain data: safe to copy for
 * rendering, AI snapshots and tests.
 */
export interface FighterState {
  id: string;
  species: 'rabbit' | 'wolf';
  team: 0 | 1;
  hp: number;
  maxHp: number;
  pos: { x: number; y: number; z: number };
  velY: number;
  heading: number;
  stance: Stance | 'downed';
  phase: FighterPhase;
  currentMove?: MoveDef;
  moveElapsedMs: number;
  /** Weapon tier held right now; null = unarmed (Task 13 wires pickups). */
  weapon: WeaponClass | null;
  flags: FighterFlags;
  /**
   * Anti-repetition tracking — deliberately UNINITIALIZED in Task 7; Task 8's
   * antirepetition module owns when and how it gets filled.
   */
  antiRep?: AntiRepState;
  pendingReverseOf?: string;
}

/** One landed strike, produced by findHit, consumed by applyHit. */
export interface HitEvent {
  attackerId: string;
  victimId: string;
  moveId: MoveId;
  /** Unit vector pointing from attacker toward the victim (ground plane). */
  dirVector: { x: number; z: number };
}

/**
 * The slice of world truth one fighter's step may read. `fighters` carries
 * the roster (self included) as plain states; the booleans gate crouch
 * context moves.
 */
export interface FighterSimWorld {
  fighters: FighterState[];
  downedBodyNearby: boolean;
  weaponOnGroundNearby: boolean;
}

// Kinematics constants live in data/tuning.ts, shared with
// actors/controller.ts (fix round F2) so sim and rig never drift.

/** Move `v` toward `target` by at most `maxDelta`. */
function approach(v: number, target: number, maxDelta: number): number {
  return v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
}

/** Shortest-arc angle interpolation: a→b by fraction t∈[0..1]. */
function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Shared null-target view; resolver treats an empty id as "no one there". */
const NO_TARGET: TargetSnapshot = {
  id: '',
  dist: Infinity,
  relAngle: Math.PI,
  stance: 'standing',
  isDowned: false,
  airborne: false,
  facingMe: false,
  unaware: true,
};

// ---------------------------------------------------------------------------
// FighterSim
// ---------------------------------------------------------------------------

export class FighterSim {
  readonly state: FighterState;

  private readonly def: SpeciesDef;

  /** True while the body touches terrain (mirrors controller.grounded). */
  private grounded = true;
  /** Crouch hold accumulator, grown with the same dt clamp kinematics use. */
  private crouchHeldMs = 0;
  private crouching = false;
  /** Horizontal locomotion velocity (m/s), intent-driven like controller. */
  private locoVelX = 0;
  private locoVelZ = 0;
  /** Victims already struck this swing — the plan's `swingHitSet`. */
  private readonly swingHitSet = new Set<string>();
  /** True once the current move has been observed in active frames. */
  private swungThisMove = false;

  /** Buffered press waiting for the running move to finish. */
  private bufferedActionId: MoveId | null = null;
  private bufferMsLeft = 0;

  /** World view for the current step (resolver context reads it). */
  private world: FighterSimWorld = {
    fighters: [],
    downedBodyNearby: false,
    weaponOnGroundNearby: false,
  };

  constructor(species: 'rabbit' | 'wolf', id: string, isPlayer: boolean) {
    this.def = SPECIES[species];
    const gy = heightAt(0, 0);
    this.state = {
      id,
      species,
      team: isPlayer ? 0 : 1,
      hp: this.def.maxHp,
      maxHp: this.def.maxHp,
      pos: { x: 0, y: gy, z: 0 },
      velY: 0,
      heading: 0,
      stance: 'standing',
      phase: { t: 'idle', phaseMsLeft: Infinity },
      moveElapsedMs: 0,
      weapon: null,
      flags: {
        bleeding: false,
        limping: false,
        unconscious: false,
        invulnerableAirFlipMs: 0,
      },
    };
  }

  /**
   * Advance one fixed step. `input === null` marks a dummy fighter: physics
   * and timers still run, but nothing is resolved or buffered.
   */
  update(dtMs: number, input: InputFrame | null, world: FighterSimWorld): void {
    const dt = Math.min(dtMs, 50); // same tab-away clamp as controller kinematics
    this.world = world;

    if (input !== null) {
      this.crouching = input.held.crouch;
      if (input.held.crouch) this.crouchHeldMs += dt;
      else this.crouchHeldMs = 0;
    } else {
      this.crouching = false;
      this.crouchHeldMs = 0;
    }

    const p = this.state.phase.t;
    const pressedAttack = input !== null && input.pressed.attack;
    const pressedJump = input !== null && input.pressed.jump;
    if (
      input !== null &&
      (pressedAttack || pressedJump) &&
      (p === 'idle' || p === 'recovery' || p === 'active')
    ) {
      this.consumeAttack(input, p);
    }

    this.advancePhase(dt);
    this.applyBuffer(dt);
    this.integrate(dt, input === null ? 0 : input.moveX, input === null ? 0 : input.moveZ);
  }

  /**
   * Poll attack geometry against `victims` and return freshly landed hits.
   * Call once per step per attacker: the first poll that sees active frames
   * arms the swing, and every victim answered here stays suppressed until
   * the next swing begins (no double hits).
   *
   * This method does NOT mutate victims — it only reports. The caller owns
   * application: feed each returned event through hitdetect.applyHit with a
   * fighter list that contains both parties (tested design; keeps hp/knock-
   * down authority explicit at the call site).
   */
  collectHits(victims: FighterState[]): HitEvent[] {
    if (this.state.phase.t === 'active' && !this.swungThisMove) {
      this.swungThisMove = true;
      this.swingHitSet.clear(); // fresh swing
    }
    const events = findHit(this.state, victims);
    if (events.length === 0) return [];
    const landed: HitEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (this.swingHitSet.has(e.victimId)) continue;
      this.swingHitSet.add(e.victimId);
      landed.push(e);
    }
    return landed;
  }

  /** Resolve a fresh press through the resolver and dispatch the result. */
  private consumeAttack(input: InputFrame, phaseAtPress: FighterPhase['t']): void {
    const button = input.pressed.attack ? 'attack' : 'jump';
    const action = resolveAction(
      { button, heldAttack: input.held.attack },
      this.snapshot(),
      this.worldCtx(),
    );
    // Reverse attempts route through Task 8's reversal module; ignored here.
    if (action === null || action.kind !== 'move') return;

    if (phaseAtPress === 'recovery') {
      // Recovery's tail chains freely into the next move; earlier presses
      // buffer like any other busy-phase press.
      if (this.state.phase.phaseMsLeft <= RECOVERY_CHAIN_MIN_MS) {
        this.startMove(action.id);
        return;
      }
    }
    if (
      phaseAtPress === 'startup' ||
      phaseAtPress === 'active' ||
      phaseAtPress === 'recovery'
    ) {
      // Real buffer: one queued action with its own expiry window. It ticks
      // every step in applyBuffer and fires iff still alive when the running
      // move ends.
      this.bufferedActionId = action.id;
      this.bufferMsLeft = INPUT_BUFFER_MS;
      return;
    }
    this.startMove(action.id);
  }

  /** Open the move timeline for a resolver-approved action. */
  private startMove(id: MoveId): void {
    const def = MOVES[id];
    if (def === undefined) return;
    this.bufferedActionId = null;
    this.bufferMsLeft = 0;
    this.swungThisMove = false;

    if (!hasTimeline(def)) {
      // Zero-duration utility rows (jump/hop): pure impulse, no animation lock.
      if (id === 'jump' || id === 'hop') {
        this.state.velY = JUMP_SPEED;
        this.grounded = false;
        this.state.stance = 'airborne';
      }
      return;
    }
    this.state.currentMove = def;
    this.state.moveElapsedMs = 0;
    this.state.phase =
      def.startupMs > 0
        ? { t: 'startup', moveId: id, phaseMsLeft: def.startupMs }
        : def.activeMs > 0
          ? { t: 'active', moveId: id, phaseMsLeft: def.activeMs }
          : { t: 'recovery', moveId: id, phaseMsLeft: def.recoveryMs };
  }

  // -- phase progression ----------------------------------------------------

  /** Tick the timeline: startup → active (lunge) → recovery → idle. */
  private advancePhase(dt: number): void {
    const s = this.state;
    switch (s.phase.t) {
      case 'hitstun':
      case 'downed':
        s.phase.phaseMsLeft -= dt;
        if (s.phase.phaseMsLeft <= 0) {
          s.phase.t = 'idle';
          s.phase.moveId = undefined;
          s.phase.phaseMsLeft = Infinity;
          s.stance = 'standing';
        }
        break;
      case 'ko':
        break; // terminal until Task 14's ragdoll/respawn layer takes over
      case 'startup':
      case 'active':
      case 'recovery': {
        const def = s.currentMove!;
        s.moveElapsedMs += dt;
        s.phase.phaseMsLeft -= dt;
        if (s.phase.phaseMsLeft > 0) {
          if (s.phase.t === 'active') this.applyLunge(def, dt);
          break;
        }
        // Boundary crossed this step; sub-frame remainder is dropped.
        if (s.phase.t === 'startup' && def.activeMs > 0) {
          s.phase.t = 'active';
          s.phase.phaseMsLeft = def.activeMs;
        } else if ((s.phase.t === 'startup' || s.phase.t === 'active') && def.recoveryMs > 0) {
          s.phase.t = 'recovery';
          s.phase.phaseMsLeft = def.recoveryMs;
        } else {
          this.endMove();
        }
        break;
      }
      case 'idle':
      case 'move':
        break;
    }
  }

  /** Forward dash along heading — lunging moves, active frames only. */
  private applyLunge(def: MoveDef, dtMs: number): void {
    const speed = def.lungeSpeed ?? 0;
    if (speed <= 0 || dtMs <= 0) return;
    const fwd = forwardXZ(this.state.heading);
    this.state.pos.x += fwd.x * speed * (dtMs / 1000);
    this.state.pos.z += fwd.z * speed * (dtMs / 1000);
  }

  /** Close the move timeline. */
  private endMove(): void {
    this.state.currentMove = undefined;
    this.state.moveElapsedMs = 0;
    this.state.phase.t = 'idle';
    this.state.phase.moveId = undefined;
    this.state.phase.phaseMsLeft = Infinity;
  }

  /**
   * Tick the buffered press (F1 real-buffer semantics): its window decrements
   * every step; when the running move ends it fires iff the window is still
   * alive, otherwise it expires unspent.
   */
  private applyBuffer(dt: number): void {
    const id = this.bufferedActionId;
    if (id === null) return;
    this.bufferMsLeft -= dt; // window ticks every step, busy or not
    if (this.state.phase.t !== 'idle') {
      if (this.bufferMsLeft <= 0) this.bufferedActionId = null; // expired waiting
      return;
    }
    if (this.bufferMsLeft > 0) this.startMove(id); // still alive → fire
    else this.bufferedActionId = null; // window spent unspent
  }

  // -- physics --------------------------------------------------------------

  /** Integrate locomotion + gravity + ground; stance follows phase/motion. */
  private integrate(dt: number, moveX: number, moveZ: number): void {
    const s = this.state;
    const dtS = dt / 1000;

    // Horizontal intent: moveZ −1 = forward along heading, moveX = strafe
    // (controller semantics); speed capped by stance.
    const cap = this.crouching ? this.def.crouchSpeed : this.def.runSpeed;
    const len = Math.hypot(moveX, moveZ);
    const wishing = len > 0 && s.phase.t !== 'downed' && s.phase.t !== 'ko' && s.phase.t !== 'hitstun';
    const fwd0 = forwardXZ(s.heading);
    const fdx0 = fwd0.x;
    const fdz0 = fwd0.z;
    const rdx0 = -fdz0;
    const rdz0 = fdx0;
    const wx = wishing ? (fdx0 * -moveZ + rdx0 * moveX) * cap : 0;
    const wz = wishing ? (fdz0 * -moveZ + rdz0 * moveX) * cap : 0;
    const wLen = Math.hypot(wx, wz);
    this.locoVelX = approach(this.locoVelX, wx, ACCEL * dtS);
    this.locoVelZ = approach(this.locoVelZ, wz, ACCEL * dtS);

    s.pos.x += this.locoVelX * dtS;
    s.pos.z += this.locoVelZ * dtS;

    // Face the movement direction when it is meaningful.
    const hSpeed = Math.hypot(this.locoVelX, this.locoVelZ);
    if (hSpeed > 0.5) {
      const target = Math.atan2(-this.locoVelX, -this.locoVelZ);
      s.heading = angleLerp(s.heading, target, 1 - Math.exp(-TURN_RATE * dtS));
    }

    s.velY += GRAVITY * dtS;
    s.pos.y += s.velY * dtS;

    const gy = heightAt(s.pos.x, s.pos.z);
    if (s.pos.y <= gy) {
      s.pos.y = gy;
      if (s.velY < 0) s.velY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (s.flags.invulnerableAirFlipMs > 0) {
      s.flags.invulnerableAirFlipMs = Math.max(0, s.flags.invulnerableAirFlipMs - dt);
    }

    const p = s.phase.t;
    if (p === 'downed' || p === 'ko') {
      s.stance = 'downed';
    } else if (!this.grounded) {
      s.stance = 'airborne';
    } else {
      const hSpeed = Math.hypot(this.locoVelX, this.locoVelZ);
      s.stance =
        this.crouching ? 'crouched' : hSpeed > RUN_STANCE_SPEED ? 'running' : 'standing';
    }
  }

  // -- resolver views -------------------------------------------------------

  /** Build the resolver-facing snapshot for this instant. */
  private snapshot(): CombatantSnapshot {
    const s = this.state;
    const t = s.phase.t;
    let movePhase: MovePhase | undefined;
    if (t === 'startup') movePhase = 'startup';
    else if (t === 'active') movePhase = 'active';
    else if (t === 'recovery') movePhase = 'recovery';
    return {
      id: s.id,
      stance: s.stance === 'downed' ? 'standing' : s.stance,
      isRunning: s.stance === 'running',
      crouchHeldMs: this.crouchHeldMs, // accumulated under the kinematics dt clamp
      pos: s.pos,
      heading: s.heading,
      hasWeapon: null,
      wallProximityM: Infinity,
      nearestTarget: nearestTargetOf(s, this.world),
      currentMove:
        movePhase !== undefined
          ? { id: s.phase.moveId!, phase: movePhase, phaseMsElapsed: s.moveElapsedMs }
          : undefined,
    };
  }

  /** World facts around this fighter for the resolver's context moves. */
  private worldCtx(): WorldContext {
    let downedBodyNearby = this.world.downedBodyNearby;
    const fighters = this.world.fighters;
    for (let i = 0; i < fighters.length; i++) {
      const f = fighters[i];
      if (f.id !== this.state.id && (f.phase.t === 'downed' || f.phase.t === 'ko')) {
        downedBodyNearby = true;
        break;
      }
    }
    return {
      downedBodyNearby,
      weaponOnGroundNearby: this.world.weaponOnGroundNearby,
      airborneSelf: !this.grounded,
    };
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

function hasTimeline(def: MoveDef): boolean {
  return def.startupMs + def.activeMs + def.recoveryMs > 0;
}

/**
 * Nearest other fighter inside the sense radius, as a plain TargetSnapshot.
 * Stance/unaware mapping are resolver-facing views refined by later tasks
 * (AI LOS, wall probes, stealth awareness).
 */
function nearestTargetOf(self: FighterState, world: FighterSimWorld): TargetSnapshot {
  const fighters = world.fighters;
  let best: FighterState | null = null;
  let bestDistSq = TARGET_SENSE_RADIUS_M * TARGET_SENSE_RADIUS_M;
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i];
    if (f.id === self.id) continue;
    const dx = f.pos.x - self.pos.x;
    const dz = f.pos.z - self.pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      best = f;
    }
  }
  if (best === null) return NO_TARGET;
  const dx = best.pos.x - self.pos.x;
  const dz = best.pos.z - self.pos.z;
  const dist = Math.sqrt(bestDistSq);
  // Signed angle from heading to victim via cross/dot atan2.
  const fwd = forwardXZ(self.heading);
  const cross = fwd.x * dz - fwd.z * dx;
  const dot = fwd.x * dx + fwd.z * dz;
  return {
    id: best.id,
    dist,
    relAngle: Math.atan2(cross, dot),
    stance: best.stance === 'downed' ? 'standing' : best.stance,
    isDowned: best.phase.t === 'downed' || best.phase.t === 'ko',
    airborne: best.stance === 'airborne',
    facingMe: facesToward(best, self),
    unaware: false, // stealth awareness lands with Task 18's FSM
    incomingAttack: undefined, // reversal wiring (Task 8) supplies real attacks
  };
}

/** True when `watcher`'s heading points back toward `other` within ~60°. */
const FACING_HALF_RAD = Math.PI / 3;

function facesToward(watcher: FighterState, other: FighterState): boolean {
  const w = forwardXZ(watcher.heading);
  const tox = other.pos.x - watcher.pos.x;
  const toz = other.pos.z - watcher.pos.z;
  const len = Math.hypot(tox, toz);
  if (len < 1e-6) return true;
  return (w.x * tox + w.z * toz) / len > Math.cos(FACING_HALF_RAD);
}


