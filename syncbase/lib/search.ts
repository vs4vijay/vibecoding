import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { sources, type Source } from "./db/schema";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

export type SearchHit = {
  source: string;
  category: string | null;
  id: number;
  external_id: string;
  storage_table: string;
  title: string | null;
  snippet: string | null;
  payload: Record<string, unknown>;
  score: number;
  cluster_id?: number;
  members?: { source: string; id: number; role: string }[];
};

export type SearchOpts = {
  q: string;
  limit?: number;
  offset?: number;
  source?: string;
  category?: string;
  /** When true (default) results are rolled up by cluster_id — one card per cluster. */
  cluster_rollup?: boolean;
};

export async function searchEntities(opts: SearchOpts): Promise<{ hits: SearchHit[]; took_ms: number }> {
  const t0 = Date.now();
  const q = opts.q.trim();
  if (!q) return { hits: [], took_ms: 0 };

  const limit = clamp(opts.limit ?? 50, 1, 200);
  const offset = Math.max(0, opts.offset ?? 0);

  const db = getDb();
  const allSrcs: Source[] = await db.select().from(sources);

  // Candidate-table set: shared `entities` plus every distinct dedicated table.
  const tableSet = new Set<string>(["entities"]);
  const sourceCategory = new Map<string, string | null>();
  for (const s of allSrcs) {
    tableSet.add(s.storageTable);
    sourceCategory.set(s.name, (s as any).category ?? null);
  }

  const allHits: SearchHit[] = [];
  for (const table of tableSet) {
    if (!TABLE_RE.test(table)) continue;
    try {
      const res: any = await db.execute(sql`
        WITH q AS (
          SELECT websearch_to_tsquery('simple', ${q}) AS tq, ${q}::text AS raw
        )
        SELECT
          source,
          id,
          external_id,
          payload,
          coalesce(payload->>'title', payload->>'name', payload->>'refNo') AS title,
          ts_headline(
            'simple',
            coalesce(payload->>'title','') || ' ' ||
            coalesce(payload->>'name','')  || ' ' ||
            coalesce(payload->>'address','') || ' ' ||
            coalesce(payload->>'city',''),
            (SELECT tq FROM q),
            'StartSel=<b>,StopSel=</b>,MaxFragments=1,MaxWords=20,MinWords=5'
          ) AS snippet,
          ts_rank_cd(search_tsv, (SELECT tq FROM q)) AS tsv_rank,
          GREATEST(
            similarity(coalesce(payload->>'title',''),   (SELECT raw FROM q)),
            similarity(coalesce(payload->>'name',''),    (SELECT raw FROM q)),
            similarity(coalesce(payload->>'address',''), (SELECT raw FROM q)),
            similarity(coalesce(payload->>'city',''),    (SELECT raw FROM q))
          ) AS trgm_rank
        FROM ${sql.identifier(table)}
        WHERE
          search_tsv @@ (SELECT tq FROM q)
          OR coalesce(payload->>'title','')   % (SELECT raw FROM q)
          OR coalesce(payload->>'name','')    % (SELECT raw FROM q)
          OR coalesce(payload->>'address','') % (SELECT raw FROM q)
          OR coalesce(payload->>'city','')    % (SELECT raw FROM q)
        LIMIT 500
      `);
      const rows: any[] = res.rows ?? res;
      for (const r of rows) {
        const tsv = Number(r.tsv_rank ?? 0);
        const trgm = Number(r.trgm_rank ?? 0);
        allHits.push({
          source: r.source,
          category: sourceCategory.get(r.source) ?? null,
          id: Number(r.id),
          external_id: r.external_id,
          storage_table: table,
          title: r.title ?? null,
          snippet: r.snippet ?? null,
          payload: trimPayload(r.payload),
          score: tsv * 0.7 + trgm * 0.3,
        });
      }
    } catch {
      // Table may pre-date F2 (no search_tsv yet) — skip silently.
    }
  }

  // Look up which hits belong to a cluster so we can either roll them up
  // (one hit per cluster) or just decorate the per-source hits with cluster_id.
  if (allHits.length) await annotateClusters(db, allHits);

  // Cross-table sort → facet filter → optional roll-up → paginate.
  let filtered = allHits;
  if (opts.source) filtered = filtered.filter((h) => h.source === opts.source);
  if (opts.category) filtered = filtered.filter((h) => h.category === opts.category);
  filtered.sort((a, b) => b.score - a.score);

  const rollup = opts.cluster_rollup !== false; // default ON
  if (rollup) filtered = rollupClusters(filtered);

  const page = filtered.slice(offset, offset + limit);
  return { hits: page, took_ms: Date.now() - t0 };
}

async function annotateClusters(db: any, hits: SearchHit[]): Promise<void> {
  if (hits.length === 0) return;
  // entity_cluster_members is small (one row per clustered entity, not per ingested entity),
  // so a full scan + JS filter is simpler than array-binding tricks and equally fast at
  // expected scale.
  let res: any;
  try {
    res = await db.execute(sql`SELECT cluster_id, source, entity_id, role FROM entity_cluster_members`);
  } catch {
    return;
  }
  const allRows: any[] = res.rows ?? res ?? [];
  if (allRows.length === 0) return;

  // Index by (source, entity_id) → cluster_id.
  const byKey = new Map<string, number>();
  // Index by cluster_id → members list.
  const byCluster = new Map<number, { source: string; id: number; role: string }[]>();
  for (const r of allRows) {
    const src = String(r.source);
    const eid = Number(r.entity_id);
    const cid = Number(r.cluster_id);
    byKey.set(`${src}\x00${eid}`, cid);
    let g = byCluster.get(cid);
    if (!g) { g = []; byCluster.set(cid, g); }
    g.push({ source: src, id: eid, role: String(r.role) });
  }

  for (const h of hits) {
    const cid = byKey.get(`${h.source}\x00${h.id}`);
    if (cid == null) continue;
    h.cluster_id = cid;
    h.members = byCluster.get(cid);
  }
}

function rollupClusters(hits: SearchHit[]): SearchHit[] {
  // Keep the first occurrence of each cluster_id (which, since hits are score-sorted,
  // is the highest-scoring representative). Drop any later members.
  const seen = new Set<number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (h.cluster_id == null) { out.push(h); continue; }
    if (seen.has(h.cluster_id)) continue;
    seen.add(h.cluster_id);
    out.push(h);
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Drop noisy/heavy fields from a payload before shipping it as a search hit.
 * Currently strips:
 *   - tsv / tsvector / search_tsv  — Typesense / Strapi full-text vectors (auctionbazaar
 *     records ship a 1.5 kB `tsv` Postgres-style ts vector that's useless to clients).
 *   - _embedded / _links            — HATEOAS junk on WP REST responses.
 *   - Any value larger than 4 kB     — guards against future surprise blobs.
 */
function trimPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload as any;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k === "tsv" || k === "tsvector" || k === "search_tsv") continue;
    if (k === "_embedded" || k === "_links") continue;
    if (typeof v === "string" && v.length > 4096) continue;
    out[k] = v;
  }
  return out;
}
