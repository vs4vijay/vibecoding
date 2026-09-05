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
  AI_STRAFE_FLIP_MAX_MS,
  AI_STRAFE_FLIP_MIN_MS,
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

const NEUTRAL: InputFrame = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  pressed: { attack: false, jump: false, crouch: false },
  held: { attack: false, jump: false, crouch: false },
};

/** Point the fighter's heading toward world position (x, z). */
function faceToward(f: FighterState, x: number, z: number): void {
  const dx = x - f.pos.x;
  const dz = z - f.pos.z;
  f.heading = Math.atan2(-dx, -dz);
}

/** Forward-move input toward the position the fighter is already facing. */
function approachInput(): InputFrame {
  return { ...NEUTRAL, moveZ: -1 };
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

  /** Any hearing events this brain has emitted since the last drain. */
  collectEvents(): HearingEvent[] {
    const drained = this.events.slice();
    this.events.length = 0;
    return drained;
  }

  /** Advance the brain one fixed step and produce its InputFrame. */
  update(dtMs: number, senses: BrainSenses, world: BrainWorld): InputFrame {
    const solar = this.fighter.state;
    this.simMs += dtMs;
    this.attackCooldownMs = Math.max(0, this.attackCooldownMs - dtMs);

    // Downed overrides every other state until the body recovers.
    if (solar.phase.t === 'downed' || solar.phase.t === 'ko') {
      this.aistate = 'downed';
      return { ...NEUTRAL };
    }

    // Hear events: a loud sound within radius becomes an investigate memory.
    const listener = { pos: solar.pos, species: solar.species };
    for (const e of senses.heard) {
      if (hear(listener, e)) {
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
        this.events.push({ kind: 'scream', pos: { x: solar.pos.x, z: solar.pos.z }, loudness: 1.5 });
        this.screamed = true;
      }
      return this.fleeInput(world.allies, target, dist);
    }
    this.screamed = false;

    // Fresh sight refreshes memory toward the live target.
    if (visible && target !== null) {
      this.memory = { pos: { x: target.pos.x, z: target.pos.z }, t: this.simMs };
    }

    // Scent: a strong scent underfoot with no known target starts an
    // investigation toward the scent source/footprint.
    const scent = senses.scent?.intensityAt(solar.pos) ?? 0;
    if (scent > 0 && this.memory === null && target === null) {
      // Investigate the local scent gradient (downhill is toward the source).
      this.memory = { pos: { x: solar.pos.x, z: solar.pos.z }, t: this.simMs };
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
    return this.patrolInput();
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
      faceToward(s, ally.pos.x, ally.pos.z);
      return approachInput();
    }
    // No ally: back away from the threat.
    if (target) {
      const awayX = s.pos.x * 2 - target.pos.x;
      const awayZ = s.pos.z * 2 - target.pos.z;
      faceToward(s, awayX, awayZ);
      return approachInput();
    }
    return { ...NEUTRAL };
  }

  /** Move toward an investigated point (heard/scented). */
  private investigateInput(pos: { x: number; z: number }): InputFrame {
    faceToward(this.fighter.state, pos.x, pos.z);
    return approachInput();
  }

  /** Orbit the target in the [AI_CIRCLE_MIN, AI_CIRCLE_MAX] band, stroking. */
  private circleInput(target: FighterState, dist: number): InputFrame {
    const s = this.fighter.state;
    if (this.simMs >= this.strafeFlipAtMs) this.scheduleStrafeFlip();
    if (dist > AI_CIRCLE_MAX_M || dist < AI_CIRCLE_MIN_M) {
      // Out of band: close in or back up, favoring the near orbit edge.
      return dist > AI_CIRCLE_MAX_M ? approachInput() : this.strafeInput(s);
    }
    return this.strafeInput(s);
  }

  /** Strafe sideways into an orbit; the flip timer has randomized the side. */
  private strafeInput(s: FighterState): InputFrame {
    return { ...NEUTRAL, moveX: this.strafeDir };
  }

  /** Close to melee reach, then commit a pickAttack every cooldown. */
  private engageInput(target: FighterState, dist: number): InputFrame {
    const s = this.fighter.state;
    faceToward(s, target.pos.x, target.pos.z);

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
      if (choice === 'reverseAttempt') {
        this.attackCooldownMs = AI_ATTACK_COOLDOWN_MS;
        return { ...NEUTRAL, pressed: { attack: false, jump: false, crouch: true } };
      }
      if (choice !== null) {
        const def = MOVES[choice];
        if (dist <= def.rangeM) {
          this.attackCooldownMs = AI_ATTACK_COOLDOWN_MS;
          return { ...NEUTRAL, pressed: { attack: true, jump: false, crouch: false } };
        }
      }
    }

    // Not ready or out of reach: close the gap.
    return dist > 1.0 ? approachInput() : { ...NEUTRAL };
  }

  /** Wander to random waypoints inside the patrol radius with brief pauses. */
  private patrolInput(): InputFrame {
    const s = this.fighter.state;
    if (this.waypoint === null) {
      this.waypoint = {
        x: this.spawn.x + (this.rng() * 2 - 1) * AI_PATROL_RADIUS_M,
        z: this.spawn.z + (this.rng() * 2 - 1) * AI_PATROL_RADIUS_M,
      };
      this.wanderPauseMs = 0;
    }
    const dx = this.waypoint.x - s.pos.x;
    const dz = this.waypoint.z - s.pos.z;
    const reached = Math.hypot(dx, dz) < 0.5;
    if (reached) {
      if (this.wanderPauseMs <= 0) {
        this.wanderPauseMs = AI_PATROL_PAUSE_MS;
        this.waypoint = null;
        return { ...NEUTRAL };
      }
      this.wanderPauseMs -= 16;
      return { ...NEUTRAL };
    }
    faceToward(s, this.waypoint.x, this.waypoint.z);
    return approachInput();
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
