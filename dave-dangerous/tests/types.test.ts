// tests/types.test.ts
import { describe, expect, it } from "vitest";
import { PHYSICS, type Action, type InputState } from "../src/core/types";

describe("types & physics", () => {
  it("PHYSICS exposes jump constants", () => {
    expect(PHYSICS.JUMP_VELOCITY).toBeLessThan(0);
    expect(PHYSICS.GRAVITY).toBeGreaterThan(0);
    expect(PHYSICS.JETPACK_FUEL_MAX).toBe(60);
  });
  it("InputState is structured", () => {
    const s: InputState = { left: false, right: false, jump: false, jetpack: false, fire: false };
    expect(Object.keys(s)).toHaveLength(5);
    const actions: Action[] = ["left", "right", "jump", "jetpack", "fire"];
    for (const a of actions) expect(a in s).toBe(true);
  });
});
