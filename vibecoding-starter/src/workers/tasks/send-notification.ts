import { Task } from 'graphile-worker';

/**
 * Example background task: Send notification
 *
 * Demonstrates a notification task that could:
 * - Send emails
 * - Push notifications
 * - Slack/Discord webhooks
 * - SMS messages
 * etc.
 */

interface NotificationPayload {
  type: 'email' | 'sms' | 'push' | 'webhook';
  recipient: string;
  message: string;
  metadata?: Record<string, any>;
}

const sendNotification: Task = async (payload, helpers) => {
  const { type, recipient, message, metadata } = payload as NotificationPayload;

  helpers.logger.info(`Sending ${type} notification to: ${recipient}`);

  try {
    // Simulate notification sending
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // In a real app, you would:
    // - Call email service (SendGrid, Resend, etc.)
    // - Call SMS service (Twilio, etc.)
    // - Call push notification service (FCM, APNs, etc.)
    // - Call webhook URL

    helpers.logger.info(`✅ Notification sent successfully`, {
      type,
      recipient,
      metadata,
    });
  } catch (error) {
    helpers.logger.error(`❌ Failed to send notification:`, { error });
    throw error;
  }
};

export default sendNotification;
