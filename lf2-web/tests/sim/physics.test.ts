import { describe, test, expect } from "bun:test";
import { integrateFighter, integrateProjectile } from "../../src/sim/physics";
import { makeFighter } from "../fixtures/helpers";

describe("fighter physics", () => {
  test("gravity accelerates fall until ground clamp", () => {
    const f = makeFighter({ y: -10, vy: 0 });
    integrateFighter(f, 0); expect(f.vy).toBe(0.35); expect(f.y).toBeCloseTo(-9.65);
    integrateFighter(f, 1); integrateFighter(f, 2);
    for (let t = 3; t < 200; t++) integrateFighter(f, t);
    expect(f.y).toBe(0); expect(f.vy).toBe(0);
  });

  test("ground friction decays vx multiplicatively", () => {
    const f = makeFighter({ vx: 5 });
    integrateFighter(f, 0);
    expect(f.vx).toBeCloseTo(4.0);          // 5 * 0.80
  });

  test("air drag (not ground friction) while airborne", () => {
    const f = makeFighter({ vx: 5, y: -20 });
    integrateFighter(f, 0);
    expect(f.vx).toBeCloseTo(4.8);          // 5 * 0.96
  });

  test("wall bounce reflects with restitution", () => {
    const f = makeFighter({ x: 1598, vx: 6 });   // arena right = 1600
    integrateFighter(f, 0);
    expect(f.x).toBeLessThan(1600);
    expect(f.vx).toBeLessThan(0);                // bounced
  });

  test("z clamps into depth band without bounce", () => {
    const f = makeFighter({ z: 118, vz: 4 });
    integrateFighter(f, 0);
    expect(f.z).toBeLessThanOrEqual(120);
    expect(f.vz).toBe(0);                        // z is positional band, not bouncy
  });

  test("extreme overshoot folds back inside the arena", () => {
    const f = makeFighter({ x: 1598, vx: 4000 });
    integrateFighter(f, 0);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.x).toBeLessThanOrEqual(1600);
    expect(f.vx).toBeLessThan(0);                // sign flipped inward
  });
});
