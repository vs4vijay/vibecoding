import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";

// Mock a page-paginated API. Page N returns 5 records with external_ids
// `p${N}_${i}` for i=0..4. We track how many GETs happened so we can assert
// the run stopped early once it hit a page of all-known records.
let server: { url: string; close: () => Promise<void>; pageCount: () => number };

async function startMock() {
  let pages = 0;
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      pages++;
      const url = new URL(req.url);
      const page = Number(url.searchParams.get("page") ?? 1);
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `p${page}_${i}`,
        title: `Record ${page}.${i}`,
      }));
      return new Response(JSON.stringify({ data: items }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${s.port}/`,
    close: async () => s.stop(true),
    pageCount: () => pages,
  };
}

beforeAll(async () => {
  await freshTestDb();
  server = await startMock();
});
afterAll(async () => { await server?.close(); await cleanupTestDb(); });

describe("pagination stop_when=no_new_records", () => {
  test("first run walks all max_pages (every page has new records)", async () => {
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "incr_seed",
      http: { method: "GET", url: server.url },
      pagination: {
        style: "page",
        page_param: "page",
        size_param: "size",
        size: 5,
        start_page: 1,
        stop_when: "no_new_records",
        max_pages: 5,
      },
      recordsPath: "$.data",
      externalIdPath: "$.id",
    }).returning();
    const before = server.pageCount();
    const r = await runPipeline(src, "adhoc");
    const after = server.pageCount();
    expect(r.recordsCreated).toBe(25);
    expect(after - before).toBe(5);
  });

  test("idle re-run stops after the first page returns all-known records", async () => {
    const db = getDb();
    const { eq } = require("drizzle-orm");
    const [src] = await db.select().from(sources).where(eq(sources.name, "incr_seed"));
    const before = server.pageCount();
    const r = await runPipeline(src, "adhoc");
    const after = server.pageCount();
    expect(r.recordsCreated).toBe(0);
    expect(r.recordsSkipped).toBe(5); // only the first page's 5 records were touched
    expect(after - before).toBe(1);   // and only one page was fetched
  });
});
