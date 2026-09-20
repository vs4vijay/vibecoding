import { describe, expect, it } from "vitest";
import { unlocksForLevel } from "../src/game/difficulty";
import { unlockSubtitle } from "../src/ui/hud";

describe("unlockSubtitle", () => {
  it("returns undefined when the level unlocks nothing (banner is level-only)", () => {
    expect(unlockSubtitle([])).toBeUndefined();
  });

  it("pluralizes a single type (level 2 → RUNNERS UNLOCKED)", () => {
    expect(unlockSubtitle(unlocksForLevel(2))).toBe("RUNNERS UNLOCKED");
  });

  it("pluralizes brutes (level 3 → BRUTES UNLOCKED)", () => {
    expect(unlockSubtitle(unlocksForLevel(3))).toBe("BRUTES UNLOCKED");
  });

  it("joins several types with +", () => {
    expect(unlockSubtitle(["runner", "brute"])).toBe(
      "RUNNERS + BRUTES UNLOCKED",
    );
  });
});
