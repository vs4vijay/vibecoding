import { Task } from 'graphile-worker';
import { executeQuery } from '@/lib/db';

/**
 * Example background task: Process an item
 *
 * This demonstrates a simple async task that could represent any background work:
 * - Data processing
 * - Sending notifications
 * - External API calls
 * - Image processing
 * - Report generation
 * etc.
 */

interface ProcessItemPayload {
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

const processItem: Task = async (payload, helpers) => {
  const { itemId, action = 'process' } = payload as ProcessItemPayload;

  helpers.logger.info(`Processing item ${itemId} with action: ${action}`);

  try {
    // Fetch the item from database
    const items = await executeQuery<Item>(
      `SELECT * FROM items WHERE id = $1`,
      [itemId]
    );
    const item = items[0];

    if (!item) {
      helpers.logger.warn(`Item ${itemId} not found`);
      return;
    }

    // Simulate some async work
    helpers.logger.info(`Starting ${action} for: ${item.name}`);

    // Simulate processing time (1-3 seconds)
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 2000 + 1000));

    // Example: Update item to mark as processed
    await executeQuery(
      `UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [itemId]
    );

    helpers.logger.info(`✅ Successfully processed item: ${item.name}`);
  } catch (error) {
    helpers.logger.error(`❌ Failed to process item ${itemId}:`, { error });
    throw error; // Re-throw to trigger retry mechanism
  }
};

export default processItem;
