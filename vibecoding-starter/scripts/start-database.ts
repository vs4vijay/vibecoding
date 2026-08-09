#!/usr/bin/env bun

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { schemaSql } from '../src/lib/schema';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The PGlite socket server is development-only');
}

const host = process.env.PGLITE_HOST || '127.0.0.1';
const port = Number(process.env.PGLITE_PORT || 5433);
const dbPath = process.env.PGLITE_DATA_DIR || './dev.db';
const maxConnections = Number(process.env.PGLITE_MAX_CONNECTIONS || 20);

const db = await PGlite.create(dbPath);
await db.exec(schemaSql);

const server = new PGLiteSocketServer({ db, host, port, maxConnections });
await server.start();
console.log(`PGlite socket ready at ${server.getServerConn()}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
