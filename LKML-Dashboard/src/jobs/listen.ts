import { PGlite } from '@electric-sql/pglite';
import { Client } from 'pg';
import type { DbHandle } from '../db/client';
import { config } from '../config';
import { JOB_CHANNEL } from './queue';

export type Unlisten = () => void;

/**
 * Subscribe to the job queue channel using PostgreSQL LISTEN/NOTIFY.
 * - Postgres backend: dedicated pg.Client running `LISTEN job_queue`.
 * - PGLite backend: in-process `pg.listen()` on the same instance.
 * Returns a function that unsubscribes.
 */
export async function listenForJobs(
  handle: DbHandle,
  onNotify: (payload: string) => void,
): Promise<Unlisten> {
  if (handle.backend === 'postgres') {
    const client = new Client({ connectionString: config.DATABASE_URL });
    await client.connect();
    await client.query(`LISTEN ${JOB_CHANNEL}`);
    client.on('notification', (msg) => onNotify(String(msg.payload ?? '')));
    return () => {
      client.end().catch(() => {});
    };
  }

  const pg = handle.client as PGlite;
  const unlisten = await pg.listen(JOB_CHANNEL, (payload) => onNotify(String(payload ?? '')));
  return () => {
    unlisten().catch(() => {});
  };
}
