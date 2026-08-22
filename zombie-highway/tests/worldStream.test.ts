import { describe, expect, it } from "vitest";
import { planSegmentRecycle } from "../src/render/world";

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
});
