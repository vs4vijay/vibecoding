import { sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { getDb, getDriver, getRawClient } from "../db";
import { runs, type Source } from "../db/schema";
import { canonicalHash } from "./hash";
import { extractScalar } from "./extract";
import { paginate, applyPreRequest, type HttpConfig, type PaginationConfig } from "./fetch";
import { applyLocation } from "./location";
import type { LocationConfig, RunLocation } from "../validation";

export type RunTrigger = "adhoc" | "schedule" | "test";

export type RunResult = {
  runId: number;
  status: "success" | "error";
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errorMessage?: string;
};

const BATCH_SIZE = 250;

export async function runPipeline(
  source: Source,
  trigger: RunTrigger,
  runLocation?: RunLocation
): Promise<RunResult> {
  const db = getDb();

  const [runRow] = await db
    .insert(runs)
    .values({
      sourceId: source.id,
      sourceName: source.name,
      trigger,
      status: "running",
    })
    .returning();
  const runId = runRow.id;

  const storageTable = source.storageTable || "entities";
  validateIdent(storageTable);

  let recordsSeen = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  try {
    const rawHttp = source.http as HttpConfig;
    const location = (source as Source & { location?: LocationConfig | null }).location ?? null;
    const httpAfterLoc = applyLocation(rawHttp, location, runLocation, source.name);
    const http = await applyPreRequest(httpAfterLoc);
    const pagination = source.pagination as PaginationConfig;

    // Dedupe by external_id across the entire run, last-wins. This is necessary
    // because Postgres' ON CONFLICT DO UPDATE statement cannot affect the same
    // row twice in one INSERT — a multi-row upsert with two duplicates throws
    // "ON CONFLICT DO UPDATE command cannot affect row a second time". Some
    // upstream APIs (e.g. sharescart) emit duplicates; we keep the last one.
    const dedup = new Map<string, BatchRow>();

    const flush = async () => {
      if (dedup.size === 0) return;
      const rows = [...dedup.values()];
      dedup.clear();
      const result = await upsertBatch({
        storageTable,
        source: source.name,
        runId,
        rows,
      });
      recordsCreated += result.created;
      recordsUpdated += result.updated;
      recordsSkipped += result.skipped;
    };

    // If the source asks for incremental "stop when this page produced no new or updated rows",
    // we have to flush at every page boundary so the created/updated counters reflect the
    // *current* page in isolation. Without this, a 250-row buffer would straddle pages and
    // the per-page diff would be invisible.
    const stopWhen = (pagination as any).stop_when as string | undefined;
    const incrementalStop = stopWhen === "no_new_records";

    let stopEarly = false;
    for await (const { records } of paginate(http, source.recordsPath, pagination)) {
      const createdBefore = recordsCreated;
      const updatedBefore = recordsUpdated;
      for (const rec of records) {
        recordsSeen++;
        const externalId = extractScalar(rec, source.externalIdPath);
        if (externalId == null) continue;
        const hash = canonicalHash(rec, source.hashFields ?? null);
        // Last-wins dedupe inside the buffer
        dedup.set(externalId, { externalId, payload: rec, contentHash: hash });
        if (dedup.size >= BATCH_SIZE) await flush();
      }
      if (incrementalStop) {
        await flush();
        const pageWroteSomething = recordsCreated > createdBefore || recordsUpdated > updatedBefore;
        if (records.length > 0 && !pageWroteSomething) {
          stopEarly = true;
          break;
        }
      }
    }
    await flush();
    void stopEarly; // informational

    await db
      .update(runs)
      .set({
        status: "success",
        endedAt: new Date(),
        recordsSeen,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
      })
      .where(sql`id = ${runId}`);

    // Auto-dedup: kick off intra-source dedup for this source if it has a config
    // AND the run actually wrote something. Errors here are logged but never fail the run.
    if ((recordsCreated > 0 || recordsUpdated > 0) && (source as any).dedup) {
      try {
        const { detectDuplicatesForSource } = await import("./dedup");
        const summary = await detectDuplicatesForSource(source.name);
        console.log(`[pipeline] auto-dedup ${source.name}: ${summary.pairs_flagged} pairs, ${summary.duration_ms}ms`);
      } catch (err) {
        console.error(`[pipeline] auto-dedup failed for ${source.name}:`, err);
      }
    }

    return {
      runId,
      status: "success",
      recordsSeen,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({
        status: "error",
        endedAt: new Date(),
        recordsSeen,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        errorMessage: msg,
      })
      .where(sql`id = ${runId}`);
    return {
      runId,
      status: "error",
      recordsSeen,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      errorMessage: msg,
    };
  }
}

type BatchRow = { externalId: string; payload: unknown; contentHash: string };

// One transaction per batch (vs one per row): cuts PGLite IPC overhead by
// BATCH_SIZE×. The same trigger fires per-row inside the batch so versioning
// + change_log behavior is unchanged.
//
// RETURNING (xmax=0) emits one row per actually-written record (INSERT or
// UPDATE); rows filtered by the WHERE produce nothing, so:
//   skipped = batch.length - returned.length
//   created = returned where xmax=0
//   updated = returned where xmax!=0
async function upsertBatch(args: {
  storageTable: string;
  source: string;
  runId: number;
  rows: BatchRow[];
}): Promise<{ created: number; updated: number; skipped: number }> {
  if (args.rows.length === 0) return { created: 0, updated: 0, skipped: 0 };

  const params: unknown[] = [];
  const valuesParts: string[] = [];
  let i = 1;
  for (const r of args.rows) {
    valuesParts.push(`($${i}, $${i + 1}, $${i + 2}::jsonb, $${i + 3})`);
    params.push(args.source, r.externalId, JSON.stringify(r.payload), r.contentHash);
    i += 4;
  }

  const upsertSql = `
    INSERT INTO "${args.storageTable}" (source, external_id, payload, content_hash)
    VALUES ${valuesParts.join(", ")}
    ON CONFLICT (source, external_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          content_hash = EXCLUDED.content_hash
      WHERE "${args.storageTable}".content_hash IS DISTINCT FROM EXCLUDED.content_hash
    RETURNING (xmax = 0) AS inserted, external_id
  `;

  const driver = getDriver();
  const client = getRawClient();
  const written = await execInTxnWithParams(driver, client, args.runId, upsertSql, params);

  const created = written.filter((r) => isTrue(r.inserted)).length;
  const updated = written.length - created;
  const skipped = args.rows.length - written.length;
  return { created, updated, skipped };
}

async function execInTxnWithParams(
  driver: "pglite" | "postgres",
  client: any,
  runId: number,
  upsertSql: string,
  params: unknown[]
): Promise<any[]> {
  if (driver === "pglite") {
    const pg = client as PGlite;
    return await pg.transaction(async (tx) => {
      await tx.exec(`SET LOCAL app.run_id = '${runId}'`);
      const res = await tx.query(upsertSql, params);
      return (res.rows as any[]) ?? [];
    });
  }
  const c = await client.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL app.run_id = '${runId}'`);
    const res = await c.query(upsertSql, params);
    await c.query("COMMIT");
    return res.rows ?? [];
  } catch (err) {
    try {
      await c.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    c.release();
  }
}

function isTrue(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1 || v === "1";
}

function validateIdent(name: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/i.test(name)) {
    throw new Error(`unsafe table identifier: ${name}`);
  }
}
