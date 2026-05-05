import { JobPayload, Job } from '@/lib/queue/types';

interface NotificationPayload extends JobPayload {
  type: 'email' | 'sms' | 'push' | 'webhook';
  recipient: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export default async function sendNotification(payload: JobPayload, _job: Job): Promise<void> {
  const { type, recipient, message, metadata } = payload as NotificationPayload;

  console.log(`Sending ${type} notification to: ${recipient}`);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(`Notification sent successfully`, {
    type,
    recipient,
    message,
    metadata,
  });
}