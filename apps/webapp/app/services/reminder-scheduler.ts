/**
 * Reminder Scheduler
 *
 * BullMQ queue infrastructure for scheduling and processing reminders.
 * Handles both regular reminders and follow-up reminders.
 */

import { Queue, Worker, type Job } from "bullmq";
import { getRedisConnection } from "~/bullmq/connection";
import { logger } from "./logger.service";
import {
  getActiveReminders,
  getReminderById,
  incrementUnrespondedCount,
  incrementOccurrenceCount,
  scheduleNextOccurrence,
  deactivateReminder,
  cancelAllFollowUpsForWorkspace,
  shouldAskToTurnOff,
  type FollowUpMetadata,
} from "./reminder.server";

// ============================================================================
// Types
// ============================================================================

export interface ReminderJobData {
  reminderId: string;
  workspaceId: string;
  channel: "whatsapp" | "email";
}

export interface FollowUpJobData {
  parentReminderId: string;
  workspaceId: string;
  channel: "whatsapp" | "email";
  action: string;
  originalSentAt: string; // ISO timestamp
}

// ============================================================================
// Queues
// ============================================================================

export const reminderQueue = new Queue<ReminderJobData>("reminder-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

export const followUpQueue = new Queue<FollowUpJobData>("followup-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

// ============================================================================
// Queue Helper Functions
// ============================================================================

/**
 * Schedule next reminder occurrence (delayed job)
 */
export async function scheduleNextReminder(
  reminderId: string,
  workspaceId: string,
  channel: "whatsapp" | "email",
  nextRunAt: Date,
) {
  try {
    const delay = nextRunAt.getTime() - Date.now();

    if (delay <= 0) {
      logger.warn(
        `Reminder ${reminderId} nextRunAt is in the past, scheduling immediately`,
      );
    }

    const jobId = `reminder-${reminderId}-${nextRunAt.getTime()}`;

    await reminderQueue.add(
      `reminder-${reminderId}`,
      { reminderId, workspaceId, channel },
      {
        delay: Math.max(delay, 0),
        jobId,
      },
    );

    logger.info(
      `Scheduled reminder ${reminderId} for ${nextRunAt} (delay: ${delay}ms)`,
    );
  } catch (error) {
    logger.error(`Failed to schedule reminder ${reminderId}`, { error });
    throw error;
  }
}

/**
 * Remove a scheduled reminder by finding jobs with matching reminderId
 */
export async function removeScheduledReminder(reminderId: string) {
  try {
    const delayed = await reminderQueue.getDelayed();
    const waiting = await reminderQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    for (const job of jobs) {
      if (job.data.reminderId === reminderId) {
        await job.remove();
        logger.info(`Removed scheduled reminder job ${job.id}`);
      }
    }
  } catch (error) {
    logger.error(`Failed to remove scheduled reminder ${reminderId}`, {
      error,
    });
  }
}

// ============================================================================
// Workers
// ============================================================================

let reminderWorker: Worker<ReminderJobData> | null = null;
let followUpWorker: Worker<FollowUpJobData> | null = null;

/**
 * Process a reminder job
 *
 * For now, this is a simple processor that:
 * 1. Checks if reminder is still active
 * 2. Updates occurrence count
 * 3. Schedules next occurrence
 *
 * When the full CASE/Decision Agent pipeline is wired up in core,
 * this will be expanded to run through the decision agent.
 */
async function processReminderJob(job: Job<ReminderJobData>) {
  const { reminderId, workspaceId, channel } = job.data;

  try {
    logger.info(
      `Processing reminder ${reminderId} for workspace ${workspaceId} on ${channel}`,
    );

    const reminder = await getReminderById(reminderId);
    if (!reminder || !reminder.isActive) {
      logger.info(`Reminder ${reminderId} is no longer active, skipping`);
      return;
    }

    // Check if this is a follow-up reminder
    const metadata = reminder.metadata as Record<string, unknown> | null;
    const isFollowUp = metadata?.isFollowUp === true;

    if (isFollowUp) {
      // Follow-ups are one-time, deactivate after processing
      await deactivateReminder(reminderId);
      logger.info(`Processed follow-up reminder ${reminderId}`);
    } else {
      // Update counts
      await incrementUnrespondedCount(reminderId);

      const { shouldDeactivate } = await incrementOccurrenceCount(reminderId);
      if (shouldDeactivate) {
        logger.info(`Reminder ${reminderId} has been auto-deactivated`);
        return;
      }

      await scheduleNextOccurrence(reminderId);
      logger.info(`Successfully processed reminder ${reminderId}`);
    }
  } catch (error) {
    logger.error(
      `Failed to process reminder ${reminderId} for workspace ${workspaceId}`,
      { error },
    );
    throw error;
  }
}

/**
 * Process a follow-up job
 */
async function processFollowUpJob(job: Job<FollowUpJobData>) {
  const { parentReminderId, workspaceId, channel, action } = job.data;

  try {
    logger.info(`Processing follow-up for reminder ${parentReminderId}`, {
      workspaceId,
      channel,
      action,
    });

    const reminder = await getReminderById(parentReminderId);
    if (!reminder || !reminder.isActive) {
      logger.info(
        `Parent reminder ${parentReminderId} is no longer active, skipping follow-up`,
      );
      return;
    }

    // For now, just log. When CASE is wired up, this will run through decision agent.
    logger.info(`Follow-up processed for reminder ${parentReminderId}`);
  } catch (error) {
    logger.error(
      `Failed to process follow-up for reminder ${parentReminderId}`,
      { error },
    );
    throw error;
  }
}

// ============================================================================
// Follow-up Scheduling
// ============================================================================

/**
 * Schedule a follow-up job
 */
export async function scheduleFollowUpJob(
  parentReminderId: string,
  workspaceId: string,
  channel: "whatsapp" | "email",
  action: string,
  scheduledFor: Date | string,
): Promise<string | null> {
  try {
    const runAt = parseRelativeTime(scheduledFor);
    if (!runAt) {
      logger.error(`Invalid scheduledFor for follow-up`, {
        scheduledFor,
        parentReminderId,
      });
      return null;
    }

    const delay = runAt.getTime() - Date.now();
    const jobId = `followup-${parentReminderId}-${runAt.getTime()}`;
    const originalSentAt = new Date().toISOString();

    await followUpQueue.add(
      `followup-${parentReminderId}`,
      {
        parentReminderId,
        workspaceId,
        channel,
        action,
        originalSentAt,
      },
      {
        delay: Math.max(delay, 0),
        jobId,
      },
    );

    logger.info(`Scheduled follow-up for reminder ${parentReminderId}`, {
      runAt,
      delay,
      action,
    });

    return jobId;
  } catch (error) {
    logger.error(`Failed to schedule follow-up job`, {
      parentReminderId,
      error,
    });
    return null;
  }
}

/**
 * Cancel all pending follow-ups for a reminder
 */
export async function cancelFollowUpsForReminder(
  reminderId: string,
): Promise<number> {
  try {
    const delayed = await followUpQueue.getDelayed();
    const waiting = await followUpQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    let cancelledCount = 0;
    for (const job of jobs) {
      if (job.data.parentReminderId === reminderId) {
        await job.remove();
        cancelledCount++;
        logger.info(
          `Cancelled follow-up job ${job.id} for reminder ${reminderId}`,
        );
      }
    }

    return cancelledCount;
  } catch (error) {
    logger.error(`Failed to cancel follow-ups for reminder ${reminderId}`, {
      error,
    });
    return 0;
  }
}

/**
 * Cancel all pending follow-ups for a workspace
 */
export async function cancelFollowUpsForWorkspace(
  workspaceId: string,
): Promise<number> {
  try {
    const delayed = await followUpQueue.getDelayed();
    const waiting = await followUpQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    let cancelledCount = 0;
    for (const job of jobs) {
      if (job.data.workspaceId === workspaceId) {
        await job.remove();
        cancelledCount++;
      }
    }

    if (cancelledCount > 0) {
      logger.info(
        `Cancelled ${cancelledCount} follow-up(s) for workspace ${workspaceId}`,
      );
    }

    return cancelledCount;
  } catch (error) {
    logger.error(`Failed to cancel follow-ups for workspace ${workspaceId}`, {
      error,
    });
    return 0;
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Check if a reminder job exists and is pending/delayed
 */
async function hasScheduledJob(reminderId: string): Promise<boolean> {
  try {
    const delayed = await reminderQueue.getDelayed();
    const waiting = await reminderQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    return jobs.some((job) => job.data.reminderId === reminderId);
  } catch {
    return false;
  }
}

/**
 * Initialize reminder scheduler - start workers and recover missed jobs
 */
export async function initializeReminderScheduler() {
  try {
    logger.info("Initializing reminder scheduler...");

    // Start reminder worker
    if (!reminderWorker) {
      reminderWorker = new Worker<ReminderJobData>(
        "reminder-queue",
        processReminderJob,
        {
          connection: getRedisConnection(),
          concurrency: 10,
        },
      );

      reminderWorker.on("completed", (job) => {
        logger.info(`Reminder job ${job.id} completed`);
      });

      reminderWorker.on("failed", (job, err) => {
        logger.error(`Reminder job ${job?.id} failed:`, { error: err });
      });
    }

    // Start follow-up worker
    if (!followUpWorker) {
      followUpWorker = new Worker<FollowUpJobData>(
        "followup-queue",
        processFollowUpJob,
        {
          connection: getRedisConnection(),
          concurrency: 5,
        },
      );

      followUpWorker.on("completed", (job) => {
        logger.info(`Follow-up job ${job.id} completed`);
      });

      followUpWorker.on("failed", (job, err) => {
        logger.error(`Follow-up job ${job?.id} failed:`, { error: err });
      });
    }

    // Recover missed reminders
    const reminders = await getActiveReminders();
    logger.info(`Found ${reminders.length} active reminders`);

    for (const reminder of reminders) {
      const hasJob = await hasScheduledJob(reminder.id);

      if (!hasJob && reminder.nextRunAt) {
        const now = new Date();
        if (reminder.nextRunAt < now) {
          logger.info(
            `Reminder ${reminder.id} missed (was ${reminder.nextRunAt}), triggering now`,
          );
          await scheduleNextReminder(
            reminder.id,
            reminder.workspaceId,
            reminder.channel as "whatsapp" | "email",
            now,
          );
        } else {
          await scheduleNextReminder(
            reminder.id,
            reminder.workspaceId,
            reminder.channel as "whatsapp" | "email",
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
 * Gracefully close reminder scheduler
 */
export async function closeReminderScheduler() {
  try {
    logger.info("Closing reminder scheduler...");

    if (reminderWorker) {
      await reminderWorker.close();
      reminderWorker = null;
    }

    if (followUpWorker) {
      await followUpWorker.close();
      followUpWorker = null;
    }

    await reminderQueue.close();
    await followUpQueue.close();

    logger.info("Reminder scheduler closed");
  } catch (error) {
    logger.error("Error closing reminder scheduler", { error });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse relative time strings like "in 30 minutes", "in 1 hour"
 */
function parseRelativeTime(scheduledFor: Date | string): Date | null {
  if (scheduledFor instanceof Date) {
    return scheduledFor;
  }

  const isoDate = new Date(scheduledFor);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const relativeMatch = scheduledFor.match(
    /in\s+(\d+)\s*(min(?:ute)?s?|hour?s?|h|m)/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();

    const now = new Date();
    if (unit.startsWith("h")) {
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    } else {
      return new Date(now.getTime() + amount * 60 * 1000);
    }
  }

  logger.warn(`Could not parse scheduledFor: ${scheduledFor}`);
  return null;
}
