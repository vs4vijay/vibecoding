/**
 * Brain — enemy FSM driving a FighterSim with the same InputFrame a human
 * produces (the sim cannot tell them apart; core design invariant).
 *
 * States: patrol (waypoint wander) → investigate (lastHeard/scent source) →
 * circle (orbit 4–6m with strafe flips) → engage (≤ AI_ENGAGE_RANGE_M) →
 * flee (hp < 25%: run to nearest ally, scream once) ; downed overrides all.
 *
 * Pure sim: no three/Rapier, no Date.now/Math.random. All randomness flows
 * through the injected seeded `rng`; all timers accumulate the injected
 * `dtMs`, so the same seed reproduces the same behavior.
 */

import { FighterSim } from '../combat/stateMachine';
import type { FighterState } from '../combat/stateMachine';
import type { InputFrame } from '../core/input';
import type { Rng } from '../core/rng';
import { canSee, hear } from './perception';
import type { Bush, HearingEvent, HearingKind } from './perception';
import { DIFFICULTY } from './difficulty';
import type { DifficultyDef } from './difficulty';
import { pickAttack } from './engage';
import type { AttackTarget } from './engage';
import type { MoveId, MovePhase } from '../combat/types';
import {
  AI_ATTACK_COOLDOWN_MS,
  AI_CHASE_RANGE_M,
  AI_CIRCLE_MAX_M,
  AI_CIRCLE_MIN_M,
  AI_ENGAGE_RANGE_M,
  AI_FLEE_HP_FRACTION,
  AI_MEMORY_TIMEOUT_MS,
  AI_PATROL_PAUSE_MS,
  AI_PATROL_RADIUS_M,
  AI_SCREAM_LOUDNESS,
  AI_SCENT_PROBE_M,
  AI_STRAFE_FLIP_MAX_MS,
  AI_STRAFE_FLIP_MIN_MS,
  AI_WAYPOINT_REACHED_M,
  SCENT_DETECT_THRESHOLD,
} from '../data/tuning';
import { MOVES } from '../data/moves';

/** The brain's current FSM disposition. */
export type AiState = 'patrol' | 'investigate' | 'circle' | 'engage' | 'flee' | 'downed';

/** Per-frame transient sensory data the brain consumes. */
export interface BrainSenses {
  /** Sound events this frame; the brain hears those inside its radius. */
  heard: HearingEvent[];
  /** Wind vector, for scent-source investigation. */
  wind: { vector: { x: number; z: number } };
  /** Scent field; null when unmodelled. */
  scent: { intensityAt(pos: { x: number; z: number }): number } | null;
}

/** Snapshot world the brain reasons over. */
export interface BrainWorld {
  enemies: FighterState[];
  allies: FighterState[];
  bushes: Bush[];
}

/** A remembered target position (seen, heard, or scented). */
interface Memory {
  pos: { x: number; z: number };
  t: number; // sim ms when first remembered
}

/** Fresh neutral frame — new objects every call (callers may mutate). */
function neutralFrame(): InputFrame {
  return {
    moveX: 0,
    moveZ: 0,
    lookDX: 0,
    lookDY: 0,
    pressed: { attack: false, jump: false, crouch: false },
    held: { attack: false, jump: false, crouch: false },
  };
}

/**
 * Build movement input that walks the fighter from `from` toward `to` given
 * the fighter's CURRENT heading — the exact inverse of the sim's
 * heading-relative mapping (fwd = (-sin h, -cos h), right = (-fwd.z, fwd.x)).
 * The brain NEVER touches FighterState.heading: heading changes only via
 * the sim's own velocity-facing, exactly as it does for a human player
 * (core invariant — the sim cannot tell brain from human).
 */
function steerFrame(from: FighterState, to: { x: number; z: number }): InputFrame {
  const h = from.heading;
  const fx = -Math.sin(h);
  const fz = -Math.cos(h);
  const rx = -fz;
  const rz = fx;
  const dx = to.x - from.pos.x;
  const dz = to.z - from.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return neutralFrame();
  const nx = dx / len;
  const nz = dz / len;
  return {
    ...neutralFrame(),
    moveZ: -(nx * fx + nz * fz),
    moveX: nx * rx + nz * rz,
  };
}

/** Walk straight ahead in the fighter's current facing. */
function approachInput(): InputFrame {
  return { ...neutralFrame(), moveZ: -1 };
}

export class Brain {
  private readonly fighter: FighterSim;
  private readonly difficulty: DifficultyDef;
  private readonly rng: Rng;
  private readonly spawn: { x: number; z: number };

  private aistate: AiState = 'patrol';
  private simMs = 0;

  // Memory of a target (heard/scented/seen) plus its timestamp.
  private memory: Memory | null = null;
  // Flee scream fires exactly once per flee episode.
  private screamed = false;
  /** Position of the most recently HEARD sound (debug overlay marker). */
  private lastHeardPos: { x: number; z: number } | null = null;
  // Waypoint wander state.
  private waypoint: { x: number; z: number } | null = null;
  private wanderPauseMs = 0;
  // Circle orbital strafe state.
  private strafeDir: 1 | -1 = 1;
  private strafeFlipAtMs = 0;
  // Attack cadence.
  private attackCooldownMs = 0;

  /** Scream + other events the brain emits, drained by collectEvents(). */
  private readonly events: HearingEvent[] = [];

  constructor(fighter: FighterSim, difficulty: DifficultyDef = DIFFICULTY.normal, rng: Rng) {
    this.fighter = fighter;
    this.difficulty = difficulty;
    this.rng = rng;
    this.spawn = { x: fighter.state.pos.x, z: fighter.state.pos.z };
    this.scheduleStrafeFlip();
  }

  /** Current FSM disposition (read by tests and the game layer). */
  get state(): AiState {
    return this.aistate;
  }

  /** Position of the last sound this brain actually heard, or null. */
  get lastHeard(): { x: number; z: number } | null {
    return this.lastHeardPos;
  }

  /** Any hearing events this brain has emitted since the last drain. */
  collectEvents(): HearingEvent[] {
    const drained = this.events.slice();
    this.events.length = 0;
    return drained;
  }

  /**
   * Drop any emitted events without allocating a drained copy — the
   * game-loop path calls this every step purely so the internal buffer
   * cannot grow unbounded. (`collectEvents` is the content-returning twin
   * used by tests.)
   */
  drainEvents(): number {
    const n = this.events.length;
    this.events.length = 0;
    return n;
  }

  /** Advance the brain one fixed step and produce its InputFrame. */
  update(dtMs: number, senses: BrainSenses, world: BrainWorld): InputFrame {
    const solar = this.fighter.state;
    this.simMs += dtMs;
    this.attackCooldownMs = Math.max(0, this.attackCooldownMs - dtMs);

    // Downed overrides every other state until the body recovers.
    if (solar.phase.t === 'downed' || solar.phase.t === 'ko') {
      this.aistate = 'downed';
      return neutralFrame();
    }

    // Memory expiry scales with difficulty memoryLen (normalized: normal=4
    // → the flat base timeout; harder brains remember longer).
    const memoryTimeout = AI_MEMORY_TIMEOUT_MS * (this.difficulty.memoryLen / 4);
    if (this.memory !== null && this.simMs - this.memory.t >= memoryTimeout) {
      this.memory = null;
    }

    // Hear events: a loud sound within radius becomes an investigate memory.
    const listener = { pos: solar.pos, species: solar.species };
    for (const e of senses.heard) {
      if (hear(listener, e)) {
        this.lastHeardPos = { x: e.pos.x, z: e.pos.z };
        this.memory = { pos: { x: e.pos.x, z: e.pos.z }, t: this.simMs };
      }
    }

    const target = this.nearestEnemy(world.enemies);
    const visible = target !== null && canSee(
      { pos: solar.pos, heading: solar.heading, species: solar.species },
      { pos: target.pos, heading: target.heading, species: 'rabbit', crouched: target.stance === 'crouched' },
      { bushes: world.bushes },
    );
    const dist = target === null ? Infinity : Math.hypot(
      target.pos.x - solar.pos.x,
      target.pos.z - solar.pos.z,
    );

    // Flee first: too hurt to fight — run to the nearest ally and scream once.
    if (solar.hp < solar.maxHp * AI_FLEE_HP_FRACTION) {
      this.aistate = 'flee';
      if (!this.screamed) {
        this.events.push({ kind: 'scream', pos: { x: solar.pos.x, z: solar.pos.z }, loudness: AI_SCREAM_LOUDNESS });
        this.screamed = true;
      }
      return this.fleeInput(world.allies, target, dist);
    }
    this.screamed = false;

    // Fresh sight refreshes memory toward the live target.
    if (visible && target !== null) {
      this.memory = { pos: { x: target.pos.x, z: target.pos.z }, t: this.simMs };
    }

    // Scent: a strong local scent with no known target sends the brain
    // probing UPWIND of its position (scent travels downwind from source).
    const scent = senses.scent?.intensityAt(solar.pos) ?? 0;
    if (scent > SCENT_DETECT_THRESHOLD && this.memory === null && target === null) {
      const wx = senses.wind?.vector.x ?? 0;
      const wz = senses.wind?.vector.z ?? 0;
      this.memory = {
        pos: { x: solar.pos.x - wx * AI_SCENT_PROBE_M, z: solar.pos.z - wz * AI_SCENT_PROBE_M },
        t: this.simMs,
      };
    }

    // Engage when a visible target is inside the melee threshold.
    if (visible && target !== null && dist <= AI_ENGAGE_RANGE_M) {
      this.aistate = 'engage';
      return this.engageInput(target, dist);
    }

    // Chase a visible target that is out of melee but within pursuit reach.
    if (visible && target !== null && dist <= AI_CHASE_RANGE_M) {
      this.aistate = 'circle';
      return this.circleInput(target, dist);
    }

    // Investigate a remembered source while it is still fresh.
    if (this.memory !== null && this.simMs - this.memory.t < AI_MEMORY_TIMEOUT_MS) {
      this.aistate = 'investigate';
      return this.investigateInput(this.memory.pos);
    }

    // Otherwise wander.
    this.aistate = 'patrol';
    return this.patrolInput(dtMs);
  }

  private nearestEnemy(enemies: FighterState[]): FighterState | null {
    if (enemies.length === 0) return null;
    let best: FighterState | null = null;
    let bestD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.pos.x - this.fighter.state.pos.x, e.pos.z - this.fighter.state.pos.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Run to the nearest ally; fall back to backing away from the target. */
  private fleeInput(allies: FighterState[], target: FighterState | null, _dist: number): InputFrame {
    const s = this.fighter.state;
    if (allies.length > 0) {
      let ally = allies[0];
      let best = Infinity;
      for (const a of allies) {
        const d = Math.hypot(a.pos.x - s.pos.x, a.pos.z - s.pos.z);
        if (d < best) {
          best = d;
          ally = a;
        }
      }
      return steerFrame(s, { x: ally.pos.x, z: ally.pos.z });
    }
    // No ally: back away from the threat.
    if (target) {
      const awayX = s.pos.x * 2 - target.pos.x;
      const awayZ = s.pos.z * 2 - target.pos.z;
      return steerFrame(s, { x: awayX, z: awayZ });
    }
    return neutralFrame();
  }

  /** Move toward an investigated point (heard/scented). */
  private investigateInput(pos: { x: number; z: number }): InputFrame {
    return steerFrame(this.fighter.state, pos);
  }

  /** Orbit the target in the [AI_CIRCLE_MIN, AI_CIRCLE_MAX] band, stroking. */
  private circleInput(target: FighterState, dist: number): InputFrame {
    const s = this.fighter.state;
    if (this.simMs >= this.strafeFlipAtMs) this.scheduleStrafeFlip();
    if (dist > AI_CIRCLE_MAX_M) {
      // Too far: close toward the target.
      return steerFrame(s, { x: target.pos.x, z: target.pos.z });
    }
    // Inside the band (or too close): orbit via a point strafed sideways
    // from the target — steering keeps the heading on the arc every step.
    const toX = target.pos.x - s.pos.x;
    const toZ = target.pos.z - s.pos.z;
    const len = Math.hypot(toX, toZ) || 1;
    const orbit = {
      x: target.pos.x + (-toZ / len) * this.strafeDir * AI_CIRCLE_MIN_M,
      z: target.pos.z + (toX / len) * this.strafeDir * AI_CIRCLE_MIN_M,
    };
    if (dist < AI_CIRCLE_MIN_M) {
      // Too close: back off toward the mirrored orbit point.
      return steerFrame(s, { x: orbit.x * 2 - s.pos.x, z: orbit.z * 2 - s.pos.z });
    }
    return steerFrame(s, orbit);
  }

  /** Close to melee reach, then commit a pickAttack every cooldown. */
  private engageInput(target: FighterState, dist: number): InputFrame {
    const s = this.fighter.state;

    const activeMove = currentMoveOf(target);
    const attackTarget: AttackTarget = {
      dist,
      stance: target.stance === 'downed' ? 'downed' : target.stance,
      activeMove,
    };
    const antiRep = s.antiRep ?? { lastMoveIds: [] };

    if (this.attackCooldownMs <= 0 && canCommit(s.phase.t)) {
      const choice = pickAttack(
        { hasWeapon: s.weapon },
        attackTarget,
        this.rng,
        antiRep,
        { reactionMs: this.difficulty.reactionMs, reversalChance: this.difficulty.reversalChance },
      );
      // Aggression scales attack cadence: harder brains re-arm faster.
      const cooldown = AI_ATTACK_COOLDOWN_MS / this.difficulty.aggression;
      if (choice === 'reverseAttempt') {
        this.attackCooldownMs = cooldown;
        return { ...neutralFrame(), pressed: { attack: false, jump: false, crouch: true } };
      }
      if (choice !== null) {
        const def = MOVES[choice];
        if (dist <= def.rangeM) {
          this.attackCooldownMs = cooldown;
          return { ...neutralFrame(), pressed: { attack: true, jump: false, crouch: false } };
        }
      }
    }

    // Not ready, out of reach, or just repositioning: KEEP CLOSING. In this
    // sim heading follows velocity, so a stationary fighter can never turn
    // to face its target — constant approach (like a human holding forward)
    // keeps the facing fresh and lets swings connect.
    return steerFrame(s, { x: target.pos.x, z: target.pos.z });
  }

  /** Wander to random waypoints inside the patrol radius with brief pauses. */
  private patrolInput(dtMs: number): InputFrame {
    const s = this.fighter.state;
    if (this.waypoint === null) {
      this.waypoint = {
        x: this.spawn.x + (this.rng() * 2 - 1) * AI_PATROL_RADIUS_M,
        z: this.spawn.z + (this.rng() * 2 - 1) * AI_PATROL_RADIUS_M,
      };
      this.wanderPauseMs = AI_PATROL_PAUSE_MS;
    }
    const dx = this.waypoint.x - s.pos.x;
    const dz = this.waypoint.z - s.pos.z;
    if (Math.hypot(dx, dz) < AI_WAYPOINT_REACHED_M) {
      // Pause at the waypoint (decrement by the REAL step, not a hardcoded
      // 16), then pick a fresh one once the pause elapses.
      this.wanderPauseMs -= dtMs;
      if (this.wanderPauseMs <= 0) this.waypoint = null;
      return neutralFrame();
    }
    return steerFrame(s, this.waypoint);
  }

  private scheduleStrafeFlip(): void {
    this.strafeFlipAtMs =
      this.simMs + AI_STRAFE_FLIP_MIN_MS + Math.floor(this.rng() * (AI_STRAFE_FLIP_MAX_MS - AI_STRAFE_FLIP_MIN_MS + 1));
    this.strafeDir = this.rng() < 0.5 ? 1 : -1;
  }
}

// --- Module-private helpers -------------------------------------------------

/** True when the fighter can start a fresh move (not committed mid-strike). */
function canCommit(phase: string): boolean {
  return phase === 'idle' || phase === 'recovery' || phase === 'active';
}

/** The inbound move view the brain passes to pickAttack, if any. */
function currentMoveOf(t: FighterState): AttackTarget['activeMove'] {
  const p = t.phase;
  if ((p.t === 'startup' || p.t === 'active') && t.currentMove) {
    return { id: t.currentMove.id as MoveId, phase: p.t as MovePhase, phaseMsElapsed: t.moveElapsedMs };
  }
  return undefined;
}
