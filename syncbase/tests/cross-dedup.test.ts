import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sql } from "drizzle-orm";
import { sources } from "../lib/db/schema";
import { detectCrossSourceDuplicates } from "../lib/pipeline/cross-dedup";

beforeAll(async () => {
  await freshTestDb();
  const db = getDb();
  // Two sources with overlapping property attributes in their payload, different shapes.
  await db.insert(sources).values([
    {
      name: "src_alpha",
      http: { url: "https://x.invalid/" },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
      crossDedup: {
        pincode: "$.attributes.pincode",
        price: "$.attributes.reservePrice",
        bank: "$.attributes.bankName",
        title: "$.attributes.title",
        address: "$.attributes.propertyAddress",
        date: "$.attributes.auctionDate",
      },
    },
    {
      name: "src_beta",
      http: { url: "https://x.invalid/" },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
      crossDedup: {
        pincode: "$.dump.location.pincode",
        price: "$.reserve_price",
        bank: "$.dump.bank.bank_name",
        title: "$.address",
        address: "$.description",
        date: "$.auction_start_date_time",
      },
    },
  ]);
  await db.execute(sql`
    INSERT INTO entities (source, external_id, payload, content_hash) VALUES
      (
        'src_alpha', 'a1',
        '{"attributes":{
          "pincode":"462001",
          "reservePrice":1688750,
          "bankName":"Central Bank of India",
          "title":"Plot 10A3 Mohalla Kumbharpura Bhopal",
          "propertyAddress":"Plot No. 10-A3 Mohalla Kumbharpura Jinsi Road Bhopal",
          "auctionDate":"2026-05-18"
         }}'::jsonb,
        'h1'
      ),
      (
        'src_beta', 'b1',
        '{"reserve_price":1689000,
          "address":"Plot 10A3 Kumbharpura, Bhopal",
          "description":"Plot 10-A3 in Mohalla Kumbharpura Jinsi Road Ward 41 Bhopal",
          "auction_start_date_time":"2026-05-19",
          "dump":{"location":{"pincode":"462001"},"bank":{"bank_name":"Central Bank of India"}}
         }'::jsonb,
        'h2'
      ),
      (
        'src_beta', 'b2',
        '{"reserve_price":700000,
          "address":"Hadapsar Industrial Estate Pune",
          "description":"Vacant industrial plot Pune",
          "auction_start_date_time":"2026-06-01",
          "dump":{"location":{"pincode":"411013"},"bank":{"bank_name":"HDFC Bank"}}
         }'::jsonb,
        'h3'
      )
  `);
});
afterAll(async () => { await cleanupTestDb(); });

describe("D2 — cross-source clustering", () => {
  test("AC-D2.1: matching pincode + ±1k price across two sources clusters into one", async () => {
    const summary = await detectCrossSourceDuplicates();
    expect(summary.entities_scanned).toBe(3);
    expect(summary.clusters_created).toBeGreaterThanOrEqual(1);
    const db = getDb();
    const m: any = await db.execute(sql`
      SELECT cluster_id, source, entity_id, role
      FROM entity_cluster_members
      ORDER BY cluster_id, source, entity_id
    `);
    const members = (m.rows ?? m) as any[];
    // The Bhopal pair should both be in a cluster together; the Pune row should not.
    expect(members.length).toBe(2);
    expect(new Set(members.map((x: any) => x.source))).toEqual(new Set(["src_alpha", "src_beta"]));
    const canonical = members.find((x: any) => x.role === "canonical");
    expect(canonical).toBeTruthy();
  });

  test("AC-D2.2: re-running is idempotent", async () => {
    const db = getDb();
    const before: any = await db.execute(sql`SELECT count(*)::int AS n FROM entity_cluster_members`);
    const nBefore = Number((before.rows ?? before)[0].n);
    await detectCrossSourceDuplicates();
    const after: any = await db.execute(sql`SELECT count(*)::int AS n FROM entity_cluster_members`);
    const nAfter = Number((after.rows ?? after)[0].n);
    expect(nAfter).toBe(nBefore);
  });

  test("intra-source pairs are NOT joined into cross-source clusters", async () => {
    // Add a near-duplicate INSIDE src_alpha: it must NOT clump with the existing Bhopal cluster
    // because cross-dedup explicitly skips same-source pairs (D1 handles that).
    const db = getDb();
    await db.execute(sql`
      INSERT INTO entities (source, external_id, payload, content_hash) VALUES (
        'src_alpha', 'a2',
        '{"attributes":{
          "pincode":"462001",
          "reservePrice":1688900,
          "bankName":"Central Bank of India",
          "title":"Plot 10A3 Mohalla Kumbharpura Bhopal copy",
          "propertyAddress":"Plot No. 10-A3 Mohalla Kumbharpura Jinsi Road Bhopal",
          "auctionDate":"2026-05-18"
         }}'::jsonb,
        'h4'
      )
    `);
    // Wipe and re-run so the cluster includes the new alpha row only if cross-source counts it.
    await db.execute(sql`DELETE FROM entity_cluster_members`);
    await db.execute(sql`DELETE FROM entity_clusters`);
    await detectCrossSourceDuplicates();
    const m: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM entity_cluster_members WHERE source='src_alpha'
    `);
    const n = Number((m.rows ?? m)[0].n);
    // Both a1 and a2 join the same cluster only because each pairs with b1 (different source).
    // The a1↔a2 pair itself is skipped.
    expect(n).toBe(2);
  });
});
