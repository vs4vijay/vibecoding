// tests/events.test.ts
import { describe, expect, it } from "vitest";
import { on, emit, clearAll } from "../src/core/Events";

describe("Events", () => {
  it("dispatches typed events to subscribers", () => {
    clearAll();
    const got: string[] = [];
    on("dave:collect", e => got.push(`collect:${e.item}:${e.value}`));
    on("level:complete", e => got.push(`complete:${e.level}:${e.score}`));
    emit({ type: "dave:collect", item: "trophy", value: 1000 });
    emit({ type: "level:complete", level: 1, score: 2000 });
    expect(got).toEqual(["collect:trophy:1000", "complete:1:2000"]);
  });
  it("unsubscribe stops delivery", () => {
    clearAll();
    let n = 0;
    const off = on("enemy:die", () => { n++; });
    emit({ type: "enemy:die" });
    off();
    emit({ type: "enemy:die" });
    expect(n).toBe(1);
  });
});
