import { IWorker, TaskHandler, WorkerOptions, Job, JobPayload } from './types';
import { queue, PostgresQueue } from './postgres-queue';

export class Worker implements IWorker {
  private tasks: Record<string, TaskHandler> = {};
  private running = false;
  private stopRequested = false;
  private workerId: string;
  private pollInterval: number;
  private concurrency: number;
  private activeJobs: Map<string, Job> = new Map();
  private unsubscribe: (() => void) | null = null;
  private postgresQueue: PostgresQueue;

  constructor(options?: WorkerOptions) {
    this.workerId = `worker_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    this.pollInterval = options?.pollInterval || 1000;
    this.concurrency = options?.concurrency || 5;
    this.postgresQueue = queue as PostgresQueue;
  }

  registerTask(taskIdentifier: string, handler: TaskHandler): void {
    this.tasks[taskIdentifier] = handler;
    console.log(`📝 Registered task: ${taskIdentifier}`);
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('⚠️  Worker already running');
      return;
    }

    this.running = true;
    this.stopRequested = false;

    console.log(`🚀 Starting Worker (${this.workerId})...`);
    console.log(`   Concurrency: ${this.concurrency}`);
    console.log(`   Poll interval: ${this.pollInterval}ms`);

    const taskNames = Object.keys(this.tasks);
    if (taskNames.length === 0) {
      console.warn('⚠️  No tasks registered!');
    } else {
      console.log(`   Tasks: ${taskNames.join(', ')}`);
    }

    try {
      this.unsubscribe = await this.postgresQueue.subscribe(async (jobId: string) => {
        console.log(`📬 Received notification for job: ${jobId}`);
        this.processNextJob();
      });
    } catch (e) {
      console.warn('⚠️  Could not subscribe to notifications, polling will be used instead');
    }

    this.pollLoop();
    console.log('✅ Worker started successfully');
  }

  private pollLoop(): void {
    if (this.stopRequested) return;

    this.processNextJob();

    setTimeout(() => this.pollLoop(), this.pollInterval);
  }

  private async processNextJob(): Promise<void> {
    if (this.activeJobs.size >= this.concurrency) {
      return;
    }

    if (this.stopRequested) return;

    try {
      const job = await this.postgresQueue.getNextJob();

      if (!job) return;

      console.log(`🎯 Processing job: ${job.id} (${job.taskIdentifier})`);

      this.activeJobs.set(job.id, job);

      this.executeTask(job).catch((error) => {
        console.error(`❌ Job ${job.id} failed:`, error);
      });
    } catch (error) {
      console.error('Error fetching job:', error);
    }
  }

  private async executeTask(job: Job): Promise<void> {
    const task = this.tasks[job.taskIdentifier];

    if (!task) {
      console.error(`❌ No handler registered for task: ${job.taskIdentifier}`);
      await this.postgresQueue.failJob(job.id, `No handler for task: ${job.taskIdentifier}`);
      this.activeJobs.delete(job.id);
      return;
    }

    try {
      await task(job.payload, job);
      await this.postgresQueue.completeJob(job.id);
      console.log(`✅ Job completed: ${job.id}`);
    } catch (error: any) {
      console.error(`❌ Job failed: ${job.id}`, error.message || error);

      if (job.attempts >= job.maxAttempts) {
        await this.postgresQueue.failJob(job.id, error.message || String(error));
      } else {
        await this.postgresQueue.releaseJob(job.id);
      }
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping worker...');
    this.stopRequested = true;

    if (this.activeJobs.size > 0) {
      console.log(`   Waiting for ${this.activeJobs.size} active job(s) to finish...`);
    }

    const waitForActive = async () => {
      while (this.activeJobs.size > 0 && !this.stopRequested) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    await waitForActive();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.running = false;
    console.log('✅ Worker stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const worker = new Worker();