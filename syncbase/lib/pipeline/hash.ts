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

export function canonicalHash(
  record: unknown,
  fields: string[] | null | undefined
): string {
  let target: unknown = record;
  if (fields && fields.length > 0 && record && typeof record === "object") {
    const src = record as Record<string, unknown>;
    const subset: Record<string, unknown> = {};
    for (const f of fields) subset[f] = src[f];
    target = subset;
  }
  return createHash("sha256").update(canonicalize(target)).digest("hex");
}
