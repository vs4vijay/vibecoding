import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources, entitiesVersions } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";

let server: { url: string; close: () => Promise<void>; setPayload: (p: unknown) => void };

async function startMock(initial: unknown) {
  let payload = initial;
  const s = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${s.port}/data`,
    close: async () => s.stop(true),
    setPayload: (p: unknown) => {
      payload = p;
    },
  };
}

beforeAll(async () => {
  await freshTestDb();
  server = await startMock({
    items: [{ id: "1", a: 1, b: 2, c: 3 }],
  });
}, 30_000);

afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

describe("AC-3: hash_fields scopes what counts as a change", () => {
  test("change to a non-hash_field produces no new version", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_hash_subset",
        http: { method: "GET", url: server.url },
        pagination: { style: "page", page_param: "p", size: 100, stop_when: "empty_records" },
        recordsPath: "$.items",
        externalIdPath: "$.id",
        hashFields: ["a", "b"], // c is intentionally excluded
      })
      .returning();

    let r = await runPipeline(src, "adhoc");
    expect(r.recordsCreated).toBe(1);

    // Change c (outside hash_fields)
    server.setPayload({ items: [{ id: "1", a: 1, b: 2, c: 999 }] });
    r = await runPipeline(src, "adhoc");
    expect(r.recordsSkipped).toBe(1);
    expect(r.recordsUpdated).toBe(0);

    const versions = await db.select().from(entitiesVersions);
    expect(versions.length).toBe(0);
  });

  test("change to a hash_field produces a new version", async () => {
    const db = getDb();
    server.setPayload({ items: [{ id: "1", a: 99, b: 2, c: 999 }] });
    // Re-select source row
    const [src] = await db
      .select()
      .from(sources)
      .where((s) => sourcesNameEq(s, "test_hash_subset"));
    const r = await runPipeline(src, "adhoc");
    expect(r.recordsUpdated).toBe(1);

    const versions = await db.select().from(entitiesVersions);
    expect(versions.length).toBe(1);
  });
});

import { eq } from "drizzle-orm";
import { sources as S } from "../lib/db/schema";
function sourcesNameEq(_: any, name: string) {
  return eq(S.name, name);
}
