import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { formatPopupText, nextPopupSlot } from "../src/ui/popups";

describe("nextPopupSlot", () => {
  it("walks the pool in order on the first pass", () => {
    const count = CONFIG.hud.popupCount;
    let cursor = 0;
    const seen: number[] = [];
    for (let i = 0; i < count; i++) {
      seen.push(nextPopupSlot(cursor++, count));
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("recycles the OLDEST slot first once the burst exceeds the cap", () => {
    const count = CONFIG.hud.popupCount;
    let cursor = 0;
    for (let i = 0; i < count; i++) cursor++; // first pass fills 0..5
    const recycled: number[] = [];
    for (let i = 0; i < count; i++) {
      recycled.push(nextPopupSlot(cursor++, count));
    }
    expect(recycled).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("stays in [0, count) for a long burst", () => {
    const count = CONFIG.hud.popupCount;
    for (let cursor = 0; cursor < 1000; cursor++) {
      const slot = nextPopupSlot(cursor, count);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(count);
    }
  });

  it("pins the single slot of a 1-length pool", () => {
    for (let cursor = 0; cursor < 5; cursor++) {
      expect(nextPopupSlot(cursor, 1)).toBe(0);
    }
  });
});

describe("formatPopupText", () => {
  it("shows bare points at streak multiplier ×1", () => {
    expect(formatPopupText(25, 1)).toBe("25");
  });

  it("appends ×N when the streak multiplier is ≥2", () => {
    expect(formatPopupText(50, 2)).toBe("50 ×2");
    expect(formatPopupText(75, 3)).toBe("75 ×3");
    expect(formatPopupText(100, 4)).toBe("100 ×4");
  });

  it("scrape-doubled points at ×1 streak show no suffix", () => {
    // runner (50) × scrape ×2 = 100 points, but the streak multiplier is
    // what the suffix tracks — a scrape without a streak stays bare.
    expect(formatPopupText(100, 1)).toBe("100");
  });

  it("floors fractional points", () => {
    expect(formatPopupText(12.9, 1)).toBe("12");
  });
});
