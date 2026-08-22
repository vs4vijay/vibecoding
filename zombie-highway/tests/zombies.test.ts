import { describe, expect, it } from "vitest";
import { predictLanding, ZombiePool } from "../src/game/zombies";

describe("predictLanding", () => {
  it("leads the target by car velocity and clamps to road by accuracy", () => {
    const perfect = predictLanding(0, 5, 20, 10, 1);
    expect(perfect).toBeCloseTo(5 * (20 / (10 + 28 * 0.9)), 1);
    const sloppy = predictLanding(6, 5, 20, 10, 0);
    expect(sloppy).toBeLessThan(perfect + 0.001); // low accuracy aims nearer current pos
    expect(predictLanding(99, 0, 20, 10, 0.5)).toBeLessThanOrEqual(7); // clamped inside rails
  });
});

describe("ZombiePool", () => {
  it("leap lands and attaches weight to correct side", () => {
    const pool = new ZombiePool();
    const z = pool.spawnLurker("walker", 3, 80)!;
    expect(z.state).toBe("lurking");
    // fast-forward sim until clinging (max ~10s)
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) {
      pool.update(1 / 60, { carX: 2, carVx: 0, carZ: 0, accuracy: 1 });
      if (z.state === "clinging") landed = true;
    }
    expect(landed).toBe(true);
    expect(pool.attachedWeight(2)).toEqual({ left: 0, right: 1 });
  });
  it("hit respects recent-leap double damage", () => {
    const pool = new ZombiePool();
    const z = pool.spawnLurker("brute", 3, 80)!;
    z.hp = 3;
    z.recentLeapUntil = Infinity;
    expect(pool.hit(z, 2)).toBe(false); // 2 dmg doubled -> 3hp-4 => dead?
    // resolve ambiguity: doubling happens INSIDE hit(); brute(3hp) dies to one recent 2dmg shot
    expect(z.hp).toBeLessThanOrEqual(0);
  });
  it("scrapeSide damages only that side's clingers", () => {
    const pool = new ZombiePool();
    const a = pool.spawnLurker("walker", 3, 80)!;
    const b = pool.spawnLurker("walker", -3, 90)!;
    a.state = "clinging"; b.state = "clinging";
    a.side = "right"; b.side = "left";
    const killed = pool.scrapeSide("right");
    expect(killed.map((k) => k.id)).toEqual([a.id]);
    expect(b.hp).toBe(1);
  });
});
