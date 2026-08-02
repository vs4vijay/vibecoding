import { expect, test } from 'bun:test';
import { createDb, closeDb, type DbHandle } from '../src/db/client';
import { ensureMigrated } from '../src/db/migrate';

export { expect, test };

export async function makeDb(): Promise<DbHandle> {
  const handle = createDb({ dataDir: ':memory:' });
  await ensureMigrated(handle);
  return handle;
}

export async function destroyDb(handle: DbHandle): Promise<void> {
  await closeDb(handle);
}
