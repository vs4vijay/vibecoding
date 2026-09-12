import type {
  CharacterSheet, Fighter, HitboxDef, Knockback, Projectile, SimEvent, WeaponLike, WorldState,
} from "./types";
import { BURN_TICKS, COMBO_RESET_TICKS, KNOCKDOWN_LAUNCH_VY, THAW_TICKS } from "./constants";

/** LAUNCH_THRESHOLD: knockback vy at or below this launches into a knockdown. */
const LAUNCH_THRESHOLD = KNOCKDOWN_LAUNCH_VY;
/** Ticks of downed flight + get-up protection applied after a launch. */
const KNOCKDOWN_INVULN_TICKS = 40 + 18;

/** The damage-relevant slice of a hitbox — HitboxDef and Projectile.box both satisfy it. */
type DamageBox = Pick<HitboxDef, "damage" | "knockback" | "hitstunTicks" | "type" | "priority"> & {
  status?: "freeze" | "burn" | undefined;             // Refinement 4 rider (optional both ways)
};

interface ResolvedBox {
  owner: Fighter;
  box: HitboxDef;
  ax: number;
  ay: number;
  az: number;
}

/** §2.4 step 1: collect every fighter's active-frame hitbox. */
function activeBoxes(w: WorldState, sheets: Map<string, CharacterSheet>): ResolvedBox[] {
  const out: ResolvedBox[] = [];
  for (const f of w.fighters) {
    if (f.state !== "attack") continue;
    const sheet = sheets.get(f.charId);
    const mv = f.moveId ? sheet?.moves[f.moveId] : undefined;
    const fr = mv?.frames[f.frameIdx ?? -1];
    if (!fr?.hitbox) continue;
    out.push({ owner: f, box: fr.hitbox, ax: f.x, ay: f.y, az: f.z });
  }
  return out;
}

/**
 * §2.4 step 2: AABB overlap between a resolved hitbox and a victim body.
 * Body is a standing volume ~28w × 56h × 24d whose feet origin sits at (x, y, z);
 * y is negative-up, so the body's vertical centre is 28 above the feet (fy - 28).
 */
function overlaps(a: ResolvedBox, f: Fighter): boolean {
  const cx = a.ax + a.box.x * a.owner.facing;
  const cy = a.ay + a.box.y;
  const cz = a.az + a.box.z;
  return (
    Math.abs(cx - f.x) <= a.box.w / 2 + 14 &&
    Math.abs(cy - (f.y - 28)) <= a.box.h / 2 + 28 &&
    Math.abs(cz - f.z) <= a.box.d / 2 + 12
  );
}

/** Same capsule-margin pattern as overlaps(), for a projectile-sized box. */
function projectileOverlaps(p: Projectile, f: Fighter): boolean {
  return (
    Math.abs(p.x - f.x) <= p.size.w / 2 + 14 &&
    Math.abs(p.y - (f.y - 28)) <= p.size.h / 2 + 28 &&
    Math.abs(p.z - f.z) <= p.size.d / 2 + 12
  );
}

export function resolveHits(
  w: WorldState,
  sheets: Map<string, CharacterSheet>,
  events: SimEvent[],
  weapons?: Record<string, WeaponLike>,
): void {
  const boxes = activeBoxes(w, sheets);
  // §2.4 step 3: priority desc, then attacker id asc.
  boxes.sort((a, b) => b.box.priority - a.box.priority || a.owner.id - b.owner.id);

  const boxByOwner = new Map<number, ResolvedBox>();
  for (const rb of boxes) boxByOwner.set(rb.owner.id, rb);

  for (const ab of boxes) {
    const attacker = ab.owner;
    // A swing only connects while its owner is still mid-move: a higher-priority
    // hit earlier this tick may have knocked the attacker out of "attack".
    if (attacker.state !== "attack") continue;

    for (const victim of w.fighters) {
      if (victim.id === attacker.id) continue;
      // Team filter: independents hit everyone; same non-independent team is skipped.
      if (attacker.team !== "independent" && victim.team === attacker.team) continue;
      if (victim.state === "dead") continue;
      if (w.tick < victim.invulnUntilTick) continue; // §2.4 step 4: i-frames
      if (!overlaps(ab, victim)) continue; // §2.4 step 2
      if (attacker.hitIds.has(victim.id)) continue; // once-per-swing

      if (ab.box.type === "grab") {
        // A victim already engaged in a grab exchange cannot be re-grabbed;
        // stealing it would strand the first grabber in "grabbing" forever.
        if (victim.state === "grabbed" || victim.state === "grabbing" || victim.state === "thrown") continue;
        attacker.hitIds.add(victim.id);
        applyGrab(attacker, victim, events);
      } else {
        attacker.hitIds.add(victim.id);
        applyDamage(w, attacker, victim, ab.box, boxByOwner, events, weapons); // §2.4 steps 5–6
      }
    }
  }
}

/**
 * §3.2 projectile pass: each projectile × fighter, same filter chain as
 * resolveHits (owner, team, dead, i-frames, once-per-projectile hitIds).
 * healsAllies boxes silently heal eligible fighters (no hit event — the
 * renderer's flash is keyed on hit events); the rest route through the
 * shared damageFighter ladder. Non-pierce projectiles that connected are
 * removed after the pass; a thrown weapon is consumed on fighter contact.
 */
export function resolveProjectiles(w: WorldState, sheets: Map<string, CharacterSheet>, events: SimEvent[]): void {
  const remove = new Set<Projectile>();

  for (const p of w.projectiles) {
    const owner = w.fighters.find((o) => o.id === p.ownerId);
    const ownerTeam = owner?.team ?? "independent";

    for (const f of w.fighters) {
      if (f.id === p.ownerId) continue;                 // never the owner
      if (f.state === "dead") continue;
      if (w.tick < f.invulnUntilTick) continue;         // i-frames
      if (p.hitIds.has(f.id)) continue;                 // once-per-projectile
      if (!projectileOverlaps(p, f)) continue;

      if (p.box.healsAllies === true) {
        // Heal only allies (any non-self fighter when the owner is independent)
        // that are actually wounded; a full-hp overlap consumes nothing.
        const maxHp = sheets.get(f.charId)?.maxHp ?? f.hp;
        const isAlly = ownerTeam === "independent" || f.team === ownerTeam;
        if (!isAlly || f.hp >= maxHp) continue;
        p.hitIds.add(f.id);
        f.hp = Math.min(maxHp, f.hp + p.box.damage);
        continue;                                       // silent: no hit event, keeps flying
      }

      // Damage path: the same team filter as resolveHits.
      if (ownerTeam !== "independent" && f.team === ownerTeam) continue;
      p.hitIds.add(f.id);
      const dir = p.vx > 0 ? 1 : -1;                    // knockback follows travel
      damageFighter(w, f, p.box, dir, p.ownerId, events);
      if (p.thrownWeapon !== undefined) remove.add(p);  // fighter contact consumes a throw
      else if (!p.pierce) remove.add(p);                // one-hit projectiles despawn
    }
  }

  if (remove.size > 0) {
    w.projectiles = w.projectiles.filter((p) => !remove.has(p));
  }
}

function applyGrab(attacker: Fighter, victim: Fighter, events: SimEvent[]): void {
  victim.state = "grabbed";
  victim.stateTick = 0;
  victim.vx = 0;
  victim.vy = 0;
  attacker.state = "grabbing";
  attacker.stateTick = 0;
  events.push({ type: "grab", who: attacker.id, victim: victim.id });
}

function applyDamage(
  w: WorldState,
  attacker: Fighter,
  victim: Fighter,
  box: HitboxDef,
  boxByOwner: Map<number, ResolvedBox>,
  events: SimEvent[],
  weapons?: Record<string, WeaponLike>,
): void {
  // §3.3: a melee/heavy weapon overrides the swing's damage with meleeDamage
  // and loses one durability per landed victim hit; at 0 the weapon breaks.
  const wdef = attacker.holdingWeapon !== undefined ? weapons?.[attacker.holdingWeapon] : undefined;
  const wielded = wdef !== undefined && (wdef.kind === "melee" || wdef.kind === "heavy");
  const effBox: DamageBox = wielded && wdef !== undefined ? { ...box, damage: wdef.meleeDamage } : box;

  damageFighter(w, victim, effBox, attacker.facing, attacker.id, events);

  if (wielded && attacker.holdingWeapon !== undefined && wdef !== undefined) {
    const durability = (attacker.weaponDurability ?? wdef.durability) - 1;
    if (durability <= 0) {
      const defId = attacker.holdingWeapon;
      delete attacker.holdingWeapon;
      delete attacker.weaponDurability;
      events.push({ type: "weaponBreak", defId });
    } else {
      attacker.weaponDurability = durability;
    }
  }

  // Clash: if the victim was itself mid-swing with a box that reaches this
  // attacker, the higher-priority hit resolving first wins the trade — the
  // attacker is staggered out of its own swing (no damage), so its lower box
  // never lands when its turn arrives.
  const vb = boxByOwner.get(victim.id);
  if (vb && overlaps(vb, attacker) && attacker.state === "attack") {
    attacker.state = "hitstun";
    attacker.stateTick = 0;
  }
}

/**
 * Shared §2.4 steps 5–6 damage ladder for melee boxes AND projectiles:
 * shatter (fire on frozen → double + knockdown), hp, knockback along `dir`,
 * combo counter, hit event, then KO / knockdown / freeze / burn / hitstun.
 */
function damageFighter(w: WorldState, victim: Fighter, box: DamageBox, dir: number, attackerId: number, events: SimEvent[]): void {
  const kb: Knockback = box.knockback;

  // Fire hit on a frozen victim shatters: double damage + instant knockdown.
  const shattered = box.status === "burn" && victim.state === "frozen";
  const damage = shattered ? box.damage * 2 : box.damage;
  const launched = shattered || (kb.vy ?? 0) <= LAUNCH_THRESHOLD;

  victim.hp -= damage;
  victim.vx = kb.vx * dir;
  victim.vy = kb.vy;

  // §2.4 step 6: combo counter on the victim, reset after a gap.
  if (w.tick - victim.comboLastTick > COMBO_RESET_TICKS) victim.comboCount = 0;
  victim.comboCount += 1;
  victim.comboLastTick = w.tick;

  events.push({
    type: "hit",
    attacker: attackerId,
    victim: victim.id,
    damage,
    heavy: box.type === "heavy",
    blocked: false,
  });

  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.state = "dead";
    victim.stateTick = 0;
    events.push({ type: "ko", victim: victim.id });
    checkMatchEnd(w);
  } else if (launched) {
    victim.state = "knockdown";
    victim.stateTick = 0;
    victim.invulnUntilTick = w.tick + KNOCKDOWN_INVULN_TICKS;
  } else if (!applyStatus(w, victim, box.status)) {
    victim.state = "hitstun";
    victim.stateTick = 0;
  }
}

/** §2.2 status rider shared by melee boxes and projectiles; false when no status. */
function applyStatus(w: WorldState, victim: Fighter, status: DamageBox["status"]): boolean {
  if (status === "freeze") {
    victim.state = "frozen";
    victim.stateTick = 0;
    victim.frozenUntilTick = w.tick + THAW_TICKS;
    return true;
  }
  if (status === "burn") {
    victim.state = "burned";
    victim.stateTick = 0;
    victim.burnUntilTick = w.tick + BURN_TICKS;
    return true;
  }
  return false;
}

function checkMatchEnd(w: WorldState): void {
  const alive = w.fighters.filter((f) => f.state !== "dead");
  if (alive.length <= 1) w.over = true;
}
