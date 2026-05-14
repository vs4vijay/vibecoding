import { sql, eq } from "drizzle-orm";
import { getDb } from "./db";
import { sources } from "./db/schema";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

export type EntityRow = {
  id: number;
  source: string;
  external_id: string;
  payload: unknown;
  content_hash: string;
  version_num: number;
  first_seen_at: string;
  updated_at: string;
  storage_table: string;
};

export async function listEntities(opts: {
  sourceName?: string;
  limit?: number;
}): Promise<EntityRow[]> {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 500);

  let tables: { table: string; sourceName?: string }[];
  if (opts.sourceName) {
    const [src] = await db.select().from(sources).where(eq(sources.name, opts.sourceName));
    if (!src) return [];
    tables = [{ table: src.storageTable, sourceName: src.name }];
  } else {
    const allSrcs = await db.select().from(sources);
    const set = new Set<string>(["entities"]);
    for (const s of allSrcs) set.add(s.storageTable);
    tables = [...set].map((t) => ({ table: t }));
  }

  const all: any[] = [];
  for (const { table, sourceName } of tables) {
    if (!TABLE_RE.test(table)) continue;
    try {
      const res: any = sourceName
        ? await db.execute(
            sql`SELECT id, source, external_id, payload, content_hash, version_num, first_seen_at, updated_at
                FROM ${sql.identifier(table)} WHERE source = ${sourceName}
                ORDER BY id DESC LIMIT ${limit}`
          )
        : await db.execute(
            sql`SELECT id, source, external_id, payload, content_hash, version_num, first_seen_at, updated_at
                FROM ${sql.identifier(table)} ORDER BY id DESC LIMIT ${limit}`
          );
      const rows = res.rows ?? res;
      for (const r of rows) all.push({ ...r, storage_table: table });
    } catch {
      // table may not exist yet
    }
  }

  all.sort((a, b) => {
    const at = new Date(a.updated_at).getTime();
    const bt = new Date(b.updated_at).getTime();
    return bt - at;
  });
  return all.slice(0, limit);
}
