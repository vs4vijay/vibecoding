import { closeDb } from "../../lib/db";
import { migrate } from "../../lib/db/migrate";

export async function freshTestDb() {
  process.env.DB_DRIVER = "pglite";
  process.env.PGLITE_PATH = "memory://";
  await closeDb();
  await migrate();
}

export async function cleanupTestDb() {
  await closeDb();
}
