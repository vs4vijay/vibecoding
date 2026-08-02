import { sql } from 'drizzle-orm';
import { createDb, closeDb } from './client';
import { ensureMigrated } from './migrate';
import { patchSeries, patches, reviews, jobs, ingestState } from './schema';

export async function resetDatabase(): Promise<void> {
  const handle = createDb();
  try {
    await ensureMigrated(handle);
    await handle.db.execute(sql`TRUNCATE TABLE ${reviews} CASCADE`);
    await handle.db.execute(sql`TRUNCATE TABLE ${patches} CASCADE`);
    await handle.db.execute(sql`TRUNCATE TABLE ${patchSeries} CASCADE`);
    await handle.db.execute(sql`TRUNCATE TABLE ${jobs} CASCADE`);
    await handle.db.execute(sql`TRUNCATE TABLE ${ingestState} CASCADE`);
    console.log('[db] database reset (all tables truncated)');
  } finally {
    await closeDb(handle);
  }
}

if (import.meta.main) {
  void resetDatabase().catch((err) => {
    console.error(`[db] reset failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
