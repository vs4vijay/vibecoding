// tests/dave.test.ts
import { describe, expect, it } from "vitest";
import { Dave } from "../src/entities/Dave";
import { TileMap } from "../src/world/TileMap";
import { GameState } from "../src/state/GameState";
import type { ScreenMap, InputState } from "../src/core/types";

function emptyMap(): TileMap {
  const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities: [] };
  s.tiles[12 * 20 + 0] = 1; // a single ground tile under dave at x=0..16
  return new TileMap(s);
}
const idle = (): InputState => ({ left: false, right: false, jump: false, jetpack: false, fire: false });

describe("Dave", () => {
  it("walks right with acceleration capped at WALK_MAX", () => {
    const d = new Dave(48, 176); d.grounded = true;
    const map = emptyMap();
    const st = new GameState();
    const input = { ...idle(), right: true };
    for (let i = 0; i < 30; i++) d.update(input, map, st);
    expect(d.vel.x).toBeGreaterThan(0);
    expect(d.vel.x).toBeLessThanOrEqual(2.5);
  });
  it("jumps upwards then lands", () => {
    const d = new Dave(48, 176); d.grounded = true;
    const map = emptyMap();
    const st = new GameState();
    const input = { ...idle(), jump: true };
    d.update(input, map, st);
    expect(d.vel.y).toBeLessThan(0);
  });
  it("jetpack consumes fuel", () => {
    const d = new Dave(48, 176);
    d.grounded = false;
    d.jetpackFuel = 60;
    const map = emptyMap();
    const st = new GameState();
    const input = { ...idle(), jetpack: true };
    for (let i = 0; i < 15; i++) d.update(input, map, st);
    expect(d.jetpackFuel).toBeLessThan(60);
  });
  it("lethal tile kills dave (emits dave:die)", () => {
    const d = new Dave(8 * 16, 2 * 16); // on lava tile (8,2)
    const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities: [] };
    s.tiles[2 * 20 + 8] = 3;
    const map = new TileMap(s);
    const st = new GameState();
    d.update(idle(), map, st);
    expect(d.alive).toBe(false);
  });
  it("does not jump mid-fall after walking off a ledge", () => {
    const s: ScreenMap = { width: 20, height: 13, tiles: new Array(20 * 13).fill(0), entities: [] };
    for (let c = 0; c <= 3; c++) s.tiles[12 * 20 + c] = 1; // platform: row 12, columns 0..3 (x 0..64)
    const map = new TileMap(s);
    const st = new GameState();
    const d = new Dave(48, 160); // hitbox bottom rests on the platform top (y=192)
    d.grounded = true;
    const right = { ...idle(), right: true };
    for (let i = 0; i < 10; i++) d.update(right, map, st); // walk past the ledge edge at x=64
    expect(d.grounded).toBe(false); // airborne
    for (let i = 0; i < 3; i++) d.update(right, map, st); // keep falling
    d.update({ ...idle(), jump: true }, map, st); // press jump mid-fall
    expect(d.vel.y).toBeGreaterThan(0); // still falling — no mid-air jump impulse
  });
});
