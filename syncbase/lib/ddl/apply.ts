import { sql } from "drizzle-orm";
import { getDb, getRawClient, getDriver } from "../db";
import { ddlLog } from "../db/schema";
import type { DDLStatement } from "./generate";
import { PGlite } from "@electric-sql/pglite";

export async function applyDDLBundle(
  sourceId: number | null,
  statements: DDLStatement[]
): Promise<void> {
  // Apply all statements in a single transaction; rollback rolls back ddl_log too,
  // so we accumulate audit rows in-memory and only commit them on success.
  const db = getDb();
  const driver = getDriver();
  const client = getRawClient();

  // Bun + drizzle pglite transaction wraps via the underlying client. We use a
  // top-level transaction here.
  if (driver === "pglite") {
    const pg = client as PGlite;
    await pg.transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.exec(stmt.sql);
      }
    });
  } else {
    await (client as any).query("BEGIN");
    try {
      for (const stmt of statements) {
        await (client as any).query(stmt.sql);
      }
      await (client as any).query("COMMIT");
    } catch (err) {
      await (client as any).query("ROLLBACK");
      throw err;
    }
  }

  // Log on success — separate from the DDL transaction so log rows persist
  // independent of any subsequent failure.
  for (const stmt of statements) {
    await db.insert(ddlLog).values({
      sourceId,
      statement: stmt.sql,
      kind: stmt.kind,
      success: true,
    });
  }
}

export async function logDDLFailure(
  sourceId: number | null,
  statements: DDLStatement[],
  error: Error
) {
  const db = getDb();
  await db.insert(ddlLog).values({
    sourceId,
    statement: statements.map((s) => s.sql).join("\n;\n"),
    kind: "failed",
    success: false,
    error: error.message,
  });
}
