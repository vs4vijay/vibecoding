import { describe, test, expect } from "bun:test";
import { createCamera } from "../../src/render/camera";

describe("whole-arena camera", () => {
  const cam = createCamera({ arenaW: 1600, arenaH: 480, viewW: 960, viewH: 540 });
  test("arena maps into view centered", () => {
    const a = cam.worldToScreen(0, 0, 60);
    const b = cam.worldToScreen(1600, 0, 60);
    expect(b.sx - a.sx).toBeCloseTo(1600 * cam.scale);
    expect(a.sx).toBeGreaterThanOrEqual(0);
  });
  test("depth equals z", () => {
    expect(cam.worldToScreen(100, 0, 10).depth).toBe(10);
    expect(cam.worldToScreen(100, 0, 110).depth).toBe(110);
  });
});
