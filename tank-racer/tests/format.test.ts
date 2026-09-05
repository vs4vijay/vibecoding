import { describe, expect, it } from "bun:test";
import { formatRaceTime } from "../src/format";

// The single shared formatter used by hud.ts / game.ts / screens.ts.
// Spec format: m:ss.t with zero-padded two-digit minutes+seconds.

describe("formatRaceTime", () => {
  it("formats zero", () => {
    expect(formatRaceTime(0)).toBe("00:00.0");
  });

  it("formats sub-second times", () => {
    expect(formatRaceTime(0.1)).toBe("00:00.1");
    expect(formatRaceTime(5.04)).toBe("00:05.0");
    expect(formatRaceTime(9.95)).toBe("00:09.9");
  });

  it("formats seconds under a minute", () => {
    expect(formatRaceTime(42)).toBe("00:42.0");
    expect(formatRaceTime(59.99)).toBe("00:59.9");
  });

  it("formats minutes (>= 60s)", () => {
    expect(formatRaceTime(60)).toBe("01:00.0");
    expect(formatRaceTime(61.2)).toBe("01:01.2");
    expect(formatRaceTime(83.42)).toBe("01:23.4"); // doc example
    expect(formatRaceTime(599.99)).toBe("09:59.9");
  });

  it("rolls minutes past 59 rather than switching to hours", () => {
    expect(formatRaceTime(3600)).toBe("60:00.0");
    expect(formatRaceTime(3600.5)).toBe("60:00.5");
    expect(formatRaceTime(3661.45)).toBe("61:01.4");
  });

  it("truncates (never rounds up) the tenths digit", () => {
    // 1.9999s must render 00:01.9, not 00:02.0 — display truncation.
    expect(formatRaceTime(1.9999)).toBe("00:01.9");
  });
});
