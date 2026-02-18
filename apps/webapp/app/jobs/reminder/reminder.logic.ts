/**
 * Reminder Processing Logic
 *
 * Common business logic for processing reminders, shared between
 * Trigger.dev and BullMQ implementations.
 */

import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";

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

export interface ReminderProcessResult {
  success: boolean;
  shouldDeactivate?: boolean;
  isFollowUp?: boolean;
  error?: string;
}

// ============================================================================
// Business Logic
// ============================================================================

/**
 * Process a reminder job
 *
 * This handles:
 * 1. Checking if reminder is still active
 * 2. Updating occurrence/unresponded counts
 * 3. Scheduling next occurrence via callback
 *
 * @param data - Reminder job data
 * @param scheduleNextOccurrence - Callback to schedule the next occurrence
 * @param deactivateReminder - Callback to deactivate the reminder
 */
export async function processReminderJob(
  data: ReminderJobData,
  scheduleNextOccurrence: (reminderId: string) => Promise<boolean>,
  deactivateReminder: (reminderId: string) => Promise<void>,
): Promise<ReminderProcessResult> {
  const { reminderId, workspaceId, channel } = data;

  try {
    logger.info(
      `Processing reminder ${reminderId} for workspace ${workspaceId} on ${channel}`,
    );

    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder || !reminder.isActive) {
      logger.info(`Reminder ${reminderId} is no longer active, skipping`);
      return { success: true };
    }

    // Check if this is a follow-up reminder
    const metadata = reminder.metadata as Record<string, unknown> | null;
    const isFollowUp = metadata?.isFollowUp === true;

    if (isFollowUp) {
      // Follow-ups are one-time, deactivate after processing
      await deactivateReminder(reminderId);
      logger.info(`Processed follow-up reminder ${reminderId}`);
      return { success: true, isFollowUp: true };
    }

    // Update unresponded count
    await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        unrespondedCount: { increment: 1 },
        lastSentAt: new Date(),
      },
    });

    // Increment occurrence count and check for auto-deactivation
    const updatedReminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: { occurrenceCount: { increment: 1 } },
    });

    const shouldDeactivate = checkShouldDeactivate(updatedReminder);

    if (shouldDeactivate) {
      await deactivateReminder(reminderId);
      logger.info(`Reminder ${reminderId} has been auto-deactivated`);
      return { success: true, shouldDeactivate: true };
    }

    // Schedule next occurrence
    await scheduleNextOccurrence(reminderId);
    logger.info(`Successfully processed reminder ${reminderId}`);

    return { success: true };
  } catch (error) {
    logger.error(
      `Failed to process reminder ${reminderId} for workspace ${workspaceId}`,
      { error },
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Process a follow-up job
 */
export async function processFollowUpJob(
  data: FollowUpJobData,
): Promise<ReminderProcessResult> {
  const { parentReminderId, workspaceId, channel, action } = data;

  try {
    logger.info(`Processing follow-up for reminder ${parentReminderId}`, {
      workspaceId,
      channel,
      action,
    });

    const reminder = await prisma.reminder.findUnique({
      where: { id: parentReminderId },
    });

    if (!reminder || !reminder.isActive) {
      logger.info(
        `Parent reminder ${parentReminderId} is no longer active, skipping follow-up`,
      );
      return { success: true };
    }

    // For now, just log. When CASE is wired up, this will run through decision agent.
    logger.info(`Follow-up processed for reminder ${parentReminderId}`);

    return { success: true };
  } catch (error) {
    logger.error(
      `Failed to process follow-up for reminder ${parentReminderId}`,
      { error },
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if reminder should be auto-deactivated
 */
function checkShouldDeactivate(reminder: {
  occurrenceCount: number;
  maxOccurrences: number | null;
  endDate: Date | null;
}): boolean {
  if (
    reminder.maxOccurrences !== null &&
    reminder.maxOccurrences > 0 &&
    reminder.occurrenceCount >= reminder.maxOccurrences
  ) {
    return true;
  }

  if (reminder.endDate !== null && new Date() >= reminder.endDate) {
    return true;
  }

  return false;
}

/**
 * Parse relative time strings like "in 30 minutes", "in 1 hour"
 */
export function parseRelativeTime(scheduledFor: Date | string): Date | null {
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
