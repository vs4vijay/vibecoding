import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractRecords, extractScalar } from "../lib/pipeline/extract";
import { canonicalHash } from "../lib/pipeline/hash";

describe("RERA response shape", () => {
  test("records_path=$.Data yields all records", async () => {
    const raw = JSON.parse(
      await readFile(join(import.meta.dir, "fixtures/rera-page-1.json"), "utf8")
    );
    const records = extractRecords(raw, "$.Data");
    expect(records.length).toBe(3);
    expect(records[0]).toHaveProperty("RegNo");
  });

  test("external_id_path=$.RegNo extracts the registration number", async () => {
    const raw = JSON.parse(
      await readFile(join(import.meta.dir, "fixtures/rera-page-1.json"), "utf8")
    );
    const records = extractRecords(raw, "$.Data");
    const ids = records.map((r) => extractScalar(r, "$.RegNo"));
    expect(ids).toEqual([
      "RAJ/P/2024/0001",
      "RAJ/P/2024/0002",
      "RAJ/P/2024/0003",
    ]);
    expect(ids.every((x) => x !== null)).toBe(true);
  });

  test("canonicalHash is deterministic and key-order independent", () => {
    const a = { x: 1, y: 2, z: { a: 1, b: 2 } };
    const b = { z: { b: 2, a: 1 }, y: 2, x: 1 };
    expect(canonicalHash(a, null)).toBe(canonicalHash(b, null));
  });

  test("hash_fields subset changes what counts as different", () => {
    const v1 = { a: 1, b: 2, c: 3 };
    const v2 = { a: 1, b: 2, c: 999 };
    expect(canonicalHash(v1, null)).not.toBe(canonicalHash(v2, null));
    expect(canonicalHash(v1, ["a", "b"])).toBe(canonicalHash(v2, ["a", "b"]));
  });
});
