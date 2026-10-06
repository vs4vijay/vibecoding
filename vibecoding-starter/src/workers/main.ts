import { getPool } from '@/lib/db';
import { queue, Worker } from '@/lib/queue';
import { tasks } from './tasks';

const worker = new Worker(queue, tasks);

async function shutdown() {
  await worker.stop();
  await getPool().end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await worker.start();
