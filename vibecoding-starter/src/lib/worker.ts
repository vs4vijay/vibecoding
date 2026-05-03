import { run, Runner, RunnerOptions } from 'graphile-worker';
import { getPGliteInstance, executeQuery } from './db';
import path from 'path';

let runner: Runner | null = null;

export async function startWorker(): Promise<Runner> {
  if (runner) {
    console.log('⚠️  Worker already running');
    return runner;
  }

  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const isPGlite = databaseUrl.startsWith('file:');

  console.log(`🚀 Starting Graphile Worker (${isPGlite ? 'PGlite' : 'Postgres'})...`);

  const workerOptions: RunnerOptions = {
    connectionString: isPGlite ? undefined : databaseUrl,
    pgPool: isPGlite ? await getPGlitePool() : undefined,
    taskDirectory: path.join(process.cwd(), 'src/workers/tasks'),
    concurrency: 5,
    pollInterval: 1000,
    logger: console as any,
  };

  try {
    runner = await run(workerOptions);
    console.log('✅ Worker started successfully');

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

async function getPGlitePool() {
  const pglite = await getPGliteInstance();

  if (!pglite) {
    throw new Error('PGlite instance not available');
  }

  return pglite as any;
}

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
  await executeQuery(
    `SELECT graphile_worker.add_job($1, $2, $3, $4, $5, $6, $7)`,
    [
      taskIdentifier,
      JSON.stringify(payload),
      options?.jobKey || null,
      options?.runAt || null,
      options?.maxAttempts || 25,
      null,
      options?.priority || 0,
    ]
  );

  console.log(`📝 Enqueued job: ${taskIdentifier}`);
}

export async function getJobs(filters?: {
  limit?: number;
  offset?: number;
}) {
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  const jobs = await executeQuery(
    `SELECT
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
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return jobs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error('Failed to start worker:', error);
    process.exit(1);
  });
}