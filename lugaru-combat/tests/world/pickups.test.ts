/**
 * Task 17 — the fixed pickup loadout.
 *
 * spawnPickups pushes knife ×2, staff ×2, sword ×1 into the real
 * WeaponDrops pool (Rapier bodies), at ground points near the player
 * spawn, queryable by the crouch-pickup probe (nearestInto) and removable
 * (the consumption side lives in game.ts).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { PhysicsWorld } from '../../src/world/physics';
import { WeaponDrops } from '../../src/world/projectiles';
import { PICKUP_SPAWNS, spawnPickups } from '../../src/world/pickups';

const FLAT_HEIGHT = (_x: number, _z: number) => 0;

let world: PhysicsWorld;
let drops: WeaponDrops;

beforeAll(async () => {
  world = await PhysicsWorld.create(FLAT_HEIGHT);
  drops = new WeaponDrops(world);
});

describe('spawnPickups', () => {
  it('spawns the fixed loadout: knife ×2, staff ×2, sword ×1', () => {
    spawnPickups(drops);
    const counts: Record<string, number> = { knife: 0, staff: 0, sword: 0 };
    let total = 0;
    drops.forEachDrop((_id, weaponClass) => {
      counts[weaponClass]++;
      total++;
    });
    expect(total).toBe(5);
    expect(counts).toEqual({ knife: 2, staff: 2, sword: 1 });
  });

  it('places every pickup point within 10 m of the player spawn (origin)', () => {
    for (const s of PICKUP_SPAWNS) {
      expect(Math.hypot(s.pos.x, s.pos.z)).toBeLessThanOrEqual(10);
    }
  });

  it('the nearest-drop probe finds a drop, and remove clears it', () => {
    // Probe from the first spawn point with a generous reach: the dropped
    // bodies clatter and settle a short distance from where they spawn.
    const at = {
      x: PICKUP_SPAWNS[0].pos.x,
      y: 0.5,
      z: PICKUP_SPAWNS[0].pos.z,
    };
    const out: { id: number; weaponClass: 'knife' | 'sword' | 'staff'; pos: { x: number; y: number; z: number } } = {
      id: 0,
      weaponClass: 'knife',
      pos: { x: 0, y: 0, z: 0 },
    };

    // Step the pool so the dropped bodies fall/settle into probe range.
    let found = false;
    for (let i = 0; i < 120 && !found; i++) {
      world.step(1 / 60);
      found = drops.nearestInto(at, 3, out);
    }
    expect(found).toBe(true);
    expect(out.weaponClass).toBe('knife');

    const before: number[] = [];
    drops.forEachDrop((id) => before.push(id));

    drops.remove(out.id);
    let after = 0;
    drops.forEachDrop((id) => {
      after++;
      expect(id).not.toBe(out.id);
    });
    expect(after).toBe(before.length - 1);
    expect(after).toBe(PICKUP_SPAWNS.length - 1);
  });
});
