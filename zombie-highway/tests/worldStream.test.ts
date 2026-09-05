import { describe, expect, it } from "vitest";
import { planSegmentRecycle } from "../src/render/world";

/** Applies moves to the segment array (same as World.update does inline). */
function apply(segs: { id: number; z: number }[], moves: { id: number; newZ: number }[]): void {
  for (const m of moves) segs[m.id].z = m.newZ;
}

describe("planSegmentRecycle", () => {
  it("keeps coverage window ahead of the car", () => {
    const segLen = 30, count = 6;
    let segs = Array.from({ length: count }, (_, i) => ({ id: i, z: -i * segLen }));
    const moves = planSegmentRecycle(segs, /*carZ*/ 200, segLen);
    // every recycled segment jumps to the front of the window
    for (const m of moves) segs[m.id].z = m.newZ;
    const zs = segs.map((s) => s.z);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(200 - 30);
    expect(Math.max(...zs)).toBeLessThanOrEqual(200 + 6 * 30);
  });

  it("never leaves a hole around the car (ground covers carZ-30 .. carZ+120 while driving)", () => {
    // Regression: recycling as soon as a segment's ANCHOR passed the car
    // stripped the road from under/behind the chase camera, leaving up to
    // ~30 m of bare sky. Coverage must hold continuously while driving.
    const segLen = 30, count = 6;
    const segs = Array.from({ length: count }, (_, i) => ({ id: i, z: -i * segLen }));
    for (let carZ = 0; carZ <= 600; carZ += 3) {
      apply(segs, planSegmentRecycle(segs, carZ, segLen));
      const zs = segs.map((s) => s.z);
      const backEdge = Math.min(...zs) - segLen / 2;
      const frontEdge = Math.max(...zs) + segLen / 2;
      expect(backEdge, `ground behind carZ=${carZ}`).toBeLessThanOrEqual(carZ - 30);
      expect(frontEdge, `ground ahead of carZ=${carZ}`).toBeGreaterThanOrEqual(carZ + 120);
    }
  });

  it("recovers ground coverage after a large forward teleport", () => {
    const segLen = 30, count = 6;
    const segs = Array.from({ length: count }, (_, i) => ({ id: i, z: -i * segLen }));
    apply(segs, planSegmentRecycle(segs, /*carZ*/ 0, segLen));
    apply(segs, planSegmentRecycle(segs, /*carZ*/ 1000, segLen));
    const zs = segs.map((s) => s.z);
    expect(Math.min(...zs) - segLen / 2).toBeLessThanOrEqual(1000 - 30);
    expect(Math.max(...zs) + segLen / 2).toBeGreaterThanOrEqual(1000 + count * segLen - 60);
  });

  it("slides the window back after a backward teleport (retry resets carZ to 0)", () => {
    // Regression: startRun() resets carZ to 0, but the segments stayed at the
    // previous run's distance — the respawned car drove on bare void with no
    // ground, road, or lamps anywhere near it.
    const segLen = 30, count = 6;
    const segs = Array.from({ length: count }, (_, i) => ({ id: i, z: 900 - i * segLen }));
    apply(segs, planSegmentRecycle(segs, /*carZ*/ 0, segLen));
    const zs = segs.map((s) => s.z);
    const backEdge = Math.min(...zs) - segLen / 2;
    const frontEdge = Math.max(...zs) + segLen / 2;
    expect(backEdge).toBeLessThanOrEqual(-30);
    expect(frontEdge).toBeGreaterThanOrEqual(count * segLen - 60);
    // spacing preserved
    const sorted = [...zs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBe(segLen);
  });
});
