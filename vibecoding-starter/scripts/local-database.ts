import { connect } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { getPool } from '../src/lib/db';
import { schemaSql } from '../src/lib/schema';

export const host = process.env.PGLITE_HOST || '127.0.0.1';
export const port = Number(process.env.PGLITE_PORT || 5433);
export const localDatabaseUrl = `postgresql://postgres@${host}:${port}/postgres`;

export function isPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Open the PGlite data directory, apply the schema, and serve it over the
 * Postgres wire protocol. Only one process may own the data directory at a time.
 * Returns a function that stops the server.
 */
export async function startLocalDatabase(): Promise<() => Promise<void>> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The PGlite socket server is development-only');
  }
  if (await isPortOpen()) {
    throw new Error(
      `${host}:${port} is already in use. Stop the process using it or set PGLITE_PORT to a free port.`
    );
  }

  const db = await PGlite.create(process.env.PGLITE_DATA_DIR || './dev.db');
  await db.exec(schemaSql);

  const server = new PGLiteSocketServer({
    db,
    host,
    port,
    maxConnections: Number(process.env.PGLITE_MAX_CONNECTIONS || 20),
  });
  await server.start();

  return async () => {
    await server.stop();
    await db.close();
  };
}

/**
 * Run a script against DATABASE_URL. When that is the local PGlite socket (the
 * default) and nothing is serving it yet, start it for the duration of the script.
 */
export async function withDatabase(run: () => Promise<void>): Promise<void> {
  process.env.DATABASE_URL ||= localDatabaseUrl;

  let stop: (() => Promise<void>) | undefined;
  if (process.env.DATABASE_URL === localDatabaseUrl && !(await isPortOpen())) {
    stop = await startLocalDatabase();
  }

  try {
    await run();
  } finally {
    await getPool().end();
    await stop?.();
  }
}
