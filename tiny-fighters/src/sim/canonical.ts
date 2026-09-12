// src/sim/canonical.ts — canonical JSON form for state hashing: Sets become
// sorted arrays, buffer-like objects serialize via .serialize(), object keys
// are sorted at every depth. Shared by the HEADLESS runner and the golden
// test so both hash byte-identically.
export function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value].sort();
  if (value !== null && typeof value === "object" && typeof (value as { serialize?: unknown }).serialize === "function") {
    return canonicalReplacer(_key, (value as { serialize(): unknown }).serialize());
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
      // Plain ASCII comparator: localeCompare is environment-dependent, and
      // the determinism pin must hold on every host. Keys here are ASCII, so
      // output is byte-identical to the previous ordering.
        .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)),
    );
  }
  return value;
}
