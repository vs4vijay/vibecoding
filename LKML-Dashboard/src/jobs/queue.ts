import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import type { AppDb } from '../db/client';
import { jobs, type Job, type JobStatus, type NewJob } from '../db/schema';

export const JOB_CHANNEL = 'job_queue';

interface EnqueueOptions {
  availableAt?: Date;
  maxAttempts?: number;
  notify?: boolean;
}

export async function enqueueJob(
  db: AppDb,
  type: string,
  payload: Record<string, unknown> | null = null,
  opts: EnqueueOptions = {},
): Promise<Job> {
  const row: NewJob = {
    type,
    payload,
    maxAttempts: opts.maxAttempts,
    availableAt: opts.availableAt,
  };
  const [job] = await db.insert(jobs).values(row).returning();
  if (opts.notify !== false) await notifyNewJob(db);
  return job!;
}

export async function notifyNewJob(db: AppDb): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${JOB_CHANNEL}, 'new-job')`);
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function toJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    type: String(row.type),
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    status: row.status as JobStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? config.JOB_MAX_ATTEMPTS),
    error: (row.error as string | null) ?? null,
    availableAt: row.available_at ? new Date(row.available_at as string) : new Date(),
    lockedBy: (row.locked_by as string | null) ?? null,
    lockedAt: row.locked_at ? new Date(row.locked_at as string) : null,
    runAt: row.run_at ? new Date(row.run_at as string) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Atomically claim the next eligible job using PostgreSQL's
 * `FOR UPDATE SKIP LOCKED` so concurrent workers never run the same job.
 * Uses the ORM's `sql` helper -> runs on both PGLite and Postgres.
 */
export async function claimNextJob(db: AppDb, workerId: string): Promise<Job | null> {
  const result = await db.execute(sql`
    UPDATE ${jobs}
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = now(),
        run_at = now(),
        attempts = attempts + 1
    WHERE id = (
      SELECT id
      FROM ${jobs}
      WHERE status = 'pending'
        AND available_at <= now()
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  const rows = rowsOf(result);
  if (rows.length === 0) return null;
  return toJob(rows[0]!);
}

function backoffMs(attempts: number): number {
  const base = 2 ** Math.min(attempts, 6);
  return base * 1_000 + Math.floor(Math.random() * 1_000);
}

export async function completeJob(db: AppDb, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', finishedAt: new Date(), lockedBy: null, lockedAt: null })
    .where(eq(jobs.id, jobId));
}

export async function failJob(
  db: AppDb,
  jobId: string,
  attempts: number,
  maxAttempts: number,
  error: unknown,
): Promise<void> {
  const exhausted = attempts >= maxAttempts;
  const message = error instanceof Error ? error.message : String(error);
  const set: Partial<NewJob> = {
    status: exhausted ? 'failed' : 'pending',
    error: message,
    lockedBy: null,
    lockedAt: null,
  };
  if (exhausted) {
    set.finishedAt = new Date();
  } else {
    set.availableAt = new Date(Date.now() + backoffMs(attempts));
  }
  await db.update(jobs).set(set).where(eq(jobs.id, jobId));
}

export async function countPendingJobs(db: AppDb): Promise<number> {
  const result = await db.execute(sql`SELECT count(*)::int AS n FROM ${jobs} WHERE status = 'pending'`);
  const row = rowsOf(result)[0];
  return Number(row?.n ?? 0);
}
