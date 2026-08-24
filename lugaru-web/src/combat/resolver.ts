/**
 * resolveAction — the one pure function that decides what a button press
 * means [spec §3.1].
 *
 * Inputs are plain snapshots (CombatantSnapshot / WorldContext), never class
 * instances; no three/Rapier anywhere under src/combat/. No I/O, no clock,
 * no RNG — same inputs always yield the same output, so AI (Task 16) can
 * simulate it headless.
 *
 * Priority order (brief): stealthKill → reverse → context (pickup/body/clean)
 * → stance table → null. Returns null when nothing applies; never throws.
 */

import type {
  ActionButton,
  CombatantSnapshot,
  ResolveResult,
  TargetSnapshot,
  WorldContext,
} from './types';
import { MOVES } from '../data/moves';

// Snapshot types re-exported so consumers import the whole resolver surface
// from one module (types.ts remains the owning declaration).
export type {
  ActionButton,
  CombatantSnapshot,
  MoveId,
  ResolveResult,
  Stance,
  TargetSnapshot,
  WorldContext,
} from './types';

/**
 * Crouch presses longer than this are held state (sneak), not a timed
 * reverse attempt [spec §3.2 "timed press = reverse"].
 */
const REVERSE_PRESS_MAX_MS = 250;

/** Facing cone for stealth kills: |relAngle| at least this = behind. */
const BEHIND_RAD = Math.PI - 0.6;

/** Facing half-cone for the leg-cannon dive: target must be ahead. */
const AHEAD_HALF_RAD = 1.0;

export function resolveAction(
  input: { button: ActionButton; heldAttack?: boolean },
  actor: CombatantSnapshot,
  worldCtx: WorldContext,
): ResolveResult | null {
  switch (input.button) {
    case 'attack':
      return resolveAttack(input, actor);
    case 'jump':
      return resolveJump(actor, worldCtx);
    case 'crouch':
      return resolveCrouch(actor, worldCtx);
  }
}

// ---------------------------------------------------------------------------
// Attack button [spec §3.1 row 1]
// ---------------------------------------------------------------------------

function resolveAttack(
  input: { button: ActionButton; heldAttack?: boolean },
  a: CombatantSnapshot,
): ResolveResult {
  const t = a.nearestTarget;

  // Stealth kill outranks every other attack resolution [spec §3.7].
  if (t && t.unaware && isBehind(t) && t.dist <= MOVES.stealthKill.rangeM) {
    return { kind: 'move', id: 'stealthKill' };
  }

  // Held attack chains doublePunch during the first punch's recovery.
  // A crouched fighter keeps sweep intent instead of chaining.
  if (
    input.heldAttack &&
    !isCrouchDown(a) &&
    a.currentMove?.id === 'punch' &&
    a.currentMove.phase === 'recovery'
  ) {
    return { kind: 'move', id: 'doublePunch' };
  }
  // Context attacks beat the plain stance table.
  if (t?.isDowned && t.dist <= MOVES.soccerKick.rangeM) return { kind: 'move', id: 'soccerKick' };
  if (t?.airborne && t.dist <= MOVES.airGrab.rangeM) return { kind: 'move', id: 'airGrab' };

  // Wall kick when a wall is close enough to bounce off.
  if (a.wallProximityM < (MOVES.wallKick.requiresWallWithinM ?? Infinity)) {
    return { kind: 'move', id: 'wallKick' };
  }

  // Stance table.
  if (a.stance === 'crouched') return { kind: 'move', id: 'legSweep' };
  if (a.isRunning || a.stance === 'running') return { kind: 'move', id: 'runningKick' };
  return { kind: 'move', id: 'punch' };
}

// ---------------------------------------------------------------------------
// Jump button [spec §3.1 row 2]
// ---------------------------------------------------------------------------

function resolveJump(a: CombatantSnapshot, ctx: WorldContext): ResolveResult {
  if (ctx.airborneSelf || a.stance === 'airborne') return { kind: 'move', id: 'flip' };

  const t = a.nearestTarget;
  if (
    (a.isRunning || a.stance === 'running') &&
    t &&
    t.relAngle >= -AHEAD_HALF_RAD &&
    t.relAngle <= AHEAD_HALF_RAD &&
    t.dist <= MOVES.legCannon.rangeM
  ) {
    return { kind: 'move', id: 'legCannon' };
  }

  if (a.stance === 'crouched') return { kind: 'move', id: 'hop' };
  return { kind: 'move', id: 'jump' };
}

// ---------------------------------------------------------------------------
// Crouch button — reverse > context > slide-stop [spec §3.1 row 3]
// ---------------------------------------------------------------------------

function resolveCrouch(a: CombatantSnapshot, ctx: WorldContext): ResolveResult | null {
  // Reversal: timed crouch press vs an incoming attack inside its reversal
  // window while facing back at the attacker [spec §3.2]. Long-held crouch
  // is sneak state, not a reverse attempt.
  if (isFreshCrouchPress(a)) {
    const rev = findReversal(a);
    if (rev) return rev;
  }

  if (a.stance === 'crouched') {
    // Context priority: pickup > body throw > blade cleaning (brief).
    if (ctx.weaponOnGroundNearby) return { kind: 'move', id: 'pickupOrContext' };
    if (ctx.downedBodyNearby) return { kind: 'move', id: 'bodyThrow' };
    if (a.hasWeapon && a.bladeBloody) return { kind: 'move', id: 'cleanBlade' };
    // Crouched with nothing to do stays put.
    return null;
  }

  if (a.isRunning || a.stance === 'running') return { kind: 'move', id: 'slideStop' };
  return null;
}

/**
 * The defender reverses iff the incoming attack sits inside its move's
 * `reversalWindow` (absolute ms from attacker's move start) while they face
 * us. A failed check is a whiffed duck — resolveCrouch falls through and
 * returns null here; the controller just enters crouch stance [§3.2].
 */
function findReversal(a: CombatantSnapshot): { kind: 'reverse'; targetId: string } | null {
  const t = a.nearestTarget;
  const inc = t?.incomingAttack;
  if (!t || !inc) return null;

  const def = MOVES[inc.moveId];
  const win = def?.reversalWindow;
  if (!win) return null;

  const elapsed =
    inc.phase === 'startup'
      ? inc.phaseMsElapsed
      : inc.phase === 'active'
        ? def.startupMs + inc.phaseMsElapsed
        : def.startupMs + def.activeMs + inc.phaseMsElapsed;

  if (elapsed < win.from || elapsed > win.to) return null;
  if (!t.facingMe) return null;

  return { kind: 'reverse', targetId: t.id };
}

/** True for a timed press: fresh enough to count as a reverse attempt. */
function isFreshCrouchPress(a: CombatantSnapshot): boolean {
  return a.crouchHeldMs <= REVERSE_PRESS_MAX_MS;
}

/** True while the button is physically down at all (suppresses chaining). */
function isCrouchDown(a: CombatantSnapshot): boolean {
  return a.crouchHeldMs > 0;
}

/** True when target stands behind us (|relAngle| beyond the front cone). */
function isBehind(t: TargetSnapshot): boolean {
  const abs = t.relAngle < 0 ? -t.relAngle : t.relAngle;
  return abs >= BEHIND_RAD;
}
