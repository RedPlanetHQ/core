/**
 * Reminder Scheduler
 *
 * Initialization and recovery logic for the reminder system.
 * Queue and worker definitions are in bullmq/queues and bullmq/workers.
 */

import { env } from "~/env.server";
import { logger } from "./logger.service";
import { prisma } from "../db.server";
import { enqueueReminder } from "~/lib/queue-adapter.server";

// ============================================================================
// Initialization
// ============================================================================

/**
 * Check if a reminder job exists and is pending/delayed (BullMQ only)
 */
async function hasScheduledJob(reminderId: string): Promise<boolean> {
  if (env.QUEUE_PROVIDER === "trigger") {
    // Trigger.dev handles job idempotency via idempotencyKey
    return false;
  }

  try {
    const { reminderQueue } = await import("~/bullmq/queues");
    const delayed = await reminderQueue.getDelayed();
    const waiting = await reminderQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    return jobs.some((job) => job.data.reminderId === reminderId);
  } catch {
    return false;
  }
}

/**
 * Initialize reminder scheduler - recover missed jobs on startup
 */
export async function initializeReminderScheduler() {
  try {
    logger.info("Initializing reminder scheduler...");

    // Get all active reminders
    const reminders = await prisma.reminder.findMany({
      where: { isActive: true },
    });

    logger.info(`Found ${reminders.length} active reminders`);

    // Recover missed reminders
    for (const reminder of reminders) {
      const hasJob = await hasScheduledJob(reminder.id);

      if (!hasJob && reminder.nextRunAt) {
        const now = new Date();
        if (reminder.nextRunAt < now) {
          logger.info(
            `Reminder ${reminder.id} missed (was ${reminder.nextRunAt}), triggering now`,
          );
          await enqueueReminder(
            {
              reminderId: reminder.id,
              workspaceId: reminder.workspaceId,
              channel: reminder.channel as "whatsapp" | "email",
            },
            now,
          );
        } else {
          await enqueueReminder(
            {
              reminderId: reminder.id,
              workspaceId: reminder.workspaceId,
              channel: reminder.channel as "whatsapp" | "email",
            },
            reminder.nextRunAt,
          );
        }
      }
    }

    logger.info("Reminder scheduler initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize reminder scheduler", { error });
    throw error;
  }
}

/**
 * Gracefully close reminder scheduler (BullMQ only)
 * Note: Queue and worker cleanup is handled in bullmq/workers/index.ts closeAllWorkers()
 */
export async function closeReminderScheduler() {
  logger.info("Reminder scheduler closed");
}
