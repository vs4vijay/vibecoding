import { createApp } from './api/app';
import { config } from './config';
import { createDb, closeDb } from './db/client';
import { bootstrap } from './db/bootstrap';

async function main(): Promise<void> {
  const handle = createDb();
  await bootstrap(handle);
  const app = createApp(handle.db);

  Bun.serve({
    fetch: app.fetch,
    hostname: config.API_HOST,
    port: config.API_PORT,
    reusePort: true,
  });
  console.log(`[api] listening on http://${config.API_HOST}:${config.API_PORT}`);

  const shutdown = async () => {
    console.log('[api] shutting down...');
    await closeDb(handle);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error(`[api] fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
