// Pins the persisted coach gate that main.ts re-reads on EVERY PLAY/RETRY
// attempt: once a completion is saved via markCoachSeen(), coachPending()
// must read false forever, so the coach never re-shows within any later
// run or page session. (Hide-on-game-over is DOM wiring in main.ts and
// lives outside unit-testable code.)
import { afterEach, describe, expect, it } from "vitest";
import { coachPending, markCoachSeen } from "../src/ui/menus";

afterEach(() => localStorage.clear());

describe("coach gate (zh.coachSeen)", () => {
  it("is pending on a fresh profile", () => {
    expect(coachPending()).toBe(true);
  });

  it("never pends again once completion is persisted", () => {
    markCoachSeen();
    expect(coachPending()).toBe(false);
    // Idempotent: a same-step completion landing at game over may re-save.
    markCoachSeen();
    expect(coachPending()).toBe(false);
  });
});
