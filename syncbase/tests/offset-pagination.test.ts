import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";

// Simulates a DataTables-style server: hard-caps page size at 10 regardless of
// what the client asks for, returns positional rows under aaData, and uses
// iDisplayStart/iDisplayLength.

let server: { url: string; close: () => Promise<void> };
let totalSeen = 0;

async function startMock(records: any[]) {
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      const form = new URLSearchParams(body);
      const start = parseInt(form.get("iDisplayStart") ?? "0", 10);
      const len = parseInt(form.get("iDisplayLength") ?? "10", 10);
      const cap = Math.min(len, 10);
      const slice = records.slice(start, start + cap);
      const payload = {
        sEcho: form.get("sEcho"),
        iTotalRecords: records.length,
        iTotalDisplayRecords: records.length,
        aaData: slice,
      };
      return new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${s.port}/datatables`,
    close: async () => s.stop(true),
  };
}

beforeAll(async () => {
  await freshTestDb();
  // 33 records → expect 4 pages of 10 + 1 page of 3
  const records = Array.from({ length: 33 }, (_, i) => [
    `/img/${i}.jpg`,
    String(10000 + i), // column 1: external_id
    "Bank Name",
    `Description ${i}`,
    "City",
  ]);
  totalSeen = records.length;
  server = await startMock(records);
}, 30_000);

afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

describe("offset pagination + positional records", () => {
  test("paginates with iDisplayStart, captures all records, dedupe-by-id works on positional rows", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_offset",
        http: {
          method: "POST",
          url: server.url,
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          form: { sEcho: "1" },
        },
        pagination: {
          style: "offset",
          offset_param: "iDisplayStart",
          size_param: "iDisplayLength",
          size: 10,
          start_offset: 0,
          stop_when: "empty_records",
          max_pages: 100,
        },
        recordsPath: "$.aaData",
        externalIdPath: "$[1]",
      })
      .returning();

    const r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("success");
    expect(r.recordsSeen).toBe(totalSeen);
    expect(r.recordsCreated).toBe(totalSeen);
    expect(r.recordsSkipped).toBe(0);
    expect(r.recordsUpdated).toBe(0);

    // Re-run: full AC-2 skip-unchanged across paginated source
    const r2 = await runPipeline(src, "adhoc");
    expect(r2.recordsSeen).toBe(totalSeen);
    expect(r2.recordsSkipped).toBe(totalSeen);
    expect(r2.recordsCreated).toBe(0);
  });
});
