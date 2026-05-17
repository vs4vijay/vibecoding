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
};

export type SearchOpts = {
  q: string;
  limit?: number;
  offset?: number;
  source?: string;
  category?: string;
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
          payload: r.payload,
          score: tsv * 0.7 + trgm * 0.3,
        });
      }
    } catch {
      // Table may pre-date F2 (no search_tsv yet) — skip silently.
    }
  }

  // Cross-table sort → facet filter → paginate.
  let filtered = allHits;
  if (opts.source) filtered = filtered.filter((h) => h.source === opts.source);
  if (opts.category) filtered = filtered.filter((h) => h.category === opts.category);
  filtered.sort((a, b) => b.score - a.score);
  const page = filtered.slice(offset, offset + limit);
  return { hits: page, took_ms: Date.now() - t0 };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
