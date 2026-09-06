// tests/camera.test.ts
import { describe, expect, it } from "vitest";
import { Camera } from "../src/world/Camera";

describe("Camera", () => {
  it("offsets by screen width", () => {
    const c = new Camera(0);
    expect(c.offsetX).toBe(0);
    c.warpTo(2);
    expect(c.offsetX).toBe(2 * 320);
  });
});
