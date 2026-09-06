// tests/smoke.test.ts
import { describe, expect, it } from "vitest";

describe("project scaffold", () => {
  it("package.json has zero runtime deps", async () => {
    const pkg = await import("../package.json");
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
