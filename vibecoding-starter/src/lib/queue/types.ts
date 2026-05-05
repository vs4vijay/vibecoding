export type JobStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface JobPayload {
  [key: string]: unknown;
}

export interface JobOptions {
  runAt?: Date;
  maxAttempts?: number;
  priority?: number;
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
  queue: string | null;
}

export interface IQueue {
  enqueue<T extends JobPayload = JobPayload>(
    taskIdentifier: string,
    payload: T,
    options?: JobOptions
  ): Promise<Job>;

  getJob(id: string): Promise<Job | null>;

  getJobs(filters?: {
    status?: JobStatus;
    queue?: string;
    limit?: number;
    offset?: number;
  }): Promise<Job[]>;

  completeJob(id: string): Promise<void>;

  failJob(id: string, error: string): Promise<void>;

  releaseJob(id: string): Promise<void>;

  deleteJob(id: string): Promise<void>;
}

export interface IWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface TaskHandler {
  (payload: JobPayload, job: Job): Promise<void>;
}

export interface TaskRegistry {
  [taskIdentifier: string]: TaskHandler;
}

export interface WorkerOptions {
  concurrency?: number;
  pollInterval?: number;
  maxAttempts?: number;
}