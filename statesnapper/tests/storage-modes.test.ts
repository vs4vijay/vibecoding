import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources, runs, changeLog } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { generateDedicatedTableDDL, tableNameFor } from "../lib/ddl/generate";
import { applyDDLBundle } from "../lib/ddl/apply";
import { eq, sql } from "drizzle-orm";

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
    Data: [
      { RegNo: "A1", District: 7, Status: "Approved" },
      { RegNo: "A2", District: 8, Status: "Approved" },
    ],
  });
}, 30_000);

afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

describe("AC-14/AC-15: dedicated storage parity + generated columns", () => {
  test("dedicated source: same created/skipped/updated behavior as generic + typed columns populated", async () => {
    const db = getDb();
    const sourceName = "rera_typed";

    // Provision dedicated tables
    const ddl = generateDedicatedTableDDL(sourceName, [
      { name: "district", jsonpath: "$.District", sql_type: "integer", indexed: true },
      { name: "status", jsonpath: "$.Status", sql_type: "text" },
    ]);
    await applyDDLBundle(null, ddl);

    const storageTable = tableNameFor(sourceName);
    const [src] = await db
      .insert(sources)
      .values({
        name: sourceName,
        http: { method: "GET", url: server.url },
        pagination: { style: "page", page_param: "p", size: 100, stop_when: "empty_records" },
        recordsPath: "$.Data",
        externalIdPath: "$.RegNo",
        storageMode: "dedicated",
        typedColumns: [
          { name: "district", jsonpath: "$.District", sql_type: "integer", indexed: true },
          { name: "status", jsonpath: "$.Status", sql_type: "text" },
        ],
        storageTable,
      })
      .returning();

    // First run: AC-1 parity
    let r = await runPipeline(src, "adhoc");
    expect(r.status).toBe("success");
    expect(r.recordsCreated).toBe(2);

    // Typed columns are populated via STORED generated expression
    const sel: any = await db.execute(
      sql`SELECT district, status FROM ${sql.identifier(storageTable)} ORDER BY external_id`
    );
    const rows = sel.rows ?? sel;
    expect(rows.length).toBe(2);
    expect(rows[0].district).toBe(7);
    expect(rows[0].status).toBe("Approved");
    expect(rows[1].district).toBe(8);

    // Second run: skip-unchanged parity (AC-2)
    r = await runPipeline(src, "adhoc");
    expect(r.recordsSkipped).toBe(2);
    expect(r.recordsCreated).toBe(0);

    // change_log entries are tagged with the dedicated storage_table
    const log = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.source, sourceName));
    expect(log.length).toBe(2);
    expect(log.every((c) => c.storageTable === storageTable)).toBe(true);

    // Mutate one record upstream → AC-4 parity
    server.setPayload({
      Data: [
        { RegNo: "A1", District: 7, Status: "Updated" },
        { RegNo: "A2", District: 8, Status: "Approved" },
      ],
    });
    r = await runPipeline(src, "adhoc");
    expect(r.recordsUpdated).toBe(1);

    const versions: any = await db.execute(
      sql`SELECT * FROM ${sql.identifier(storageTable + "_versions")}`
    );
    const versionRows = versions.rows ?? versions;
    expect(versionRows.length).toBe(1);
  });
});
