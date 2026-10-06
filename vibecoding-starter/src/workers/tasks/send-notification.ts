import { z } from 'zod';
import type { JobPayload } from '@/lib/queue/types';

const payloadSchema = z.object({
  type: z.enum(['email', 'sms', 'push', 'webhook']),
  recipient: z.string().min(1),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export default async function sendNotification(payload: JobPayload): Promise<void> {
  const notification = payloadSchema.parse(payload);

  console.log(`Sending ${notification.type} notification to: ${notification.recipient}`);

  // Simulated delivery
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('Notification sent successfully', notification);
}
