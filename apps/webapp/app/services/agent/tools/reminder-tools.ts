/**
 * Reminder Tools for Core Agent
 *
 * Provides add_reminder, update_reminder, delete_reminder, list_reminders,
 * and confirm_reminder tools for the agent to manage reminders.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { DateTime } from "luxon";
import {
  addReminder,
  updateReminder,
  deleteReminder,
  getWorkspaceReminders,
  confirmReminderActive,
  getReminderById,
  recalculateRemindersForTimezone,
} from "~/services/reminder.server";
import type { MessageChannel } from "~/services/agent/types";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

/**
 * Parse RRule schedule string and format as human-readable time in user's timezone
 */
function formatScheduleForUser(schedule: string, timezone: string): string {
  const hourMatch = schedule.match(/BYHOUR=(\d+)/);
  const minuteMatch = schedule.match(/BYMINUTE=(\d+)/);
  const dayMatch = schedule.match(/BYDAY=([A-Z,]+)/);
  const freqMatch = schedule.match(/FREQ=(\w+)/);
  const intervalMatch = schedule.match(/INTERVAL=(\d+)/);

  const hour = hourMatch ? parseInt(hourMatch[1]) : null;
  const minute = minuteMatch ? parseInt(minuteMatch[1]) : 0;
  const days = dayMatch ? dayMatch[1] : null;
  const freq = freqMatch ? freqMatch[1] : "DAILY";
  const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;

  // Format time
  let timeStr = "";
  if (hour !== null) {
    const dt = DateTime.now().setZone(timezone).set({ hour, minute });
    timeStr = dt.toFormat("h:mm a").toLowerCase();
  }

  // Format frequency
  let freqStr = "";
  const dayNames: Record<string, string> = {
    MO: "mon",
    TU: "tue",
    WE: "wed",
    TH: "thu",
    FR: "fri",
    SA: "sat",
    SU: "sun",
  };

  if (freq === "DAILY" && days) {
    const dayList = days
      .split(",")
      .map((d) => dayNames[d] || d)
      .join("/");
    freqStr = dayList;
  } else if (freq === "DAILY") {
    freqStr = interval > 1 ? `every ${interval} days` : "daily";
  } else if (freq === "WEEKLY") {
    freqStr = interval > 1 ? `every ${interval} weeks` : "weekly";
    if (days) {
      const dayList = days
        .split(",")
        .map((d) => dayNames[d] || d)
        .join("/");
      freqStr += ` on ${dayList}`;
    }
  } else if (freq === "MINUTELY") {
    freqStr = `every ${interval} min`;
  } else if (freq === "HOURLY") {
    freqStr = interval > 1 ? `every ${interval} hours` : "hourly";
  }

  if (timeStr && freqStr) {
    return `${freqStr} at ${timeStr}`;
  } else if (timeStr) {
    return `at ${timeStr}`;
  } else if (freqStr) {
    return freqStr;
  }
  return schedule;
}

/**
 * Get reminder management tools for the core agent
 */
export function getReminderTools(
  workspaceId: string,
  channel: MessageChannel = "whatsapp",
  timezone: string = "UTC",
  availableChannels: MessageChannel[] = ["email"],
): Record<string, Tool> {
  return {
    add_reminder: tool({
      description: `Schedule a reminder for later. Creates a trigger that will fire at the specified time.

Simple reminders (just notify):
- "notify user: drink water"
- "tell user: standup in 5 minutes"

Complex reminders (check + act):
- "check gmail for emails from CA in last 2 hours. if none, send email to CA asking for update"
- "get today's calendar. summarize and send to user"

REMINDER TEXT GUIDELINES:
- Describe WHAT to do, not HOW or WHERE to find information.
- Do NOT name specific websites, APIs, or data sources unless the user explicitly mentioned them.

Schedule uses RRule format (times are in user's local timezone):
- "FREQ=MINUTELY;INTERVAL=15" (every 15 min from now)
- "FREQ=HOURLY;INTERVAL=3" (every 3 hours from now)
- "FREQ=DAILY;BYHOUR=9" (9am daily)
- "FREQ=DAILY;BYHOUR=9;BYMINUTE=30" (9:30am daily)
- "FREQ=DAILY;BYHOUR=10,13,16,19,22" (multiple times daily)
- "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=10" (10am Mon/Wed/Fri)

IMPORTANT for "every N hours from X to Y":
- Use FREQ=DAILY with multiple BYHOUR values listing each hour
- Example: "every 3 hours from 10am to 10pm" = "FREQ=DAILY;BYHOUR=10,13,16,19,22"

For multiple days at the SAME time, use ONE reminder with maxOccurrences:
- "today and tomorrow at 5pm" = schedule="FREQ=DAILY;BYHOUR=17", maxOccurrences=2

For DIFFERENT times on different days, create SEPARATE one-time reminders.

FUTURE DATE REMINDERS (use startDate):
- "tomorrow at 2pm" = schedule="FREQ=DAILY;BYHOUR=14", startDate="2026-01-15", maxOccurrences=1

RELATIVE TIME REMINDERS (no startDate):
- "in 2 minutes" = schedule="FREQ=MINUTELY;INTERVAL=2", maxOccurrences=1
- "in 1 hour" = schedule="FREQ=HOURLY;INTERVAL=1", maxOccurrences=1

One-time: set maxOccurrences=1. Recurring with limit: set maxOccurrences=N or endDate.

FOLLOW-UP REMINDERS:
- Set isFollowUp=true and parentReminderId to create a follow-up
- Follow-ups are one-time and check if user responded to the original`,
      inputSchema: z.object({
        text: z.string().describe("The action to perform when triggered."),
        schedule: z
          .string()
          .describe(
            "RRule schedule string (e.g., 'FREQ=DAILY;BYHOUR=9' for 9am daily)",
          ),
        channel: z
          .enum(["whatsapp", "slack", "email"])
          .optional()
          .describe(
            "Channel to send the reminder on. Defaults to user's default channel if not specified.",
          ),
        startDate: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date (YYYY-MM-DD) for when to start. Use for future date reminders.",
          ),
        maxOccurrences: z
          .number()
          .optional()
          .describe(
            "Maximum times to trigger. 1 for one-time, N for limited, omit for unlimited.",
          ),
        endDate: z
          .string()
          .optional()
          .describe("ISO 8601 date string for when to stop."),
        isFollowUp: z
          .boolean()
          .optional()
          .describe("True if this is a follow-up for a previous reminder."),
        parentReminderId: z
          .string()
          .optional()
          .describe(
            "ID of the parent reminder. Required if isFollowUp is true.",
          ),
      }),
      execute: async ({
        text,
        schedule,
        channel: reminderChannel,
        startDate,
        maxOccurrences,
        endDate,
        isFollowUp,
        parentReminderId,
      }) => {
        try {
          // Enforce max 1 follow-up per reminder
          if (isFollowUp && parentReminderId) {
            const parentReminder = await getReminderById(parentReminderId);
            if (parentReminder) {
              const parentMeta = parentReminder.metadata as Record<
                string,
                unknown
              > | null;
              if (parentMeta?.isFollowUp === true) {
                logger.info(
                  `Rejecting follow-up creation: parent ${parentReminderId} is already a follow-up`,
                );
                return "Cannot create follow-up: this reminder is already a follow-up. Max 1 follow-up per original reminder.";
              }
            }
          }

          const maxOcc = isFollowUp
            ? 1
            : maxOccurrences && maxOccurrences > 0
              ? maxOccurrences
              : null;

          // Use specified channel or fall back to default
          const targetChannel = reminderChannel || channel;

          // Validate channel is available
          if (!availableChannels.includes(targetChannel)) {
            return `Channel "${targetChannel}" is not available. Available channels: ${availableChannels.join(", ")}`;
          }

          logger.info(
            `Creating reminder for workspace ${workspaceId}: ${text} (${schedule}, start: ${startDate}, max: ${maxOcc}, end: ${endDate}, followUp: ${isFollowUp}) on ${targetChannel}`,
          );

          // Build metadata for follow-ups
          const metadata = isFollowUp
            ? {
                isFollowUp: true,
                parentReminderId: parentReminderId || null,
                originalSentAt: new Date().toISOString(),
                followUpAction: text,
              }
            : undefined;

          const reminder = await addReminder(workspaceId, {
            text,
            schedule,
            channel: targetChannel,
            maxOccurrences: maxOcc,
            endDate: endDate ? new Date(endDate) : null,
            startDate: startDate ? new Date(startDate) : null,
            metadata,
          });

          let limitInfo = "";
          if (isFollowUp) {
            limitInfo = " (follow-up)";
          } else if (maxOcc) {
            limitInfo = maxOcc === 1 ? " (one-time)" : ` (${maxOcc} times max)`;
          } else if (endDate) {
            limitInfo = ` (until ${endDate})`;
          }

          const nextRunInfo = reminder.nextRunAt
            ? ` Next: ${reminder.nextRunAt.toLocaleString()}`
            : "";

          return `Created reminder: "${reminder.text}".${nextRunInfo}${limitInfo}`;
        } catch (error) {
          logger.error("Failed to create reminder", { error });
          return "Failed to create reminder. Please try again.";
        }
      },
    }),

    update_reminder: tool({
      description:
        "Update an existing reminder's text, schedule, limits, or active status.",
      inputSchema: z.object({
        reminderId: z.string().describe("The ID of the reminder to update"),
        text: z.string().optional().describe("New action text"),
        schedule: z.string().optional().describe("New RRule schedule string"),
        isActive: z
          .boolean()
          .optional()
          .describe("Set to false to pause, true to resume"),
        maxOccurrences: z
          .number()
          .optional()
          .describe("Update max occurrences limit"),
        endDate: z
          .string()
          .optional()
          .describe("Update end date (ISO 8601 format)"),
      }),
      execute: async ({
        reminderId,
        text,
        schedule,
        isActive,
        maxOccurrences,
        endDate,
      }) => {
        try {
          logger.info(
            `Updating reminder ${reminderId} for workspace ${workspaceId}`,
          );
          const reminder = await updateReminder(reminderId, workspaceId, {
            text,
            schedule,
            isActive,
            maxOccurrences: maxOccurrences ?? undefined,
            endDate: endDate ? new Date(endDate) : undefined,
          });
          return `Updated reminder: "${reminder.text}"`;
        } catch (error) {
          logger.error("Failed to update reminder", { error });
          return error instanceof Error
            ? error.message
            : "Failed to update reminder";
        }
      },
    }),

    delete_reminder: tool({
      description:
        "Delete a reminder completely. Use when user wants to cancel a reminder permanently.",
      inputSchema: z.object({
        reminderId: z.string().describe("The ID of the reminder to delete"),
      }),
      execute: async ({ reminderId }) => {
        try {
          logger.info(
            `Deleting reminder ${reminderId} for workspace ${workspaceId}`,
          );
          await deleteReminder(reminderId, workspaceId);
          return "Reminder deleted.";
        } catch (error) {
          logger.error("Failed to delete reminder", { error });
          return error instanceof Error
            ? error.message
            : "Failed to delete reminder";
        }
      },
    }),

    list_reminders: tool({
      description:
        "Get all active reminders for the user. IDs are for internal use (update/delete) - don't show them to user.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          logger.info(`Listing reminders for workspace ${workspaceId}`);
          const reminders = await getWorkspaceReminders(workspaceId);

          if (reminders.length === 0) {
            return "No active reminders.";
          }

          const reminderList = reminders
            .map((r, i) => {
              const scheduleStr = formatScheduleForUser(r.schedule, timezone);

              let limitInfo = "";
              if (r.maxOccurrences) {
                const remaining = r.maxOccurrences - r.occurrenceCount;
                limitInfo =
                  remaining === 1 ? " (one-time)" : ` (${remaining} left)`;
              } else if (r.endDate) {
                limitInfo = ` (until ${new Date(r.endDate).toLocaleDateString()})`;
              }

              return `${i + 1}. "${r.text}" - ${scheduleStr}${limitInfo} [id:${r.id}]`;
            })
            .join("\n");

          return `Active reminders:\n${reminderList}`;
        } catch (error) {
          logger.error("Failed to list reminders", { error });
          return "Failed to retrieve reminders.";
        }
      },
    }),

    confirm_reminder: tool({
      description:
        "Confirm user wants to keep a reminder active. Use when user said yes to keeping it. Stops future prompts about turning it off.",
      inputSchema: z.object({
        reminderId: z.string().describe("The ID of the reminder to confirm"),
      }),
      execute: async ({ reminderId }) => {
        try {
          logger.info(
            `Confirming reminder ${reminderId} as active for workspace ${workspaceId}`,
          );
          await confirmReminderActive(reminderId, workspaceId);
          return "Reminder confirmed active.";
        } catch (error) {
          logger.error("Failed to confirm reminder", { error });
          return "Failed to confirm reminder.";
        }
      },
    }),

    set_timezone: tool({
      description:
        "Set user's timezone. Use when user mentions their timezone (e.g., 'i'm in PST', 'my timezone is IST'). This will also recalculate all existing reminder schedules to the new timezone.",
      inputSchema: z.object({
        timezone: z
          .string()
          .describe(
            "IANA timezone string (e.g., 'America/Los_Angeles', 'Asia/Kolkata', 'Europe/London')",
          ),
      }),
      execute: async ({ timezone: newTimezone }) => {
        try {
          // Get the user from workspace
          const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { UserWorkspace: { include: { user: true }, take: 1 } },
          });

          const user = workspace?.UserWorkspace[0]?.user;
          if (!user) {
            return "failed to update timezone";
          }

          const existingMetadata =
            (user.metadata as Record<string, unknown>) || {};
          const oldTimezone = (existingMetadata.timezone as string) || "UTC";

          // Update user metadata with new timezone
          await prisma.user.update({
            where: { id: user.id },
            data: {
              metadata: {
                ...existingMetadata,
                timezone: newTimezone,
              },
            },
          });

          // Recalculate all reminders if timezone actually changed
          if (oldTimezone !== newTimezone) {
            const { updated, failed } = await recalculateRemindersForTimezone(
              workspaceId,
              oldTimezone,
              newTimezone,
            );
            if (updated > 0) {
              logger.info(
                `Recalculated reminders for timezone change: ${updated} updated, ${failed} failed`,
              );
              return `timezone set to ${newTimezone}. ${updated} reminder(s) adjusted.`;
            }
          }

          return `timezone set to ${newTimezone}. no reminders to adjust.`;
        } catch (error) {
          logger.error("Failed to update timezone", { error });
          return "failed to update timezone";
        }
      },
    }),
  };
}
