import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export type PgliteClient = PGlite;
export type PostgresClient = Pool;

export type DbBackend = 'pglite' | 'postgres';

export type PgliteDrizzle = PgliteDatabase<typeof schema>;
export type PostgresDrizzle = NodePgDatabase<typeof schema>;
export type AppDb = PgliteDrizzle | PostgresDrizzle;

export interface DbHandle {
  backend: DbBackend;
  db: AppDb;
  client: PgliteClient | PostgresClient;
}

export interface CreateDbOptions {
  backend?: DbBackend;
  dataDir?: string;
  databaseUrl?: string;
}

export function createDb(opts: CreateDbOptions = {}): DbHandle {
  const backend: DbBackend = opts.backend ?? config.DB_BACKEND;

  if (backend === 'postgres') {
    const pool = new Pool({
      connectionString: opts.databaseUrl ?? config.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 10_000,
    });
    return {
      backend,
      client: pool,
      db: drizzlePg(pool, { schema }),
    };
  }

  const dir = opts.dataDir ?? config.PGLITE_DATA_DIR;
  const pg = new PGlite(dir === ':memory:' ? undefined : dir);
  return {
    backend,
    client: pg,
    db: drizzlePglite(pg, { schema }),
  };
}

export async function closeDb(handle: DbHandle): Promise<void> {
  if (handle.backend === 'postgres') {
    await (handle.client as PostgresClient).end();
  } else {
    await (handle.client as PgliteClient).close();
  }
}

export async function pingDb(handle: DbHandle): Promise<boolean> {
  try {
    await handle.db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
