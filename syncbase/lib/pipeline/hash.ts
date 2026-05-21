import { createHash } from "node:crypto";

// Canonical JSON: sorted keys, no whitespace. Deterministic across runs.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

/** Walk a dot-path inside a value. `"title.rendered"` returns
 *  `value.title.rendered`. Missing intermediate keys return undefined; numeric
 *  segments index into arrays. Flat keys (no dot) behave exactly like the prior
 *  implementation. */
function readPath(value: unknown, path: string): unknown {
  if (!path.includes(".")) return (value as any)?.[path];
  let cur: any = value;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function canonicalHash(
  record: unknown,
  fields: string[] | null | undefined
): string {
  let target: unknown = record;
  if (fields && fields.length > 0 && record && typeof record === "object") {
    const subset: Record<string, unknown> = {};
    for (const f of fields) subset[f] = readPath(record, f);
    target = subset;
  }
  return createHash("sha256").update(canonicalize(target)).digest("hex");
}
