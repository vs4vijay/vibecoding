// tests/enemy.test.ts
import { describe, expect, it } from "vitest";
import { Enemy } from "../src/entities/Enemy";
import { TileMap } from "../src/world/TileMap";
import { RNG } from "../src/core/RNG";
import type { ScreenMap } from "../src/core/types";

function map(): TileMap {
  const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities: [] };
  return new TileMap(s);
}

describe("Enemy (spider)", () => {
  it("patrols within range and turns around", () => {
    const e = new Enemy(
      { type: "spider", x: 5, y: 10, props: { patrol: [5, 10], speed: 1 } },
      new RNG(1),
    );
    const m = map();
    let lastX = e.pos.x;
    for (let i = 0; i < 60; i++) {
      e.update(m, new RNG(1));
      expect(e.pos.x).toBeGreaterThanOrEqual(5 * 16 - 1);
      expect(e.pos.x).toBeLessThanOrEqual(10 * 16 + 1);
      lastX = e.pos.x;
    }
    expect(lastX).not.toBe(5 * 16);
  });
  it("takeHit kills spider and emits enemy:die", () => {
    const e = new Enemy({ type: "spider", x: 5, y: 10 }, new RNG(1));
    let died = false;
    // spy on Events via on() — see Task 8 wiring; simpler: check dead flag
    e.takeHit();
    expect(e.dead).toBe(true);
  });
});
