import { afterEach, describe, expect, it } from "vitest";
import { load, save } from "../src/core/storage";

afterEach(() => localStorage.clear());

describe("storage", () => {
  it("round-trips values under zh. namespace", () => {
    save("bestScore", 1234);
    expect(localStorage.getItem("zh.bestScore")).toBe("1234");
    expect(load("bestScore", 0)).toBe(1234);
  });
  it("returns fallback for missing/corrupt", () => {
    localStorage.setItem("zh.junk", "{not json");
    expect(load("missing", 7)).toBe(7);
    expect(load("junk", 7)).toBe(7);
  });
});
