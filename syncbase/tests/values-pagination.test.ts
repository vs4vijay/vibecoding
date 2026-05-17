import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";

// Mock server that returns shard-specific records based on a path segment.
type Captured = { url: string; path: string };
let captured: Captured[] = [];
let server: { url: string; close: () => Promise<void> };

const SHARDS: Record<string, Array<{ id: string; name: string }>> = {
  HO:  [{ id: "ho-1", name: "Head office lot 1" }, { id: "ho-2", name: "Head office lot 2" }],
  BLR: [{ id: "blr-1", name: "Bangalore lot 1" }],
  HYD: [],   // empty shard — must not abort iteration
  JPR: [{ id: "jpr-1", name: "Jaipur lot 1" }],
};

async function startMock() {
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      captured.push({ url: req.url, path });
      const shard = path.split("/").pop() ?? "";
      const records = SHARDS[shard] ?? [];
      return new Response(JSON.stringify({ data: records }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return { url: `http://localhost:${s.port}`, close: async () => s.stop(true) };
}

beforeAll(async () => {
  await freshTestDb();
  server = await startMock();
});
afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

describe("F3 — pagination.style: 'values'", () => {
  test("AC-V1: issues one GET per value, in order, with {{value}} substituted", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "values_seed",
      http: {
        method: "GET",
        url: `${server.url}/shard/{{value}}`,
      },
      pagination: {
        style: "values",
        values: ["HO", "BLR", "HYD", "JPR"],
      },
      recordsPath: "$.data",
      externalIdPath: "$.id",
    }).returning();
    const r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("success");
    expect(captured.length).toBe(4);
    expect(captured[0].path).toBe("/shard/HO");
    expect(captured[1].path).toBe("/shard/BLR");
    expect(captured[2].path).toBe("/shard/HYD");
    expect(captured[3].path).toBe("/shard/JPR");
  });

  test("AC-V2: records from all shards are persisted; empty shard does not abort the loop", async () => {
    // recordsSeen = 2 + 1 + 0 + 1 = 4
    const db = getDb();
    const [src] = await db.select().from(sources).where((() => {
      const { eq } = require("drizzle-orm");
      return eq(sources.name, "values_seed");
    })());
    expect(src).toBeTruthy();
    // First run already happened in AC-V1. Inspect entities table directly.
    const { sql } = require("drizzle-orm");
    const res: any = await db.execute(sql`SELECT count(*)::int AS n FROM entities WHERE source = 'values_seed'`);
    const n = Number((res.rows ?? res)[0].n);
    expect(n).toBe(4);
  });

  test("AC-V2b: idle re-run skips all records (AC-2 still holds)", async () => {
    const db = getDb();
    const { eq } = require("drizzle-orm");
    const [src] = await db.select().from(sources).where(eq(sources.name, "values_seed"));
    const r = await runPipeline(src, "adhoc");
    expect(r.recordsSeen).toBe(4);
    expect(r.recordsSkipped).toBe(4);
    expect(r.recordsCreated).toBe(0);
  });

  test("AC-V3: URL without {{value}} placeholder fails with VALUES_TEMPLATE_REQUIRED", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "values_bad_seed",
      http: { method: "GET", url: `${server.url}/no-template` },
      pagination: { style: "values", values: ["HO", "BLR"] },
      recordsPath: "$.data",
      externalIdPath: "$.id",
    }).returning();
    const r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/no \{\{value\}\} placeholder/);
    expect(captured.length).toBe(0);
  });

  test("max_pages caps the iteration", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "values_capped_seed",
      http: { method: "GET", url: `${server.url}/shard/{{value}}` },
      pagination: { style: "values", values: ["HO", "BLR", "HYD", "JPR"], max_pages: 2 },
      recordsPath: "$.data",
      externalIdPath: "$.id",
    }).returning();
    const r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("success");
    expect(captured.length).toBe(2);
  });
});
