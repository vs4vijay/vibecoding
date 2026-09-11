// Bot utility AI (spec §4): distance bands, projectile dodge, retreat weight,
// 12-tick decision lock. Pure function of the current frame — no lookahead.
import { botRoll, botTemperament } from "./items";
import { DOUBLE_TAP_WINDOW_TICKS } from "./constants";
import type { Fighter, InputFrame, WorldState } from "./types";

const BAND_MELEE = 48;
/** Swing-gate z depth: typical melee hitboxes reach ~34 px in z (punch1 d=44
 *  + body margin), the grab gate sits at 16 — swinging at dz in between is a
 *  guaranteed whiff, and the attack input suppresses the z-approach that
 *  would close it (soak: all survivors whiff-locked at walls, 9000 ticks). */
const MELEE_Z_REACH = 24;
const BAND_ENGAGE = 160;
const RETREAT_HP_FRACTION = 0.25;
const RETREAT_TRIGGER_DIST = 96;
const DODGE_RANGE = 140;
const LANE_WIDTH = 20;
const DECISION_LOCK_TICKS = 12;
const SPECIAL_CHANCE = 0.15;
/** MP reserve above the cheapest special cost before a bot will cast. */
const SPECIAL_MP_RESERVE = 20;

/**
 * Minimal context slice the bot reads: sheet data for MP thresholds is
 * resolved by callers holding full SimContext; bot itself stays decoupled.
 */
export interface SimContextMin {
  sheets: Map<string, unknown>;
  weapons: Record<string, unknown>;
  items: Record<string, unknown>;
}

/**
 * Decide this bot's input frame. Bands (spec §4): <48 attack /
 * 48–160 approach / >160 approach-or-special when mp ≥ cost + 20. A hostile
 * projectile crossing my lane overrides everything; HP ≤ 25% flips approach
 * into retreat beyond point-blank. Committed decisions lock for 12 ticks
 * via `cooldownUntilTick` — emergency dodges bypass the lock. Dedicated
 * jitter channel (`drawBotJitter`) keeps world RNG replay-pure.
 */
export function botThink(w: WorldState, self: Fighter, _ctx: SimContextMin): InputFrame {
  const neutral: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };
  if (self.state === "dead" || self.state === "grabbed" || self.state === "thrown") return neutral;
  // Grabbing: throw immediately — bots never hold a grab (spec §2.2).
  // Evaluated before the decision lock so cooldownUntilTick can't swallow it.
  if (self.state === "grabbing") return { ...neutral, a: true };

  // Emergency dodge — evaluated before the decision lock (spec §4).
  for (const p of w.projectiles) {
    if (p.ownerId === self.id) continue;
    const closing = (p.vx > 0) === (self.x > p.x);
    const dist = Math.abs(self.x - p.x);
    if (!closing || dist > DODGE_RANGE || Math.abs(p.z - self.z) >= LANE_WIDTH) continue;
    // Mostly jump the shot; a small per-bot jitter varies the response without
    // touching world RNG.
    return botTemperament(self) < 0.2 ? { ...neutral, dHeld: true } : { ...neutral, j: true };
  }

  // Decision lock: committed bots drift neutral until the lock expires.
  if ((self.cooldownUntilTick ?? 0) > w.tick) return neutral;

  const foe = nearestFoe(w, self);
  if (foe === undefined) return neutral;

  const dx = foe.x - self.x;
  const dz = foe.z - self.z;
  const dist = Math.abs(dx) + Math.abs(dz);
  // HP ceiling comes from the sheet; without one (bare contexts) no retreat.
  const maxHp = (_ctx.sheets.get(self.charId) as { maxHp?: number } | undefined)?.maxHp ?? self.hp;
  const lowHp = self.hp <= maxHp * RETREAT_HP_FRACTION;
  const out: InputFrame = { ...neutral };

  if (dist < BAND_MELEE) {
    // Spec §4 bands: <48 px attacks, no HP exception — low HP only raises
    // retreat weight beyond point-blank. But the swing only fires when the
    // foe is actually inside the swing envelope — in front, |dz| within z
    // reach (typical melee hitboxes reach ~34 px in z; swinging outside that
    // is a guaranteed whiff, and the attack input suppresses the approach
    // that would close it). Otherwise reposition on foot toward the foe.
    const inSwingReach = Math.abs(dz) <= MELEE_Z_REACH && dx * self.facing >= -4;
    if (inSwingReach) {
      out.a = true;                                   // in range: swing
    } else {
      out.dir.x = dx > 4 ? 1 : dx < -4 ? -1 : 0;      // close in / turn around
      out.dir.z = dz > 4 ? 1 : dz < -4 ? -1 : 0;
    }
  } else if (lowHp && dist > RETREAT_TRIGGER_DIST) {  // retreat weight
    // Flee only toward the arena's centre half — never corner-ward. A bot
    // fleeing into a wall camps there dashing forever while its (also
    // fleeing) foes hover out of reach: a mutual stalemate nothing can
    // close, so matches never end (soak: last fighters never meet).
    // Centre-ward flight keeps the retreat behavior but every trajectory
    // eventually converges back into engagement range.
    const fleeLeft = dx > 0;                          // foe right → flee left
    const centre = (w.stage.walls.right - w.stage.walls.left) / 2;
    const room = fleeLeft
      ? self.x - w.stage.walls.left
      : w.stage.walls.right - self.x;
    if (room > centre) {
      out.dir.x = (dx > 4 ? -1 : dx < -4 ? 1 : 0) as -1 | 0 | 1;  // away
      out.dir.z = 0;
    } else {
      out.dir.x = dx > 4 ? 1 : dx < -4 ? -1 : 0;      // cornered: fight it out
      out.dir.z = dz > 4 ? 1 : dz < -4 ? -1 : 0;
    }
  } else {
    out.dir.x = dx > 4 ? 1 : dx < -4 ? -1 : 0;
    out.dir.z = dz > 4 ? 1 : dz < -4 ? -1 : 0;
    if (dist > BAND_ENGAGE) {
      // >160: approach, or open with the sheet's cheapest sequence special
      // when MP comfortably covers it. The cast rides the buffer as a D>→A
      // chord: phase tokens are emitted across decisions, and the FSM's
      // matcher fires the move from the completed chord.
      const special = specialIntent(_ctx.sheets.get(self.charId), self);
      if (special !== null && !pendingChordToken(self, w.tick, "A")) {
        if (pendingChordToken(self, w.tick, ">")) {
          out.a = true;                                 // phase 3 of D>A
        } else if (pendingChordToken(self, w.tick, "D")) {
          out.dir.x = 1;                                // phase 2: ">" while advancing
        } else if (botRoll(self, w.tick) < SPECIAL_CHANCE) {
          out.dHeld = true;                             // phase 1: "D"
        }
      }
    }
  }

  // Precision close-in: the decision lock's neutral gaps re-arm the
  // double-tap (a repeated same-token edge lands 12 ticks apart, window
  // 14), so unsuppressed close-range movement dash-chains at 5 px/tick and
  // overshoots the <48 in-band window between decisions — two survivors
  // ping-ponged through each other for 1800 ticks without a swing landing
  // (soak timeouts). Inside the retreat trigger, walk: the second tap is
  // suppressed so repositioning never dashes. Long transit keeps dashing.
  if (out.dir.x !== 0 && dist < RETREAT_TRIGGER_DIST &&
      wouldDoubleTap(self, w.tick, out.dir.x)) {
    out.dir.x = 0;
  }

  self.cooldownUntilTick = w.tick + DECISION_LOCK_TICKS;
  return out;
}

/**
 * True when emitting `dirX` now would log a same-token edge within the
 * double-tap window of the previous one — i.e. the FSM would read it as a
 * deliberate dash. Bots use this to keep repositioning moves on foot.
 */
function wouldDoubleTap(self: Fighter, tick: number, dirX: number): boolean {
  const token = dirX > 0 ? ">" : "<";
  for (const rec of self.buffer.pressLog()) {
    if (tick - rec.tick > DOUBLE_TAP_WINDOW_TICKS) break;
    if (rec.token === token) return true;
  }
  return false;
}

function nearestFoe(w: WorldState, self: Fighter): Fighter | undefined {
  let best: Fighter | undefined;
  let bestDist = Infinity;
  for (const f of w.fighters) {
    if (f.id === self.id || f.state === "dead") continue;
    if (self.team !== "independent" && f.team === self.team) continue;
    const d = Math.abs(f.x - self.x) + Math.abs(f.z - self.z);
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best;
}

/**
 * True when the buffer holds `token` within the decision window and no "A"
 * has landed since — i.e. the chord is still open at that phase. The buffer
 * doubles as phase memory for multi-decision casts; all state lives in the
 * replayed world.
 */
function pendingChordToken(self: Fighter, tick: number, token: "D" | ">" | "A"): boolean {
  const log = self.buffer.pressLog();
  let saw = false;
  for (let i = 0; i < log.length; i++) {
    const rec = log[i]!;
    if (tick - rec.tick > DECISION_LOCK_TICKS) break;
    if (rec.token === "A") return false;              // chord consumed/failed
    if (rec.token === token) { saw = true; break; }
  }
  return saw;
}

/**
 * The sheet's cheapest sequence special, if the bot can comfortably afford
 * it (cost + SPECIAL_MP_RESERVE). Null when no special exists or MP is low.
 */
function specialIntent(sheet: unknown, self: Fighter): string | null {
  const moves = (sheet as { moves?: Record<string, { sequence?: string; frames: Array<{ mpCost?: number }> }> } | undefined)?.moves;
  if (moves === undefined) return null;
  let best: { id: string; cost: number } | null = null;
  for (const [id, mv] of Object.entries(moves)) {
    if (mv.sequence === undefined) continue;
    let cost = 0;
    for (const fr of mv.frames) cost += fr.mpCost ?? 0;
    if (best === null || cost < best.cost) best = { id, cost };
  }
  if (best === null || self.mp < best.cost + SPECIAL_MP_RESERVE) return null;
  return best.id;
}
