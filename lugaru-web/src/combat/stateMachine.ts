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
 *
 * Task 8 additions [spec §3.2]: crouch presses resolving to {kind:'reverse'}
 * dispatch through reversal.tryReversal — success cancels the attacker's
 * move into a counterWindow-wide hitstun (the counter-reversal window),
 * puts the defender in a short 'reverseAttempt' animation phase and marks
 * pendingReverseOf on both parties. Every fired attack is recorded through
 * antirepetition.recordAttack; the damage scale is read via penaltyFor at
 * strike time.
 */

import type { InputFrame } from '../core/input';
import { heightAt } from '../world/terrain';
import { SPECIES } from '../data/species';
import type { SpeciesDef } from '../data/species';
import {
  ACCEL,
  BODY_THROW_SPEED_MPS,
  COUNTER_WINDOW_MS,
  DOWNED_GROUND_MS,
  FLIP_STUN_MS,
  FRICTION,
  INPUT_BUFFER_MS,
  GRAVITY,
  JUMP_SPEED,
  KNOCKDOWN_VELY,
  RECOVERY_CHAIN_MIN_MS,
  REVERSE_ATTEMPT_MS,
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
import { applyHit, applyLethalState, downFighter, findHit, forwardXZ } from './hitdetect';
import { startCounter, tryReversal } from './reversal';
import { createAntiRepState, recordAttack } from './antirepetition';
import type { AntiRepState } from './antirepetition';
export type { AntiRepState };
import { updateInjuries } from './injury';
import type { InjuryEvent } from './injury';
import { ScoreLedger } from './scoring';
import type { ScoreLedger as LedgerView } from './scoring';
import { tryStealthKill, type StealthResult } from './stealth';
import {
  heldWeapon,
  onReversalVsArmed,
  thrownKnifeHit,
  weaponDropEvent,
} from './weaponsLogic';
import type { ThrownKnifeOutcome, WeaponSimEvent } from './weaponsLogic';
import { applySpecial, isSpecialMove } from './bodymoves';
import type { CorpseThrowEvent, SpecialCtx, SpecialEffect } from './bodymoves';

/**
 * Everything the sim can hand the game layer in one step: Task 13's weapon
 * events plus Task 14's corpse throw.
 */
export type CombatSimEvent = WeaponSimEvent | CorpseThrowEvent;

/** Shared quiet-step value for lastCombatEvents — see the field's doc. */
const NO_COMBAT_EVENTS: readonly CombatSimEvent[] = [];

/** Shared quiet-step value for lastInjuryEvents — see the field's doc. */
const NO_INJURY_EVENTS: readonly InjuryEvent[] = [];

// Plain fighter state — serializable snapshot, no class instances inside.
// ---------------------------------------------------------------------------

/** One named stretch of the fighter's update loop. */
export interface FighterPhase {
  t:
    | 'idle'
    | 'move'
    | 'startup'
    | 'active'
    | 'recovery'
    | 'hitstun'
    | 'downed'
    | 'ko'
    | 'reverseAttempt';
  /** Move owning this phase (startup/active/recovery only). */
  moveId?: MoveId;
  /** ms remaining before the phase auto-transitions; Infinity while idle. */
  phaseMsLeft: number;
}

/** Long-lived status flags; the injury model (Task 9) extends semantics. */
export interface FighterFlags {
  bleeding: boolean;
  limping: boolean;
  unconscious: boolean;
  invulnerableAirFlipMs: number;
  /**
   * [Task 13] Body is armored: thrown knives hit for WEAPONS throwDamage
   * instead of killing outright. Unset = unarmored (instant-killable).
   */
  armored?: boolean;
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
  /**
   * [Task 13] Remaining wear for weapons with a WEAPONS durability (the
   * staff). Set on pickup; tryClash decrements it per clash; at 0 the blade
   * breaks loose. Undefined = the weapon cannot break by wear.
   */
  durability?: number;
  /**
   * [Task 13] True after this fighter lands a hit with a bleeding blade;
   * the resolver's cleanBlade context move and cleanBlade() read/clear it.
   */
  bloodiedWeapon?: boolean;
  /**
   * [Task 13] A thrown knife is lodged in this body (thrownKnifeHit). Task
   * 18's roll-over prompt reads mere presence to offer a knife pickup.
   */
  stuckIn?: boolean;
  flags: FighterFlags;
  /**
   * Anti-repetition tracking — deliberately UNINITIALIZED in Task 7; Task 8's
   * antirepetition module owns when and how it gets filled.
   */
  antiRep?: AntiRepState;
  pendingReverseOf?: string;
  /**
   * [Task 18] Game-layer awareness annotation: true while this fighter's
   * brain FSM is alerted (investigate/circle/engage/flee/downed — anything
   * but 'patrol'). The game layer writes it from brain state each step;
   * the sim and resolver only read it: unset/false = unaware = the stealth
   * window is open. Brainless fighters (and the player) are never marked.
   */
  alerted?: boolean;
  /**
   * [Task 14] Horizontal launch velocity (m/s) riding out on shared state —
   * knockback (leg cannon) and wall-kick launches set it on the VICTIM's or
   * ATTACKER's state, and that fighter's own integrate() carries + decays
   * it (ground-friction decel). Absent/0 = no launch in flight.
   */
  pushX?: number;
  pushZ?: number;
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
  /**
   * [Task 14] Nearest-wall probe for wall-kick gating: distance plus the
   * unit ground-plane direction pointing AWAY from the wall (the launch
   * heading). Absent = open field (snapshot reports Infinity, exactly the
   * pre-Task-14 behavior).
   */
  wall?: { proximityM: number; awayX: number; awayZ: number };
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

  /** Horizontal velocity for renderer (read-only). */
  get horizontalVelX(): number { return this.locoVelX; }
  get horizontalVelZ(): number { return this.locoVelZ; }
  /** Crouch state for renderer (read-only). */
  get isCrouching(): boolean { return this.crouching; }
  /**
   * Injury events from the MOST RECENT update() step [Task 9]. The renderer
   * polls this once per frame (blood-drip FX, limp gait, KO ragdoll kick-
   * off); each step overwrites it, so pollers must read before the next.
   *
   * Quiet steps share one immutable empty array — no per-step allocation.
   */
  lastInjuryEvents: readonly InjuryEvent[] = NO_INJURY_EVENTS;

  /**
   * Combat events produced during the most recent update(): plain drop /
   * throw data the game layer bridges to Rapier (WeaponDrops, Projectiles)
   * plus Task 14's corpse throw. Re-published (or reset to a shared empty
   * array) every step; quiet steps share NO_COMBAT_EVENTS so no per-frame
   * allocation happens.
   */
  lastCombatEvents: readonly CombatSimEvent[] = NO_COMBAT_EVENTS;

  /** Event accumulator for the current step; published at update() end. */
  private combatEvents: CombatSimEvent[] = [];

  /**
   * [Task 14] Hits this fighter's CURRENT move has landed (collectHits
   * counts them). The leg cannon reads it when its active window ends:
   * zero landed hits is a whiff, and a whiffed cannon downs the attacker.
   */
  private hitsLandedThisMove = 0;

  /**
   * Score sink [Task 9]: when set, this fighter's awards land here.
   * Injected via setScoreLedger; the game layer owns the ledger so
   * results screens and persistence stay outside the sim. Every award
   * fires where its cause happens [Task 14]: REVERSAL on a successful
   * reversal, REVERSAL_KO when the counter throw KOs, LEG_CANNON on a
   * landed leg cannon, NICE_AIM on a corpse hit, STYLE_WALLKICK when a
   * wall kick kills, NINJA_THROW when this fighter's thrown knife kills
   * (Task 18 owns STEALTH_KILL).
   */
  private ledger: LedgerView | null = null;

  /** Total score accumulated in this fighter's ledger (0 when unset). */
  get scoreTotal(): number {
    return this.ledger?.total() ?? 0;
  }

  /** Attach the score sink for this fighter's awards (idempotent). */
  setScoreLedger(ledger: LedgerView): void {
    this.ledger = ledger;
  }

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
      antiRep: createAntiRepState(),
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

    // Counter-reversal [spec §3.2]: an ATTACK press while sitting in the
    // post-reversal counter-hitstun window answers with startCounter's
    // downing throw. Outside the window (drained timer, or any other
    // phase) presses fall through to the normal buffered path below.
    if (
      input !== null &&
      pressedAttack &&
      p === 'hitstun' &&
      this.state.pendingReverseOf !== undefined
    ) {
      this.consumeCounter();
    } else if (
      input !== null &&
      (pressedAttack || pressedJump) &&
      (p === 'idle' || p === 'recovery' || p === 'active')
    ) {
      this.consumeAttack(input, p);
    }

    // Crouch press: reverse attempt first [spec §3.2], then context moves.
    // Mid-swing (startup/active) the body is committed — no crouch actions.
    if (input !== null && input.pressed.crouch && (p === 'idle' || p === 'recovery')) {
      this.consumeCrouch(input, p);
    }

    this.advancePhase(dt);
    this.applyBuffer(dt);
    this.integrate(dt, input === null ? 0 : input.moveX, input === null ? 0 : input.moveZ);

    // Injury model [Task 9]: one tick per step, AFTER the phase work so a
    // hit applied mid-step is seen by the same tick that follows it. The
    // returned events are republished for renderer polling (documented on
    // the field).
    this.lastInjuryEvents = updateInjuries(this.state, dt);

    // Weapon housekeeping [Task 13]: a fighter who goes down loses their
    // weapon — it clatters beside the body (bridge drops it as a physical
    // box). Runs here so every KO path (applyHit, thrownKnifeHit, stealth)
    // is covered; clearing the weapon makes it fire exactly once.
    if (this.state.phase.t === 'ko' && this.state.weapon !== null) {
      this.combatEvents.push(weaponDropEvent(this.state, null, 'ko'));
      this.state.weapon = null;
      this.state.durability = undefined;
    }

    // Publish or reuse the shared quiet-step list (no per-frame alloc).
    if (this.combatEvents.length > 0) {
      this.lastCombatEvents = this.combatEvents;
      this.combatEvents = [];
    } else {
      this.lastCombatEvents = NO_COMBAT_EVENTS;
    }
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

  // -- special-move application [Task 14] -----------------------------------

  /**
   * Apply one landed SPECIAL-move strike. The game layer routes special
   * hits here instead of hitdetect.applyHit: the strike runs through
   * applySpecial's strike-time gate and the returned effect is consumed
   * uniformly — damage → KO/knockdown/stun, launches, pin disarm, corpse
   * throw, shared-fate self-fall — with kill attribution and score awards
   * on THIS fighter's ledger. Returns the applied effect, or null when the
   * gate rejected the strike (a whiff changes nothing).
   */
  applySpecialStrike(hit: HitEvent, fighters: FighterState[]): SpecialEffect | null {
    if (hit.attackerId !== this.state.id) return null; // awards land on the attacker's sim
    let victim: FighterState | undefined;
    for (let i = 0; i < fighters.length && victim === undefined; i++) {
      if (fighters[i].id === hit.victimId) victim = fighters[i];
    }
    if (victim === undefined) return null;
    const effect = applySpecial(hit.moveId, this.state, victim, this.specialCtx());
    if (effect === null) return null; // gate-rejected: a whiff, not a hit
    // [Task 14] Count APPLIED strikes only — the leg cannon's whiff rule
    // reads this at active-window end, and a gate-rejected strike is a whiff.
    this.hitsLandedThisMove += 1;
    this.applyEffect(effect, this.state, victim, hit.dirVector);
    return effect;
  }

  /**
   * Stage-2 body throw [Task 14]: a hurled corpse (see CorpseThrowEvent)
   * just connected with `victimId`. The impact flows through the same
   * uniform application — tuning-table damage + NICE_AIM on the hit.
   * Returns the applied effect, or null (unknown victim / gate rejected).
   */
  applyCorpseImpact(victimId: string, fighters: FighterState[]): SpecialEffect | null {
    let victim: FighterState | undefined;
    for (let i = 0; i < fighters.length && victim === undefined; i++) {
      if (fighters[i].id === victimId) victim = fighters[i];
    }
    if (victim === undefined) return null;
    const ctx: SpecialCtx = { ...this.specialCtx(), corpseImpact: true };
    const effect = applySpecial('bodyThrow', this.state, victim, ctx);
    if (effect === null) return null;
    const dx = victim.pos.x - this.state.pos.x;
    const dz = victim.pos.z - this.state.pos.z;
    const len = Math.hypot(dx, dz);
    const dir = len > 1e-9 ? { x: dx / len, z: dz / len } : forwardXZ(this.state.heading);
    this.applyEffect(effect, this.state, victim, dir);
    return effect;
  }

  /**
   * Thrown-knife impact bridge [Task 13 → Task 14]: the game layer reports
   * a projectile hit; thrownKnifeHit applies the outcome (pure) and THIS
   * sim — which must be the THROWER's — awards NINJA_THROW when the impact
   * killed (kill-attribution rule: hp is checked after application, not
   * inside the pure function). Returns the outcome, or null when called on
   * any sim but the thrower's.
   */
  applyThrownKnifeImpact(victim: FighterState, thrower: FighterState): ThrownKnifeOutcome | null {
    if (thrower.id !== this.state.id) return null;
    const outcome = thrownKnifeHit(victim, thrower);
    if (outcome.fatal) this.ledger?.award({ type: 'NINJA_THROW' });
    return outcome;
  }

  /**
   * Consume one SpecialEffect uniformly. Order matters: terminal state
   * first (a KO never also knocks down), then launches, equipment, corpse
   * bridge data, and finally the attacker's own shared-fate fall.
   */
  private applyEffect(
    effect: SpecialEffect,
    attacker: FighterState,
    victim: FighterState,
    dirVector: { x: number; z: number },
  ): void {
    if (effect.damage !== undefined && effect.damage > 0) {
      const dmg = Math.round(effect.damage * SPECIES[attacker.species].punchDmgMult);
      victim.hp -= dmg;
      if (victim.hp <= 0) {
        applyLethalState(victim);
        if (effect.killScoreEvent !== undefined) this.ledger?.award(effect.killScoreEvent);
      } else if (effect.knockdown === true) {
        downFighter(victim);
      } else if (effect.stunMs !== undefined) {
        this.applyStun(victim, effect.stunMs);
      }
      // Hit-gated awards (LEG_CANNON, NICE_AIM) land on any landed strike.
      if (effect.scoreEvent !== undefined) this.ledger?.award(effect.scoreEvent);
    } else if (effect.stunMs !== undefined) {
      this.applyStun(victim, effect.stunMs); // zero-damage stun (the flip)
    }

    if (effect.impulse !== undefined) {
      victim.pushX = effect.impulse.x;
      victim.pushZ = effect.impulse.z;
      victim.velY = effect.impulse.y; // overrides the knockdown pop (slams)
    }
    if (effect.attackerImpulse !== undefined) {
      attacker.pushX = effect.attackerImpulse.x;
      attacker.pushZ = effect.attackerImpulse.z;
    }

    if (effect.disarm === true && heldWeapon(victim) !== null) {
      this.combatEvents.push(weaponDropEvent(victim, attacker, 'disarm'));
      victim.weapon = null;
      victim.durability = undefined;
      victim.bloodiedWeapon = undefined;
    }

    if (effect.corpseLaunch === true) {
      this.combatEvents.push({
        type: 'corpseThrow',
        victimId: victim.id,
        dir: { x: dirVector.x, z: dirVector.z },
        speed: BODY_THROW_SPEED_MPS,
      });
    }

    if (effect.selfKnockdown === true) this.selfKnockdown();
  }

  /** [Task 14] The attacker goes prone: whiffed leg cannon, air-grab commit.
   *  Delegates to hitdetect.downFighter so hit-caused and self-caused
   *  knockdowns can never drift apart. */
  private selfKnockdown(): void {
    downFighter(this.state);
  }

  /** [Task 14] Stun overlay: interrupts whatever ran, ticks out to idle. */
  private applyStun(victim: FighterState, stunMs: number): void {
    victim.currentMove = undefined;
    victim.moveElapsedMs = 0;
    victim.phase.t = 'hitstun';
    victim.phase.moveId = undefined;
    victim.phase.phaseMsLeft = stunMs;
  }

  /**
   * [Task 14] Mid-air flip fired (zero-timeline move): grants the flip's
   * air invulnerability — which cancels air grabs — and stuns every enemy
   * inside the row's stun radius through the uniform effect path.
   */
  private fireFlip(): void {
    const s = this.state;
    s.flags.invulnerableAirFlipMs = FLIP_STUN_MS;
    const fighters = this.world.fighters;
    const ctx = this.specialCtx();
    for (let i = 0; i < fighters.length; i++) {
      const other = fighters[i];
      if (other.id === s.id) continue;
      const effect = applySpecial('flip', s, other, ctx);
      if (effect?.stunMs !== undefined) this.applyStun(other, effect.stunMs);
    }
  }

  /** [Task 14] Strike-time context for the pure dispatcher. */
  private specialCtx(): SpecialCtx {
    const wall = this.world.wall;
    return {
      wallProximityM: wall !== undefined ? wall.proximityM : Infinity,
      wallAwayDir: wall !== undefined ? { x: wall.awayX, z: wall.awayZ } : undefined,
      crouchHeld: this.crouching,
    };
  }

  /** Resolve a fresh press through the resolver and dispatch the result. */
  private consumeAttack(input: InputFrame, phaseAtPress: FighterPhase['t']): void {
    const button = input.pressed.attack ? 'attack' : 'jump';
    const action = resolveAction(
      { button, heldAttack: input.held.attack },
      this.snapshot(),
      this.worldCtx(),
    );
    // Reverse attempts route through Task 8's reversal module below.
    if (action === null || action.kind !== 'move') return;


    this.dispatchMoveAction(action.id, phaseAtPress);
  }

  /**
   * Shared move-dispatch tail for both buttons: recovery-tail chaining,
   * busy-phase buffering (INPUT_BUFFER_MS), or immediate start.
   */
  private dispatchMoveAction(id: MoveId, phaseAtPress: FighterPhase['t']): void {
    if (phaseAtPress === 'recovery') {
      // Recovery's tail chains freely into the next move; earlier presses
      // buffer like any other busy-phase press.
      if (this.state.phase.phaseMsLeft <= RECOVERY_CHAIN_MIN_MS) {
        this.startMove(id);
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
      this.bufferedActionId = id;
      this.bufferMsLeft = INPUT_BUFFER_MS;
      return;
    }
    this.startMove(id);
  }

  /**
   * Crouch press dispatch [spec §3.2]: reverse attempt first, then context
   * moves (pickup/body/clean), then slide-stop — exactly resolveCrouch's
   * priority. The resolver answers {kind:'reverse'} only when its window +
   * facing gates pass, so a whiffed duck falls through to null/duck.
   */
  private consumeCrouch(input: InputFrame, phaseAtPress: FighterPhase['t']): void {
    const action = resolveAction(
      { button: 'crouch' },
      this.snapshot(),
      this.worldCtx(),
    );
    if (action === null) return; // plain duck: crouch stance via integrate()
    if (action.kind === 'reverse') {
      this.executeReversal(action.targetId);
      return;
    }
    // Context moves (pickup/body/clean/slide-stop) are crouch-button moves;
    // route through the shared move dispatcher so anti-rep records them too.
    if (action.kind === 'move') this.dispatchMoveAction(action.id, phaseAtPress);
  }

  /**
   * Reversal resolution [spec §3.2]: the crouch press became {reverse}; if
   * the attacker is mid-move and within the window, the hit dies. On
   * success the attacker is cancelled into hitstun (duration = the counter
   * window) and the defender plays the short reverseAttempt pose. Vs an
   * armed attacker, the reversal always disarms them [brief Task 13].
   */
  private executeReversal(attackerId: string): void {
    const s = this.state;
    const fighters = this.world.fighters;
    let attacker: FighterState | undefined;
    for (let i = 0; i < fighters.length && attacker === undefined; i++) {
      if (fighters[i].id === attackerId) attacker = fighters[i];
    }
    if (
      attacker === undefined ||
      attacker.currentMove === undefined ||
      (attacker.phase.t !== 'startup' &&
        attacker.phase.t !== 'active')
    ) {
      return; // target gone or not mid-move: nothing to reverse
    }

    const outcome = tryReversal(s, {
      attacker,
      def: attacker.currentMove,
      elapsedMs: attacker.moveElapsedMs,
    });
    if (outcome !== 'success') return; // early/late/notFacing → whiffed duck

    // SUCCESS [spec §3.2]: the incoming attack dies mid-swing. Attacker is
    // cancelled into hitstun whose duration IS the counter-reversal window
    // (startCounter reads it); defender plays the short reversal animation.
    attacker.currentMove = undefined;
    attacker.moveElapsedMs = 0;
    attacker.phase.t = 'hitstun';
    attacker.phase.moveId = undefined;
    attacker.phase.phaseMsLeft = COUNTER_WINDOW_MS;
    attacker.pendingReverseOf = s.id;
    s.pendingReverseOf = attacker.id;
    s.phase.t = 'reverseAttempt';
    s.phase.moveId = undefined;
    s.phase.phaseMsLeft = REVERSE_ATTEMPT_MS;
    s.stance = 'standing';

    // A successful reversal vs an armed attacker ALWAYS disarms them
    // [brief Task 13]: mutates the attacker, emits a bridge event.
    {
      const ev = onReversalVsArmed(s, attacker);
      if (ev !== null) this.combatEvents.push(ev);
    }

    // Score hook [Task 9]: every successful reversal is worth
    // SCORE_REVERSAL; the KO variant (REVERSAL_KO) lands with Task 14's
    // kill-attribution layer once effects can be traced to a death.
    this.ledger?.award({ type: 'REVERSAL' });
  }


  /**
   * The original attacker answers a successful reversal [spec §3.2]:
   * startCounter validates the still-open window and returns the
   * applyHit-ready counter throw, which lands immediately on the reverser
   * (downs them for REVERSE_DAMAGE base). Consuming the window clears the
   * marker; a refused call leaves state untouched (normal press rules
   * apply on later steps).
   */
  private consumeCounter(): void {
    const s = this.state;
    const reverserId = s.pendingReverseOf!;
    const fighters = this.world.fighters;
    let reverser: FighterState | undefined;
    for (let i = 0; i < fighters.length && reverser === undefined; i++) {
      if (fighters[i].id === reverserId) reverser = fighters[i];
    }
    if (reverser === undefined) return; // target gone: nothing to answer

    const res = startCounter(s, reverserId);
    if (!res.granted || res.effect === undefined) return;
    applyHit(res.effect, fighters);
    // Score hook [Task 14]: a reversal chain that ends the reverser awards
    // REVERSAL_KO to the counter-thrower's ledger — the kill is attributed
    // here, where hp after application is visible (kill-attribution rule).
    if (reverser.hp <= 0) this.ledger?.award({ type: 'REVERSAL_KO' });
    // The throw consumes the counter opportunity.
    s.pendingReverseOf = undefined;
  }



  /**
   * Open the move timeline for a resolver-approved action — the single
   * FIRE SITE shared by immediate starts, recovery-chain fires and buffer
   * fires, so anti-repetition counts only attacks that actually began.
   */
  private startMove(id: MoveId): void {
    const def = MOVES[id];
    if (def === undefined) return;
    this.bufferedActionId = null;
    this.bufferMsLeft = 0;
    this.swungThisMove = false;
    this.hitsLandedThisMove = 0;
    recordAttack(this.state.antiRep!, id);
    // [Task 18] A stealth kill IS its fire — the row has no startup/active
    // window, so the weapon-shaped outcome applies at dispatch and the 400 ms
    // recovery is the kill-animation lock. tryStealthKill re-gates the world
    // at fire time; a rejected kill is just a whiffed animation lock.
    if (id === 'stealthKill') this.fireStealthKill();

    if (!hasTimeline(def)) {
      // Zero-duration utility rows: pure effect, no animation lock — the
      // fire itself IS the effect.
      if (id === 'jump' || id === 'hop') {
        this.state.velY = JUMP_SPEED;
        this.grounded = false;
        this.state.stance = 'airborne';
      } else if (id === 'flip') {
        this.fireFlip();
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
      case 'reverseAttempt':
        s.phase.phaseMsLeft -= dt;
        if (s.phase.phaseMsLeft <= 0) {
          // Any overlay (hitstun/downed/reverseAttempt) ending clears the
          // reversal marker: only a reversal success ever sets it, and its
          // story is over once the victim stands back up.
          s.pendingReverseOf = undefined;
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
        const leavingActive = s.phase.t === 'active';
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
        // [Task 14] A leg cannon whose whole active window landed nothing
        // whiffed: the attacker eats dirt (self-knockdown instead of the
        // recovery the successful move would ride out).
        if (leavingActive && def.id === 'legCannon' && this.hitsLandedThisMove === 0) {
          this.selfKnockdown();
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
   * [Task 18] Apply the stealth kill at the move's fire site: pick the best
   * enemy victim the pure gate accepts (nearest wins), consume its weapon-
   * shaped StealthResult, and attribute the kill — STEALTH_KILL lands only
   * when the victim dies. SILENT by design [spec §3.7]: nothing here pushes
   * a hearing/scream bridge event, so nearby patrols stay unaware.
   */
  private fireStealthKill(): void {
    const s = this.state;
    let victim: FighterState | null = null;
    let result: StealthResult | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.world.fighters.length; i++) {
      const other = this.world.fighters[i];
      if (other.id === s.id || other.team === s.team) continue;
      const r = tryStealthKill(s, other);
      if (r === null) continue;
      const d = Math.hypot(other.pos.x - s.pos.x, other.pos.z - s.pos.z);
      if (d < bestDist) {
        bestDist = d;
        victim = other;
        result = r;
      }
    }
    if (victim === null || result === null) return; // gate rejected: whiff lock
    if (result.instantKill) {
      applyLethalState(victim);
    } else {
      victim.hp -= result.damage;
      if (victim.hp <= 0) applyLethalState(victim);
      else if (result.knockdown) downFighter(victim);
    }
    // Kill attribution [Task 14 pattern]: hp is checked after application.
    if (victim.hp <= 0) this.ledger?.award({ type: 'STEALTH_KILL' });
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

    // [Task 14] Launch velocity in flight (knockback, wall-kick bounce):
    // rides shared state so a VICTIM's own sim carries it; decays with the
    // same ground-friction deceleration locomotion uses.
    const pushX = s.pushX ?? 0;
    const pushZ = s.pushZ ?? 0;
    if (pushX !== 0 || pushZ !== 0) {
      s.pos.x += pushX * dtS;
      s.pos.z += pushZ * dtS;
      s.pushX = approach(pushX, 0, FRICTION * dtS);
      s.pushZ = approach(pushZ, 0, FRICTION * dtS);
    }

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
      hasWeapon: s.weapon,
      wallProximityM: this.world.wall?.proximityM ?? Infinity,
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
    // [Task 18] Awareness flows into the resolver's stealth row: the game
    // layer annotates each fighter with its brain's alert state every step
    // (FighterState.alerted); unset = patrol/brainless = unaware.
    unaware: best.alerted !== true,
    // Reversal wiring [spec §3.2]: expose the target's in-flight attack.
    // phaseMsElapsed is ABSOLUTE ms since the move started (moveElapsedMs
    // in every phase) — one clock, identical to what executeReversal feeds
    // tryReversal; the resolver's window test reads the same number.
    // (IncomingAttack.phaseMsElapsed's per-phase doc is superseded here.)
    incomingAttack:
      best.phase.t === 'startup' || best.phase.t === 'active'
        ? {
            attackerId: best.id,
            moveId: best.phase.moveId!,
            phase: best.phase.t,
            phaseMsElapsed: best.moveElapsedMs,
          }
        : undefined,
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


