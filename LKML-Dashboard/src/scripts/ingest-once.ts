import { createDb, closeDb } from '../db/client';
import { ensureMigrated } from '../db/migrate';
import { runIngest } from '../jobs/tasks';

async function main(): Promise<void> {
  const handle = createDb();
  try {
    await ensureMigrated(handle);
    await runIngest(handle.db);
  } finally {
    await closeDb(handle);
  }
}

void main().catch((err) => {
  console.error(`[ingest] failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
