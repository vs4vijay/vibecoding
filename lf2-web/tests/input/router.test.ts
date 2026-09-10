import { describe, test, expect } from "bun:test";
import { createRouter, type RoutedSource } from "../../src/input/router";
import { MAX_FIGHTERS } from "../../src/sim/constants";
import type { InputFrame } from "../../src/sim/types";
import { neutralFrame } from "../../src/input/keyboard";

function stubSource(frame: Partial<InputFrame>, log: number[]): { poll(): InputFrame } {
  return {
    poll() {
      log.push(1);
      return { ...neutralFrame(), ...frame };
    },
  };
}

describe("input router", () => {
  test("always emits exactly MAX_FIGHTERS frames", () => {
    expect(createRouter([]).poll()).toHaveLength(MAX_FIGHTERS);
  });

  test("empty slots and bot slots come back NEUTRAL", () => {
    const frames = createRouter([]).poll();
    for (const f of frames) expect(f).toEqual({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } });

    const frames2 = createRouter([{ slot: 1, source: "bot" }, { slot: 5, source: "bot" }]).poll();
    expect(frames2).toHaveLength(MAX_FIGHTERS);
    for (const f of frames2) expect(f.dHeld).toBe(false);
  });

  test("human frames land at their slot; every source polled once per poll()", () => {
    const p1Log: number[] = [], p3Log: number[] = [];
    const sources: RoutedSource[] = [
      { slot: 0, source: stubSource({ a: true, dir: { x: 1, z: 0 } }, p1Log) },
      { slot: 2, source: stubSource({ j: true, dHeld: true }, p3Log) },
      { slot: 7, source: "bot" },
    ];
    const frames = createRouter(sources).poll();

    expect(frames[0]).toEqual({ a: true, j: false, dHeld: false, dir: { x: 1, z: 0 } });
    expect(frames[2]).toEqual({ a: false, j: true, dHeld: true, dir: { x: 0, z: 0 } });
    expect(frames[1]).toEqual(neutralFrame());
    expect(frames[MAX_FIGHTERS - 1]).toEqual(neutralFrame());
    expect(p1Log).toHaveLength(1);
    expect(p3Log).toHaveLength(1);

    createRouter(sources).poll();
    expect(p1Log).toHaveLength(2);
  });
});
