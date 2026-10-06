import { randomUUID } from 'node:crypto';
import { IQueue, Job, TaskRegistry, WorkerOptions } from './types';

export class Worker {
  private readonly queue: IQueue;
  private readonly tasks: TaskRegistry;
  private readonly workerId = `worker_${randomUUID()}`;
  private readonly pollInterval: number;
  private readonly concurrency: number;
  private readonly activeJobs = new Set<Promise<void>>();
  private claiming = 0;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(queue: IQueue, tasks: TaskRegistry, options: WorkerOptions = {}) {
    this.queue = queue;
    this.tasks = tasks;
    this.pollInterval = options.pollInterval ?? 1000;
    this.concurrency = options.concurrency ?? 5;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`🚀 Starting worker (${this.workerId})`);
    console.log(`   Concurrency: ${this.concurrency}`);
    console.log(`   Poll interval: ${this.pollInterval}ms`);
    console.log(`   Tasks: ${Object.keys(this.tasks).join(', ') || '(none registered)'}`);

    try {
      this.unsubscribe = await this.queue.subscribe(() => void this.fill());
    } catch (error) {
      console.warn('⚠️  Could not subscribe to job notifications; polling only:', error);
    }

    this.poll();
  }

  /** Stop claiming new jobs and wait for the ones in flight to finish. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) clearTimeout(this.pollTimer);
    await this.unsubscribe?.().catch(() => undefined);
    this.unsubscribe = null;

    if (this.activeJobs.size > 0) {
      console.log(`🛑 Waiting for ${this.activeJobs.size} active job(s) to finish...`);
    }
    while (this.claiming > 0 || this.activeJobs.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log('✅ Worker stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private poll(): void {
    if (!this.running) return;
    void this.fill();
    this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
  }

  /** Claim jobs until the queue is drained or every concurrency slot is busy. */
  private async fill(): Promise<void> {
    while (this.running && this.activeJobs.size + this.claiming < this.concurrency) {
      let job: Job | null;
      this.claiming++;
      try {
        job = await this.queue.claimJob(this.workerId);
      } catch (error) {
        console.error('Failed to claim job:', error);
        return;
      } finally {
        this.claiming--;
      }

      if (!job) return;

      const run: Promise<void> = this.run(job).finally(() => {
        this.activeJobs.delete(run);
        void this.fill();
      });
      this.activeJobs.add(run);
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      if (!Object.hasOwn(this.tasks, job.taskIdentifier)) {
        throw new Error(`No handler registered for task: ${job.taskIdentifier}`);
      }

      await this.tasks[job.taskIdentifier](job.payload, job);
      await this.queue.completeJob(job.id);
      console.log(`✅ Job completed: ${job.id} (${job.taskIdentifier})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Job failed: ${job.id} (attempt ${job.attempts}/${job.maxAttempts}):`, message);

      await this.queue.failJob(job.id, message).catch((failError) => {
        console.error(`Failed to record failure for job ${job.id}:`, failError);
      });
    }
  }
}
