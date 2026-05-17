import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { sources, type Source } from "./db/schema";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

export type DupPair = {
  id: number;
  source: string;
  canonical_id: number;
  duplicate_id: number;
  canonical_title: string | null;
  duplicate_title: string | null;
  similarity: number;
  status: string;
  detected_at: string;
};

export type ClusterRow = {
  cluster_id: number;
  member_count: number;
  members: { source: string; id: number; role: string; score: number | null; title: string | null }[];
};

export async function listIntraSourcePairs(opts: { limit?: number; source?: string } = {}): Promise<DupPair[]> {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 100, 500);
  // First, the dup rows.
  const dupRes: any = opts.source
    ? await db.execute(sql`
        SELECT id, source, canonical_id, duplicate_id, similarity, status, detected_at
        FROM entity_duplicates
        WHERE source = ${opts.source}
        ORDER BY similarity DESC, id DESC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT id, source, canonical_id, duplicate_id, similarity, status, detected_at
        FROM entity_duplicates
        ORDER BY similarity DESC, id DESC
        LIMIT ${limit}
      `);
  const dupRows: any[] = dupRes.rows ?? dupRes;
  if (dupRows.length === 0) return [];

  // Resolve titles per source: each source can have its own storage_table.
  const allSrcs: Source[] = await db.select().from(sources);
  const storageBySource = new Map<string, string>();
  for (const s of allSrcs) storageBySource.set(s.name, s.storageTable);

  const idsBySource = new Map<string, Set<number>>();
  for (const r of dupRows) {
    let s = idsBySource.get(r.source);
    if (!s) { s = new Set(); idsBySource.set(r.source, s); }
    s.add(Number(r.canonical_id));
    s.add(Number(r.duplicate_id));
  }
  const titles = new Map<string, string | null>(); // key = source\x00id
  for (const [src, ids] of idsBySource) {
    const table = storageBySource.get(src);
    if (!table || !TABLE_RE.test(table)) continue;
    const idList = [...ids];
    if (idList.length === 0) continue;
    // Use unnest to bind a JS array as PG array.
    const res: any = await db.execute(sql`
      SELECT id, coalesce(payload->>'title', payload->>'name', payload->'attributes'->>'title', external_id) AS title
      FROM ${sql.identifier(table)}
      WHERE source = ${src} AND id IN ${sql.raw("(" + idList.join(",") + ")")}
    `).catch(() => null);
    if (!res) continue;
    const rows: any[] = res.rows ?? res;
    for (const r of rows) titles.set(`${src}\x00${Number(r.id)}`, r.title ?? null);
  }

  return dupRows.map((r: any) => ({
    id: Number(r.id),
    source: r.source,
    canonical_id: Number(r.canonical_id),
    duplicate_id: Number(r.duplicate_id),
    canonical_title: titles.get(`${r.source}\x00${Number(r.canonical_id)}`) ?? null,
    duplicate_title: titles.get(`${r.source}\x00${Number(r.duplicate_id)}`) ?? null,
    similarity: Number(r.similarity),
    status: r.status,
    detected_at: r.detected_at,
  }));
}

export async function listClusters(opts: { limit?: number } = {}): Promise<ClusterRow[]> {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const cRes: any = await db.execute(sql`
    SELECT cluster_id, member_count, updated_at
    FROM entity_clusters
    ORDER BY updated_at DESC, cluster_id DESC
    LIMIT ${limit}
  `);
  const cRows: any[] = cRes.rows ?? cRes;
  if (cRows.length === 0) return [];

  const mRes: any = await db.execute(sql`
    SELECT cluster_id, source, entity_id, role, score
    FROM entity_cluster_members
  `);
  const mRows: any[] = mRes.rows ?? mRes;

  // Pre-compute titles per (source, id).
  const allSrcs: Source[] = await db.select().from(sources);
  const storageBySource = new Map<string, string>();
  for (const s of allSrcs) storageBySource.set(s.name, s.storageTable);

  const idsBySource = new Map<string, Set<number>>();
  for (const m of mRows) {
    let s = idsBySource.get(m.source);
    if (!s) { s = new Set(); idsBySource.set(m.source, s); }
    s.add(Number(m.entity_id));
  }
  const titles = new Map<string, string | null>();
  for (const [src, ids] of idsBySource) {
    const table = storageBySource.get(src);
    if (!table || !TABLE_RE.test(table)) continue;
    const idList = [...ids];
    if (idList.length === 0) continue;
    const res: any = await db.execute(sql`
      SELECT id, coalesce(payload->>'title', payload->>'name', payload->'attributes'->>'title', external_id) AS title
      FROM ${sql.identifier(table)}
      WHERE source = ${src} AND id IN ${sql.raw("(" + idList.join(",") + ")")}
    `).catch(() => null);
    if (!res) continue;
    const rows: any[] = res.rows ?? res;
    for (const r of rows) titles.set(`${src}\x00${Number(r.id)}`, r.title ?? null);
  }

  const byCluster = new Map<number, ClusterRow["members"]>();
  for (const m of mRows) {
    const cid = Number(m.cluster_id);
    let g = byCluster.get(cid);
    if (!g) { g = []; byCluster.set(cid, g); }
    g.push({
      source: m.source,
      id: Number(m.entity_id),
      role: m.role,
      score: m.score == null ? null : Number(m.score),
      title: titles.get(`${m.source}\x00${Number(m.entity_id)}`) ?? null,
    });
  }
  return cRows.map((c: any) => ({
    cluster_id: Number(c.cluster_id),
    member_count: Number(c.member_count),
    members: (byCluster.get(Number(c.cluster_id)) ?? []).sort((a, b) => (a.role === "canonical" ? -1 : b.role === "canonical" ? 1 : 0)),
  }));
}
