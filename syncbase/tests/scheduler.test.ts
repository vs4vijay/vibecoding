import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb, listen } from "../lib/db";
import { sources, runs } from "../lib/db/schema";
import { CronerScheduler } from "../lib/scheduler/croner";
import { runPipeline } from "../lib/pipeline/run";
import { eq } from "drizzle-orm";

let server: { url: string; close: () => Promise<void> };

async function startMock() {
  const s = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(
        JSON.stringify({ items: [{ id: "k", v: 1 }] }),
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

describe("AC-8/AC-9: scheduler integration", () => {
  test("CronerScheduler tick → NOTIFY run_due → runPipeline produces a runs row with trigger=schedule", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_sched",
        http: { method: "GET", url: server.url },
        pagination: { style: "page", page_param: "p", size: 100, stop_when: "empty_records" },
        recordsPath: "$.items",
        externalIdPath: "$.id",
      })
      .returning();

    // Simulate worker: LISTEN run_due and trigger pipeline on the matching source.
    const unlisten = await listen("run_due", async (payload) => {
      if (payload === "test_sched") {
        await runPipeline(src, "schedule");
      }
    });

    const sched = new CronerScheduler();
    // Every second
    await sched.register("test_sched", "* * * * * *");

    // Wait until either a schedule-triggered run appears, or timeout
    const deadline = Date.now() + 5_000;
    let scheduledRuns: any[] = [];
    while (Date.now() < deadline) {
      scheduledRuns = await db
        .select()
        .from(runs)
        .where(eq(runs.trigger, "schedule"));
      if (scheduledRuns.length > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await sched.unregister("test_sched");
    await unlisten();

    expect(scheduledRuns.length).toBeGreaterThanOrEqual(1);
    expect(scheduledRuns[0].trigger).toBe("schedule");
  });
});
