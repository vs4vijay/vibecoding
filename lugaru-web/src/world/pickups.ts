/**
 * Task 17 — arena pickup layout.
 *
 * Fixed weapon-drop points near the player spawn (brief: knife ×2, staff
 * ×2, sword ×1) so a fresh sandbox always has something to arm up with.
 * `spawnPickups` pushes the loadout through WeaponDrops (real Rapier
 * bodies — they clatter and settle); visuals (bob + ground ring decal)
 * live in render/fx.ts's PickupVisuals, and the crouch-pickup consumption
 * (resolver pickupOrContext → WeaponDrops.nearest → fighter.weapon) is
 * game.ts's bridge per weaponsLogic's documented split.
 */
import { WeaponDrops } from './projectiles';
import { heightAt } from './terrain';
import type { WeaponId } from '../data/weapons';

/** One fixed pickup point (ground position; y is derived from the terrain). */
export interface PickupSpawn {
  weaponClass: WeaponId;
  pos: { x: number; z: number };
}

/**
 * The loadout, fanned around the player spawn (origin) — each point well
 * clear of the boulder clusters and of the dummy's spawn (0, -3).
 */
export const PICKUP_SPAWNS: readonly PickupSpawn[] = [
  { weaponClass: 'knife', pos: { x: 2.5, z: -2.0 } },
  { weaponClass: 'knife', pos: { x: -3.0, z: -4.5 } },
  { weaponClass: 'staff', pos: { x: 4.5, z: -6.0 } },
  { weaponClass: 'staff', pos: { x: -5.0, z: -1.5 } },
  { weaponClass: 'sword', pos: { x: 1.0, z: -9.0 } },
];

/** Drop height above the terrain — enough to clatter down and settle. */
const PICKUP_DROP_HEIGHT_M = 0.4;

/**
 * Spawn every fixed pickup into `drops`; returns the drop ids in
 * PICKUP_SPAWNS order (ids are only needed for bookkeeping — visuals sync
 * straight off the drop pool each frame).
 */
export function spawnPickups(drops: WeaponDrops): number[] {
  const ids: number[] = [];
  for (const s of PICKUP_SPAWNS) {
    ids.push(
      drops.spawnDrop(s.weaponClass, {
        x: s.pos.x,
        y: heightAt(s.pos.x, s.pos.z) + PICKUP_DROP_HEIGHT_M,
        z: s.pos.z,
      }),
    );
  }
  return ids;
}
