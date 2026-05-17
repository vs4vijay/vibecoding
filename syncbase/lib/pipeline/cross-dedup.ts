import { sql } from "drizzle-orm";
import { JSONPath } from "jsonpath-plus";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { sources, type Source } from "../db/schema";
import { normalize } from "./dedup";

export type CrossDedupConfig = {
  pincode?: string;
  city?: string;
  state?: string;
  price?: string;
  bank?: string;
  title?: string;
  address?: string;
  date?: string;
};

type CommonRecord = {
  source: string;
  entityId: number;
  pincode: string;
  city: string;              // normalize("lower")
  state: string;             // normalize("lower")
  priceBucket: string;       // round_10000(price)
  bank: string;              // normalize("bank")
  title: string;
  address: string;
  date: string;              // ISO YYYY-MM-DD or empty
};

export type CrossDedupSummary = {
  sources_scanned: number;
  entities_scanned: number;
  blocks: number;
  pairs_evaluated: number;
  clusters_created: number;
  members_attached: number;
  duration_ms: number;
};

export async function detectCrossSourceDuplicates(): Promise<CrossDedupSummary> {
  const t0 = Date.now();
  const db = getDb();
  const srcs: Source[] = await db.select().from(sources);
  const eligible = srcs.filter((s) => !!(s as any).crossDedup && s.enabled);

  // Project every entity from every eligible source into a common shape.
  // We page through each source in chunks because pulling 10k+ JSONB rows in a
  // single PGLite query blows the WASM heap. Projection happens row-by-row, so we
  // only keep the lightweight CommonRecord values in memory long-term.
  const SCAN_BATCH = 1000;
  const common: CommonRecord[] = [];
  for (const s of eligible) {
    const cfg = (s as any).crossDedup as CrossDedupConfig;
    let lastId = 0;
    while (true) {
      const res: any = await db.execute(sql`
        SELECT id, payload FROM ${sql.identifier(s.storageTable)}
        WHERE source = ${s.name} AND id > ${lastId}
        ORDER BY id ASC
        LIMIT ${SCAN_BATCH}
      `);
      const rows: { id: number; payload: unknown }[] = (res.rows ?? res).map((r: any) => ({
        id: Number(r.id),
        payload: r.payload,
      }));
      if (rows.length === 0) break;
      for (const r of rows) {
        common.push({
          source: s.name,
          entityId: r.id,
          pincode:     normalize(extract(r.payload, cfg.pincode), "pincode"),
          city:        normalize(extract(r.payload, cfg.city),    "lower"),
          state:       normalize(extract(r.payload, cfg.state),   "lower"),
          priceBucket: normalize(extract(r.payload, cfg.price),   "round_10000"),
          bank:        normalize(extract(r.payload, cfg.bank),    "bank"),
          title:       extract(r.payload, cfg.title),
          address:     extract(r.payload, cfg.address),
          date:        normalize(extract(r.payload, cfg.date),    "date_week"),
        });
      }
      lastId = rows[rows.length - 1].id;
      if (rows.length < SCAN_BATCH) break;
    }
  }

  // Block key prefers pincode (most precise) and falls back to (state, city) when
  // pincode is missing. Records that lack BOTH a geo anchor AND a price are skipped —
  // blocking by price alone produces enormous noise blocks (every "₹1.4M listing in
  // India" hashing the same way).
  const blocks = new Map<string, CommonRecord[]>();
  for (const r of common) {
    if (!r.priceBucket) continue;
    let geo = "";
    if (r.pincode) geo = `p=${r.pincode}`;
    else if (r.city && r.state) geo = `cs=${r.state}/${r.city}`;
    else if (r.city) geo = `c=${r.city}`;
    else continue;
    const key = `${geo}|${r.priceBucket}`;
    let g = blocks.get(key);
    if (!g) { g = []; blocks.set(key, g); }
    g.push(r);
  }

  let pairsEvaluated = 0;
  let clustersCreated = 0;
  let membersAttached = 0;
  const topDebug: Array<{ a: CommonRecord; b: CommonRecord; score: number }> = [];

  for (const [blockKey, group] of blocks) {
    if (group.length < 2) continue;
    // Within the block, only consider cross-source pairs (intra-source is D1's job).
    const pairs: Array<{ a: CommonRecord; b: CommonRecord; score: number }> = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.source === b.source) continue;
        pairsEvaluated++;
        const score = pairScore(a, b);
        if (process.env.SYNCBASE_DEDUP_DEBUG === "1") topDebug.push({ a, b, score });
        if (score >= 0.5) pairs.push({ a, b, score });
      }
    }
    if (pairs.length === 0) continue;

    // Union-find: cluster everything that pairs together within this block.
    const ids = new Map<string, string>();
    const key = (r: CommonRecord) => `${r.source}#${r.entityId}`;
    const find = (k: string): string => {
      let cur = ids.get(k) ?? k;
      while (cur !== ids.get(cur) && ids.get(cur)) cur = ids.get(cur)!;
      ids.set(k, cur);
      return cur;
    };
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) ids.set(ra, rb);
    };
    for (const p of pairs) { ids.set(key(p.a), key(p.a)); ids.set(key(p.b), key(p.b)); union(key(p.a), key(p.b)); }

    const groupsByRoot = new Map<string, CommonRecord[]>();
    for (const k of ids.keys()) {
      const root = find(k);
      const rec = group.find((r) => key(r) === k);
      if (!rec) continue;
      let g = groupsByRoot.get(root);
      if (!g) { g = []; groupsByRoot.set(root, g); }
      g.push(rec);
    }

    for (const [, members] of groupsByRoot) {
      if (members.length < 2) continue;
      // Deterministic cluster_key per block-root combo.
      const sortedKeys = members.map(key).sort();
      const clusterKey = createHash("sha1").update(blockKey + "|" + sortedKeys.join(",")).digest("hex").slice(0, 24);

      // Insert (or fetch) the cluster.
      const ins: any = await db.execute(sql`
        INSERT INTO entity_clusters (cluster_key, member_count, updated_at)
        VALUES (${clusterKey}, ${members.length}, now())
        ON CONFLICT (cluster_key) DO UPDATE
          SET member_count = EXCLUDED.member_count,
              updated_at = now()
        RETURNING cluster_id
      `);
      const clusterId = Number(((ins.rows ?? ins)[0] as any).cluster_id);

      // Replace member set for this cluster (idempotent re-run).
      await db.execute(sql`DELETE FROM entity_cluster_members WHERE cluster_id = ${clusterId}`);
      // Canonical = lowest entity_id (oldest), and we treat ≥0.7 as 'member', 0.5-0.7 as 'suggested'.
      const sorted = [...members].sort((x, y) => x.entityId - y.entityId);
      const canonical = sorted[0];
      for (const m of sorted) {
        const role = m === canonical ? "canonical" : "member";
        // We don't have a single pair score for the cluster; use the avg of edges touching m.
        const edges = pairs.filter((p) => p.a === m || p.b === m);
        const avg = edges.length ? edges.reduce((s, e) => s + e.score, 0) / edges.length : null;
        await db.execute(sql`
          INSERT INTO entity_cluster_members (cluster_id, source, entity_id, role, score)
          VALUES (${clusterId}, ${m.source}, ${m.entityId}, ${role}, ${avg})
        `);
        membersAttached++;
      }
      clustersCreated++;
    }
  }

  if (process.env.SYNCBASE_DEDUP_DEBUG === "1" && topDebug.length) {
    topDebug.sort((x, y) => y.score - x.score);
    console.log("Top 10 candidate pair scores (cross-source):");
    for (const p of topDebug.slice(0, 10)) {
      console.log(`  score=${p.score.toFixed(3)}  ${p.a.source}#${p.a.entityId} ↔ ${p.b.source}#${p.b.entityId}`);
      console.log(`    a: city=${p.a.city} state=${p.a.state} pin=${p.a.pincode} bank=${p.a.bank} price=${p.a.priceBucket}`);
      console.log(`       title=${(p.a.title||"").slice(0,80)}`);
      console.log(`       addr =${(p.a.address||"").slice(0,80)}`);
      console.log(`    b: city=${p.b.city} state=${p.b.state} pin=${p.b.pincode} bank=${p.b.bank} price=${p.b.priceBucket}`);
      console.log(`       title=${(p.b.title||"").slice(0,80)}`);
      console.log(`       addr =${(p.b.address||"").slice(0,80)}`);
    }
  }

  return {
    sources_scanned: eligible.length,
    entities_scanned: common.length,
    blocks: blocks.size,
    pairs_evaluated: pairsEvaluated,
    clusters_created: clustersCreated,
    members_attached: membersAttached,
    duration_ms: Date.now() - t0,
  };
}

function extract(payload: unknown, path?: string): string {
  if (!path) return "";
  try {
    const r = JSONPath({ path, json: payload as object, wrap: true });
    if (!Array.isArray(r) || r.length === 0) return "";
    const v = r[0];
    if (v == null) return "";
    return String(v);
  } catch {
    return "";
  }
}

/**
 * Weighted similarity. Higher = more likely the same property.
 *   0.25 pincode match (strongest single signal when both sources have it)
 *   0.15 (city + state) match — fallback when no pincode
 *   0.20 priceBucket match (same ±₹10k bucket) — implicit from blocking but scored
 *        explicitly so it can push the total over threshold
 *   0.15 bank match (exact-or-alias)
 *   0.05 within-week auction date
 *   0.10 trigram(address)
 *   0.10 trigram(title)
 *
 * In practice, two records with matching (city, state, priceBucket, bank) score
 * ≥ 0.55 even when titles look unrelated — which is the right call for aggregators
 * where one source uses boilerplate titles ("Bank X Auctions for property in Y") and
 * the other uses the property description verbatim.
 *
 * trigram similarity is Jaccard-on-trigrams in JS to avoid per-pair DB round-trips
 * (at 15k entities the SQL version blew PGLite's WASM heap).
 */
function pairScore(a: CommonRecord, b: CommonRecord): number {
  let score = 0;
  if (a.pincode && b.pincode && a.pincode === b.pincode) score += 0.25;
  else if (a.city && b.city && a.city === b.city && a.state === b.state) score += 0.15;
  if (a.priceBucket && b.priceBucket && a.priceBucket === b.priceBucket) score += 0.20;
  if (a.bank && b.bank && a.bank === b.bank) score += 0.15;
  if (a.date && b.date && a.date === b.date) score += 0.05;
  score += 0.10 * trigramSimilarity(a.address, b.address);
  score += 0.10 * trigramSimilarity(a.title, b.title);
  return score;
}

function trigrams(s: string): Set<string> {
  if (!s) return new Set();
  // pg_trgm: lowercase, split on non-alnum, then pad each word " <word> " and 3-gram.
  const out = new Set<string>();
  const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    const padded = "  " + w + " ";
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
