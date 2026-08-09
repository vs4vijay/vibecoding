import { Pool, type QueryResultRow } from 'pg';

const DEFAULT_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/postgres';

declare global {
  var postgresPool: Pool | undefined;
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

export function getPool(): Pool {
  if (!global.postgresPool) {
    global.postgresPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number(process.env.DATABASE_POOL_SIZE || 5),
    });
  }

  return global.postgresPool;
}

/** Execute parameterized SQL through the Postgres wire protocol in every environment. */
export async function executeQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}
