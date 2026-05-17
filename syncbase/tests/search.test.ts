import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sql } from "drizzle-orm";
import { searchEntities } from "../lib/search";
import { sources } from "../lib/db/schema";

beforeAll(async () => {
  await freshTestDb();
  const db = getDb();
  // Seed two sources from different categories, both into shared entities.
  await db.insert(sources).values([
    {
      name: "src_banks",
      http: { url: "https://x.invalid/" },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
      category: "bank-auction",
    },
    {
      name: "src_govt",
      http: { url: "https://x.invalid/" },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
      category: "govt-eauction",
    },
  ]);
  // Insert entities via raw SQL so we don't go through the pipeline.
  await db.execute(sql`
    INSERT INTO entities (source, external_id, payload, content_hash) VALUES
      ('src_banks', 'b1', '{"title":"Residential plot in Ajmer, Rajasthan","city":"Ajmer","state":"RJ","bank":"SBI","address":"Plot 14, Civil Lines, Ajmer"}'::jsonb, 'h1'),
      ('src_banks', 'b2', '{"title":"Commercial unit in Bengaluru, Karnataka","city":"Bengaluru","state":"KA","bank":"HDFC","address":"3rd Cross, Indiranagar"}'::jsonb, 'h2'),
      ('src_banks', 'b3', '{"title":"Vacant land Pune","city":"Pune","state":"MH","bank":"SBI","address":"Hadapsar Industrial Estate"}'::jsonb, 'h3'),
      ('src_govt',  'g1', '{"title":"Timber Auction at Bhamragarh Depot","refNo":"2026_MH_34290","state":"MH"}'::jsonb, 'h4'),
      ('src_govt',  'g2', '{"title":"WBIW/CTU/RFP-87(e)/2025-26","refNo":"2026_WB_5530","state":"WB"}'::jsonb, 'h5')
  `);
});
afterAll(async () => { await cleanupTestDb(); });

describe("G1 — global search", () => {
  test("AC-S1: exact city term ranks the right entity", async () => {
    const r = await searchEntities({ q: "ajmer" });
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    expect(r.hits[0].external_id).toBe("b1");
  });

  test("trigram bridges a typo (dropped letter) on city field", async () => {
    // "Bengalru" → "Bengaluru" trigram similarity ≈ 0.58, well above pg_trgm's 0.3 threshold.
    // Bangalore↔Bengaluru is a transliteration variant — not what trigram is designed for.
    const r = await searchEntities({ q: "Bengalru" });
    const ids = r.hits.map((h) => h.external_id);
    expect(ids).toContain("b2");
  });

  test("ts_headline returns a snippet with <b>...</b> highlight", async () => {
    const r = await searchEntities({ q: "Ajmer" });
    expect(r.hits[0].snippet).toMatch(/<b>.+<\/b>/);
  });

  test("AC-S3: empty q resolves to []", async () => {
    const r = await searchEntities({ q: "   " });
    expect(r.hits).toEqual([]);
  });

  test("facet: source filter restricts results to one source", async () => {
    const r = await searchEntities({ q: "MH", source: "src_govt" });
    for (const h of r.hits) expect(h.source).toBe("src_govt");
  });

  test("facet: category filter restricts results", async () => {
    const r = await searchEntities({ q: "auction", category: "govt-eauction" });
    for (const h of r.hits) expect(h.category).toBe("govt-eauction");
  });

  test("phrase search via websearch_to_tsquery", async () => {
    const r = await searchEntities({ q: '"Timber Auction"' });
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    expect(r.hits[0].external_id).toBe("g1");
  });
});
