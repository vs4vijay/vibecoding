import { queue, PostgresQueue } from './queue/postgres-queue';
import { JobOptions, Job, JobPayload } from './queue/types';

const postgresQueue = queue as PostgresQueue;

export async function enqueueJob<T extends JobPayload = JobPayload>(
  taskIdentifier: string,
  payload: T,
  options?: JobOptions
): Promise<Job> {
  const job = await postgresQueue.enqueue<T>(taskIdentifier, payload, options);
  console.log(`📝 Enqueued job: ${taskIdentifier} (${job.id})`);
  return job;
}

export async function getJobs(filters?: {
  status?: string;
  queue?: string;
  limit?: number;
  offset?: number;
}) {
  return postgresQueue.getJobs(filters);
}

export async function startWorker() {
  const { Worker } = await import('./queue/worker');
  const worker = new Worker({ concurrency: 5, pollInterval: 1000 });

  const { registerAllTasks } = await import('@/workers/tasks');
  registerAllTasks(worker);

  await worker.start();
  return worker;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error('Failed to start worker:', error);
    process.exit(1);
  });
}