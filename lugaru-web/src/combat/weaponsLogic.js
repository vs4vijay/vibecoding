/**
 * Weapons logic [Task 13] — clash, disarm, throwing, cleaning.
 *
 * SIM-ONLY: pure functions over plain FighterState snapshots. No three.js,
 * no Rapier, no classes. Fight rules mutate their fighters in place (the
 * same convention as hitdetect.applyHit) and report what left their hands
 * as plain events that the game layer bridges to physics.
 *
 * BRIDGE CONTRACT (sim → game, implemented in src/game.ts):
 * - tryClash returns ClashResult.drops and FighterSim publishes
 *   lastCombatEvents (disarm/ko drops, knife throws): plain `WeaponSimEvent`
 *   data. game.ts converts `{type:'drop'}` → WeaponDrops.spawnDrop(pos, vel)
 *   and `{type:'throw'}` → Projectiles.throwKnife(from, dir, speed).
 * - Thrown-knife IMPACTS travel the other way: Rapier's Projectiles.step
 *   reports `{type:'hit', targetId}` / `{type:'rest', at}`; game.ts turns a
 *   hit into thrownKnifeHit(victim, thrower) (this module applies damage /
 *   stuckIn) and a rest into a knife WeaponDrops pickup.
 * - Pickups: resolver emits `pickupOrContext` (crouch, drop nearby); game.ts
 *   answers it by WeaponDrops.nearest → remove → set fighter.weapon and
 *   durability from WEAPONS. cleanBlade stays a pure flag-clear here (the
 *   crouch-near-corpse prompt is Task 18's).
 *
 * All chance rolls take a seeded `rng` (src/core/rng.ts) — never Math.random.
 */
import { MOVES } from '../data/moves';
import { WEAPONS } from '../data/weapons';
import { CLASH_BREAK_CHANCE, CLASH_KNOCK_SPEED_MPS, THROWN_KNIFE_SPEED_MPS, CLASH_WEAR_PER_CLASH, } from '../data/tuning';
import { KNIFE_HIT_CHEST_Y_M } from '../data/tuning';
import { angleDiff, forwardXZ } from './hitdetect';
// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------
/** The weapon a fighter actually holds; `null`/`'none'` both read unarmed. */
export function heldWeapon(f) {
    return f.weapon !== null && f.weapon !== 'none' ? f.weapon : null;
}
/**
 * True while `f` executes an armed move's active frames holding a weapon.
 */
function isArmedSwing(f) {
    if (f.phase.t !== 'active' || heldWeapon(f) === null)
        return false;
    const def = f.phase.moveId !== undefined ? MOVES[f.phase.moveId] : undefined;
    return def?.armedSwing === true;
}
/** Bearing from `watcher` to `other` inside the armed swing's arc? */
function facesSwing(watcher, other, halfArc) {
    const dx = other.pos.x - watcher.pos.x;
    const dz = other.pos.z - watcher.pos.z;
    if (dx === 0 && dz === 0)
        return true; // co-located: trivially facing
    const bearing = Math.atan2(-dx, -dz); // heading that would face the other
    return Math.abs(angleDiff(watcher.heading, bearing)) <= halfArc;
}
/**
 * Build the drop event for a weapon leaving `f`'s hand. `awayFrom` knocks
 * the weapon along f−awayFrom (clash/disarm scatter); `null` drops it dead
 * (KO: it falls beside the body). Position/velocity are COPIES — the sim
 * keeps mutating its own state after emission.
 */
export function weaponDropEvent(f, awayFrom, reason) {
    let vel = { x: 0, y: 0, z: 0 };
    if (awayFrom !== null) {
        const dx = f.pos.x - awayFrom.pos.x;
        const dz = f.pos.z - awayFrom.pos.z;
        const dist = Math.hypot(dx, dz);
        const nx = dist > 1e-9 ? dx / dist : 0;
        const nz = dist > 1e-9 ? dz / dist : 0;
        vel = { x: nx * CLASH_KNOCK_SPEED_MPS, y: 0, z: nz * CLASH_KNOCK_SPEED_MPS };
    }
    return {
        type: 'drop',
        reason,
        weaponClass: heldWeapon(f),
        fromId: f.id,
        pos: { x: f.pos.x, y: f.pos.y, z: f.pos.z },
        vel,
    };
}
/** Strip a fighter of their held weapon (drop events are the caller's job). */
function stripWeapon(f, keepWear) {
    f.weapon = null;
    // ONLY a weapon that broke by reaching durability 0 keeps its wear count;
    // every other strip (disarm, KO drop, unlucky roll) clears it — the pickup
    // layer (game.ts) resets it from WEAPONS on re-arm either way.
    if (!keepWear)
        f.durability = undefined;
}
// ---------------------------------------------------------------------------
// Clash
// ---------------------------------------------------------------------------
/**
 * Two simultaneous armed swings meeting blade-to-blade.
 *
 * Gates [brief Task 13]: BOTH fighters in their armed move's active phase,
 * holding weapons, facing each other inside the swing arc, and close enough
 * for the blades to touch (within the longer weapon's reach). On success:
 *
 * - both swings cancel into recovery (timeline position preserved);
 * - weapons with WEAPONS durability wear CLASH_WEAR_PER_CLASH;
 * - a weapon at 0 durability — or facing an unlucky seeded roll
 *   (< CLASH_BREAK_CHANCE, one rng() call per surviving weapon, a then b) —
 *   is knocked flying: drop event, hand empties.
 *
 * CLASH TAKES PRECEDENCE OVER DAMAGE: the caller runs this BEFORE any
 * collectHits/applyHit for the step (game.ts does exactly that). Afterwards
 * both fighters sit in recovery, so findHit answers nothing — no damage
 * application path can fire.
 *
 * Returns null when no clash happens (any gate fails).
 */
export function tryClash(a, b, rng) {
    if (!isArmedSwing(a) || !isArmedSwing(b))
        return null;
    // Blades must be able to touch: within the longer weapon's reach…
    const reachA = WEAPONS[heldWeapon(a)].reachM;
    const reachB = WEAPONS[heldWeapon(b)].reachM;
    const maxReach = Math.max(reachA, reachB) + 1e-9;
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    if (dx * dx + dz * dz > maxReach * maxReach)
        return null;
    // …and each swing must be aimed at the other (shared slash arc).
    const halfArc = MOVES.slash.arcRad / 2 + 1e-9;
    if (!facesSwing(a, b, halfArc) || !facesSwing(b, a, halfArc))
        return null;
    // Clash! Both swings die into recovery.
    for (const f of [a, b]) {
        const def = MOVES[f.phase.moveId];
        f.phase.t = 'recovery';
        f.phase.phaseMsLeft = def.recoveryMs;
        f.moveElapsedMs = def.startupMs + def.activeMs;
    }
    // Wear + break rolls, deterministic in [a, b] order.
    const drops = [];
    for (const [f, opponent] of [
        [a, b],
        [b, a],
    ]) {
        const weapon = heldWeapon(f);
        const durability = WEAPONS[weapon].durability;
        let broke = false;
        let brokeByWear = false;
        if (durability !== undefined) {
            f.durability = (f.durability ?? durability) - CLASH_WEAR_PER_CLASH;
            if (f.durability <= 0) {
                broke = true;
                brokeByWear = true;
            }
        }
        if (!broke && rng() < CLASH_BREAK_CHANCE)
            broke = true;
        if (broke) {
            drops.push(weaponDropEvent(f, opponent, 'clash'));
            // keepWear only when wear (not the rng roll) caused the break; the
            // short-circuit above preserves one rng() call per surviving weapon.
            stripWeapon(f, brokeByWear);
        }
    }
    return { drops };
}
// ---------------------------------------------------------------------------
// Disarm
// ---------------------------------------------------------------------------
/**
 * A successful reversal against an armed fighter ALWAYS disarms them
 * [brief Task 13]: the weapon spawns as a drop beside the victim, knocked
 * away from the reverser. Mutates the victim (hand empties, durability
 * clears); returns the bridge event, or null when the victim holds nothing
 * (callers may skip bridging).
 */
export function onReversalVsArmed(reverser, armedVictim) {
    if (heldWeapon(armedVictim) === null)
        return null;
    const event = weaponDropEvent(armedVictim, reverser, 'disarm');
    stripWeapon(armedVictim, false);
    return event;
}
// ---------------------------------------------------------------------------
// Thrown knives
// ---------------------------------------------------------------------------
/**
 * Launch a held knife [brief Task 13]. Emits the flight event game.ts turns
 * into a Rapier body (Projectiles.throwKnife); the SIM never simulates the
 * flight itself — the ballistic result is decided where the projectile
 * lands, via thrownKnifeHit.
 *
 * `dir` is the ground-plane aim; it is normalized defensively. Returns null
 * (hand unchanged) when the fighter holds nothing throwable.
 */
export function throwKnife(state, dir) {
    if (heldWeapon(state) === null || !WEAPONS[heldWeapon(state)].throwable)
        return null;
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-9)
        return null; // no aim, no throw
    const event = {
        type: 'throw',
        weaponClass: 'knife',
        fromId: state.id,
        from: {
            x: state.pos.x,
            y: state.pos.y + KNIFE_HIT_CHEST_Y_M,
            z: state.pos.z,
        },
        dir: { x: dir.x / len, z: dir.z / len },
        speed: THROWN_KNIFE_SPEED_MPS,
    };
    stripWeapon(state, false);
    return event;
}
/**
 * Analytic ballistic RESULT of a thrown knife connecting with `victim`
 * [brief Task 13]: unarmored → one-hit kill, armored → WEAPONS throwDamage.
 * The blade sticks in the body (stuckIn) either way — retrieve it by rolling
 * over the body (Task 18) — and the wound bleeds (it is a blade).
 *
 * Mirrors applyHit's lethal handling (KO phase, unconscious flag, grounded).
 * Pure over the pair; the thrower is untouched.
 */
export function thrownKnifeHit(victim, thrower) {
    const armored = victim.flags.armored === true;
    const damage = armored
        ? WEAPONS.knife.throwDamage
        : victim.maxHp; // unarmored: blade to the vitals — instant kill
    victim.hp = Math.max(0, victim.hp - damage);
    victim.stuckIn = true;
    victim.flags.bleeding = true;
    let fatal = false;
    if (victim.hp <= 0) {
        fatal = true;
        victim.flags.unconscious = true;
        victim.stance = 'downed';
        victim.currentMove = undefined;
        victim.moveElapsedMs = 0;
        victim.phase.t = 'ko';
        victim.phase.moveId = undefined;
        victim.phase.phaseMsLeft = Infinity;
    }
    return { damageDealt: damage, fatal, stuckIn: victim.id, thrownBy: thrower.id };
}
// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------
/**
 * Clean a bloody blade on the ground/clothing [brief Task 13]. Pure flag
 * clear: true when there was blood to wipe (the weapon had landed a hit),
 * false otherwise. The crouch-prompt presentation near a corpse is Task 18's
 * (the resolver's cleanBlade context move already gates on the flag).
 */
export function cleanBlade(f) {
    if (f.bloodiedWeapon !== true)
        return false;
    f.bloodiedWeapon = false;
    return true;
}
// Shared geometry helper re-export so this module is the one weapons surface.
export { forwardXZ };
