/**
 * Async channel adapter (WhatsApp, Email).
 *
 * Creates/gets a daily conversation, then delegates to noStreamProcess
 * (same flow as web chat).
 */

import { type UserTypeEnum } from "@core/types";
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
  /** If provided, use this conversation instead of creating/finding a daily one */
  conversationId?: string;
  /** If true, the userMessage won't be saved to conversation history (still used as AI context) */
  skipUserMessage?: boolean;
  /** Override message type (e.g. System for reminders). Defaults to User. */
  messageUserType?: UserTypeEnum;
  /** Action plan from Decision Agent — injected into core brain system prompt */
  actionPlan?: MessagePlan;
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>;
  /** Channel-specific metadata (messageSid, slackUserId, threadTs, etc.) */
  channelMetadata?: Record<string, string>;
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
  conversationId: existingConversationId,
  skipUserMessage,
  messageUserType,
  actionPlan,
  onMessage,
  channelMetadata,
}: ProcessInboundMessageParams): Promise<ProcessInboundMessageResult> {
  const conversationId =
    existingConversationId ??
    (await getOrCreateDailyConversation(userId, workspaceId, userMessage, channel));

  // Call the same flow as web chat no_stream
  const assistantMessage = await noStreamProcess(
    {
      id: conversationId,
      message: {
        parts: [{ type: "text", text: userMessage }],
        role: "user",
      },
      source: channel,
      skipUserMessage,
      messageUserType,
      actionPlan,
      onMessage,
      channelMetadata,
    },
    userId,
    workspaceId,
  );

  const responseText = assistantMessage.text || "I processed your request.";

  return { responseText, conversationId };
}
