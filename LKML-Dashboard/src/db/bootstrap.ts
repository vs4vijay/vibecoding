import { config } from '../config';
import type { DbHandle } from './client';
import { ensureMigrated } from './migrate';
import { seedDatabase } from './seed';

export async function bootstrap(handle: DbHandle): Promise<void> {
  await ensureMigrated(handle);
  if (config.SEED_ON_START) await seedDatabase(handle);
}
