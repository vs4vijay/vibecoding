import type { TaskRegistry } from '@/lib/queue/types';
import processItem from './process-item';
import sendNotification from './send-notification';

/** Every task the worker can run, keyed by the name used when enqueueing. */
export const tasks: TaskRegistry = {
  'process-item': processItem,
  'send-notification': sendNotification,
};
