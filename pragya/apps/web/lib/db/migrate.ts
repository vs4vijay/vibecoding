import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { getDb } from "./client";

export async function runMigrations(migrationsFolder = "./drizzle") {
  const { db, driver } = getDb();
  if (driver === "pglite") {
    await migratePglite(db as any, { migrationsFolder });
  } else {
    await migratePg(db as any, { migrationsFolder });
  }
}
