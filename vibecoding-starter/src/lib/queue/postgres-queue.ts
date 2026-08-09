import { Client } from 'pg';
import { executeQuery, getDatabaseUrl } from '../db';
import { IQueue, Job, JobOptions, JobPayload } from './types';

const CHANNEL_NAME = 'job_queue';

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `job_${timestamp}${randomStr}`;
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    taskIdentifier: row.task_identifier as string,
    payload: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as JobPayload,
    status: row.status as Job['status'],
    priority: row.priority as number,
    runAt: new Date(row.run_at as string),
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    lastError: row.last_error as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    lockedAt: row.locked_at ? new Date(row.locked_at as string) : null,
    lockedBy: row.locked_by as string | null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    queue: row.queue as string | null,
  };
}

export class PostgresQueue implements IQueue {
  async enqueue<T extends JobPayload = JobPayload>(
    taskIdentifier: string,
    payload: T,
    options?: JobOptions
  ): Promise<Job> {
    const id = generateId();
    const runAt = options?.runAt || new Date();
    const maxAttempts = options?.maxAttempts || 25;
    const priority = options?.priority || 0;
    const queue = options?.queue || null;
    const jobKey = options?.jobKey || null;

    if (jobKey) {
      const existing = await executeQuery<{ id: string }>(
        `SELECT id FROM jobs WHERE key = $1 AND status IN ('pending', 'active')`,
        [jobKey]
      );
      if (existing.length > 0) {
        throw new Error(`Job with key ${jobKey} already exists`);
      }
    }

    const result = await executeQuery(
      `INSERT INTO jobs (
        id, task_identifier, payload, status, priority, run_at,
        max_attempts, key, queue
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        id,
        taskIdentifier,
        JSON.stringify(payload),
        priority,
        runAt.toISOString(),
        maxAttempts,
        jobKey,
        queue,
      ]
    );

    const job = rowToJob(result[0]);

    await executeQuery(`SELECT pg_notify($1, $2)`, [
      CHANNEL_NAME,
      JSON.stringify({ jobId: job.id }),
    ]);

    return job;
  }

  async getJob(id: string): Promise<Job | null> {
    const result = await executeQuery(
      `SELECT * FROM jobs WHERE id = $1`,
      [id]
    );
    return result.length > 0 ? rowToJob(result[0]) : null;
  }

  async getJobs(filters?: {
    status?: string;
    queue?: string;
    limit?: number;
    offset?: number;
  }): Promise<Job[]> {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    if (filters?.queue) {
      query += ` AND queue = $${paramIndex++}`;
      params.push(filters.queue);
    }

    query += ` ORDER BY priority DESC, run_at ASC, created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await executeQuery(query, params);
    return result.map(rowToJob);
  }

  async claimJob(workerId: string): Promise<Job | null> {
    const result = await executeQuery(
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

    return result.length > 0 ? rowToJob(result[0]) : null;
  }

  async completeJob(id: string): Promise<void> {
    await executeQuery(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async failJob(id: string, error: string): Promise<void> {
    await executeQuery(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           last_error = $1, locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $2`,
      [error, id]
    );
  }

  async releaseJob(id: string): Promise<void> {
    await executeQuery(
      `UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async deleteJob(id: string): Promise<void> {
    await executeQuery(`DELETE FROM jobs WHERE id = $1`, [id]);
  }

  async getNextJob(): Promise<Job | null> {
    const result = await executeQuery(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND run_at <= NOW()
       ORDER BY priority DESC, run_at ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`
    );

    if (result.length === 0) {
      return null;
    }

    await executeQuery(
      `UPDATE jobs SET status = 'active', locked_at = NOW(), attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
      [result[0].id]
    );

    const updated = await executeQuery(`SELECT * FROM jobs WHERE id = $1`, [result[0].id]);
    return rowToJob(updated[0]);
  }

  async subscribe(callback: (jobId: string) => void): Promise<() => void> {
    const client = new Client({ connectionString: getDatabaseUrl() });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL_NAME}`);
      client.on('notification', (notification) => {
        if (notification.channel === CHANNEL_NAME) {
          try {
            const data = JSON.parse(notification.payload || '{}');
            callback(data.jobId);
          } catch (e) {
            console.error('Failed to parse notification:', e);
          }
        }
      });
    } catch (e) {
      await client.end().catch(() => undefined);
      console.warn('⚠️  Could not subscribe to notifications:', e);
      return () => {};
    }

    return () => {
      void client.end();
    };
  }
}

export const queue = new PostgresQueue();
