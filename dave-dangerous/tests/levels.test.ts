// tests/levels.test.ts
import { describe, expect, it } from "vitest";
import { validateLevel } from "../src/levels/data";
import { LEVEL_1, BONUS_1 } from "../src/levels/levels";

describe("level data", () => {
  it("level 1 validates and has dave + trophy + exit", () => {
    const l = validateLevel(LEVEL_1);
    expect(l.screens).toHaveLength(1);
    const e = l.screens[0]!.entities;
    expect(e.some(x => x.type === "dave")).toBe(true);
    expect(e.some(x => x.type === "trophy")).toBe(true);
    expect(e.some(x => x.type === "exitDoor")).toBe(true);
  });
  it("dims match 20×13", () => {
    const l = validateLevel(LEVEL_1);
    const s = l.screens[0]!;
    expect(s.width).toBe(20);
    expect(s.height).toBe(13);
    expect(s.tiles).toHaveLength(20 * 13);
  });
  it("bonus room validates and has trophy + door", () => {
    const b = validateLevel(BONUS_1);
    const e = b.screens[0]!.entities;
    expect(e.some(x => x.type === "trophy")).toBe(true);
    expect(e.some(x => x.type === "exitDoor")).toBe(true);
  });
  it("malformed level throws", () => {
    expect(() => validateLevel({ id: 9, name: "bad", startScreen: 0, screens: [] } as never)).toThrow();
  });
});
