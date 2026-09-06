// tests/smoke.test.ts
import { describe, expect, it } from "vitest";
import pkgJson from "../package.json";

describe("project scaffold", () => {
  it("package.json has zero runtime deps", () => {
    // Index-signature cast: JSON literal type only carries keys present in the file,
    // so a missing `dependencies` key must be read dynamically to typecheck.
    const pkg = pkgJson as unknown as Record<string, unknown>;
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
