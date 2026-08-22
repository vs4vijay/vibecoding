import { describe, expect, it } from "vitest";
import { fireGun } from "../src/game/combat";
import { ZombiePool } from "../src/game/zombies";

function cling(pool: ZombiePool, side: "left" | "right", x: number) {
  const z = pool.spawnLurker("walker", x, 80)!;
  z.state = "clinging"; z.side = side; z.hp = 1; z.recentLeapUntil = -Infinity;
  return z;
}

describe("fireGun", () => {
  it("hits nearest zombie on the fired side", () => {
    const pool = new ZombiePool();
    const near = cling(pool, "right", 1.4);
    const far = cling(pool, "right", 2.6);
    const gun = { mag: 8, reloadT: 0 };
    const res = fireGun("right", pool, gun, { carX: 0, carZ: 0 });
    expect(res.hit).toBe(true);
    expect(near.state).toBe("dead");
    expect(far.state).toBe("clinging");
    expect(gun.mag).toBe(7);
  });
  it("empty mag triggers reload and no shot", () => {
    const pool = new ZombiePool();
    cling(pool, "left", -1.5);
    const gun = { mag: 1, reloadT: 0 };
    const r1 = fireGun("left", pool, gun, { carX: 0, carZ: 0 });
    expect(r1.hit).toBe(true);
    const r2 = fireGun("left", pool, gun, { carX: 0, carZ: 0 });
    expect(r2.hit).toBe(false);
    expect(gun.reloadT).toBeGreaterThan(0.9);
  });
  it("misses when no target on that side, still consumes ammo", () => {
    const pool = new ZombiePool();
    cling(pool, "left", -1.5);
    const gun = { mag: 3, reloadT: 0 };
    const res = fireGun("right", pool, gun, { carX: 0, carZ: 0 });
    expect(res).toMatchObject({ hit: false, killed: null });
    expect(gun.mag).toBe(2);
  });
});
