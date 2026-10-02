// tests/ui-helpers.test.ts — pure helpers exported from src/render3d/ui/UI.ts
// (module scope there is DOM-free, so the import is node-safe).
import { describe, expect, it } from "vitest";
import { fuelWarningEdge, shouldConfirmNewGame } from "../src/render3d/ui/UI";

describe("fuelWarningEdge", () => {
  it("false→false returns null", () => {
    expect(fuelWarningEdge(false, false)).toBeNull();
  });

  it("false→true returns warn (rising edge fires the toast)", () => {
    expect(fuelWarningEdge(false, true)).toBe("warn");
  });

  it("true→true returns null", () => {
    expect(fuelWarningEdge(true, true)).toBeNull();
  });

  it("true→false returns null (refuel re-arms silently)", () => {
    expect(fuelWarningEdge(true, false)).toBeNull();
  });
});

describe("shouldConfirmNewGame", () => {
  it("asks for confirmation only when a saved run exists", () => {
    expect(shouldConfirmNewGame(false)).toBe(false);
    expect(shouldConfirmNewGame(true)).toBe(true);
  });
});
