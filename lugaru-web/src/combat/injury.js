/**
 * Injury model [spec §3.4 diegetic health; plan Task 9] — the slow clock
 * that runs on top of instant hit resolution. Bleeding wounds drain hp at
 * BLEED_DPS but never kill (BLEED_HP_FLOOR); heavy damage below
 * LIMP_HP_FRACTION of maxHp leaves the fighter limping; hp ≤ 0 or an
 * externally-set unconscious flag means knockout.
 *
 * Pure function over plain FighterState — no clock, no RNG, no sim class,
 * no three/Rapier. The caller injects dtMs each fixed step; FighterSim
 * calls this once per update() and republishes the returned events as
 * `lastInjuryEvents` for renderer polling.
 */
import { BLEED_DPS, BLEED_HP_FLOOR, LIMP_HP_FRACTION } from '../data/tuning';
/**
 * Shared quiet-step return — never mutated by this module. Transition
 * steps (rare, cold path) allocate one fresh single-event array instead,
 * so concurrent fighters can never alias each other's event lists.
 */
const NO_EVENTS = [];
const BLED_ONLY = [{ type: 'bled' }];
const LIMPED = { type: 'limped' };
const KNOCKED_OUT = { type: 'knockedOut' };
/**
 * Advance one fighter's injuries by dtMs. Emits an event exactly once per
 * transition:
 *
 * - first bleed-drain step of a bleeding episode → 'bled';
 * - hp crossing below LIMP_HP_FRACTION × maxHp → 'limped';
 * - hp ≤ 0 OR flags.unconscious already set → unconscious + phase 'ko'
 *   ('knockedOut').
 *
 * Ordering inside one tick: KO wins over limp, and a fresh external hit may
 * finish a fighter the bleed floor had clamped. Bleed alone stops at
 * BLEED_HP_FLOOR.
 *
 * Allocation: quiet steps return the shared NO_EVENTS array; transition
 * steps (rare, cold) build a small fresh array. Callers may hold either.
 */
export function updateInjuries(f, dtMs) {
    // Already out — terminal until Task 14's ragdoll/respawn layer.
    if (f.flags.unconscious)
        return NO_EVENTS;
    if (f.flags.bleeding && f.hp > BLEED_HP_FLOOR) {
        f.hp -= (dtMs / 1000) * BLEED_DPS;
        if (f.hp < BLEED_HP_FLOOR)
            f.hp = BLEED_HP_FLOOR;
        return BLED_ONLY;
    }
    // KO wins over limp: a fighter who just crossed into dying never limps.
    if (f.hp <= 0) {
        knockOut(f);
        return [KNOCKED_OUT];
    }
    const limpThreshold = LIMP_HP_FRACTION * f.maxHp;
    if (!f.flags.limping && f.hp < limpThreshold) {
        f.flags.limping = true;
        return [LIMPED];
    }
    return NO_EVENTS;
}
/** Flip a fighter to its terminal ko presentation [mirrors applyHit]. */
function knockOut(f) {
    f.flags.unconscious = true;
    f.stance = 'downed';
    f.currentMove = undefined;
    f.moveElapsedMs = 0;
    f.phase.t = 'ko';
    f.phase.moveId = undefined;
    f.phase.phaseMsLeft = Infinity;
}
