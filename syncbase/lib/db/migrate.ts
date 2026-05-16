import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb, getDriver, getRawClient } from "./index";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export async function migrate(): Promise<{ applied: string[]; skipped: string[] }> {
  const db = getDb();
  const driver = getDriver();

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedRows = await db.execute<{ filename: string }>(
    sql`SELECT filename FROM _migrations`
  );
  const rawRows: any[] =
    (appliedRows as any).rows ??
    (Array.isArray(appliedRows) ? (appliedRows as any) : []);
  const appliedSet = new Set(rawRows.map((r: any) => r.filename));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const filename of files) {
    if (appliedSet.has(filename)) {
      skipped.push(filename);
      continue;
    }
    if (driver === "pglite" && filename.includes("pgcron")) {
      skipped.push(filename + " (pglite-skip)");
      continue;
    }
    const body = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    await execMultiStatement(body);
    await db.execute(sql`INSERT INTO _migrations (filename) VALUES (${filename})`);
    applied.push(filename);
  }

  return { applied, skipped };
}

async function execMultiStatement(script: string): Promise<void> {
  const driver = getDriver();
  const client = getRawClient();
  if (driver === "pglite") {
    await (client as PGlite).exec(script);
  } else {
    // node-postgres Pool.query() uses simple query protocol when no params are supplied;
    // simple protocol supports multi-statement scripts.
    await (client as any).query(script);
  }
}
