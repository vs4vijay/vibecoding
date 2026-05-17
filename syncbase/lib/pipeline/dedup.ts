import { sql } from "drizzle-orm";
import { JSONPath } from "jsonpath-plus";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { sources, type Source } from "../db/schema";

export type DedupNormalize =
  | "address"
  | "round_1000"
  | "round_10000"
  | "date_week"
  | "pincode"
  | "bank"
  | "lower"
  | "identity";

export type DedupKeyField = {
  path: string;        // JSONPath like "$.address"
  normalize?: DedupNormalize;
};

export type DedupConfig = {
  key_fields: DedupKeyField[];
  similarity_threshold?: number;   // 0..1, default 0.85
  compare_fields?: string[];       // JSONPaths whose trigram similarity decides the pair (default: payload->>'title' + payload->>'address')
};

export function normalize(value: unknown, mode: DedupNormalize = "identity"): string {
  if (value == null) return "";
  const s = String(value);
  switch (mode) {
    case "identity": return s.trim();
    case "lower":    return s.trim().toLowerCase();
    case "address": {
      const lowered = s.toLowerCase()
        .replace(/[.,#/'"()\[\]-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        // expand common abbreviations
        .replace(/\b(st|str)\b/g, "street")
        .replace(/\b(rd)\b/g, "road")
        .replace(/\b(ln)\b/g, "lane")
        .replace(/\b(apt|appt)\b/g, "apartment")
        .replace(/\b(no|nbr)\b/g, "number");
      return lowered;
    }
    case "round_1000": {
      const n = Number(String(s).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return "";
      return String(Math.round(n / 1000) * 1000);
    }
    case "round_10000": {
      const n = Number(String(s).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return "";
      return String(Math.round(n / 10000) * 10000);
    }
    case "date_week": {
      const d = parseDate(s);
      if (!d) return "";
      // ISO week bucket: YYYY-Www
      const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const diff = (d.getTime() - start.getTime()) / 86_400_000;
      const week = Math.floor((diff + start.getUTCDay()) / 7) + 1;
      return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }
    case "pincode": {
      const m = s.match(/\b\d{6}\b/);
      return m ? m[0] : "";
    }
    case "bank": {
      // Run alias expansion FIRST, then strip generic suffixes ("Ltd", "Limited", "Bank")
      // so both "SBI" and "State Bank of India Ltd." land on "state of india".
      const expanded = s.toLowerCase()
        .replace(/[.,#'"()]/g, "")
        .replace(/\bsbi\b/g, "state bank of india")
        .replace(/\bpnb\b/g, "punjab national bank")
        .replace(/\bbob\b/g, "bank of baroda")
        .replace(/\bicici\b/g, "icici bank");
      return expanded
        .replace(/\b(ltd|limited|bank)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
}

function trigrams(s: string): Set<string> {
  if (!s) return new Set();
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

function parseDate(s: string): Date | null {
  // Try ISO first, then "18-May-2026 09:30 AM" style.
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);
  const m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})/);
  if (m) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const month = months.indexOf(m[2].toLowerCase().slice(0,3));
    if (month === -1) return null;
    return new Date(Date.UTC(parseInt(m[3],10), month, parseInt(m[1],10)));
  }
  return null;
}

function extractScalar(record: unknown, path: string): string {
  try {
    const result = JSONPath({ path, json: record as object, wrap: true });
    if (!Array.isArray(result) || result.length === 0) return "";
    const v = result[0];
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  } catch {
    return "";
  }
}

export function computeDedupKey(payload: unknown, fields: DedupKeyField[]): { hash: string; parts: string[] } {
  const parts: string[] = [];
  for (const f of fields) {
    const raw = extractScalar(payload, f.path);
    parts.push(normalize(raw, f.normalize ?? "identity"));
  }
  const hash = createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
  return { hash, parts };
}

export type DedupRunSummary = {
  source: string;
  scanned: number;
  groups: number;
  candidates_evaluated: number;
  pairs_flagged: number;
  duration_ms: number;
};

/**
 * Walk one source's entities, group by dedup_key_hash, run pairwise trigram
 * similarity over compare_fields, upsert into entity_duplicates.
 *
 * Idempotent: existing pairs are updated, not duplicated.
 */
export async function detectDuplicatesForSource(sourceName: string): Promise<DedupRunSummary> {
  const t0 = Date.now();
  const db = getDb();
  const [src] = (await db.select().from(sources).where(sql`name = ${sourceName}`)) as Source[];
  if (!src) throw new Error(`source not found: ${sourceName}`);
  const cfg = (src as any).dedup as DedupConfig | null;
  if (!cfg || !cfg.key_fields?.length) {
    return { source: sourceName, scanned: 0, groups: 0, candidates_evaluated: 0, pairs_flagged: 0, duration_ms: Date.now() - t0 };
  }
  const threshold = cfg.similarity_threshold ?? 0.85;
  const compareFields = cfg.compare_fields ?? ["$.title", "$.address"];

  const storageTable = src.storageTable;
  // Paged scan: a single SELECT against a 10k-row dedicated table blows the PGLite
  // WASM heap. 1k rows at a time keeps memory bounded.
  const SCAN_BATCH = 1000;
  const rows: { id: number; payload: unknown }[] = [];
  let lastId = 0;
  while (true) {
    const res: any = await db.execute(sql`
      SELECT id, payload FROM ${sql.identifier(storageTable)}
      WHERE source = ${sourceName} AND id > ${lastId}
      ORDER BY id ASC
      LIMIT ${SCAN_BATCH}
    `);
    const batch: { id: number; payload: unknown }[] = (res.rows ?? res).map((r: any) => ({
      id: Number(r.id),
      payload: r.payload,
    }));
    if (batch.length === 0) break;
    for (const r of batch) rows.push(r);
    lastId = batch[batch.length - 1].id;
    if (batch.length < SCAN_BATCH) break;
  }

  // Group by dedup_key_hash.
  const groups = new Map<string, { ids: number[]; payloads: Map<number, unknown> }>();
  for (const r of rows) {
    const { hash } = computeDedupKey(r.payload, cfg.key_fields);
    if (!hash || hash === computeDedupKey({}, cfg.key_fields).hash) continue; // empty key → skip
    let g = groups.get(hash);
    if (!g) { g = { ids: [], payloads: new Map() }; groups.set(hash, g); }
    g.ids.push(r.id);
    g.payloads.set(r.id, r.payload);
  }

  let candidatesEvaluated = 0;
  let pairsFlagged = 0;

  for (const [hash, g] of groups) {
    if (g.ids.length < 2) continue;
    const sortedIds = [...g.ids].sort((a, b) => a - b);
    for (let i = 0; i < sortedIds.length; i++) {
      for (let j = i + 1; j < sortedIds.length; j++) {
        candidatesEvaluated++;
        const canonical = sortedIds[i];
        const duplicate = sortedIds[j];
        const a = g.payloads.get(canonical)!;
        const b = g.payloads.get(duplicate)!;
        // Build compare strings from JSONPaths.
        const aStr = compareFields.map((p) => extractScalar(a, p)).join(" ");
        const bStr = compareFields.map((p) => extractScalar(b, p)).join(" ");
        // JS-side trigram similarity (Jaccard-on-trigrams). Same algorithm as
        // lib/pipeline/cross-dedup.ts so D1 and D2 score consistently. Doing this
        // in JS avoids one DB round-trip per pair, which OOMs PGLite at ≥10k rows.
        const sim = trigramSimilarity(aStr, bStr);
        if (sim < threshold) continue;
        // Skip if operator already overrode this pair.
        const ovr: any = await db.execute(sql`
          SELECT decision FROM entity_duplicate_overrides
          WHERE source = ${sourceName}
            AND ((entity_a_id = ${canonical} AND entity_b_id = ${duplicate})
              OR (entity_a_id = ${duplicate} AND entity_b_id = ${canonical}))
        `);
        const ovrRow = (ovr.rows ?? ovr)[0];
        if (ovrRow?.decision === "different") continue;
        // Upsert the pair (idempotent).
        await db.execute(sql`
          INSERT INTO entity_duplicates (source, canonical_id, duplicate_id, similarity, dedup_key_hash, status)
          VALUES (${sourceName}, ${canonical}, ${duplicate}, ${sim}, ${hash}, ${ovrRow?.decision === "same" ? "confirmed" : "auto"})
          ON CONFLICT (source, canonical_id, duplicate_id) DO UPDATE
            SET similarity = EXCLUDED.similarity,
                dedup_key_hash = EXCLUDED.dedup_key_hash,
                detected_at = now()
        `);
        pairsFlagged++;
      }
    }
  }

  return {
    source: sourceName,
    scanned: rows.length,
    groups: groups.size,
    candidates_evaluated: candidatesEvaluated,
    pairs_flagged: pairsFlagged,
    duration_ms: Date.now() - t0,
  };
}

export async function detectDuplicatesForAllSources(): Promise<DedupRunSummary[]> {
  const db = getDb();
  const srcs: Source[] = await db.select().from(sources);
  const out: DedupRunSummary[] = [];
  for (const s of srcs) {
    if (!(s as any).dedup) continue;
    if (!s.enabled) continue;
    out.push(await detectDuplicatesForSource(s.name));
  }
  return out;
}
