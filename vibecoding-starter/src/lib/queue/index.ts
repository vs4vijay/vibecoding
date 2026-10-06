import { PostgresQueue } from './postgres-queue';
import type { IQueue } from './types';

export * from './types';
export { Worker } from './worker';

/** The queue used by the app and the worker. Swap the backend by changing this one line. */
export const queue: IQueue = new PostgresQueue();
