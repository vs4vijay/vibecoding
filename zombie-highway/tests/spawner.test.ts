import { describe, expect, it } from "vitest";
import { Spawner } from "../src/game/spawner";
import { ZombiePool } from "../src/game/zombies";
import { ObstaclePool } from "../src/game/obstacles";
import { knobsForLevel } from "../src/game/difficulty";

// deterministic RNG for tests
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Spawner obstacle rows", () => {
  it("always leaves a >=2.6m passable gap across 200 seeded rows", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const zombies = new ZombiePool();
      const obstacles = new ObstaclePool();
      const sp = new Spawner(zombies, obstacles, mulberry(seed));
      const row = sp.spawnObstacleRow(/*z*/ 90, knobsForLevel(5));
      const blocked = row.filter((o) => o !== null);
      // sweep car-width intervals across road, find any x fully clear of all obstacles
      let passable = false;
      for (let x = -5.6; x <= 5.6; x += 0.2) {
        const clear = blocked.every((o) => Math.abs(o!.x - x) > o!.halfW + 0.95 + 0.35);
        if (clear) { passable = true; break; }
      }
      expect(passable, `seed ${seed} row ${JSON.stringify(blocked)}`).toBe(true);
    }
  });
  it("respects maxZombies from knobs", () => {
    const zombies = new ZombiePool();
    const sp = new Spawner(zombies, new ObstaclePool(), mulberry(7));
    const knobs = { ...knobsForLevel(9), maxZombies: 2 };
    for (let i = 0; i < 600; i++) sp.update(1 / 60, { carX: 0, carZ: 0, knobs });
    const busy = [...zombies.all()].filter((z) => ["telegraphing", "leaping", "clinging"].includes(z.state)).length;
    expect(busy).toBeLessThanOrEqual(2);
  });
});
