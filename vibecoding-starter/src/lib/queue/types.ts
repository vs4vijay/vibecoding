export const JOB_STATUSES = ['pending', 'active', 'completed', 'failed'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobPayload = Record<string, unknown>;

export interface JobOptions {
  runAt?: Date;
  maxAttempts?: number;
  priority?: number;
  /** At most one unfinished job may hold a given key; enqueueing a duplicate throws. */
  jobKey?: string;
  queue?: string;
}

export interface Job {
  id: string;
  taskIdentifier: string;
  payload: JobPayload;
  status: JobStatus;
  priority: number;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  completedAt: Date | null;
  key: string | null;
  queue: string | null;
}

export interface JobFilters {
  status?: JobStatus;
  queue?: string;
  limit?: number;
  offset?: number;
}

/**
 * The full contract between the app, the worker, and a queue backend.
 * Implement this interface and export it from `src/lib/queue/index.ts` to swap backends.
 */
export interface IQueue {
  enqueue(taskIdentifier: string, payload: JobPayload, options?: JobOptions): Promise<Job>;

  getJob(id: string): Promise<Job | null>;

  /** Newest jobs first. */
  getJobs(filters?: JobFilters): Promise<Job[]>;

  countJobs(): Promise<Record<JobStatus, number>>;

  /** Atomically lock the next runnable job for this worker, or return null when none is due. */
  claimJob(workerId: string): Promise<Job | null>;

  completeJob(id: string): Promise<void>;

  /** Record the error and either schedule a retry or mark the job failed once attempts run out. */
  failJob(id: string, error: string): Promise<void>;

  deleteJob(id: string): Promise<void>;

  /**
   * Call `onJob` whenever a job is enqueued so workers can skip the poll delay.
   * Returns an unsubscribe function. Backends without push can return a no-op;
   * the worker always polls as well.
   */
  subscribe(onJob: () => void): Promise<() => Promise<void>>;
}

export type TaskHandler = (payload: JobPayload, job: Job) => Promise<void>;

export type TaskRegistry = Record<string, TaskHandler>;

export interface WorkerOptions {
  concurrency?: number;
  pollInterval?: number;
}
