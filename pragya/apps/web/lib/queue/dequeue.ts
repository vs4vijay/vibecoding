import { sql } from "drizzle-orm";
import { db, getDb } from "../db/client";
import { getConfig } from "../config";

// Atomic dequeue: pick the next queued job whose run_after has elapsed.
// Uses FOR UPDATE SKIP LOCKED on real Postgres; PGLite emulates with a single-process safe path.
export async function dequeueNext(workerId: string) {
  const handle = getDb();
  const cfg = getConfig();
  const lockTimeoutMs = 60_000;

  if (handle.driver === "pglite" && handle.pglite) {
    // PGLite is single-process, so a transactional update-where-id-in-subquery is safe.
    const res = await handle.pglite.query<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `WITH next AS (
         SELECT id FROM jobs
         WHERE status = 'queued' AND run_after <= NOW()
         ORDER BY run_after ASC
         LIMIT 1
       )
       UPDATE jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_at = NOW(),
              locked_by = $1,
              started_at = COALESCE(started_at, NOW())
        WHERE id IN (SELECT id FROM next)
       RETURNING id, kind, payload, attempts`,
      [workerId],
    );
    return res.rows[0] ?? null;
  }

  // postgres-js path: real SKIP LOCKED.
  const d = db();
  const result = await d.execute(sql`
    WITH next AS (
      SELECT id FROM jobs
       WHERE status = 'queued' AND run_after <= NOW()
       ORDER BY run_after ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs SET
      status = 'running',
      attempts = attempts + 1,
      locked_at = NOW(),
      locked_by = ${workerId},
      started_at = COALESCE(started_at, NOW())
    WHERE id IN (SELECT id FROM next)
    RETURNING id, kind, payload, attempts
  `);
  const rows = (result as any).rows ?? result;
  return rows[0] ?? null;
}

export async function markJobOutcome(
  id: string,
  outcome: { status: "succeeded" | "failed"; result?: Record<string, unknown>; error?: string },
  workerId: string,
) {
  const d = db();
  // If a failed job has attempts < max_attempts, requeue with backoff.
  if (outcome.status === "failed") {
    const cur = await d.execute(sql`SELECT attempts, max_attempts FROM jobs WHERE id = ${id}`);
    const row = (cur as any).rows?.[0] ?? (Array.isArray(cur) ? cur[0] : null);
    const attempts = Number(row?.attempts ?? 0);
    const maxAttempts = Number(row?.max_attempts ?? 3);
    if (attempts < maxAttempts) {
      const backoffSec = Math.min(60, 2 ** attempts);
      await d.execute(sql`
        UPDATE jobs SET
          status = 'queued',
          run_after = NOW() + (${backoffSec} || ' seconds')::interval,
          locked_at = NULL,
          locked_by = NULL,
          error = ${outcome.error ?? null}
        WHERE id = ${id}
      `);
      return { requeued: true, backoffSec };
    }
  }
  await d.execute(sql`
    UPDATE jobs SET
      status = ${outcome.status},
      result = ${outcome.result ? JSON.stringify(outcome.result) : null}::jsonb,
      error = ${outcome.error ?? null},
      finished_at = NOW()
    WHERE id = ${id}
  `);
  return { requeued: false };
}

// Recover jobs that have been "running" too long (worker crashed mid-job).
export async function reclaimStaleJobs(lockTimeoutMs: number) {
  const d = db();
  await d.execute(sql`
    UPDATE jobs SET
      status = 'queued',
      locked_at = NULL,
      locked_by = NULL
    WHERE status = 'running'
      AND locked_at < NOW() - (${Math.floor(lockTimeoutMs / 1000)} || ' seconds')::interval
  `);
}
