import { createApp } from './api/app';
import { config } from './config';
import { createDb, closeDb } from './db/client';
import { bootstrap } from './db/bootstrap';
import { enqueueJob } from './jobs/queue';
import { runWorker } from './worker';

async function main(): Promise<void> {
  const handle = createDb();
  await bootstrap(handle);
  const app = createApp(handle.db);

  const worker = await runWorker(handle, { ingestOnStart: false });

  const enqueueIngest = async () => {
    try {
      await enqueueJob(handle.db, 'ingest.series', {});
    } catch (err) {
      console.error(`[dev] failed to enqueue ingest: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (config.AUTO_INGEST) {
    const timer = setInterval(() => void enqueueIngest(), config.LKML_FETCH_INTERVAL_MS);
    process.on('exit', () => clearInterval(timer));
  }
  await enqueueIngest();

  Bun.serve({
    fetch: app.fetch,
    hostname: config.API_HOST,
    port: config.API_PORT,
    reusePort: true,
  });
  console.log(`[api] listening on http://${config.API_HOST}:${config.API_PORT} (dev: api + worker in one process)`);

  const shutdown = async () => {
    console.log('[dev] shutting down...');
    await worker.stop();
    await closeDb(handle);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error(`[dev] fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
