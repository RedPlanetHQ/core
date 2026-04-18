/**
 * Decision Context Gatherer
 *
 * Builds rich context for the Decision Agent to make informed decisions.
 * Each trigger type has specific context requirements.
 */

import { prisma } from "~/db.server";
import {
  type Trigger,
  type ReminderTrigger,
  type ScheduledTaskTrigger,
  type DecisionContext,
  type TodayState,
  type ReminderSummary,
  type UserState,
} from "../types/decision-agent";
import type { MessageChannel } from "~/services/agent/types";
import { logger } from "~/services/logger.service";
import { getWorkspaceChannelContext } from "~/services/channel.server";
import { UserTypeEnum } from "@core/types";
import {
  createConversation,
  upsertConversationHistory,
} from "~/services/conversation.server";

/**
 * Build full decision context for a trigger
 */
export async function buildDecisionContext(
  trigger: Trigger,
  timezone: string,
): Promise<DecisionContext> {
  const { userId, workspaceId, channel } = trigger;

  // Gather context in parallel where possible
  const [userState, todayState] = await Promise.all([
    getUserState(userId, workspaceId, timezone),
    getTodayState(workspaceId, channel),
  ]);

  return {
    trigger,
    user: userState,
    todayState,
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
  workspaceId: string,
  timezone: string,
): Promise<UserState> {
  try {
    const [lastUserMessage, channelCtx] = await Promise.all([
      prisma.conversationHistory.findFirst({
        where: {
          conversation: { userId },
          userType: "User",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      getWorkspaceChannelContext(workspaceId),
    ]);

    return {
      userId,
      workspaceId,
      timezone,
      lastActiveAt: lastUserMessage?.createdAt,
      currentlyBusy: false,
      defaultChannel: channelCtx.defaultChannelType,
      availableChannels: channelCtx.availableTypes,
    };
  } catch (error) {
    logger.error("Failed to get user state", { userId, error });
    return {
      userId,
      workspaceId,
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
  channel: MessageChannel,
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
    const remindersSent: ReminderSummary[] = remindersSentToday.map(
      (r: any) => ({
        id: r.id,
        action: r.text,
        sentAt: r.lastSentAt!,
        acknowledged: r.unrespondedCount === 0,
        hasGoal: r.text.includes("goal:"), // Simple heuristic
      }),
    );

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
    logger.error("Failed to get today state", { workspaceId, error });
    return {
      remindersSent: [],
      remindersAcknowledged: 0,
      pendingFollowUps: [],
      goalProgress: [],
    };
  }
}

/**
 * Create a reminder trigger from database reminder
 */
export function createReminderTriggerFromDb(reminder: {
  id: string;
  userId: string;
  workspaceId: string;
  text: string;
  channel: string;
  channelId?: string | null;
  unrespondedCount: number;
  confirmedActive: boolean;
  occurrenceCount: number;
  metadata?: Record<string, unknown> | null;
}): ReminderTrigger {
  const meta = reminder.metadata;
  const data: ReminderTrigger["data"] = {
    reminderId: reminder.id,
    action: reminder.text,
    occurrenceNumber: reminder.occurrenceCount + 1,
    previousResponses: [], // Would need response tracking to populate
    unrespondedCount: reminder.unrespondedCount,
    confirmedActive: reminder.confirmedActive,
  };

  // Attach skill reference if present in reminder metadata
  if (meta?.skillId) {
    (data as any).skillId = meta.skillId;
    (data as any).skillName = meta.skillName || null;
  }

  return {
    type: "reminder_fired",
    timestamp: new Date(),
    workspaceId: reminder.workspaceId,
    userId: reminder.userId,
    channel: reminder.channel as MessageChannel,
    channelId: reminder.channelId,
    data,
  };
}

/**
 * Create a follow-up trigger for a reminder
 */
export function createFollowUpTrigger(reminder: {
  id: string;
  userId: string;
  workspaceId: string;
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
    workspaceId: reminder.workspaceId,
    channel: reminder.channel as MessageChannel,
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

/**
 * Create a scheduled task trigger from database task
 */
export function createTaskTriggerFromDb(task: {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  channel: string;
  channelId?: string | null;
  unrespondedCount: number;
  confirmedActive: boolean;
  occurrenceCount: number;
  metadata?: Record<string, unknown> | null;
  schedule?: string | null;
}): ScheduledTaskTrigger {
  const meta = task.metadata;
  const data: ScheduledTaskTrigger["data"] = {
    taskId: task.id,
    action: task.description || task.title,
    occurrenceNumber: task.occurrenceCount + 1,
    previousResponses: [],
    unrespondedCount: task.unrespondedCount,
    confirmedActive: task.confirmedActive,
    isRecurring: !!task.schedule,
  };

  if (meta?.skillId) {
    data.skillId = meta.skillId as string;
    data.skillName = (meta.skillName as string) || undefined;
  }

  return {
    type: "scheduled_task_fired",
    timestamp: new Date(),
    workspaceId: task.workspaceId,
    userId: task.userId,
    channel: task.channel as any,
    channelId: task.channelId,
    data,
  };
}

/**
 * Build context for scheduled task triggers
 */
export async function buildScheduledTaskContext(
  trigger: ScheduledTaskTrigger,
  timezone: string,
): Promise<DecisionContext> {
  return buildDecisionContext(trigger, timezone);
}

// ============================================================================
// Conversation Management
// ============================================================================

const MAX_MESSAGES_PER_CONVERSATION = 100;

/**
 * Get or create a conversation for an async job (reminder, integration webhook, etc.).
 * Reuses the existing conversation (looked up by asyncJobId) until it hits
 * MAX_MESSAGES_PER_CONVERSATION, then creates a new one.
 *
 * Usage:
 * - Reminder: source="reminder", asyncJobId=reminderId
 * - Integration webhook: source=integrationSlug, asyncJobId=integrationAccountId
 * - Background task: source="background-task", asyncJobId=taskId
 */
export async function getOrCreateAsyncConversation(
  workspaceId: string,
  userId: string,
  asyncJobId: string,
  source: string,
  message: string,
): Promise<string> {
  // Look for existing conversation for this async job
  const existing = await prisma.conversation.findFirst({
    where: {
      asyncJobId,
      userId,
      deleted: null,
    },
    include: {
      _count: { select: { ConversationHistory: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (
    existing &&
    existing._count.ConversationHistory < MAX_MESSAGES_PER_CONVERSATION
  ) {
    // Add trigger message to existing conversation
    await upsertConversationHistory(
      crypto.randomUUID(),
      [{ text: message, type: "text" }],
      existing.id,
      UserTypeEnum.System,
    );
    return existing.id;
  }

  // Create new conversation (first run or existing one is full)
  const conversation = await createConversation(workspaceId, userId, {
    message,
    parts: [{ text: message, type: "text" }],
    source,
    asyncJobId,
    userType: UserTypeEnum.System,
  });

  return conversation.conversationId;
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
  channel: MessageChannel,
  minutesAgo: number = 30,
): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000);

    const recentUserMessage = await prisma.conversationHistory.findFirst({
      where: {
        conversation: {
          userId,
          source: channel,
        },
        userType: "User",
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
