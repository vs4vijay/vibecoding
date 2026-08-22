import { CONFIG } from "../config";
import type { Zombie, ZombiePool, ZombieSide } from "./zombies";

export type FireResult = { hit: boolean; killed: Zombie | null; points: number };

// Leaping zombies are airborne mid-approach; anything beyond this is a wasted
// round. Clinging zombies are exempt: they are attached to the hull by
// construction (z = carZ - slot*0.9), so they are always in range.
const LEAP_RANGE_LIMIT_M = 14;

/**
 * One trigger pull on a flank. Reload gate first (empty mag or mid-reload
 * arms the reload timer, no shot); then the nearest clinging-or-leaping
 * zombie on that side takes the hit. Every trigger pull spends a round,
 * hit or miss.
 */
export function fireGun(
  side: ZombieSide,
  zombies: ZombiePool,
  gun: { mag: number; reloadT: number },
  ctx: { carX: number; carZ: number },
): FireResult {
  if (gun.mag <= 0 || gun.reloadT > 0) {
    gun.reloadT = CONFIG.gun.reloadS;
    return { hit: false, killed: null, points: 0 };
  }
  gun.mag--;

  let best: Zombie | null = null;
  let bestDist = Infinity;
  for (const z of zombies.all()) {
    if (z.state !== "clinging" && z.state !== "leaping") continue;
    if (z.side !== side) continue;
    if (z.state === "leaping" && Math.abs(z.z - ctx.carZ) > LEAP_RANGE_LIMIT_M) continue;
    const dist = Math.hypot(z.x - ctx.carX, z.z - ctx.carZ);
    if (dist < bestDist) {
      best = z;
      bestDist = dist;
    }
  }
  if (!best) return { hit: false, killed: null, points: 0 };

  const survived = zombies.hit(best, CONFIG.gun.dmg);
  const killed = survived ? null : best;
  const points = killed
    ? CONFIG.zombies[killed.type].points *
      (zombies.isRecentLeap(killed) ? CONFIG.gun.recentLeapMult : 1)
    : 0;
  return { hit: true, killed, points };
}
