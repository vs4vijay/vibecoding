import { describe, expect, it } from "bun:test";
import {
  buildClosestTable,
  closestOnSpline,
  getPoint,
  getTangent,
  type Vec2,
} from "../src/spline";

// Closed uniform Catmull-Rom loop. Unit square keeps every expected value
// hand-derivable; a 12-gon approximates a circle for closest-point queries.

const EPS = 1e-9;

/** Unit-square loop (side 100). Segment i runs points[i] -> points[i+1]. */
const square: Vec2[] = [
  { x: 0, z: 0 },
  { x: 100, z: 0 },
  { x: 100, z: 100 },
  { x: 0, z: 100 },
];

/** Regular 12-gon on a radius-100 circle. */
const dodecagon: Vec2[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { x: Math.cos(a) * 100, z: Math.sin(a) * 100 };
});

describe("getPoint — loop closure", () => {
  it("wraps any t into 0..1: p(t) === p(t + k)", () => {
    const base = getPoint(square, 0.1);
    for (const t of [1.1, -0.9, 2.1, 101.1]) {
      const p = getPoint(square, t);
      expect(Math.abs(p.x - base.x)).toBeLessThan(EPS);
      expect(Math.abs(p.z - base.z)).toBeLessThan(EPS);
    }
  });

  it("is continuous across the seam p(1-e) ≈ p(0)", () => {
    // Gap is O(parametric speed × e); with speed ≈ 200 units/t on the square,
    // e = 1e-6 leaves a ~2e-4 gap — bounded, and it shrinks as e shrinks.
    const gap = (e: number) =>
      Math.hypot(
        getPoint(square, 1 - e).x - getPoint(square, 0).x,
        getPoint(square, 1 - e).z - getPoint(square, 0).z,
      );
    expect(gap(1e-6)).toBeLessThan(1e-3);
    expect(gap(1e-7)).toBeLessThan(gap(1e-6));
  });
});

describe("getPoint — known points", () => {
  it("interpolates exactly through every control point at t = i/n", () => {
    square.forEach((cp, i) => {
      const p = getPoint(square, i / square.length);
      expect(Math.abs(p.x - cp.x)).toBeLessThan(EPS);
      expect(Math.abs(p.z - cp.z)).toBeLessThan(EPS);
    });
  });

  it("hits the hand-derived midpoint of the first square segment", () => {
    // Uniform CR basis at u=0.5: a=c=0.5, b=0.125, d=-0.125. With neighbors
    // p0=(0,100) and p3=(100,100) the corner tangents pull the curve to
    // (50, -12.5) — outward past the straight edge, as CR overshoot predicts.
    const p = getPoint(square, 0.125);
    expect(p.x).toBeCloseTo(50, 9);
    expect(p.z).toBeCloseTo(-12.5, 9);
  });
});

describe("getTangent", () => {
  it("points along travel (+x) at the midpoint of the bottom edge", () => {
    const tan = getTangent(square, 0.125);
    expect(tan.x).toBeGreaterThan(0);
    expect(Math.abs(tan.z)).toBeLessThan(1e-9); // exactly axial by symmetry
  });

  it("follows the corner tangent (p_next - p_prev) / 2 at t = 0", () => {
    // At t=0: prev=(0,100), next=(100,0) → derivative direction (1,-1).
    const tan = getTangent(square, 0);
    const along = tan.x - tan.z; // dot with (1,-1)
    const across = tan.x + tan.z; // dot with (1,1)
    expect(along).toBeGreaterThan(0);
    expect(Math.abs(across)).toBeLessThan(1e-9);
  });
});

describe("closestOnSpline", () => {
  const table = buildClosestTable(square, 400);

  it("builds a dense parameter table", () => {
    expect(table.points.length).toBe(400);
    expect(table.ts.length).toBe(400);
    expect(table.ts[0]).toBe(0);
    expect(table.ts[399]).toBeCloseTo(399 / 400, 12);
  });

  it("finds each control point at its own parameter with ~zero distance", () => {
    square.forEach((cp, i) => {
      const hit = closestOnSpline(table, cp.x, cp.z);
      expect(hit.t).toBeCloseTo(i / square.length, 2); // 400 samples → 1/400 grid
      expect(hit.distSq).toBeLessThan(1e-6);
    });
  });

  it("snaps near-curve queries to the nearest sample", () => {
    // Point just off the middle of the bottom edge (t≈0.125).
    const hit = closestOnSpline(table, 50, -13);
    expect(hit.t).toBeGreaterThan(0.1);
    expect(hit.t).toBeLessThan(0.15);
    expect(hit.distSq).toBeLessThan(4); // within 2 units of the curve
  });

  it("returns monotonically increasing t for queries walked around a loop", () => {
    const circleTable = buildClosestTable(dodecagon, 800);
    let prev = -1;
    let maxErr = 0;
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const q = closestOnSpline(
        circleTable,
        Math.cos(angle) * 100,
        Math.sin(angle) * 100,
      );
      expect(q.t).toBeGreaterThanOrEqual(prev - 1e-9); // no backwards jumps
      maxErr = Math.max(maxErr, Math.abs(q.t - angle / (Math.PI * 2)));
      prev = q.t;
    }
    // Parameter tracks the walked angle closely on the 12-gon.
    expect(maxErr).toBeLessThan(0.01);
  });
});
