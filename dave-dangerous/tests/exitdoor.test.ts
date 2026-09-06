// tests/exitdoor.test.ts
import { describe, expect, it } from "vitest";
import { ExitDoor } from "../src/entities/ExitDoor";
import { Dave } from "../src/entities/Dave";
import { GameState } from "../src/state/GameState";
import { on, clearAll } from "../src/core/Events";
import { LEVEL_1 } from "../src/levels/levels";

describe("ExitDoor", () => {
  it("does not trigger when closed", () => {
    clearAll();
    let completed = 0;
    on("level:complete", () => { completed++; });
    const door = new ExitDoor({ x: 18, y: 11 });
    const d = new Dave(18 * 16, 11 * 16);
    const st = new GameState();
    door.update(d, st, LEVEL_1);
    expect(completed).toBe(0);
  });
  it("triggers level complete when opened and overlapping", () => {
    clearAll();
    let ev: { level: number; score: number } | null = null;
    on("level:complete", e => { ev = { level: e.level, score: e.score }; });
    const door = new ExitDoor({ x: 18, y: 11 });
    door.opened = true;
    const d = new Dave(18 * 16, 11 * 16);
    const st = new GameState();
    st.addScore(1000);
    door.update(d, st, LEVEL_1);
    expect(ev).toEqual({ level: 1, score: 3000 }); // +2000 exit bonus
    expect(door.opened).toBe(true);
  });
});
