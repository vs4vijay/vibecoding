import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources, entities, entitiesVersions, changeLog } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { eq } from "drizzle-orm";

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
    items: [
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
    ],
  });
}, 30_000);

afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

describe("AC-3/AC-4/AC-5: change detection + versioning visibility", () => {
  test("mutate one record → exactly 1 new versions row + 1 new change_log row, version_num bumps", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_changes",
        http: { method: "GET", url: server.url },
        pagination: { style: "page", page_param: "p", size: 100, stop_when: "empty_records" },
        recordsPath: "$.items",
        externalIdPath: "$.id",
      })
      .returning();

    // First run: 2 created
    let r = await runPipeline(src, "adhoc");
    expect(r.recordsCreated).toBe(2);
    expect(r.recordsUpdated).toBe(0);

    // Mutate the upstream payload — Alpha's value changes
    server.setPayload({
      items: [
        { id: "1", name: "Alpha", value: 999 },
        { id: "2", name: "Beta", value: 200 },
      ],
    });

    const versionsBefore = (await db.select().from(entitiesVersions)).length;
    const updatedBefore = (
      await db.select().from(changeLog).where(eq(changeLog.changeType, "updated"))
    ).length;

    r = await runPipeline(src, "adhoc");
    expect(r.recordsUpdated).toBe(1);
    expect(r.recordsSkipped).toBe(1);
    expect(r.recordsCreated).toBe(0);

    const versionsAfter = await db.select().from(entitiesVersions);
    const updatedAfter = await db.select().from(changeLog).where(eq(changeLog.changeType, "updated"));

    expect(versionsAfter.length - versionsBefore).toBe(1);
    expect(updatedAfter.length - updatedBefore).toBe(1);

    const ent = (await db.select().from(entities).where(eq(entities.externalId, "1")))[0];
    expect(ent.versionNum).toBe(2);
    expect((ent.payload as any).value).toBe(999);

    // Stored prior version preserves the old payload
    const versions = await db
      .select()
      .from(entitiesVersions)
      .where(eq(entitiesVersions.entityId, ent.id));
    expect(versions.length).toBe(1);
    expect((versions[0].payload as any).value).toBe(100);
    expect(versions[0].versionNum).toBe(1);
  });
});
