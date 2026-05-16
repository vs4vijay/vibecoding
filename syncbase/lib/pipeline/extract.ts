import { JSONPath } from "jsonpath-plus";

export function extractRecords(response: unknown, path: string): unknown[] {
  const result = JSONPath({ path, json: response as object, wrap: true });
  if (!Array.isArray(result)) return [];
  if (result.length === 1) {
    const v = result[0];
    if (Array.isArray(v)) return v;
    // ASP.NET PageMethods convention: $.d is a JSON-encoded string whose body
    // contains the actual array. Auto-unwrap when the matched value is a JSON
    // string that parses to an array.
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // not nested JSON — fall through
      }
    }
  }
  return result;
}

export function extractScalar(record: unknown, path: string): string | null {
  const result = JSONPath({ path, json: record as object, wrap: true });
  if (!Array.isArray(result) || result.length === 0) return null;
  const v = result[0];
  if (v == null) return null;
  return String(v);
}
