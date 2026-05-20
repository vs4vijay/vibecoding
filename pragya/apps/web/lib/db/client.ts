import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../config";
import * as schema from "./schema";

export type DB = ReturnType<typeof initDb>;

declare global {
  // eslint-disable-next-line no-var
  var __drishti_db__: { db: unknown; pglite?: PGlite } | undefined;
}

function initDb() {
  const cfg = getConfig();
  if (cfg.DB_DRIVER === "pglite") {
    const pglite = new PGlite(cfg.PGLITE_DATA_DIR);
    const db = drizzlePglite(pglite, { schema });
    return { db, pglite, driver: "pglite" as const };
  }
  const sql = postgres(cfg.DATABASE_URL, { max: 10 });
  const db = drizzlePostgres(sql, { schema });
  return { db, sql, driver: "postgres" as const };
}

export function getDb() {
  if (!globalThis.__drishti_db__) {
    const initialised = initDb();
    globalThis.__drishti_db__ = initialised as unknown as { db: unknown; pglite?: PGlite };
    // Stash extras on the same object for retrieval below.
    (globalThis.__drishti_db__ as any).__extras = initialised;
  }
  return (globalThis.__drishti_db__ as any).__extras as ReturnType<typeof initDb>;
}

export function db() {
  return getDb().db as PgliteDatabase<typeof schema> & {
    // postgres-js variant is structurally similar
  };
}

export { schema };
