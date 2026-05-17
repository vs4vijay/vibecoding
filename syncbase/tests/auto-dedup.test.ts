import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { sql } from "drizzle-orm";

let server: { url: string; close: () => Promise<void> };

async function startMock(payload: unknown) {
  const s = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    },
  });
  return { url: `http://localhost:${s.port}/`, close: async () => s.stop(true) };
}

beforeAll(async () => {
  await freshTestDb();
  // Mock returns two records with the same normalized address + price bucket — they should
  // form an intra-source dup as soon as the run completes.
  server = await startMock({
    d: [
      { id: "a", title: "Plot 14 Civil Lines Ajmer", address: "Plot 14 Civil Lines Ajmer", reservePrice: "1000100" },
      { id: "b", title: "Plot 14 Civil Lines Ajmer (copy)", address: "PLOT 14 CIVIL LINES AJMER", reservePrice: "1000400" },
    ],
  });
});
afterAll(async () => { await server?.close(); await cleanupTestDb(); });

describe("auto-dedup hook", () => {
  test("dup config triggers intra-source dedup at end of run", async () => {
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "auto_dup_src",
      http: { method: "GET", url: server.url },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
      dedup: {
        key_fields: [
          { path: "$.address",      normalize: "address" },
          { path: "$.reservePrice", normalize: "round_1000" },
        ],
        similarity_threshold: 0.5,
        compare_fields: ["$.title", "$.address"],
      },
    }).returning();
    const r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("success");
    expect(r.recordsCreated).toBe(2);

    // Auto-dedup should have flagged the pair as a duplicate.
    const dupRes: any = await db.execute(sql`SELECT count(*)::int AS n FROM entity_duplicates WHERE source='auto_dup_src'`);
    const n = Number((dupRes.rows ?? dupRes)[0].n);
    expect(n).toBe(1);
  });

  test("source without dedup config does NOT auto-trigger", async () => {
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "no_dedup_src",
      http: { method: "GET", url: server.url },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
    }).returning();
    await runPipeline(src, "adhoc");
    const dupRes: any = await db.execute(sql`SELECT count(*)::int AS n FROM entity_duplicates WHERE source='no_dedup_src'`);
    expect(Number((dupRes.rows ?? dupRes)[0].n)).toBe(0);
  });
});
