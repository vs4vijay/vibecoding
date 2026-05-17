import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sql } from "drizzle-orm";
import { sources } from "../lib/db/schema";
import {
  normalize,
  computeDedupKey,
  detectDuplicatesForSource,
} from "../lib/pipeline/dedup";

beforeAll(async () => { await freshTestDb(); });
afterAll(async () => { await cleanupTestDb(); });

describe("D1 — normalize helpers", () => {
  test("address: lowercase + strip punctuation + expand abbrev", () => {
    expect(normalize("Plot No. 14, 3rd Cross Rd.", "address")).toBe("plot number 14 3rd cross road");
  });
  test("round_1000 buckets numeric strings", () => {
    expect(normalize("1,000,499", "round_1000")).toBe("1000000");
    expect(normalize("1000500", "round_1000")).toBe("1001000");
  });
  test("date_week buckets ISO week", () => {
    // 2026-05-18 (Mon) and 2026-05-21 (Thu) — same ISO week.
    expect(normalize("2026-05-18", "date_week")).toBe(normalize("2026-05-21", "date_week"));
    // 2026-05-15 (Fri) and 2026-05-18 (Mon) cross a week boundary.
    expect(normalize("2026-05-15", "date_week")).not.toBe(normalize("2026-05-18", "date_week"));
  });
  test("pincode extracts 6-digit code", () => {
    expect(normalize("Bengaluru 560001 India", "pincode")).toBe("560001");
  });
  test("bank normalizes SBI variants", () => {
    expect(normalize("State Bank of India Ltd.", "bank")).toBe("state of india");
    expect(normalize("SBI", "bank")).toBe("state of india");
  });
});

describe("D1 — computeDedupKey", () => {
  test("two records that normalize identically share a hash", () => {
    // round_1000 buckets to nearest ₹1k; 1000100 and 1000400 both round to 1000000.
    // Dates are within the same ISO week (Mon-Thu).
    const a = { address: "Plot 14, 3rd Cross Road", price: "1000100", date: "2026-05-18" };
    const b = { address: "PLOT 14, 3rd-cross rd.",  price: "1000400", date: "2026-05-21" };
    const k1 = computeDedupKey(a, [
      { path: "$.address", normalize: "address" },
      { path: "$.price",   normalize: "round_1000" },
      { path: "$.date",    normalize: "date_week" },
    ]);
    const k2 = computeDedupKey(b, [
      { path: "$.address", normalize: "address" },
      { path: "$.price",   normalize: "round_1000" },
      { path: "$.date",    normalize: "date_week" },
    ]);
    expect(k1.hash).toBe(k2.hash);
  });
  test("different addresses give different hashes", () => {
    const a = computeDedupKey({ address: "Plot 14" }, [{ path: "$.address", normalize: "address" }]);
    const b = computeDedupKey({ address: "Plot 99" }, [{ path: "$.address", normalize: "address" }]);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("D1 — detectDuplicatesForSource", () => {
  test("AC-D1.1: two near-duplicates inside one source get flagged", async () => {
    const db = getDb();
    await db.insert(sources).values({
      name: "dedup_src",
      http: { url: "https://x.invalid/" },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
      dedup: {
        key_fields: [
          { path: "$.address", normalize: "address" },
          { path: "$.reservePrice", normalize: "round_10000" },
        ],
        similarity_threshold: 0.7,
        compare_fields: ["$.title", "$.address"],
      },
    });
    await db.execute(sql`
      INSERT INTO entities (source, external_id, payload, content_hash) VALUES
        ('dedup_src', 'a', '{"title":"Residential plot in Civil Lines, Ajmer","address":"Plot 14, Civil Lines, Ajmer","reservePrice":"1000499"}'::jsonb, 'h1'),
        ('dedup_src', 'b', '{"title":"Residential plot in Civil Lines, Ajmer","address":"PLOT 14 CIVIL LINES AJMER","reservePrice":"1000600"}'::jsonb, 'h2'),
        ('dedup_src', 'c', '{"title":"Unrelated Pune unit","address":"3rd Cross Pune","reservePrice":"700000"}'::jsonb, 'h3')
    `);
    const summary = await detectDuplicatesForSource("dedup_src");
    expect(summary.scanned).toBe(3);
    expect(summary.pairs_flagged).toBe(1);
    const dupRows: any = await db.execute(sql`SELECT canonical_id, duplicate_id, similarity FROM entity_duplicates WHERE source='dedup_src'`);
    const rows = dupRows.rows ?? dupRows;
    expect(rows.length).toBe(1);
    // canonical is the lower-numbered (oldest) id
    expect(Number(rows[0].canonical_id)).toBeLessThan(Number(rows[0].duplicate_id));
    expect(Number(rows[0].similarity)).toBeGreaterThanOrEqual(0.7);
  });

  test("AC-D1.2: re-running is idempotent", async () => {
    const db = getDb();
    const before: any = await db.execute(sql`SELECT count(*)::int AS n FROM entity_duplicates`);
    const nBefore = Number((before.rows ?? before)[0].n);
    await detectDuplicatesForSource("dedup_src");
    const after: any = await db.execute(sql`SELECT count(*)::int AS n FROM entity_duplicates`);
    const nAfter = Number((after.rows ?? after)[0].n);
    expect(nAfter).toBe(nBefore);
  });

  test("AC-D1.3: an operator 'different' override hides the pair", async () => {
    const db = getDb();
    // Get the existing pair, then mark as different.
    const r: any = await db.execute(sql`SELECT canonical_id, duplicate_id FROM entity_duplicates WHERE source='dedup_src' LIMIT 1`);
    const row = (r.rows ?? r)[0];
    await db.execute(sql`DELETE FROM entity_duplicates WHERE source='dedup_src'`);
    await db.execute(sql`
      INSERT INTO entity_duplicate_overrides (source, entity_a_id, entity_b_id, decision, decided_by)
      VALUES ('dedup_src', ${Number(row.canonical_id)}, ${Number(row.duplicate_id)}, 'different', 'test')
    `);
    const summary = await detectDuplicatesForSource("dedup_src");
    expect(summary.pairs_flagged).toBe(0);
  });
});
