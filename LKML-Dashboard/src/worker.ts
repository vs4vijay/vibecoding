import { randomUUID } from 'node:crypto';
import { config } from './config';
import { createDb, closeDb, type DbHandle } from './db/client';
import type { Job } from './db/schema';
import { ensureMigrated } from './db/migrate';
import { listenForJobs, type Unlisten } from './jobs/listen';
import { claimNextJob, completeJob, failJob, JOB_CHANNEL } from './jobs/queue';
import { getTask } from './jobs/tasks';
import { runIngest } from './jobs/tasks';

const workerId = config.WORKER_ID ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

export interface WorkerRuntime {
  stop: () => Promise<void>;
}

export async function runWorker(
  handle?: DbHandle,
  opts?: { ingestOnStart?: boolean },
): Promise<WorkerRuntime> {
  const ownsHandle = handle === undefined;
  const dbHandle = handle ?? createDb();
  await ensureMigrated(dbHandle);

  if (opts?.ingestOnStart) {
    try {
      await runIngest(dbHandle.db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[worker:${workerId}] initial ingest failed: ${msg}`);
    }
  }

  let shuttingDown = false;
  let wakePromise: Promise<void> = Promise.resolve();
  let wakeResolve: () => void = () => {};

  const armWake = (): void => {
    wakePromise = new Promise<void>((resolve) => {
      wakeResolve = resolve;
    });
  };
  const triggerWake = (): void => wakeResolve();

  const sleepWithWake = (ms: number): Promise<void> => {
    armWake();
    return Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
      wakePromise,
    ]);
  };

  const runClaimedJob = async (job: Job): Promise<void> => {
    const task = getTask(job.type);
    if (!task) {
      console.warn(`[worker:${workerId}] unknown task type "${job.type}"`);
      await failJob(
        dbHandle.db,
        job.id,
        job.maxAttempts,
        job.maxAttempts,
        new Error(`unknown task type: ${job.type}`),
      );
      return;
    }
    try {
      await task(dbHandle.db, job.payload);
      await completeJob(dbHandle.db, job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worker:${workerId}] job ${job.id} (${job.type}) failed: ${msg}`);
      await failJob(dbHandle.db, job.id, job.attempts, job.maxAttempts, err);
    }
  };

  const claimLoop = async (loopIndex: number): Promise<void> => {
    console.log(`[worker:${workerId}] loop ${loopIndex} started (concurrency=${config.WORKER_CONCURRENCY})`);
    while (!shuttingDown) {
      try {
        const job = await claimNextJob(dbHandle.db, workerId);
        if (job) {
          await runClaimedJob(job);
          triggerWake();
        } else {
          await sleepWithWake(config.JOB_POLL_INTERVAL_MS);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker:${workerId}] loop ${loopIndex} error: ${msg}`);
        await sleepWithWake(Math.max(config.JOB_POLL_INTERVAL_MS, 2_000));
      }
    }
  };

  let unlisten: Unlisten | null = null;
  try {
    unlisten = await listenForJobs(dbHandle, () => {
      triggerWake();
    });
    console.log(`[worker:${workerId}] listening on "${JOB_CHANNEL}" (LISTEN/NOTIFY)`);
  } catch (err) {
    console.warn(
      `[worker:${workerId}] LISTEN/NOTIFY unavailable, falling back to polling: ${err instanceof Error ? err.message : err}`,
    );
  }

  const loops: Promise<void>[] = [];
  for (let i = 0; i < config.WORKER_CONCURRENCY; i++) {
    loops.push(claimLoop(i));
  }
  triggerWake();

  return {
    stop: async () => {
      shuttingDown = true;
      triggerWake();
      await Promise.allSettled(loops);
      unlisten?.();
      if (ownsHandle) await closeDb(dbHandle);
    },
  };
}

async function main(): Promise<void> {
  const runtime = await runWorker(undefined, { ingestOnStart: true });
  const shutdown = async () => {
    console.log(`[worker:${workerId}] shutting down...`);
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.main) {
  void main().catch((err) => {
    console.error(`[worker] fatal: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
