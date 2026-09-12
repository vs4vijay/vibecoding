import { describe, test, expect } from "bun:test";
import { frameIndex } from "../../src/render/atlas";

describe("atlas index", () => {
  const idx = frameIndex([
    { name: "br_p1_windup", x: 0, y: 0, w: 32, h: 32 },
    { name: "br_p1_active", x: 32, y: 0, w: 32, h: 32 },
  ]);
  test("finds by sprite key", () => expect(idx("br_p1_active")).toEqual({ name: "br_p1_active", x: 32, y: 0, w: 32, h: 32 }));
  test("throws on missing key", () => expect(() => idx("nope")).toThrow(/missing frame/i));
});
