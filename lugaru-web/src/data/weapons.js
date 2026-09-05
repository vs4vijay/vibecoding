/**
 * Weapon table [Task 13] — every weapon number in the game lives here
 * (global constraints: no magic numbers in logic). Pure data: no three/Rapier
 * imports under src/data/.
 *
 * Design notes [spec §3.4]:
 * - `reachM`/`damage` are read at swing time by armed moves (see MoveDef
 *   `armedSwing`): one `slash` row serves every weapon.
 * - Bleeding is a property of the blade, not the move (knife/sword true,
 *   staff false).
 * - `durability` (staff only): each clash wears it down; at 0 — or on an
 *   unlucky seeded roll (CLASH_BREAK_CHANCE) — the weapon is knocked flying
 *   as a drop. Absent = the weapon cannot break by wear.
 * - `throwDamage`: damage of a thrown hit vs an armored victim; unarmored
 *   victims die outright (thrownKnifeHit). Meaningful only when `throwable`.
 */
export const WEAPONS = {
    // 2 slices set up the stab finisher (×4, Task 14's chain layer).
    knife: {
        id: 'knife',
        reachM: 0.8,
        damage: 10,
        bleedOnHit: true,
        throwable: true,
        throwDamage: 60,
    },
    sword: {
        id: 'sword',
        reachM: 1.5,
        damage: 22,
        bleedOnHit: true,
        throwable: false,
        throwDamage: 0,
    },
    staff: {
        id: 'staff',
        reachM: 1.3,
        damage: 14,
        bleedOnHit: false,
        throwable: false,
        throwDamage: 0,
        durability: 6,
    },
};
