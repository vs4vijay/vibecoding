import { sql } from "drizzle-orm";
import { JSONPath } from "jsonpath-plus";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { sources, type Source } from "../db/schema";
import { normalize } from "./dedup";

export type CrossDedupConfig = {
  pincode?: string;
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
  const common: CommonRecord[] = [];
  for (const s of eligible) {
    const cfg = (s as any).crossDedup as CrossDedupConfig;
    const res: any = await db.execute(sql`
      SELECT id, payload FROM ${sql.identifier(s.storageTable)} WHERE source = ${s.name}
    `);
    const rows: { id: number; payload: unknown }[] = (res.rows ?? res).map((r: any) => ({
      id: Number(r.id),
      payload: r.payload,
    }));
    for (const r of rows) {
      common.push({
        source: s.name,
        entityId: r.id,
        pincode:     normalize(extract(r.payload, cfg.pincode), "pincode"),
        priceBucket: normalize(extract(r.payload, cfg.price),   "round_10000"),
        bank:        normalize(extract(r.payload, cfg.bank),    "bank"),
        title:       extract(r.payload, cfg.title),
        address:     extract(r.payload, cfg.address),
        date:        normalize(extract(r.payload, cfg.date),    "date_week"),
      });
    }
  }

  // Block by (pincode, priceBucket). Skip records that have neither — they're noise.
  const blocks = new Map<string, CommonRecord[]>();
  for (const r of common) {
    if (!r.pincode && !r.priceBucket) continue;
    const key = `${r.pincode}|${r.priceBucket}`;
    let g = blocks.get(key);
    if (!g) { g = []; blocks.set(key, g); }
    g.push(r);
  }

  let pairsEvaluated = 0;
  let clustersCreated = 0;
  let membersAttached = 0;

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
        const score = await pairScore(db, a, b);
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
 *   0.30 exact pincode
 *   0.25 trigram(address)
 *   0.20 trigram(title)
 *   0.15 bank exact-or-alias (already normalized)
 *   0.10 within-week auction date
 */
async function pairScore(db: any, a: CommonRecord, b: CommonRecord): Promise<number> {
  let score = 0;
  if (a.pincode && b.pincode && a.pincode === b.pincode) score += 0.30;
  const addrSim = await trgmSim(db, a.address, b.address);
  score += 0.25 * addrSim;
  const titleSim = await trgmSim(db, a.title, b.title);
  score += 0.20 * titleSim;
  if (a.bank && b.bank && a.bank === b.bank) score += 0.15;
  if (a.date && b.date && a.date === b.date) score += 0.10;
  return score;
}

async function trgmSim(db: any, a: string, b: string): Promise<number> {
  if (!a || !b) return 0;
  const res: any = await db.execute(sql`SELECT similarity(${a}, ${b}) AS s`);
  return Number(((res.rows ?? res)[0] as any).s ?? 0);
}
