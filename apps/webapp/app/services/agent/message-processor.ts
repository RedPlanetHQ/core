/**
 * Async channel adapter (WhatsApp, Email).
 *
 * Creates/gets a daily conversation, then delegates to noStreamProcess
 * (same flow as web chat).
 */

import { UserTypeEnum } from "@core/types";
import { prisma } from "~/db.server";
import { type ChannelType } from "~/services/agent/prompts/channel-formats";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { type MessagePlan } from "~/services/agent/types/decision-agent";
import { createConversation } from "../conversation.server";

interface ProcessInboundMessageParams {
  userId: string;
  workspaceId: string;
  channel: ChannelType;
  userMessage: string;
  /** Override message type (e.g. System for reminders). Defaults to User. */
  messageUserType?: UserTypeEnum;
  /** Action plan from Decision Agent — injected into core brain system prompt */
  actionPlan?: MessagePlan;
}

interface ProcessInboundMessageResult {
  responseText: string;
  conversationId: string;
}

/**
 * Get or create a daily conversation for async channels.
 * One session per day per channel.
 */
async function getOrCreateDailyConversation(
  userId: string,
  workspaceId: string,
  message: string,
  channel: string,
): Promise<string> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.conversation.findFirst({
    where: {
      userId,
      source: channel,
      deleted: null,
      createdAt: { gte: todayStart },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) return existing.id;

  const conversation = await createConversation(workspaceId, userId, {
    message,
    parts: [{ text: message, type: "text" }],
    source: channel,
  });

  return conversation.conversationId;
}

export async function processInboundMessage({
  userId,
  workspaceId,
  channel,
  userMessage,
  messageUserType,
  actionPlan,
}: ProcessInboundMessageParams): Promise<ProcessInboundMessageResult> {
  const conversationId = await getOrCreateDailyConversation(
    userId,
    workspaceId,
    userMessage,
    channel,
  );

  // Call the same flow as web chat no_stream
  const assistantMessage = await noStreamProcess(
    {
      id: conversationId,
      message: {
        parts: [{ type: "text", text: userMessage }],
        role: "user",
      },
      source: channel,
      messageUserType,
      actionPlan,
    },
    userId,
    workspaceId,
  );

  const responseText =
    assistantMessage.parts?.[0]?.text || "I processed your request.";

  return { responseText, conversationId };
}
