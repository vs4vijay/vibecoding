import { drizzle as drizzlePg, NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, PgliteDatabase } from "drizzle-orm/pglite";
import pkg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { fuzzystrmatch } from "@electric-sql/pglite/contrib/fuzzystrmatch";
import * as schema from "./schema";

const { Pool } = pkg;

type DB =
  | (NodePgDatabase<typeof schema> & { _driver: "postgres" })
  | (PgliteDatabase<typeof schema> & { _driver: "pglite" });

type ListenFn = (channel: string, cb: (payload: string) => void) => Promise<() => void>;

let _db: DB | null = null;
let _listen: ListenFn | null = null;
let _driver: "postgres" | "pglite" | null = null;
let _pglite: PGlite | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

export function getDriver(): "postgres" | "pglite" {
  if (_driver) return _driver;
  _driver = process.env.DB_DRIVER === "postgres" ? "postgres" : "pglite";
  return _driver;
}

export function getDb(): DB {
  if (_db) return _db;
  if (getDriver() === "postgres") {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const d = drizzlePg(_pool, { schema });
    _db = Object.assign(d, { _driver: "postgres" as const });
    _listen = makePgListen(_pool);
  } else {
    _pglite = new PGlite(process.env.PGLITE_PATH ?? "./local.pglite", {
      extensions: { pg_trgm, fuzzystrmatch },
    });
    const d = drizzlePglite(_pglite, { schema });
    _db = Object.assign(d, { _driver: "pglite" as const });
    _listen = makePgliteListen(_pglite);
  }
  return _db;
}

export function getRawClient(): PGlite | InstanceType<typeof Pool> {
  getDb();
  if (_driver === "postgres") return _pool!;
  return _pglite!;
}

export const listen = async (channel: string, cb: (p: string) => void) => {
  getDb();
  return _listen!(channel, cb);
};

function makePgListen(pool: InstanceType<typeof Pool>): ListenFn {
  return async (channel, cb) => {
    const client = await pool.connect();
    await client.query(`LISTEN ${quoteIdent(channel)}`);
    client.on("notification", (msg) => {
      if (msg.channel === channel && msg.payload != null) cb(msg.payload);
    });
    return async () => {
      try {
        await client.query(`UNLISTEN ${quoteIdent(channel)}`);
      } finally {
        client.release();
      }
    };
  };
}

function makePgliteListen(client: PGlite): ListenFn {
  return async (channel, cb) => {
    const unlisten = await client.listen(channel, cb);
    return unlisten;
  };
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe channel identifier: ${name}`);
  }
  return `"${name}"`;
}

export async function closeDb() {
  if (_pool) await _pool.end();
  if (_pglite) await _pglite.close();
  _db = null;
  _listen = null;
  _pool = null;
  _pglite = null;
}

export { schema };
