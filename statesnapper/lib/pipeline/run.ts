import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { runs, type Source } from "../db/schema";
import { canonicalHash } from "./hash";
import { extractScalar } from "./extract";
import { paginate, type HttpConfig, type PaginationConfig } from "./fetch";

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

export async function runPipeline(
  source: Source,
  trigger: RunTrigger
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

  let recordsSeen = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  try {
    const http = source.http as HttpConfig;
    const pagination = source.pagination as PaginationConfig;

    for await (const { records } of paginate(http, source.recordsPath, pagination)) {
      for (const rec of records) {
        recordsSeen++;
        const externalId = extractScalar(rec, source.externalIdPath);
        if (externalId == null) continue;
        const hash = canonicalHash(rec, source.hashFields ?? null);

        const result = await upsertEntity({
          storageTable,
          source: source.name,
          externalId,
          payload: rec,
          contentHash: hash,
          runId,
        });

        if (result === "created") recordsCreated++;
        else if (result === "updated") recordsUpdated++;
        else recordsSkipped++;
      }
    }

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

// Skip-unchanged upsert + RETURNING flags so we can distinguish created vs updated vs skipped.
// SET LOCAL app.run_id makes the run id available inside the trigger via current_setting.
async function upsertEntity(args: {
  storageTable: string;
  source: string;
  externalId: string;
  payload: unknown;
  contentHash: string;
  runId: number;
}): Promise<"created" | "updated" | "skipped"> {
  const db = getDb();
  validateIdent(args.storageTable);

  // Single transaction: set the run_id GUC, perform upsert, return inserted flag.
  // PGLite + drizzle: db.transaction works on both drivers.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.run_id = '${args.runId}'`));

    const payloadJson = JSON.stringify(args.payload);
    const upsertSql = sql`
      INSERT INTO ${sql.identifier(args.storageTable)} (source, external_id, payload, content_hash)
      VALUES (${args.source}, ${args.externalId}, ${sql.raw(`'${payloadJson.replace(/'/g, "''")}'::jsonb`)}, ${args.contentHash})
      ON CONFLICT (source, external_id) DO UPDATE
        SET payload = EXCLUDED.payload,
            content_hash = EXCLUDED.content_hash
        WHERE ${sql.identifier(args.storageTable)}.content_hash IS DISTINCT FROM EXCLUDED.content_hash
      RETURNING (xmax = 0) AS inserted, id
    `;
    const res = await tx.execute(upsertSql);
    const rows = extractRows(res);
    if (rows.length === 0) return "skipped" as const;
    const inserted = rows[0].inserted === true || rows[0].inserted === "t" || rows[0].inserted === 1;
    return inserted ? ("created" as const) : ("updated" as const);
  });

  return result;
}

function extractRows(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  const r = res as any;
  if (r && Array.isArray(r.rows)) return r.rows;
  return [];
}

function validateIdent(name: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/i.test(name)) {
    throw new Error(`unsafe table identifier: ${name}`);
  }
}
