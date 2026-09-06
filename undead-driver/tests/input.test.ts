import { describe, expect, it } from "vitest";
import { classifyTap, InputController } from "../src/core/input";

describe("classifyTap", () => {
  it("accepts quick small movements, rejects drags and long holds", () => {
    expect(classifyTap(150, 5)).toBe(true);
    expect(classifyTap(250, 5)).toBe(false);
    expect(classifyTap(100, 40)).toBe(false);
  });
});

describe("InputController (test hooks)", () => {
  it("tap on left half fires left gun", () => {
    const c = new InputController({ clientWidth: 800 }, { testHooks: true });
    const fired: string[] = [];
    c.onFire((side) => fired.push(side));
    c["press"](100, 400, 0);
    c["release"](120);
    expect(fired).toEqual(["left"]);
  });
  it("horizontal drag produces steering then zero on release", () => {
    const c = new InputController({ clientWidth: 800 }, { testHooks: true });
    c["press"](400, 400, 0);
    c["moveTo"](500, 400, 100);
    expect(c.steer).toBeGreaterThan(0);
    c["release"](150);
    expect(c.steer).toBe(0);
  });
  it("arrow key steers right", () => {
    const c = new InputController({ clientWidth: 800 }, { testHooks: true });
    c["keyDown"]("ArrowRight");
    expect(c.steer).toBe(1);
  });
});
