import { createDb, closeDb, type DbHandle } from './client';
import { ensureMigrated } from './migrate';
import { countSeries } from '../services/lkml';
import { runIngest } from '../jobs/tasks';

export async function seedDatabase(handle: DbHandle): Promise<{ seeded: boolean }> {
  await ensureMigrated(handle);
  const existing = await countSeries(handle.db);
  if (existing > 0) {
    return { seeded: false };
  }
  await runIngest(handle.db, {});
  return { seeded: true };
}

export async function runSeed(): Promise<void> {
  const handle = createDb();
  try {
    const { seeded } = await seedDatabase(handle);
    console.log(seeded ? '[seed] database seeded' : '[seed] database already has data, skipping');
  } finally {
    await closeDb(handle);
  }
}

if (import.meta.main) {
  void runSeed().catch((err) => {
    console.error(`[seed] failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
