import { JobPayload, Job } from '@/lib/queue/types';
import { executeQuery } from '@/lib/db';

interface ProcessItemPayload extends JobPayload {
  itemId: string;
  action?: 'process' | 'notify' | 'cleanup';
}

interface Item {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export default async function processItem(payload: JobPayload, _job: Job): Promise<void> {
  const { itemId, action = 'process' } = payload as ProcessItemPayload;

  console.log(`Processing item ${itemId} with action: ${action}`);

  const items = await executeQuery<Item>(
    `SELECT * FROM items WHERE id = $1`,
    [itemId]
  );
  const item = items[0];

  if (!item) {
    console.warn(`Item ${itemId} not found`);
    return;
  }

  console.log(`Starting ${action} for: ${item.name}`);

  await new Promise((resolve) => setTimeout(resolve, Math.random() * 2000 + 1000));

  await executeQuery(
    `UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [itemId]
  );

  console.log(`Successfully processed item: ${item.name}`);
}