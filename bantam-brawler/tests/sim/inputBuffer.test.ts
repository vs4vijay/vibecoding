import { describe, test, expect } from "bun:test";
import { createBuffer } from "../../src/sim/inputBuffer";
import type { InputFrame } from "../../src/sim/types";

const F = (over: Partial<InputFrame> = {}): InputFrame =>
  ({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 }, ...over });

describe("input buffer", () => {
  test("keeps latest held frame", () => {
    const b = createBuffer();
    b.push(F(), 0);
    b.push(F({ a: true }), 1);
    expect(b.held().a).toBe(true);
  });

  test("logs rising edges as tokens, ignores repeats", () => {
    const b = createBuffer();
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 3); // A, D(hold-start), >
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 4); // still held — no new edges
    b.push(F(), 5);                                              // releases
    const tokens = b.pressLog().map((p) => p.token);
    expect(tokens).toEqual(["A", ">", "D"]);                     // newest first
  });

  test("ring wraps at capacity", () => {
    const b = createBuffer(3);
    for (let t = 0; t < 10; t++) b.push(F({ a: t % 2 === 0 }), t);
    expect(b.held().a).toBe(false);                              // t=9 odd
  });

  test("same-tick chord keeps emission order in pressLog", () => {
    const b = createBuffer();
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 7); // chord: A, >, D
    expect(b.pressLog().map((p) => p.tick)).toEqual([7, 7, 7]);  // newest tick first = itself
    expect(b.pressLog().map((p) => p.token)).toEqual(["A", ">", "D"]);
  });

  test("later single press lands ahead of earlier chord", () => {
    const b = createBuffer();
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 7); // chord: A, >, D
    b.push(F(), 8);                                              // releases
    b.push(F({ a: true }), 9);                                   // later single A
    expect(b.pressLog().map((p) => p.token)).toEqual(["A", "A", ">", "D"]);
    expect(b.pressLog()[0]!.tick).toBe(9);
  });
});
