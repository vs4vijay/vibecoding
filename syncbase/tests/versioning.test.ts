import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources, entities, entitiesVersions, changeLog, runs } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { eq } from "drizzle-orm";

let mockServer: { url: string; close: () => Promise<void>; setPayload: (p: unknown) => void };

async function startMockServer(initial: unknown) {
  let payload: unknown = initial;
  const server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}/data`,
    close: async () => server.stop(true),
    setPayload: (p: unknown) => {
      payload = p;
    },
  };
}

beforeAll(async () => {
  await freshTestDb();
  const fixture = JSON.parse(
    await readFile(join(import.meta.dir, "fixtures/rera-page-1.json"), "utf8")
  );
  mockServer = await startMockServer(fixture);
}, 30_000);

afterAll(async () => {
  await mockServer?.close();
  await cleanupTestDb();
});

describe("AC-1, AC-2: skip-unchanged property", () => {
  test("first run inserts N entities, N created change_log rows, 0 versions", async () => {
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "test_rera",
        http: { method: "GET", url: mockServer.url },
        pagination: { style: "page", page_param: "page", size: 200, stop_when: "empty_records" },
        recordsPath: "$.Data",
        externalIdPath: "$.RegNo",
        storageTable: "entities",
      })
      .returning();

    const result = await runPipeline(src, "adhoc");
    expect(result.status).toBe("success");
    expect(result.recordsSeen).toBe(3);
    expect(result.recordsCreated).toBe(3);
    expect(result.recordsSkipped).toBe(0);

    const ents = await db.select().from(entities).where(eq(entities.source, "test_rera"));
    expect(ents.length).toBe(3);

    const versions = await db.select().from(entitiesVersions);
    expect(versions.length).toBe(0);

    const created = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.changeType, "created"));
    expect(created.length).toBe(3);
  });

  test("second run with same payload: 0 new entities, 0 new versions, 0 new change_log rows", async () => {
    const db = getDb();
    const before = {
      entities: (await db.select().from(entities)).length,
      versions: (await db.select().from(entitiesVersions)).length,
      changes: (await db.select().from(changeLog)).length,
      runs: (await db.select().from(runs)).length,
    };

    const [src] = await db.select().from(sources).where(eq(sources.name, "test_rera"));
    const result = await runPipeline(src, "adhoc");

    expect(result.status).toBe("success");
    expect(result.recordsSeen).toBe(3);
    expect(result.recordsSkipped).toBe(3);
    expect(result.recordsCreated).toBe(0);
    expect(result.recordsUpdated).toBe(0);

    const after = {
      entities: (await db.select().from(entities)).length,
      versions: (await db.select().from(entitiesVersions)).length,
      changes: (await db.select().from(changeLog)).length,
      runs: (await db.select().from(runs)).length,
    };

    expect(after.entities).toBe(before.entities);
    expect(after.versions).toBe(before.versions);
    expect(after.changes).toBe(before.changes);
    expect(after.runs).toBe(before.runs + 1); // new run row written
  });

  test("mutating one record produces exactly 1 new version and 1 updated change_log row", async () => {
    const db = getDb();

    // Bypass the trigger's hash check by mutating via SQL using a different hash:
    // Easier: update the upstream mock payload, re-run.
    const newPayload = {
      Data: [
        { RegNo: "RAJ/P/2024/0001", ProjectName: "Aravali Heights v2", District: "1063", Status: "Updated", PromoterName: "Aravali Builders" },
        { RegNo: "RAJ/P/2024/0002", ProjectName: "Pink City Towers", District: "1063", Status: "Approved", PromoterName: "Jaipur Estates" },
        { RegNo: "RAJ/P/2024/0003", ProjectName: "Hawa Mahal Residency", District: "1063", Status: "Approved", PromoterName: "Heritage Holdings" },
      ],
      Total: 3,
    };
    mockServer.setPayload(newPayload);

    const versionsBefore = (await db.select().from(entitiesVersions)).length;
    const updatesBefore = (
      await db.select().from(changeLog).where(eq(changeLog.changeType, "updated"))
    ).length;

    const [src] = await db.select().from(sources).where(eq(sources.name, "test_rera"));
    const result = await runPipeline(src, "adhoc");

    expect(result.recordsUpdated).toBe(1);
    expect(result.recordsSkipped).toBe(2);
    expect(result.recordsCreated).toBe(0);

    const versionsAfter = (await db.select().from(entitiesVersions)).length;
    const updatesAfter = (
      await db.select().from(changeLog).where(eq(changeLog.changeType, "updated"))
    ).length;

    expect(versionsAfter - versionsBefore).toBe(1);
    expect(updatesAfter - updatesBefore).toBe(1);

    const ent = (
      await db.select().from(entities).where(eq(entities.externalId, "RAJ/P/2024/0001"))
    )[0];
    expect(ent.versionNum).toBe(2);
  });
});
