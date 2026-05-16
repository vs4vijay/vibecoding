import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { subscribeEntityChanges, type EntityChangedEvent } from "../lib/sse/listen";

let server: { url: string; close: () => Promise<void> };

async function startMock() {
  let calls = 0;
  const s = Bun.serve({
    port: 0,
    async fetch() {
      calls++;
      // First call: one record; subsequent calls: empty → pagination stops.
      const body = calls === 1 ? { items: [{ id: "x", v: 1 }] } : { items: [] };
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      });
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

describe("AC-6/AC-7: NOTIFY → LISTEN delivers events", () => {
  test("subscribing receives a created event when a row is inserted", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_sse",
        http: { method: "GET", url: server.url },
        pagination: { style: "page", page_param: "p", size: 1, stop_when: "empty_records" },
        recordsPath: "$.items",
        externalIdPath: "$.id",
      })
      .returning();

    const events: EntityChangedEvent[] = [];
    const unlisten = await subscribeEntityChanges((ev) => events.push(ev));

    try {
      await runPipeline(src, "adhoc");
      const deadline = Date.now() + 2_000;
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].type).toBe("created");
      expect(events[0].source).toBe("test_sse");
      expect(events[0].external_id).toBe("x");
    } finally {
      await unlisten();
    }
  });
});
