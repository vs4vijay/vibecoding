/**
 * The move table — every gameplay timing/damage number in the game lives
 * here (or tuning.ts) [global constraints; spec §3.1–§3.3]. Plain data only:
 * no three/Rapier imports under src/data/.
 *
 * Timeline model [spec §3.2]: every attack runs startup → active → recovery.
 * - reversalWindow: defender crouch-press sub-range of startup+active that
 *   converts the incoming attack into a reversal.
 * - counterWindow: original attacker's tighter window to reverse back,
 *   centered on the reversal impact moment ±120ms.
 *
 * Numbers below are Lugaru-flavored authoring choices where the brief gives
 * ranges: punch ~350ms total, startup 120 / active 80 / recovery 150;
 * runningKick 450ms dmg 14 knockdown; legSweep 500ms dmg 10 downs standing
 * targets and staggers crouched ones; wallKick requires wall within 0.9m,
 * dmg 25; soccerKick needs a downed target, unblockable, dmg 12; airGrab
 * needs an airborne target, dmg 20, downs both parties; legCannon = jump+
 * attack near a target, dmg 30, huge knockback, self-falls on miss; tackle
 * dmg 5 prone; flip stuns nearby attackers ~1.5s in a 3m radius.
 */

import type { MoveDef, MoveId } from '../combat/types';

/** Reversal impact sits at the end of startup+active; counters see ±120ms. */
const COUNTER_HALF_WIDTH_MS = 120;

export const MOVES: Record<MoveId, MoveDef> = {
  // -------------------------------------------------------------------------
  // Attack-button moves
  // -------------------------------------------------------------------------

  /**
   * Basic jab. Reversal window opens at 40% of startup (48ms — past the
   * too-early whiffed-duck zone) through the end of active frames.
   */
  punch: {
    id: 'punch',
    clip: 'punch',
    startupMs: 120,
    activeMs: 80,
    recoveryMs: 150,
    rangeM: 1.4,
    arcRad: 1.0,
    damage: 8,
    knockdown: false,
    // Reversal impact = end of startup+active (120+80); counters see ±COUNTER_HALF_WIDTH_MS.
    reversalWindow: { from: 48, to: 120 + 80 },
    counterWindow: { from: 200 - COUNTER_HALF_WIDTH_MS, to: 200 + COUNTER_HALF_WIDTH_MS },
  },

  /**
   * Held-attack chain during the first punch's recovery. Slightly faster but
   * lighter than the opener so spamming trades damage for pressure.
   */
  doublePunch: {
    id: 'doublePunch',
    clip: 'punch',
    startupMs: 100,
    activeMs: 80,
    recoveryMs: 320, // 100+80+320 = 500ms total; long tail is the chain risk
    rangeM: 1.4,
    arcRad: 1.0,
    damage: 7,
    knockdown: false,
    reversalWindow: { from: 40, to: 100 + 80 }, // from = 40%×100
    counterWindow: { from: 180 - COUNTER_HALF_WIDTH_MS, to: 180 + COUNTER_HALF_WIDTH_MS },
  },

  /** Sprinting kick. First reliable knockdown tool; heavy commitment. */
  runningKick: {
    id: 'runningKick',
    clip: 'kick',
    startupMs: 140,
    activeMs: 90,
    recoveryMs: 220,
    rangeM: 1.8,
    arcRad: 0.9,
    damage: 14,
    knockdown: true,
    reversalWindow: { from: 56, to: 140 + 90 }, // from = 40%×140
    counterWindow: { from: 230 - COUNTER_HALF_WIDTH_MS, to: 230 + COUNTER_HALF_WIDTH_MS },
  },

  /**
   * Low sweep from crouch. Downs standing victims; crouched ones merely
   * stagger (Task 14 effect layer reads stance for which applies).
   */
  legSweep: {
    id: 'legSweep',
    clip: 'sweep',
    startupMs: 160,
    activeMs: 110,
    recoveryMs: 230,
    rangeM: 1.6,
    arcRad: 1.6,
    damage: 10,
    knockdown: true,
    reversalWindow: { from: 64, to: 160 + 110 }, // from = 40%×160
    counterWindow: { from: 270 - COUNTER_HALF_WIDTH_MS, to: 270 + COUNTER_HALF_WIDTH_MS },
  },

  /** Off a wall within 0.9m. Slow telegraph, huge payoff, style bonus on kill. */
  wallKick: {
    id: 'wallKick',
    clip: 'wallkick',
    startupMs: 190,
    activeMs: 110,
    recoveryMs: 250,
    rangeM: 2.0,
    arcRad: 1.2,
    damage: 25,
    knockdown: true,
    requiresWallWithinM: 0.9,
  },

  /** Stomp/soccer kick vs downed enemies — unblockable, no reversal window. */
  soccerKick: {
    id: 'soccerKick',
    clip: 'soccerkick',
    startupMs: 130,
    activeMs: 90,
    recoveryMs: 180,
    rangeM: 2.4, // stomp reaches a body on the ground farther than a jab
    arcRad: 1.2,
    damage: 12,
    knockdown: false,
    requiresDownedTarget: true,
  },

  /** Catch an airborne enemy overhead and throw them down — downs both. */
  airGrab: {
    id: 'airGrab',
    clip: 'airgrab',
    startupMs: 180,
    activeMs: 120,
    recoveryMs: 300,
    rangeM: 2.2,
    arcRad: Math.PI, // overhead catch: generous vertical cone
    damage: 20,
    knockdown: true,
    requiresAirborneTarget: true,
  },

  /**
   * Jump + attack onto a nearby target while running. Devastating, huge
   * knockback; whiffing means the attacker eats dirt (self-fall on miss).
   */
  legCannon: {
    id: 'legCannon',
    clip: 'legcannon',
    startupMs: 240,
    activeMs: 120,
    recoveryMs: 340,
    rangeM: 2.6,
    arcRad: 1.4,
    damage: 30,
    knockdown: true,
  },

  // -------------------------------------------------------------------------
  // Jump-button moves
  // -------------------------------------------------------------------------

  jump: {
    id: 'jump',
    clip: 'jump',
    startupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    rangeM: 0,
    arcRad: 0,
    damage: 0,
    knockdown: false,
  },

  /** Low hop from crouch — never leaves reach, keeps low profile. */
  hop: {
    id: 'hop',
    clip: 'hop',
    startupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    rangeM: 0,
    arcRad: 0,
    damage: 0,
    knockdown: false,
  },

  /**
   * Mid-air flip: stuns nearby attackers ~1.5s within a 3m radius and cancels
   * air-grabs [spec §3.1 footnote]. Timing handled by Task 14 effects; the
   * stun duration/radius live here as data.
   */
  flip: {
    id: 'flip',
    clip: 'flip',
    startupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    rangeM: 3, // stun radius (m)
    arcRad: Math.PI, // all around
    damage: 0,
    knockdown: false,
  },

  // -------------------------------------------------------------------------
  // Crouch-button context moves
  // -------------------------------------------------------------------------

  tackle: {
    id: 'tackle',
    clip: 'tackle',
    startupMs: 160,
    activeMs: 100,
    recoveryMs: 240,
    rangeM: 1.5,
    arcRad: 0.8,
    damage: 5, // prone victim; can KO via unconscious flag [spec §3.4]
    knockdown: true,
  },

  pickupOrContext: {
    id: 'pickupOrContext',
    clip: 'pickup',
    startupMs: 0,
    activeMs: 0,
    recoveryMs: 250, // bent-over commit time before control returns
    rangeM: 1.2,
    arcRad: Math.PI,
    damage: 0,
    knockdown: false,
  },

  slideStop: {
    id: 'slideStop',
    clip: 'slidestop',
    startupMs: 0,
    activeMs: 300, // slide duration while friction kills run speed
    recoveryMs: 120,
    rangeM: 1.6,
    arcRad: 0.9,
    damage: 0, // mobility move; contact effects are Task 14's layer
    knockdown: false,
  },

  /** Instant silent kill behind an unaware enemy [spec §3.7]; 100 pts. */
  stealthKill: {
    id: 'stealthKill',
    clip: 'stealthkill',
    startupMs: 0,
    activeMs: 0,
    recoveryMs: 400, // kill animation lock
    rangeM: 1.2,
    arcRad: Math.PI,
    damage: 9999,
    knockdown: true,
  },

  bodyThrow: {
    id: 'bodyThrow',
    clip: 'bodythrow',
    startupMs: 120,
    activeMs: 80,
    recoveryMs: 260,
    rangeM: 1.5,
    arcRad: Math.PI,
    damage: 0, // projectile damage resolves when the body lands ("Nice Aim")
    knockdown: false,
  },

  /** Crouch-context with a bloody blade: stab it into the ground to clean. */
  cleanBlade: {
    id: 'cleanBlade',
    clip: 'cleanblade',
    startupMs: 0,
    activeMs: 0,
    recoveryMs: 350,
    rangeM: 0,
    arcRad: 0,
    damage: 0,
    knockdown: false,
  },
};
