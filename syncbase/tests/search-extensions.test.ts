import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sql } from "drizzle-orm";

beforeAll(async () => { await freshTestDb(); });
afterAll(async () => { await cleanupTestDb(); });

describe("F2 — pg_trgm / fuzzystrmatch / tsvector available on PGLite", () => {
  test("AC-X1: pg_trgm provides similarity() and ranks typos as similar", async () => {
    const db = getDb();
    // Classic typo: dropped 'a' in Bangalore. Trigrams are nearly identical → score > 0.6.
    const res = await db.execute<{ score: number }>(
      sql`SELECT similarity('Bangalore', 'Banglore') AS score`
    );
    const rows: any[] = (res as any).rows ?? res;
    const score = Number(rows[0].score);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("AC-X1b: pg_trgm provides the `%` operator", async () => {
    const db = getDb();
    const res = await db.execute<{ matches: boolean }>(
      sql`SELECT ('Bangalore' % 'Banglore') AS matches`
    );
    const rows: any[] = (res as any).rows ?? res;
    expect(rows[0].matches).toBe(true);
  });

  test("AC-X2: tsvector / GIN search works on the entities table", async () => {
    const db = getDb();
    // Insert two rows with the same source/external_id-style pair using raw SQL (skip triggers).
    await db.execute(sql`
      INSERT INTO entities (source, external_id, payload, content_hash) VALUES
        ('s', 'a', '{"title":"Residential plot in Ajmer","city":"Ajmer"}'::jsonb, 'h1'),
        ('s', 'b', '{"title":"Commercial unit in Bengaluru","city":"Bengaluru"}'::jsonb, 'h2')
    `);
    const res = await db.execute<{ ext: string; rank: number }>(sql`
      SELECT external_id AS ext,
             ts_rank_cd(search_tsv, websearch_to_tsquery('simple', 'ajmer')) AS rank
        FROM entities
       WHERE search_tsv @@ websearch_to_tsquery('simple', 'ajmer')
    `);
    const rows: any[] = (res as any).rows ?? res;
    expect(rows.length).toBe(1);
    expect(rows[0].ext).toBe("a");
    expect(Number(rows[0].rank)).toBeGreaterThan(0);
  });

  test("AC-X2b: trigram match handles typos on a short field", async () => {
    const db = getDb();
    // Direct trigram match on the city field. "Bengalru" (typo: dropped 'u') vs "Bengaluru" → sim ~0.58.
    const res = await db.execute<{ ext: string; sim: number }>(sql`
      SELECT external_id AS ext,
             similarity(coalesce(payload->>'city',''), 'Bengalru') AS sim
        FROM entities
       WHERE coalesce(payload->>'city','') % 'Bengalru'
       ORDER BY sim DESC
    `);
    const rows: any[] = (res as any).rows ?? res;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].ext).toBe("b");
    expect(Number(rows[0].sim)).toBeGreaterThan(0.4);
  });

  test("AC-X3: idempotency — re-running CREATE EXTENSION pg_trgm is a no-op", async () => {
    const db = getDb();
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    // No throw = success.
    expect(true).toBe(true);
  });
});
