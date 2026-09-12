import { describe, test, expect } from "bun:test";
import { createTouchSource, hasTouch } from "../../src/input/touch";

describe("touch source", () => {
  test("edges: attack true only on transition poll", () => {
    const src = createTouchSource();
    src.press("attack");
    expect(src.poll().a).toBe(true);
    expect(src.poll().a).toBe(false); // still held, no new edge
    src.release("attack");
    expect(src.poll().a).toBe(false);
  });

  test("directions: right minus left, opposing cancel", () => {
    const src = createTouchSource();
    src.press("right");
    expect(src.poll().dir).toEqual({ x: 1, z: 0 });
    src.press("left");
    expect(src.poll().dir).toEqual({ x: 0, z: 0 });
    src.release("right");
    src.release("left");
    expect(src.poll().dir).toEqual({ x: 0, z: 0 });
  });

  test("defend stays a held level across polls", () => {
    const src = createTouchSource();
    src.press("defend");
    expect(src.poll().dHeld).toBe(true);
    expect(src.poll().dHeld).toBe(true);
    src.release("defend");
    expect(src.poll().dHeld).toBe(false);
  });

  test("clear drops held buttons", () => {
    const src = createTouchSource();
    src.press("jump");
    src.clear();
    expect(src.poll()).toEqual({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } });
  });

  test("no touch points in this runner", () => {
    expect(hasTouch()).toBe(false);
  });
});
