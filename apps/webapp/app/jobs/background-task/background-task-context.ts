/**
 * Background Task Context Builder
 *
 * Creates triggers and context for decision agent callbacks
 * when background tasks complete, fail, or timeout.
 */

import type { BackgroundTask } from "@prisma/client";
import {
  type DecisionContext,
  type TodayState,
  type UserState,
  type BackgroundTaskTrigger,
} from "~/services/agent/types/decision-agent";
import type { MessageChannel } from "~/services/agent/types";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

/**
 * Create a background task trigger for the decision agent
 */
export function createBackgroundTaskTrigger(
  task: BackgroundTask,
  status: "completed" | "failed" | "timeout",
  result?: string,
  error?: string,
): BackgroundTaskTrigger {
  const triggerType =
    status === "completed"
      ? "background_task_completed"
      : status === "failed"
        ? "background_task_failed"
        : "background_task_timeout";

  return {
    type: triggerType,
    timestamp: new Date(),
    userId: task.userId,
    workspaceId: task.workspaceId,
    channel: task.callbackChannel as MessageChannel,
    data: {
      taskId: task.id,
      intent: task.intent,
      status,
      result,
      error,
      startedAt: task.startedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      callbackConversationId: task.callbackConversationId ?? undefined,
      callbackMetadata: task.callbackMetadata as
        | Record<string, unknown>
        | undefined,
    },
  };
}

/**
 * Build decision context for a background task trigger
 */
export async function buildBackgroundTaskContext(
  trigger: BackgroundTaskTrigger,
  timezone: string,
): Promise<DecisionContext> {
  const { userId, workspaceId, channel } = trigger;

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
 * Get user's current state
 */
async function getUserState(
  userId: string,
  workspaceId: string,
  timezone: string,
): Promise<UserState> {
  try {
    const [user, slackAccount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { metadata: true, phoneNumber: true },
      }),
      prisma.integrationAccount.findFirst({
        where: {
          workspaceId,
          integrationDefinition: { slug: "slack" },
        },
      }),
    ]);

    const metadata = user?.metadata as Record<string, unknown> | null;
    const defaultChannel =
      (metadata?.defaultChannel as
        | "whatsapp"
        | "slack"
        | "email"
        | undefined) ?? "email";

    const availableChannels: Array<"whatsapp" | "slack" | "email"> = ["email"];
    if (user?.phoneNumber) availableChannels.push("whatsapp");
    if (slackAccount) availableChannels.push("slack");

    return {
      userId,
      workspaceId,
      timezone,
      currentlyBusy: false,
      defaultChannel,
      availableChannels,
    };
  } catch (error) {
    logger.error("Failed to get user state for background task", {
      userId,
      error,
    });
    return {
      userId,
      workspaceId,
      timezone,
      currentlyBusy: false,
    };
  }
}

/**
 * Get today's state (minimal for background tasks)
 */
async function getTodayState(
  workspaceId: string,
  channel: MessageChannel,
): Promise<TodayState> {
  return {
    remindersSent: [],
    remindersAcknowledged: 0,
    pendingFollowUps: [],
    goalProgress: [],
  };
}
