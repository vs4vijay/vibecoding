import { describe, test, expect } from "bun:test";
import { createBuffer } from "../../src/sim/inputBuffer";
import { compilePattern, matchSpecial } from "../../src/sim/specials";
import type { InputFrame } from "../../src/sim/types";

const F = (over: Partial<InputFrame> = {}): InputFrame =>
  ({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 }, ...over });
const PATTERNS = { energyBlast: "D>A", megaBlast: "DD>A", skyJump: "D^J" };

describe("special matcher", () => {
  test("compiles token strings", () => {
    expect(compilePattern("D>A")).toEqual(["D", ">", "A"]);
    expect(compilePattern("D^J")).toEqual(["D", "^", "J"]);
  });

  test("matches D>A inside window", () => {
    const b = createBuffer();
    b.push(F({ dHeld: true }), 10);
    b.push(F({ dHeld: true, dir: { x: 1, z: 0 } }), 12);
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 14);
    expect(matchSpecial(b.pressLog(), 14, 30, PATTERNS)).toBe("energyBlast");
  });

  test("rejects stale sequences outside window", () => {
    const b = createBuffer();
    b.push(F({ dHeld: true }), 0);
    b.push(F({ dHeld: true, dir: { x: 1, z: 0 } }), 2);
    b.push(F({ a: true }), 100);                                 // gap >> 30
    expect(matchSpecial(b.pressLog(), 100, 30, PATTERNS)).toBeNull();
  });

  test("prefers longest/newest match (DD>A over D>A)", () => {
    const b = createBuffer();
    b.push(F({ dHeld: true }), 10);
    b.push(F(), 11);
    b.push(F({ dHeld: true }), 12);                              // second D
    b.push(F({ dHeld: true, dir: { x: 1, z: 0 } }), 14);
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 16);
    expect(matchSpecial(b.pressLog(), 16, 30, PATTERNS)).toBe("megaBlast");
  });

  test("one-tick chord [A,>,D] does not match D>A", () => {
    const b = createBuffer();
    b.push(F({ dHeld: true, dir: { x: 1, z: 0 }, a: true }), 10); // logs [A, >, D]
    expect(matchSpecial(b.pressLog(), 10, 30, PATTERNS)).toBeNull();
  });

  test("same tokens spread across three ticks match D>A", () => {
    const b = createBuffer();
    b.push(F({ dHeld: true }), 10);                                // D
    b.push(F({ dHeld: true, dir: { x: 1, z: 0 } }), 11);           // >
    b.push(F({ a: true, dHeld: true, dir: { x: 1, z: 0 } }), 12);  // A
    expect(matchSpecial(b.pressLog(), 12, 30, PATTERNS)).toBe("energyBlast");
  });
});
