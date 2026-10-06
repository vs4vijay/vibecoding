import { z } from 'zod';
import { executeQuery } from '@/lib/db';
import type { JobPayload } from '@/lib/queue/types';

const payloadSchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(['process', 'notify', 'cleanup']).default('process'),
});

export default async function processItem(payload: JobPayload): Promise<void> {
  const { itemId, action } = payloadSchema.parse(payload);

  const items = await executeQuery<{ name: string }>(
    `SELECT name FROM items WHERE id = $1`,
    [itemId]
  );
  const item = items[0];

  if (!item) {
    console.warn(`Item ${itemId} not found`);
    return;
  }

  console.log(`Starting ${action} for: ${item.name}`);

  // Simulated work
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 2000 + 1000));

  await executeQuery(
    `UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [itemId]
  );

  console.log(`Successfully processed item: ${item.name}`);
}
