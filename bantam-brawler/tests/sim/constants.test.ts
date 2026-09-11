import { describe, test, expect } from "bun:test";
import * as C from "../../src/sim/constants";

describe("spec constants", () => {
  test("match spec §2.3 table exactly", () => {
    expect(C.TICK_RATE).toBe(60);
    expect(C.GRAVITY).toBe(0.35);
    expect(C.GROUND_FRICTION).toBe(0.80);
    expect(C.AIR_DRAG).toBe(0.96);
    expect(C.WALK_SPEED).toBe(2.2);
    expect(C.RUN_DASH_SPEED).toBe(5.0);
    expect(C.JUMP_IMPULSE).toBe(-8.5);
    expect(C.KNOCKDOWN_LAUNCH_VY).toBe(-6.0);
    expect(C.ARENA_W).toBe(1600);
    expect(C.ARENA_H).toBe(480);
    expect(C.ARENA_D).toBe(120);
    expect(C.WALL_BOUNCE_RESTITUTION).toBe(0.4);
    expect(C.MAX_FIGHTERS).toBe(8);
  });
});
