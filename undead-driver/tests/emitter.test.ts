import { describe, expect, it } from "vitest";
import { Emitter } from "../src/core/emitter";

describe("Emitter", () => {
  it("invokes handlers with args", () => {
    const em = new Emitter<{ hit: [side: string, dmg: number] }>();
    let got = "";
    em.on("hit", (side, dmg) => (got = `${side}:${dmg}`));
    em.emit("hit", "left", 2);
    expect(got).toBe("left:2");
  });
  it("unsubscribes via returned off fn", () => {
    const em = new Emitter<{ x: [] }>();
    let n = 0;
    const off = em.on("x", () => n++);
    em.emit("x");
    off();
    em.emit("x");
    expect(n).toBe(1);
  });
});
