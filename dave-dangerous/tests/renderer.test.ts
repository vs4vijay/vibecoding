// tests/renderer.test.ts
import { describe, expect, it } from "vitest";
import { scaleToFit } from "../src/render/Renderer";

describe("Renderer helpers", () => {
  it("scaleToFit picks largest integer scale ≤ viewport", () => {
    expect(scaleToFit(960, 600)).toBe(3);
    expect(scaleToFit(320, 200)).toBe(1);
    expect(scaleToFit(2000, 1200)).toBe(6); // floor(2000/320)=6, floor(1200/200)=6
    expect(scaleToFit(100, 100)).toBe(1);
  });
});
