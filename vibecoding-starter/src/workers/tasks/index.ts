import { Worker } from '@/lib/queue/worker';
import processItemTask from './process-item';
import sendNotificationTask from './send-notification';

export function registerAllTasks(worker: Worker): void {
  worker.registerTask('process-item', processItemTask);
  worker.registerTask('send-notification', sendNotificationTask);
}