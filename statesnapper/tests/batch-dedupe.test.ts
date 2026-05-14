import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources, entities } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { eq } from "drizzle-orm";

// Some upstream APIs emit the same external_id twice in one response (we saw
// this on sharescart.com — FINCODE 1000000043 appears twice). Postgres rejects
// ON CONFLICT DO UPDATE if the same row would be affected twice in one
// statement, so the batched-upsert path must dedupe by external_id (last-wins)
// before issuing the INSERT.

let server: { url: string; close: () => Promise<void> };

async function startMock() {
  const s = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(
        JSON.stringify({
          items: [
            { id: "dup", v: "first" },
            { id: "u1", v: "uniq" },
            { id: "dup", v: "second" }, // duplicate of "dup"
            { id: "dup", v: "third" }, // and again
            { id: "u2", v: "uniq2" },
          ],
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    },
  });
  return {
    url: `http://localhost:${s.port}/data`,
    close: async () => s.stop(true),
  };
}

beforeAll(async () => {
  await freshTestDb();
  server = await startMock();
}, 30_000);

afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

describe("batch dedupe (last-wins) protects against ON CONFLICT collision", () => {
  test("duplicate external_ids in one response do not crash the run", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_dedupe",
        http: { method: "GET", url: server.url },
        pagination: { style: "page", page_param: "p", size: 100, stop_when: "empty_records" },
        recordsPath: "$.items",
        externalIdPath: "$.id",
      })
      .returning();

    const r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("success");
    expect(r.recordsSeen).toBe(5); // we counted all 5 raw records
    // Only 3 unique IDs end up in the table; last "dup" wins
    expect(r.recordsCreated).toBe(3);
    expect(r.recordsUpdated).toBe(0);

    const dup = await db.select().from(entities).where(eq(entities.externalId, "dup"));
    expect(dup.length).toBe(1);
    expect((dup[0].payload as any).v).toBe("third");
  });
});
