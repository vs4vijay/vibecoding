import { join } from 'node:path';
import { createDb, closeDb, type DbHandle, type PgliteDrizzle, type PostgresDrizzle } from './client';

export const migrationsFolder = join(import.meta.dir, '..', '..', 'drizzle');

export async function ensureMigrated(handle: DbHandle): Promise<void> {
  if (handle.backend === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.db as PgliteDrizzle, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(handle.db as PostgresDrizzle, { migrationsFolder });
  }
}

export async function runMigrations(): Promise<void> {
  const handle = createDb();
  try {
    await ensureMigrated(handle);
    console.log('[db] migrations applied');
  } finally {
    await closeDb(handle);
  }
}

if (import.meta.main) {
  void runMigrations().catch((err) => {
    console.error(`[db] migration failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
