import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { executeQuery, getDatabaseUrl } from '../db';
import { IQueue, Job, JobFilters, JobOptions, JobPayload, JobStatus, JOB_STATUSES } from './types';

const CHANNEL_NAME = 'job_queue';
const MAX_RETRY_DELAY_SECONDS = 3600;

interface JobRow {
  id: string;
  task_identifier: string;
  payload: JobPayload;
  status: JobStatus;
  priority: number;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  completed_at: Date | null;
  key: string | null;
  queue: string | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    taskIdentifier: row.task_identifier,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    runAt: row.run_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    completedAt: row.completed_at,
    key: row.key,
    queue: row.queue,
  };
}

/** Job queue on plain Postgres: FOR UPDATE SKIP LOCKED to claim, LISTEN/NOTIFY to wake workers. */
export class PostgresQueue implements IQueue {
  async enqueue(taskIdentifier: string, payload: JobPayload, options: JobOptions = {}): Promise<Job> {
    const rows = await executeQuery<JobRow>(
      `INSERT INTO jobs (id, task_identifier, payload, priority, run_at, max_attempts, key, queue)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO NOTHING
       RETURNING *`,
      [
        `job_${randomUUID()}`,
        taskIdentifier,
        JSON.stringify(payload),
        options.priority ?? 0,
        options.runAt ?? new Date(),
        options.maxAttempts ?? 25,
        options.jobKey ?? null,
        options.queue ?? null,
      ]
    );

    if (rows.length === 0) {
      throw new Error(`Job with key ${options.jobKey} already exists`);
    }

    await executeQuery(`SELECT pg_notify($1, $2)`, [CHANNEL_NAME, rows[0].id]);

    return rowToJob(rows[0]);
  }

  async getJob(id: string): Promise<Job | null> {
    const rows = await executeQuery<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    return rows.length > 0 ? rowToJob(rows[0]) : null;
  }

  async getJobs(filters: JobFilters = {}): Promise<Job[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }

    if (filters.queue) {
      params.push(filters.queue);
      conditions.push(`queue = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filters.limit ?? 50, filters.offset ?? 0);

    const rows = await executeQuery<JobRow>(
      `SELECT * FROM jobs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows.map(rowToJob);
  }

  async countJobs(): Promise<Record<JobStatus, number>> {
    const rows = await executeQuery<{ status: JobStatus; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status`
    );

    const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<JobStatus, number>;
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  async claimJob(workerId: string): Promise<Job | null> {
    const rows = await executeQuery<JobRow>(
      `UPDATE jobs
       SET status = 'active', locked_by = $1, locked_at = NOW(), attempts = attempts + 1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'pending' AND run_at <= NOW()
         ORDER BY priority DESC, run_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [workerId]
    );

    return rows.length > 0 ? rowToJob(rows[0]) : null;
  }

  // Finished jobs give up their key so the same key can be enqueued again.
  async completeJob(id: string): Promise<void> {
    await executeQuery(
      `UPDATE jobs
       SET status = 'completed', completed_at = NOW(), key = NULL,
           locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  // Retries back off exponentially (2s, 4s, 8s, ... capped at one hour).
  async failJob(id: string, error: string): Promise<void> {
    await executeQuery(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           run_at = CASE WHEN attempts >= max_attempts THEN run_at
                         ELSE NOW() + LEAST(POWER(2, attempts), $3) * INTERVAL '1 second' END,
           key = CASE WHEN attempts >= max_attempts THEN NULL ELSE key END,
           last_error = $1, locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $2`,
      [error, id, MAX_RETRY_DELAY_SECONDS]
    );
  }

  async deleteJob(id: string): Promise<void> {
    await executeQuery(`DELETE FROM jobs WHERE id = $1`, [id]);
  }

  async subscribe(onJob: () => void): Promise<() => Promise<void>> {
    // LISTEN needs a dedicated connection; pooled connections are handed back between queries.
    const client = new Client({ connectionString: getDatabaseUrl() });
    client.on('error', (error) => {
      console.warn('⚠️  Job notification listener lost; relying on polling:', error.message);
    });
    client.on('notification', () => onJob());

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL_NAME}`);
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }

    return () => client.end();
  }
}
