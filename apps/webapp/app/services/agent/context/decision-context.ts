/**
 * Decision Context Gatherer
 *
 * Builds rich context for the Decision Agent to make informed decisions.
 * Each trigger type has specific context requirements.
 */

import { prisma } from "~/trigger/utils/prisma";
import {
  Trigger,
  ReminderTrigger,
  DecisionContext,
  TodayState,
  RelevantHistory,
  ReminderSummary,
  UserState,
} from "../types/decision-agent";
import { logger } from "~/services/logger.service";

/**
 * Build full decision context for a trigger
 */
export async function buildDecisionContext(
  trigger: Trigger,
  timezone: string,
): Promise<DecisionContext> {
  const { userId, channel } = trigger;

  // Gather context in parallel where possible
  const [userState, todayState, relevantHistory] = await Promise.all([
    getUserState(userId, timezone),
    getTodayState(userId, channel),
    getRelevantHistory(userId, channel),
  ]);

  return {
    trigger,
    user: userState,
    todayState,
    relevantHistory,
  };
}

/**
 * Build context specifically for reminder triggers
 */
export async function buildReminderContext(
  trigger: ReminderTrigger,
  timezone: string,
): Promise<DecisionContext> {
  return buildDecisionContext(trigger, timezone);
}

/**
 * Get user's current state
 */
async function getUserState(
  userId: string,
  timezone: string,
): Promise<UserState> {
  try {
    // Get last user activity from conversation messages
    const lastUserMessage = await prisma.conversationMessage.findFirst({
      where: {
        conversation: { userId },
        role: "user",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    // Simple busy check based on time of day
    // In future, this could check calendar integration
    const now = new Date();
    const hourInTimezone = getHourInTimezone(now, timezone);
    const isNightTime = hourInTimezone < 7 || hourInTimezone >= 23;

    return {
      timezone,
      lastActiveAt: lastUserMessage?.createdAt,
      currentlyBusy: false,
      // currentlyBusy: isNightTime, // Simple heuristic for now
    };
  } catch (error) {
    logger.error("Failed to get user state", { userId, error });
    return {
      timezone,
      currentlyBusy: false,
    };
  }
}

/**
 * Get today's reminder state
 */
async function getTodayState(
  workspaceId: string,
  channel: "whatsapp" | "email",
): Promise<TodayState> {
  try {
    const startOfDay = getStartOfDay();

    // Get reminders sent today (via lastSentAt)
    const remindersSentToday = await prisma.reminder.findMany({
      where: {
        workspaceId,
        channel,
        lastSentAt: { gte: startOfDay },
      },
      select: {
        id: true,
        text: true,
        lastSentAt: true,
        unrespondedCount: true,
      },
    });

    // Convert to ReminderSummary format
    const remindersSent: ReminderSummary[] = remindersSentToday.map((r) => ({
      id: r.id,
      action: r.text,
      sentAt: r.lastSentAt!,
      acknowledged: r.unrespondedCount === 0,
      hasGoal: r.text.includes("goal:"), // Simple heuristic
    }));

    // Count acknowledged reminders
    const remindersAcknowledged = remindersSent.filter(
      (r) => r.acknowledged,
    ).length;

    // Get pending follow-ups (reminders sent but not acknowledged)
    const pendingFollowUps = remindersSent
      .filter((r) => !r.acknowledged)
      .map((r) => ({
        reminderId: r.id,
        action: r.action,
        sentAt: r.sentAt,
      }));

    return {
      remindersSent,
      remindersAcknowledged,
      pendingFollowUps,
      goalProgress: [], // Will be populated when goals are implemented
    };
  } catch (error) {
    logger.error("Failed to get today state", { userId, error });
    return {
      remindersSent: [],
      remindersAcknowledged: 0,
      pendingFollowUps: [],
      goalProgress: [],
    };
  }
}

/**
 * Get relevant message history
 */
async function getRelevantHistory(
  userId: string,
  channel: "whatsapp" | "email",
): Promise<RelevantHistory> {
  try {
    // Get messages from last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const recentMessages = await prisma.conversationMessage.findMany({
      where: {
        conversation: {
          userId,
          source: channel,
        },
        createdAt: { gte: twoHoursAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return {
      recentMessages: recentMessages.reverse().map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        timestamp: m.createdAt,
      })),
    };
  } catch (error) {
    logger.error("Failed to get relevant history", { userId, error });
    return {
      recentMessages: [],
    };
  }
}

/**
 * Create a reminder trigger from database reminder
 */
export function createReminderTriggerFromDb(reminder: {
  id: string;
  userId: string;
  text: string;
  channel: string;
  unrespondedCount: number;
  confirmedActive: boolean;
  occurrenceCount: number;
}): ReminderTrigger {
  return {
    type: "reminder_fired",
    timestamp: new Date(),
    userId: reminder.userId,
    channel: reminder.channel as "whatsapp" | "email",
    data: {
      reminderId: reminder.id,
      action: reminder.text,
      occurrenceNumber: reminder.occurrenceCount + 1,
      previousResponses: [], // Would need response tracking to populate
      unrespondedCount: reminder.unrespondedCount,
      confirmedActive: reminder.confirmedActive,
    },
  };
}

/**
 * Create a follow-up trigger for a reminder
 */
export function createFollowUpTrigger(reminder: {
  id: string;
  userId: string;
  text: string;
  channel: string;
  unrespondedCount: number;
  confirmedActive: boolean;
  occurrenceCount: number;
}): ReminderTrigger {
  return {
    type: "reminder_followup",
    timestamp: new Date(),
    userId: reminder.userId,
    channel: reminder.channel as "whatsapp" | "email",
    data: {
      reminderId: reminder.id,
      action: reminder.text,
      occurrenceNumber: reminder.occurrenceCount,
      previousResponses: [],
      unrespondedCount: reminder.unrespondedCount,
      confirmedActive: reminder.confirmedActive,
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the hour (0-23) in a specific timezone
 */
function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    return parseInt(hourPart?.value || "12", 10);
  } catch {
    return date.getHours();
  }
}

/**
 * Get start of today (midnight) in UTC
 */
function getStartOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/**
 * Check if user has responded recently (within last N minutes)
 */
export async function hasUserRespondedRecently(
  userId: string,
  channel: "whatsapp" | "email",
  minutesAgo: number = 30,
): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000);

    const recentUserMessage = await prisma.conversationMessage.findFirst({
      where: {
        conversation: {
          userId,
          source: channel,
        },
        role: "user",
        createdAt: { gte: cutoff },
      },
    });

    return recentUserMessage !== null;
  } catch (error) {
    logger.error("Failed to check recent response", { userId, error });
    return false;
  }
}

/**
 * Get time since last reminder was sent (in minutes)
 */
export async function getMinutesSinceLastReminder(
  userId: string,
  reminderId?: string,
): Promise<number | null> {
  try {
    const whereClause: any = {
      userId,
      lastSentAt: { not: null },
    };

    if (reminderId) {
      whereClause.id = reminderId;
    }

    const reminder = await prisma.reminder.findFirst({
      where: whereClause,
      orderBy: { lastSentAt: "desc" },
      select: { lastSentAt: true },
    });

    if (!reminder?.lastSentAt) {
      return null;
    }

    const minutesSince =
      (Date.now() - reminder.lastSentAt.getTime()) / (60 * 1000);
    return Math.floor(minutesSince);
  } catch (error) {
    logger.error("Failed to get minutes since last reminder", {
      userId,
      error,
    });
    return null;
  }
}
