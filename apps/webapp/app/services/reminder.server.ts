import { RRule } from "rrule";
import { DateTime } from "luxon";
import { type Prisma, prisma } from "../db.server";

import {
  enqueueReminder,
  removeScheduledReminder,
} from "~/lib/queue-adapter.server";
import { logger } from "./logger.service";

export interface ReminderData {
  text: string;
  schedule: string; // RRule string (in user's local timezone)
  channel: "whatsapp" | "email";
  isActive?: boolean;
  maxOccurrences?: number | null;
  endDate?: Date | null;
  startDate?: Date | null; // Don't fire before this date (for "tomorrow at X" reminders)
  metadata?: Prisma.InputJsonValue | null; // Optional metadata (e.g., follow-up info)
}

export interface ReminderUpdateData {
  text?: string;
  schedule?: string;
  channel?: "whatsapp" | "email";
  isActive?: boolean;
  maxOccurrences?: number | null;
  endDate?: Date | null;
}

/**
 * Compute next run time from RRule string.
 * RRule is interpreted in user's local timezone, returns UTC Date.
 *
 * @param rruleString - RRule string with times in user's local timezone (e.g., BYHOUR=9 means 9am local)
 * @param timezone - User's IANA timezone (e.g., "Asia/Kolkata")
 * @param after - Find next occurrence after this time (default: now)
 * @returns Next occurrence as UTC Date, or null if no more occurrences
 */
export function computeNextRun(
  rruleString: string,
  timezone: string = "UTC",
  after: Date = new Date(),
): Date | null {
  try {
    const options = RRule.parseString(rruleString);

    // Convert 'after' to user's timezone to find the right occurrence
    const afterInUserTz = DateTime.fromJSDate(after).setZone(timezone);

    // Set dtstart to 'after' in the user's timezone context
    // This ensures RRule computes occurrences relative to user's local time
    if (!options.dtstart) {
      options.dtstart = afterInUserTz.toJSDate();
    }

    // If BYHOUR is specified, we need to handle timezone conversion
    if (options.byhour !== undefined && options.byhour !== null) {
      const hours: number[] = Array.isArray(options.byhour)
        ? options.byhour
        : [options.byhour];
      const minutes: number[] =
        options.byminute !== undefined && options.byminute !== null
          ? Array.isArray(options.byminute)
            ? options.byminute
            : [options.byminute]
          : [0];

      // Find the next occurrence by checking each hour/minute combination
      // Start from the beginning of the current day in user's timezone
      const checkDate = afterInUserTz.startOf("day");

      // Check up to 400 days ahead to handle yearly patterns
      for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
        const currentDay = checkDate.plus({ days: dayOffset });

        // Check if this day matches the RRule pattern (weekday, monthday, etc.)
        // We check by seeing if the day's date appears in the rule's next occurrences
        const dayCheckRule = new RRule({
          ...options,
          byhour: [12], // Use noon to avoid DST issues
          byminute: [0],
          dtstart: checkDate.toJSDate(),
        });

        // Get the next few occurrences and check if any fall on currentDay
        const nextFewDates = dayCheckRule.between(
          currentDay.startOf("day").toJSDate(),
          currentDay.endOf("day").toJSDate(),
          true,
        );

        if (nextFewDates.length === 0) continue;

        // Check each hour/minute combination for this day
        // Sort to find earliest time first
        const candidates: DateTime[] = [];
        for (const hour of hours) {
          for (const minute of minutes) {
            const candidate = currentDay.set({
              hour,
              minute,
              second: 0,
              millisecond: 0,
            });

            // Must be after the 'after' time
            if (candidate > afterInUserTz) {
              candidates.push(candidate);
            }
          }
        }

        // If we found candidates for this day, return the earliest
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.toMillis() - b.toMillis());
          const earliest = candidates[0];
          // Convert from user's timezone to UTC
          return earliest.toUTC().toJSDate();
        }
      }

      return null;
    }

    // For non-time-specific rules (no BYHOUR), these are relative time reminders
    // "in 2 min", "in 1 hour", "in 1 day" - add interval to now
    const interval = options.interval || 1;
    let nextRun: DateTime;

    if (options.freq === RRule.MINUTELY) {
      nextRun = afterInUserTz.plus({ minutes: interval });
    } else if (options.freq === RRule.HOURLY) {
      nextRun = afterInUserTz.plus({ hours: interval });
    } else if (options.freq === RRule.DAILY) {
      nextRun = afterInUserTz.plus({ days: interval });
    } else if (options.freq === RRule.WEEKLY) {
      nextRun = afterInUserTz.plus({ weeks: interval });
    } else {
      // Fallback to RRule for other frequencies
      const rule = new RRule(options);
      return rule.after(after, false);
    }

    return nextRun.toUTC().toJSDate();
  } catch (error) {
    logger.error("Failed to compute next run", {
      rruleString,
      timezone,
      error,
    });
    return null;
  }
}

/**
 * Add a new reminder for a workspace
 * Schedule is stored as-is (in user's local timezone)
 * nextRunAt is computed and stored in UTC
 */
export async function addReminder(
  workspaceId: string,
  data: ReminderData,
): Promise<{
  id: string;
  text: string;
  schedule: string;
  nextRunAt: Date | null;
}> {
  try {
    // Get user's timezone from workspace's user metadata
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { UserWorkspace: { include: { user: true }, take: 1 } },
    });
    const user = workspace?.UserWorkspace[0]?.user;
    const metadata = user?.metadata as Record<string, unknown> | null;
    const timezone = (metadata?.timezone as string) ?? "UTC";

    // Determine the "after" time for computing next run
    // If startDate is provided, use start of that day in user's timezone
    // This prevents "tomorrow at 2pm" from firing today at 2pm
    let afterTime = new Date();
    if (data.startDate) {
      const startInUserTz = DateTime.fromJSDate(data.startDate)
        .setZone(timezone)
        .startOf("day");
      afterTime = startInUserTz.toJSDate();
    }

    // Store schedule as-is (user's local timezone)
    // Compute nextRunAt in UTC, starting from afterTime
    const nextRunAt = computeNextRun(data.schedule, timezone, afterTime);

    logger.info(
      `Creating reminder with schedule ${data.schedule} (${timezone}), startDate: ${data.startDate}, next run: ${nextRunAt}`,
    );

    const reminder = await prisma.reminder.create({
      data: {
        workspaceId,
        text: data.text,
        schedule: data.schedule, // Store as-is (local timezone)
        startDate: data.startDate ?? null,
        nextRunAt,
        channel: data.channel,
        isActive: data.isActive ?? true,
        unrespondedCount: 0,
        maxOccurrences: data.maxOccurrences ?? null,
        occurrenceCount: 0,
        endDate: data.endDate ?? null,
        metadata: data.metadata ?? undefined,
      },
    });

    // Schedule job
    if (reminder.isActive && nextRunAt) {
      await enqueueReminder(
        {
          reminderId: reminder.id,
          workspaceId,
          channel: reminder.channel as "whatsapp" | "email",
        },
        nextRunAt,
      );
    }

    logger.info(
      `Created reminder ${reminder.id} for workspace ${workspaceId}, next run: ${nextRunAt}`,
    );
    return {
      id: reminder.id,
      text: reminder.text,
      schedule: reminder.schedule,
      nextRunAt,
    };
  } catch (error) {
    logger.error("Failed to create reminder", { error });
    throw new Error("Failed to create reminder");
  }
}

/**
 * Update an existing reminder
 */
export async function updateReminder(
  reminderId: string,
  workspaceId: string,
  data: ReminderUpdateData,
): Promise<{
  id: string;
  text: string;
  schedule: string;
  nextRunAt: Date | null;
}> {
  try {
    const existing = await prisma.reminder.findFirst({
      where: { id: reminderId, workspaceId },
      include: {
        workspace: {
          include: { UserWorkspace: { include: { user: true }, take: 1 } },
        },
      },
    });

    if (!existing) {
      throw new Error("Reminder not found or access denied");
    }

    const user = existing.workspace?.UserWorkspace[0]?.user;
    const metadata = user?.metadata as Record<string, unknown> | null;
    const timezone = (metadata?.timezone as string) ?? "UTC";

    // Use new schedule or keep existing
    const schedule = data.schedule ?? existing.schedule;

    // Compute new nextRunAt if schedule changed
    const nextRunAt = data.schedule
      ? computeNextRun(schedule, timezone)
      : existing.nextRunAt;

    const reminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        ...(data.text !== undefined && { text: data.text }),
        ...(data.schedule !== undefined && { schedule, nextRunAt }),
        ...(data.channel !== undefined && { channel: data.channel }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.maxOccurrences !== undefined && {
          maxOccurrences: data.maxOccurrences,
        }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
      },
    });

    // Reschedule job
    await removeScheduledReminder(reminderId);
    if (reminder.isActive && reminder.nextRunAt) {
      await enqueueReminder(
        {
          reminderId: reminder.id,
          workspaceId,
          channel: reminder.channel as "whatsapp" | "email",
        },
        reminder.nextRunAt,
      );
    }

    logger.info(`Updated reminder ${reminder.id} for workspace ${workspaceId}`);
    return {
      id: reminder.id,
      text: reminder.text,
      schedule: reminder.schedule,
      nextRunAt: reminder.nextRunAt,
    };
  } catch (error) {
    logger.error("Failed to update reminder", { error });
    throw new Error(
      error instanceof Error ? error.message : "Failed to update reminder",
    );
  }
}

/**
 * Delete a reminder
 */
export async function deleteReminder(
  reminderId: string,
  workspaceId: string,
): Promise<{ success: boolean }> {
  try {
    const existing = await prisma.reminder.findFirst({
      where: { id: reminderId, workspaceId },
    });

    if (!existing) {
      throw new Error("Reminder not found or access denied");
    }

    await prisma.reminder.delete({
      where: { id: reminderId },
    });

    await removeScheduledReminder(reminderId);

    logger.info(`Deleted reminder ${reminderId} for workspace ${workspaceId}`);
    return { success: true };
  } catch (error) {
    logger.error("Failed to delete reminder", { error });
    throw new Error(
      error instanceof Error ? error.message : "Failed to delete reminder",
    );
  }
}

/**
 * Get all active reminders for a workspace
 */
export async function getWorkspaceReminders(workspaceId: string) {
  try {
    return await prisma.reminder.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    logger.error("Failed to get workspace reminders", { error });
    return [];
  }
}

/**
 * Get all active reminders
 */
export async function getActiveReminders() {
  try {
    return await prisma.reminder.findMany({
      where: { isActive: true },
    });
  } catch (error) {
    logger.error("Failed to get active reminders", { error });
    return [];
  }
}

/**
 * Get reminder by ID
 */
export async function getReminderById(reminderId: string) {
  try {
    return await prisma.reminder.findUnique({
      where: { id: reminderId },
    });
  } catch (error) {
    logger.error("Failed to get reminder", { error });
    return null;
  }
}

/**
 * Update nextRunAt and schedule next occurrence
 */
export async function scheduleNextOccurrence(
  reminderId: string,
): Promise<boolean> {
  try {
    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
      include: {
        workspace: {
          include: { UserWorkspace: { include: { user: true }, take: 1 } },
        },
      },
    });

    if (!reminder || !reminder.isActive) {
      return false;
    }

    const user = reminder.workspace?.UserWorkspace[0]?.user;
    const metadata = user?.metadata as Record<string, unknown> | null;
    const timezone = (metadata?.timezone as string) ?? "UTC";

    // Compute next run from now (schedule is in user's local timezone)
    const nextRunAt = computeNextRun(reminder.schedule, timezone);

    if (!nextRunAt) {
      logger.info(`No more occurrences for reminder ${reminderId}`);
      await deactivateReminder(reminderId);
      return false;
    }

    // Check if next run is past endDate
    if (reminder.endDate && nextRunAt > reminder.endDate) {
      logger.info(`Reminder ${reminderId} past endDate, deactivating`);
      await deactivateReminder(reminderId);
      return false;
    }

    await prisma.reminder.update({
      where: { id: reminderId },
      data: { nextRunAt },
    });

    await enqueueReminder(
      {
        reminderId,
        workspaceId: reminder.workspaceId,
        channel: reminder.channel as "whatsapp" | "email",
      },
      nextRunAt,
    );

    logger.info(
      `Scheduled next occurrence for reminder ${reminderId} at ${nextRunAt}`,
    );
    return true;
  } catch (error) {
    logger.error("Failed to schedule next occurrence", { error });
    return false;
  }
}

/**
 * Increment unresponded count for a reminder
 */
export async function incrementUnrespondedCount(reminderId: string) {
  try {
    const reminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        unrespondedCount: { increment: 1 },
        lastSentAt: new Date(),
      },
    });

    logger.info(
      `Incremented unresponded count for reminder ${reminderId}: ${reminder.unrespondedCount}`,
    );
    return reminder;
  } catch (error) {
    logger.error("Failed to increment unresponded count", { error });
    throw error;
  }
}

/**
 * Reset unresponded count for a reminder
 */
export async function resetUnrespondedCount(reminderId: string) {
  try {
    await prisma.reminder.update({
      where: { id: reminderId },
      data: { unrespondedCount: 0 },
    });
    logger.info(`Reset unresponded count for reminder ${reminderId}`);
  } catch (error) {
    logger.error("Failed to reset unresponded count", { error });
  }
}

/**
 * Mark reminder as confirmed active - user said "yes" to keep it
 * This prevents future "keep this active?" prompts
 */
export async function confirmReminderActive(
  reminderId: string,
  workspaceId: string,
) {
  try {
    await prisma.reminder.update({
      where: { id: reminderId, workspaceId },
      data: { confirmedActive: true, unrespondedCount: 0 },
    });
    logger.info(`Confirmed reminder ${reminderId} as active`);
  } catch (error) {
    logger.error("Failed to confirm reminder active", { error });
    throw error;
  }
}

/**
 * Check if reminder should ask about turning off
 * Only asks if user hasn't confirmed they want to keep it
 * Asks at 5, then 10, 20, 40, 80... (exponential backoff)
 */
export function shouldAskToTurnOff(
  unrespondedCount: number,
  confirmedActive: boolean,
): boolean {
  if (confirmedActive) return false;
  if (unrespondedCount < 5) return false;

  // First ask at 5, then exponential: 5 + 5*2^n = 10, 20, 40, 80...
  // Check if count is 5 or matches 5 + 5*2^n for some n >= 0
  if (unrespondedCount === 5) return true;

  const adjusted = unrespondedCount - 5;
  // Check if adjusted is 5 * 2^n (i.e., 5, 10, 20, 40...)
  if (adjusted >= 5 && adjusted % 5 === 0) {
    const ratio = adjusted / 5;
    // Check if ratio is a power of 2
    return ratio > 0 && (ratio & (ratio - 1)) === 0;
  }
  return false;
}

/**
 * Increment occurrence count and check for auto-deactivation
 */
export async function incrementOccurrenceCount(
  reminderId: string,
): Promise<{ reminder: any; shouldDeactivate: boolean }> {
  try {
    const reminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: { occurrenceCount: { increment: 1 } },
    });

    const shouldDeactivate = checkShouldDeactivate(reminder);

    if (shouldDeactivate) {
      await deactivateReminder(reminderId);
      logger.info(
        `Auto-deactivated reminder ${reminderId} (occurrences: ${reminder.occurrenceCount}/${reminder.maxOccurrences})`,
      );
    }

    return { reminder, shouldDeactivate };
  } catch (error) {
    logger.error("Failed to increment occurrence count", { error });
    throw error;
  }
}

/**
 * Check if reminder should be auto-deactivated
 * Only deactivates based on maxOccurrences (if set and > 0) or endDate
 * Never auto-deactivates based on unresponded count
 */
export function checkShouldDeactivate(reminder: {
  occurrenceCount: number;
  maxOccurrences: number | null;
  endDate: Date | null;
}): boolean {
  // Only deactivate if maxOccurrences is explicitly set and > 0
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
 * Deactivate a reminder
 */
export async function deactivateReminder(reminderId: string): Promise<void> {
  try {
    await prisma.reminder.update({
      where: { id: reminderId },
      data: { isActive: false, nextRunAt: null },
    });

    await removeScheduledReminder(reminderId);

    logger.info(`Deactivated reminder ${reminderId}`);
  } catch (error) {
    logger.error("Failed to deactivate reminder", { error });
    throw error;
  }
}

/**
 * Recalculate all reminder nextRunAt when user's timezone changes.
 * Since schedule is stored in user's local timezone, we just recompute nextRunAt
 * using the new timezone.
 */
/**
 * Follow-up reminder metadata structure
 */
export interface FollowUpMetadata {
  isFollowUp: true;
  parentReminderId: string;
  originalSentAt: string; // ISO timestamp
  followUpAction: string; // What this follow-up is checking
  [key: string]: any; // Index signature for Prisma JSON compatibility
}

/**
 * Get pending follow-up reminders for a workspace
 * Used by Sol to weave follow-ups into conversation naturally
 */
export async function getPendingFollowUpReminders(workspaceId: string): Promise<
  Array<{
    id: string;
    parentReminderId: string;
    action: string;
    originalSentAt: Date;
    scheduledFor: Date;
  }>
> {
  try {
    const reminders = await prisma.reminder.findMany({
      where: {
        workspaceId,
        isActive: true,
        nextRunAt: { not: null },
      },
    });

    // Filter to only follow-ups and map to expected shape
    return reminders
      .filter((r) => {
        const meta = r.metadata as Record<string, unknown> | null;
        return meta?.isFollowUp === true;
      })
      .map((r) => {
        const meta = r.metadata as unknown as FollowUpMetadata;
        return {
          id: r.id,
          parentReminderId: meta.parentReminderId,
          action: meta.followUpAction,
          originalSentAt: new Date(meta.originalSentAt),
          scheduledFor: r.nextRunAt!,
        };
      });
  } catch (error) {
    logger.error("Failed to get pending follow-up reminders", {
      workspaceId,
      error,
    });
    return [];
  }
}

/**
 * Cancel (deactivate) all pending follow-ups for a parent reminder
 * Called when user responds to the original reminder
 */
export async function cancelFollowUpsForParentReminder(
  parentReminderId: string,
): Promise<number> {
  try {
    // Find all active follow-ups for this parent
    const followUps = await prisma.reminder.findMany({
      where: {
        isActive: true,
      },
    });

    const matchingFollowUps = followUps.filter((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      return (
        meta?.isFollowUp === true && meta?.parentReminderId === parentReminderId
      );
    });

    let cancelledCount = 0;
    for (const followUp of matchingFollowUps) {
      await deactivateReminder(followUp.id);
      cancelledCount++;
      logger.info(
        `Cancelled follow-up ${followUp.id} for parent ${parentReminderId}`,
      );
    }

    return cancelledCount;
  } catch (error) {
    logger.error("Failed to cancel follow-ups for parent reminder", {
      parentReminderId,
      error,
    });
    return 0;
  }
}

/**
 * Cancel all pending follow-ups for a workspace
 * Called when user sends any message (they're active)
 */
export async function cancelAllFollowUpsForWorkspace(
  workspaceId: string,
): Promise<number> {
  try {
    const followUps = await prisma.reminder.findMany({
      where: {
        workspaceId,
        isActive: true,
      },
    });

    const matchingFollowUps = followUps.filter((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      return meta?.isFollowUp === true;
    });

    let cancelledCount = 0;
    for (const followUp of matchingFollowUps) {
      await deactivateReminder(followUp.id);
      cancelledCount++;
    }

    if (cancelledCount > 0) {
      logger.info(
        `Cancelled ${cancelledCount} follow-up(s) for workspace ${workspaceId}`,
      );
    }

    return cancelledCount;
  } catch (error) {
    logger.error("Failed to cancel follow-ups for workspace", {
      workspaceId,
      error,
    });
    return 0;
  }
}

export async function recalculateRemindersForTimezone(
  workspaceId: string,
  _oldTimezone: string,
  newTimezone: string,
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  try {
    const reminders = await prisma.reminder.findMany({
      where: { workspaceId, isActive: true },
    });

    logger.info(
      `Recalculating ${reminders.length} reminders for timezone change to ${newTimezone}`,
    );

    for (const reminder of reminders) {
      try {
        const now = new Date();

        // Recompute nextRunAt using the schedule (local time) and new timezone
        const nextRunAt = computeNextRun(reminder.schedule, newTimezone, now);

        logger.info(
          `Reminder ${reminder.id}: schedule=${reminder.schedule}, new nextRunAt=${nextRunAt}`,
        );

        // For one-time reminders, check if already passed
        const isOneTime = reminder.maxOccurrences === 1;

        if (isOneTime && (!nextRunAt || nextRunAt < now)) {
          // One-time reminder's time has passed, deactivate
          logger.info(
            `One-time reminder ${reminder.id} time has passed, deactivating`,
          );
          await prisma.reminder.update({
            where: { id: reminder.id },
            data: { isActive: false, nextRunAt: null },
          });
          await removeScheduledReminder(reminder.id);
          updated++;
          continue;
        }

        // Update nextRunAt
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { nextRunAt },
        });

        // Reschedule job
        await removeScheduledReminder(reminder.id);
        if (nextRunAt) {
          await enqueueReminder(
            {
              reminderId: reminder.id,
              workspaceId,
              channel: reminder.channel as "whatsapp" | "email",
            },
            nextRunAt,
          );
        }

        updated++;
      } catch (error) {
        logger.error(`Failed to recalculate reminder ${reminder.id}`, {
          error,
        });
        failed++;
      }
    }

    logger.info(
      `Timezone recalculation complete: ${updated} updated, ${failed} failed`,
    );
    return { updated, failed };
  } catch (error) {
    logger.error("Failed to recalculate reminders for timezone change", {
      error,
    });
    return { updated, failed };
  }
}
