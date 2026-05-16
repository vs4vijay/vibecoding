import { sql, eq } from "drizzle-orm";
import { JSONPath } from "jsonpath-plus";
import { getDb } from "./db";
import { sources, type Source } from "./db/schema";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

export type DisplayField = {
  label: string;
  value: string | null;
  primary: boolean;
};

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
  display: DisplayField[];
  primary_label: string | null;
};

type DisplayCol = { label: string; jsonpath: string; primary?: boolean };

function resolveDisplay(payload: unknown, cols: DisplayCol[]): DisplayField[] {
  if (!Array.isArray(cols) || cols.length === 0) return [];
  return cols.map((c) => ({
    label: c.label,
    value: extractScalar(payload, c.jsonpath),
    primary: !!c.primary,
  }));
}

function extractScalar(record: unknown, path: string): string | null {
  if (!path) return null;
  try {
    const result = JSONPath({ path, json: record as object, wrap: true });
    if (!Array.isArray(result) || result.length === 0) return null;
    const v = result[0];
    if (v == null) return null;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  } catch {
    return null;
  }
}

export async function listEntities(opts: {
  sourceName?: string;
  limit?: number;
}): Promise<EntityRow[]> {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 500);

  const allSrcs: Source[] = await db.select().from(sources);
  const srcByName = new Map(allSrcs.map((s) => [s.name, s]));

  let tables: { table: string; sourceName?: string }[];
  if (opts.sourceName) {
    const src = srcByName.get(opts.sourceName);
    if (!src) return [];
    tables = [{ table: src.storageTable, sourceName: src.name }];
  } else {
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

  const top = all.slice(0, limit);
  return top.map((r) => {
    const src = srcByName.get(r.source);
    const cols = (src?.displayColumns as DisplayCol[] | undefined) ?? [];
    const display = resolveDisplay(r.payload, cols);
    const primary = display.find((d) => d.primary && d.value) ?? display.find((d) => d.value);
    return {
      ...r,
      display,
      primary_label: primary?.value ?? null,
    } as EntityRow;
  });
}

export async function getEntity(storageTable: string, id: number) {
  if (!TABLE_RE.test(storageTable)) return null;
  const db = getDb();
  const res: any = await db.execute(
    sql`SELECT * FROM ${sql.identifier(storageTable)} WHERE id = ${id}`
  );
  const rows = res.rows ?? res;
  if (!rows.length) return null;
  const entity = rows[0];
  const [src] = await db.select().from(sources).where(eq(sources.name, entity.source));
  const cols = ((src?.displayColumns ?? []) as DisplayCol[]);
  const display = resolveDisplay(entity.payload, cols);
  const primary = display.find((d) => d.primary && d.value) ?? display.find((d) => d.value);
  return { entity, display, primary_label: primary?.value ?? null, source: src ?? null };
}
