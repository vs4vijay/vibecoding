import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import {
  generateDedicatedTableDDL,
  generateDropDedicatedDDL,
  tableNameFor,
} from "../lib/ddl/generate";
import { applyDDLBundle } from "../lib/ddl/apply";
import { getDb } from "../lib/db";
import { ddlLog } from "../lib/db/schema";
import { eq, sql } from "drizzle-orm";

beforeAll(async () => {
  await freshTestDb();
}, 30_000);

afterAll(async () => {
  await cleanupTestDb();
});

describe("AC-16: DDL identifier + type allowlist", () => {
  test("rejects identifiers that violate the regex", () => {
    expect(() => generateDedicatedTableDDL("Bad-Name", [])).toThrow();
    expect(() => generateDedicatedTableDDL("0starts_with_digit", [])).toThrow();
    expect(() => generateDedicatedTableDDL("", [])).toThrow();
    expect(() => generateDedicatedTableDDL("a".repeat(50), [])).toThrow();
  });

  test("rejects disallowed sql_types", () => {
    expect(() =>
      generateDedicatedTableDDL("ok_name", [
        { name: "x", jsonpath: "$.X", sql_type: "varchar" },
      ])
    ).toThrow(/disallowed/);

    expect(() =>
      generateDedicatedTableDDL("ok_name", [
        { name: "x", jsonpath: "$.X", sql_type: "DROP TABLE users;--" },
      ])
    ).toThrow(/disallowed/);
  });

  test("rejects unsafe column names", () => {
    expect(() =>
      generateDedicatedTableDDL("ok_name", [
        { name: "Bad", jsonpath: "$.X", sql_type: "text" },
      ])
    ).toThrow();
    expect(() =>
      generateDedicatedTableDDL("ok_name", [
        { name: "x; DROP TABLE entities;", jsonpath: "$.X", sql_type: "text" },
      ])
    ).toThrow();
  });

  test("rejects non-top-level jsonpath", () => {
    expect(() =>
      generateDedicatedTableDDL("ok_name", [
        { name: "x", jsonpath: "$.Nested.Field", sql_type: "text" },
      ])
    ).toThrow(/top-level/);
  });
});

describe("AC-13/AC-17: transactional DDL bundle", () => {
  test("applying a dedicated DDL bundle creates the tables, triggers, and ddl_log rows", async () => {
    const sourceName = "ddl_unit_test";
    const statements = generateDedicatedTableDDL(sourceName, [
      { name: "district", jsonpath: "$.District", sql_type: "integer", indexed: true },
      { name: "status", jsonpath: "$.Status", sql_type: "text" },
    ]);

    await applyDDLBundle(42, statements);

    const db = getDb();
    const logRows = await db.select().from(ddlLog).where(eq(ddlLog.sourceId, 42));
    expect(logRows.length).toBe(statements.length);
    expect(logRows.every((r) => r.success)).toBe(true);

    const table = tableNameFor(sourceName);
    // Verify table exists by inserting a row that exercises the generated columns
    await db.execute(
      sql.raw(
        `INSERT INTO "${table}" (source, external_id, payload, content_hash) VALUES ('x', 'a', '{"District":7,"Status":"ok"}'::jsonb, 'h1')`
      )
    );
    const res: any = await db.execute(
      sql.raw(`SELECT district, status FROM "${table}" WHERE external_id='a'`)
    );
    const rows = res.rows ?? res;
    expect(rows[0].district).toBe(7);
    expect(rows[0].status).toBe("ok");

    // Drop should succeed in a single transaction
    const drops = generateDropDedicatedDDL(sourceName);
    await applyDDLBundle(42, drops);

    let dropped = true;
    try {
      await db.execute(sql.raw(`SELECT 1 FROM "${table}"`));
      dropped = false;
    } catch {
      // expected — table no longer exists
    }
    expect(dropped).toBe(true);
  });
});
