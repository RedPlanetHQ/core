/**
 * Decision Context Gatherer
 *
 * Builds rich context for the Decision Agent to make informed decisions.
 * Each trigger type has specific context requirements.
 */

import { prisma } from "~/db.server";
import {
  type Trigger,
  type ScheduledTaskTrigger,
  type DecisionContext,
  type UserState,
} from "../types/decision-agent";
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
  const { userId, workspaceId } = trigger;

  const userState = await getUserState(userId, workspaceId, timezone);

  return {
    trigger,
    user: userState,
    todayState: { goalProgress: [] },
  };
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
  const data: ScheduledTaskTrigger["data"] = {
    taskId: task.id,
    action: task.description || task.title,
    occurrenceNumber: task.occurrenceCount + 1,
    previousResponses: [],
    unrespondedCount: task.unrespondedCount,
    confirmedActive: task.confirmedActive,
    isRecurring: !!task.schedule,
  };

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
 * Get or create a conversation for an async job (scheduled task, integration webhook, etc.).
 * Reuses the existing conversation (looked up by asyncJobId) until it hits
 * MAX_MESSAGES_PER_CONVERSATION, then creates a new one.
 *
 * Usage:
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

