/**
 * Body mechanics [Task 14] — the special-move effect layer.
 *
 * applySpecial is THE one pure dispatcher every signature move flows
 * through: given the move id, the attacker's plain state, the target (or
 * null) and a small strike-context, it answers with a plain SpecialEffect
 * (or null when the move's gate rejects the strike). It never mutates
 * anything, never reads the clock, never touches three/Rapier — the
 * FighterSim consumes the returned data uniformly in its phase/move code
 * and owns every state change, kill attribution and score award.
 *
 * Contract [clarified by the controller]:
 * - Gating lives here at strike time (the resolver offers a move, the
 *   world may have changed by the time it lands): a rejected strike
 *   returns null and the sim treats it as a whiff.
 * - Effect numbers echo the MOVES row the move resolves from — this
 *   module never invents a second copy of a timing/damage table (rows:
 *   src/data/moves.ts; constants: src/data/tuning.ts).
 * - scoreEvent marks an award that lands when the effect HITS (leg
 *   cannon's style points, the corpse's Nice Aim); killScoreEvent marks
 *   one that lands only when that damage KOs the victim (wall-kick
 *   style bonus). The sim checks hp after application and awards — the
 *   pure layer stays side-effect-free.
 */

import type { FighterState } from './stateMachine';
import { forwardXZ } from './hitdetect';
import { MOVES } from '../data/moves';
import type { MoveId } from './types';
import {
  BODY_THROW_IMPACT_DAMAGE,
  BODY_THROW_SPEED_MPS,
  FLIP_STUN_MS,
  KNOCKDOWN_VELY,
  LEG_CANNON_KNOCK_SPEED_MPS,
  WALL_KICK_LAUNCH_MPS,
} from '../data/tuning';
import type { ScoreEvent } from './scoring';

/** Plain-state view of the fighter (or corpse) a special strike touches. */
export type TargetRef = FighterState;

/** Everything the dispatcher may read about the world at strike time. */
export interface SpecialCtx {
  /** Distance to the nearest wall in meters; Infinity = open field. */
  wallProximityM: number;
  /** Unit ground-plane vector pointing AWAY from that wall, if known. */
  wallAwayDir?: { x: number; z: number };
  /** Attacker holds crouch at strike time (tackle pin → disarm). */
  crouchHeld: boolean;
  /** Stage-2 bodyThrow call: a thrown corpse just connected. */
  corpseImpact?: boolean;
}

/**
 * One special strike's outcome — plain data the state machine applies
 * uniformly. Every field is optional; null effects (gate rejected) are
 * the dispatcher's way of saying "whiff".
 */
export interface SpecialEffect {
  /** Base HP damage to the victim (before the species punchDmgMult). */
  damage?: number;
  /** The victim is knocked prone (downed). */
  knockdown?: boolean;
  /** The attacker falls too (air-grab commit, leg-cannon rules apply). */
  selfKnockdown?: boolean;
  /** The victim is stunned for this long (mid-air flip shockwave). */
  stunMs?: number;
  /** Launch velocity (m/s) handed to the VICTIM (knockback / slam). */
  impulse?: { x: number; y: number; z: number };
  /** Launch velocity (m/s) handed to the ATTACKER (wall-kick bounce). */
  attackerImpulse?: { x: number; y: number; z: number };
  /** The victim's held weapon is knocked loose (tackle pin). */
  disarm?: boolean;
  /** The victim's corpse is launched as a projectile (body throw). */
  corpseLaunch?: boolean;
  /** Award granted when the effect lands a hit (sim side, on application). */
  scoreEvent?: ScoreEvent;
  /** Award granted only when this damage KOs the victim (sim side). */
  killScoreEvent?: ScoreEvent;
}

/** A corpse left the thrower's hands. game.ts bridges the flight; the
 *  impact comes back through FighterSim.applyCorpseImpact. */
export interface CorpseThrowEvent {
  type: 'corpseThrow';
  victimId: string;
  /** Ground-plane direction of the throw. */
  dir: { x: number; z: number };
  /** Launch speed (m/s). */
  speed: number;
}

/** The signature-move set — hit routing checks this before applying. */
const SPECIAL_MOVES: Partial<Record<MoveId, true>> = {
  tackle: true,
  soccerKick: true,
  airGrab: true,
  wallKick: true,
  legCannon: true,
  bodyThrow: true,
  flip: true,
};

/** True when `moveId`'s strike must flow through applySpecial. */
export function isSpecialMove(moveId: MoveId): boolean {
  return SPECIAL_MOVES[moveId] === true;
}

/** A fighter is strike-able ground meat: downed, KO'd, or flagged so. */
function isCorpse(f: TargetRef): boolean {
  return f.phase.t === 'downed' || f.phase.t === 'ko' || f.stance === 'downed';
}

/** Ground-plane distance between two fighters. */
function distXZ(a: FighterState, b: FighterState): number {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
}

/** Forward launch vector scaled to `speed`, with a knockdown-sized pop. */
function launch(heading: number, speed: number): { x: number; y: number; z: number } {
  // Trig noise (forwardXZ(±π/2).z ≈ 5e-16) must never become motion:
  // denormal-scale components snap to zero so axis-aligned launches stay
  // exactly on their axis.
  const f = forwardXZ(heading);
  const x = Math.abs(f.x) < 1e-12 ? 0 : f.x * speed;
  const z = Math.abs(f.z) < 1e-12 ? 0 : f.z * speed;
  return { x, y: KNOCKDOWN_VELY, z };
}

/**
 * Resolve one special strike into plain effect data, or null when the
 * move's strike-time gate rejects it. Pure: reads states, returns data.
 */
export function applySpecial(
  move: MoveId,
  attacker: FighterState,
  target: TargetRef | null,
  ctx: SpecialCtx,
): SpecialEffect | null {
  const def = MOVES[move];
  if (def === undefined) return null;

  switch (move) {
    // ------------------------------------------------------------------
    // Run + crouch-release + jump near an enemy: shoulder-charge them
    // prone for the row's light damage; holding crouch through the pin
    // strips their weapon [brief Task 14].
    // ------------------------------------------------------------------
    case 'tackle': {
      if (target === null || distXZ(attacker, target) > def.rangeM) return null;
      return {
        damage: def.damage,
        knockdown: true,
        ...(ctx.crouchHeld ? { disarm: true } : {}),
      };
    }

    // ------------------------------------------------------------------
    // Stomp on downed meat. The row carries no reversalWindow — there is
    // nothing to reverse against a grounded body: unblockable by design.
    // ------------------------------------------------------------------
    case 'soccerKick': {
      if (target === null || !isCorpse(target)) return null;
      if (distXZ(attacker, target) > def.rangeM) return null;
      return { damage: def.damage };
    }

    // ------------------------------------------------------------------
    // Catch an airborne enemy overhead and slam them into the ground:
    // victim and attacker both end up downed. A mid-air flip (flip
    // invulnerability window) cancels the grab [spec §3.1 footnote].
    // ------------------------------------------------------------------
    case 'airGrab': {
      if (target === null) return null;
      if (target.stance !== 'airborne') return null;
      if (target.flags.invulnerableAirFlipMs > 0) return null;
      if (distXZ(attacker, target) > def.rangeM) return null;
      return {
        damage: def.damage,
        knockdown: true,
        selfKnockdown: true,
        impulse: { x: 0, y: -KNOCKDOWN_VELY, z: 0 }, // slam downward
      };
    }

    // ------------------------------------------------------------------
    // Kick off a wall within requiresWallWithinM: the attacker launches
    // away from the wall (toward whatever they were facing) and the arc
    // strike downs for the row's heavy damage. Killing with it is a
    // style bonus [spec §3.6].
    // ------------------------------------------------------------------
    case 'wallKick': {
      const within = def.requiresWallWithinM ?? 0;
      if (ctx.wallProximityM >= within) return null;
      if (target === null || distXZ(attacker, target) > def.rangeM) return null;
      const away = ctx.wallAwayDir ?? forwardXZ(attacker.heading);
      return {
        damage: def.damage,
        knockdown: true,
        attackerImpulse: { x: away.x * WALL_KICK_LAUNCH_MPS, y: 0, z: away.z * WALL_KICK_LAUNCH_MPS },
        killScoreEvent: { type: 'STYLE_WALLKICK' },
      };
    }

    // ------------------------------------------------------------------
    // Running jump-attack onto a nearby target: devastating damage and a
    // massive knockback along the attacker's facing, worth Leg Cannon
    // points on every landed hit [spec §3.6]. Whiffing is the attacker's
    // own problem — the sim downs a whiffed cannon (its move timeline
    // tracks whether the active window landed anything).
    // ------------------------------------------------------------------
    case 'legCannon': {
      if (target === null || distXZ(attacker, target) > def.rangeM) return null;
      return {
        damage: def.damage,
        knockdown: true,
        impulse: launch(attacker.heading, LEG_CANNON_KNOCK_SPEED_MPS),
        scoreEvent: { type: 'LEG_CANNON' },
      };
    }

    // ------------------------------------------------------------------
    // Two-stage body throw [spec §3.1]:
    //  stage 1 — grab a downed/KO'd body (never a live one) and hurl it;
    //            the sim turns the effect into a CorpseThrowEvent for the
    //            game layer's flight bridge.
    //  stage 2 (ctx.corpseImpact) — the flying corpse connects with a
    //            live enemy: tuning-table damage + Nice Aim on the hit.
    // ------------------------------------------------------------------
    case 'bodyThrow': {
      if (ctx.corpseImpact === true) {
        if (target === null || isCorpse(target)) return null; // corpses hit the living
        return { damage: BODY_THROW_IMPACT_DAMAGE, scoreEvent: { type: 'NICE_AIM' } };
      }
      if (target === null || !isCorpse(target)) return null;
      if (distXZ(attacker, target) > def.rangeM) return null;
      return {
        corpseLaunch: true,
        impulse: launch(attacker.heading, BODY_THROW_SPEED_MPS),
      };
    }

    // ------------------------------------------------------------------
    // Mid-air flip [spec §3.1 footnote]: a shockwave that stuns every
    // enemy inside the row's 3m stun radius for FLIP_STUN_MS — called
    // once per nearby enemy; out-of-radius / friendly / grounded-dead
    // targets answer null. The sim also grants the flip's air
    // invulnerability (which cancels air grabs) at fire time.
    // ------------------------------------------------------------------
    case 'flip': {
      if (target === null) return null;
      if (target.team === attacker.team) return null;
      if (distXZ(attacker, target) > def.rangeM) return null;
      if (target.phase.t === 'ko' || isCorpse(target)) return null;
      return { stunMs: FLIP_STUN_MS };
    }

    default:
      return null;
  }
}
