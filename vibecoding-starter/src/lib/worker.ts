import { run, Runner, RunnerOptions } from 'graphile-worker';
import { getPGliteInstance } from './db';
import path from 'path';

let runner: Runner | null = null;

/**
 * Initialize and run Graphile Worker
 *
 * Supports both PostgreSQL and PGlite through connection string
 */
export async function startWorker(): Promise<Runner> {
  if (runner) {
    console.log('⚠️  Worker already running');
    return runner;
  }

  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const isPGlite = databaseUrl.startsWith('file:');

  console.log(`🚀 Starting Graphile Worker (${isPGlite ? 'PGlite' : 'Postgres'})...`);

  const workerOptions: RunnerOptions = {
    // Connection
    connectionString: isPGlite ? undefined : databaseUrl,
    pgPool: isPGlite ? await getPGlitePool() : undefined,

    // Task directory
    taskDirectory: path.join(process.cwd(), 'src/workers/tasks'),

    // Concurrency
    concurrency: 5,
    pollInterval: 1000,

    // Logging
    logger: {
      error: (msg, meta) => console.error('❌', msg, meta),
      warn: (msg, meta) => console.warn('⚠️', msg, meta),
      info: (msg, meta) => console.log('ℹ️', msg, meta),
      debug: () => {}, // Suppress debug logs
    },
  };

  try {
    runner = await run(workerOptions);
    console.log('✅ Worker started successfully');

    // Graceful shutdown
    const shutdownHandler = async () => {
      console.log('\n🛑 Shutting down worker...');
      if (runner) {
        await runner.stop();
        runner = null;
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

    return runner;
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    throw error;
  }
}

/**
 * Get PGlite connection pool (for worker)
 */
async function getPGlitePool() {
  const pglite = await getPGliteInstance();

  if (!pglite) {
    throw new Error('PGlite instance not available');
  }

  // PGlite exposes a pg-compatible interface
  // We can pass the PGlite instance directly as it implements the Pool interface
  return pglite as any;
}

/**
 * Helper to add a job to the queue
 */
export async function enqueueJob<T = any>(
  taskIdentifier: string,
  payload: T,
  options?: {
    runAt?: Date;
    maxAttempts?: number;
    priority?: number;
    jobKey?: string;
  }
) {
  const { prisma } = await import('./db');

  // Use Prisma to insert job directly into _private_jobs table
  // This works with both PGlite and Postgres
  const job = await prisma.$executeRawUnsafe(`
    SELECT graphile_worker.add_job(
      $1::text,
      $2::json,
      $3::text,
      $4::timestamptz,
      $5::int,
      $6::text,
      $7::int
    );
  `,
    taskIdentifier,
    JSON.stringify(payload),
    options?.jobKey || null,
    options?.runAt || null,
    options?.maxAttempts || 25,
    null, // queue name
    options?.priority || 0
  );

  console.log(`📝 Enqueued job: ${taskIdentifier}`);
  return job;
}

/**
 * Query job status
 */
export async function getJobs(filters?: {
  limit?: number;
  offset?: number;
}) {
  const { prisma } = await import('./db');

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  // Query jobs from graphile_worker tables
  const jobs = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      task_identifier,
      payload,
      priority,
      run_at,
      attempts,
      max_attempts,
      last_error,
      created_at,
      updated_at,
      locked_at,
      locked_by,
      CASE
        WHEN locked_at IS NOT NULL THEN 'active'
        WHEN attempts >= max_attempts THEN 'failed'
        WHEN run_at > NOW() THEN 'scheduled'
        ELSE 'pending'
      END as status
    FROM graphile_worker.jobs
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2;
  `, limit, offset);

  return jobs;
}

// Start worker if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error('Failed to start worker:', error);
    process.exit(1);
  });
}
