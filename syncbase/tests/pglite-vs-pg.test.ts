import { describe, test, expect } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb, getDriver } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";

// Lightweight parity smoke test. The full parity strategy is documented in
// README.md (run the whole suite under both drivers via env vars). This test
// just asserts the driver-swap shim returns a working DB regardless of which
// driver is selected.

describe("driver parity (smoke)", () => {
  test("pglite path: pipeline runs end-to-end", async () => {
    process.env.DB_DRIVER = "pglite";
    await freshTestDb();
    expect(getDriver()).toBe("pglite");

    const server = Bun.serve({
      port: 0,
      async fetch() {
        return new Response(JSON.stringify({ d: [{ id: "x", v: 1 }] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    try {
      const db = getDb();
      const [src] = await db
        .insert(sources)
        .values({
          name: "parity_pglite",
          http: { method: "GET", url: `http://localhost:${server.port}/` },
          pagination: { style: "page", page_param: "p", size: 50, stop_when: "empty_records" },
          recordsPath: "$.d",
          externalIdPath: "$.id",
        })
        .returning();
      const r = await runPipeline(src, "adhoc");
      expect(r.status).toBe("success");
      expect(r.recordsCreated).toBe(1);
    } finally {
      server.stop(true);
      await cleanupTestDb();
    }
  });
});
