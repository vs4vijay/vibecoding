// tests/touch-controls.test.ts — pure logic only: PointerActionMap and the
// node-safe capability gate. TouchControls itself touches DOM/matchMedia at
// construct and is covered by coarse-emulation browser walkthroughs, not here.
import { describe, expect, it } from "vitest";
import { PointerActionMap, isCoarsePointer } from "../src/render3d/ui/TouchControls";

describe("PointerActionMap", () => {
  it("single press holds, release reports and clears", () => {
    const m = new PointerActionMap();
    expect(m.held("left")).toBe(false);
    m.press(1, "left");
    expect(m.held("left")).toBe(true);
    expect(m.release(1)).toEqual(["left"]);
    expect(m.held("left")).toBe(false);
  });

  it("two pointers on different actions release independently", () => {
    const m = new PointerActionMap();
    m.press(1, "left");
    m.press(2, "right");
    expect(m.held("left")).toBe(true);
    expect(m.held("right")).toBe(true);
    expect(m.release(2)).toEqual(["right"]);
    expect(m.held("right")).toBe(false);
    expect(m.held("left")).toBe(true);
  });

  it("an action stays held until its LAST pointer lifts", () => {
    const m = new PointerActionMap();
    m.press(1, "left");
    m.press(2, "left");
    expect(m.release(1)).toEqual([]); // finger 2 still holds left
    expect(m.held("left")).toBe(true);
    expect(m.release(2)).toEqual(["left"]);
    expect(m.held("left")).toBe(false);
  });

  it("cancel releases the pointer's action", () => {
    const m = new PointerActionMap();
    m.press(3, "jump");
    expect(m.cancel(3)).toEqual(["jump"]);
    expect(m.held("jump")).toBe(false);
  });

  it("releaseAll returns every distinct held action and clears", () => {
    const m = new PointerActionMap();
    m.press(1, "left");
    m.press(2, "jump");
    m.press(3, "jetpack");
    m.press(4, "left"); // same action via a second pointer, reported once
    const released = m.releaseAll();
    expect(released).toHaveLength(3);
    expect(released).toContain("left");
    expect(released).toContain("jump");
    expect(released).toContain("jetpack");
    expect(m.held("left")).toBe(false);
    expect(m.held("jump")).toBe(false);
    expect(m.held("jetpack")).toBe(false);
  });

  it("release/cancel of an unknown id is a no-op returning []", () => {
    const m = new PointerActionMap();
    m.press(1, "left");
    expect(m.release(99)).toEqual([]);
    expect(m.cancel(99)).toEqual([]);
    expect(m.releaseAll()).toEqual(["left"]); // untouched by the unknown ids
  });

  it("held() reflects state per action", () => {
    const m = new PointerActionMap();
    m.press(1, "right");
    m.press(2, "jetpack");
    expect(m.held("right")).toBe(true);
    expect(m.held("jetpack")).toBe(true);
    expect(m.held("left")).toBe(false);
    expect(m.held("jump")).toBe(false);
  });

  it("re-pressing the same pointer id never duplicates (fire-style double tap)", () => {
    const m = new PointerActionMap();
    m.press(7, "fire");
    m.press(7, "fire");
    expect(m.release(7)).toEqual([]); // fire is tracked, never reported as held
    expect(m.releaseAll()).toEqual([]); // the id was tracked exactly once

    const held = new PointerActionMap();
    held.press(7, "jump");
    held.press(7, "jump");
    expect(held.release(7)).toEqual(["jump"]); // exactly one release report
    expect(held.releaseAll()).toEqual([]);
  });

  it("fire pointers are cleaned up by releaseAll but never block held actions", () => {
    const m = new PointerActionMap();
    m.press(1, "fire");
    m.press(2, "left");
    const released = m.releaseAll();
    expect(released).toEqual(["left"]);
  });

  it("releaseAll on an empty map returns []", () => {
    expect(new PointerActionMap().releaseAll()).toEqual([]);
  });
});

describe("isCoarsePointer", () => {
  it("is false without a window (node-safe import)", () => {
    expect(isCoarsePointer()).toBe(false);
  });
});
