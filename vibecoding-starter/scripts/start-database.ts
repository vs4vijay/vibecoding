#!/usr/bin/env bun

import { localDatabaseUrl, startLocalDatabase } from './local-database';

const stop = await startLocalDatabase();
console.log(`PGlite socket ready at ${localDatabaseUrl}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
