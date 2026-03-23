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
import {
  type Trigger,
  type DecisionContext,
} from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";
import { createConversation } from "../conversation.server";
import { type InboundAttachment } from "~/services/channels/types";
import { ModelMessage } from "ai";

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
  /** Trigger context — enables think tool for non-user triggers */
  triggerContext?: {
    trigger: Trigger;
    context: DecisionContext;
    reminderText: string;
    userPersona?: string;
  };
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>;
  /** Channel-specific metadata (messageSid, slackUserId, threadTs, etc.) */
  channelMetadata?: Record<string, string>;
  /** Optional executor tools — uses HttpOrchestratorTools for trigger/job contexts */
  executorTools?: OrchestratorTools;
  /** Image/file attachments from Slack or WhatsApp */
  attachments?: InboundAttachment[];
}

interface ProcessInboundMessageResult {
  responseText: string;
  conversationId: string;
  parts: any[];
}

/**
 * Get or create a conversation for async channels.
 * - If sessionId is present in metadata (e.g., thread_ts for Slack): one conversation per session
 * - Otherwise: one conversation per day per channel
 */
export async function getOrCreateChannelConversation(
  userId: string,
  workspaceId: string,
  message: string,
  channel: string,
  channelMetadata?: Record<string, string>,
): Promise<string> {
  const sessionId = channelMetadata?.sessionId;

  if (sessionId) {
    const existing = await prisma.conversation.findFirst({
      where: {
        asyncJobId: sessionId,
        userId,
        deleted: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) return existing.id;

    const conversation = await createConversation(workspaceId, userId, {
      message,
      parts: [{ text: message, type: "text" }],
      source: channel,
      asyncJobId: sessionId,
    });

    return conversation.conversationId;
  }

  // No sessionId: daily conversation
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.conversation.findFirst({
    where: {
      userId,
      source: channel,
      asyncJobId: null,
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
  triggerContext,
  onMessage,
  channelMetadata,
  executorTools,
  attachments,
}: ProcessInboundMessageParams): Promise<ProcessInboundMessageResult> {
  const conversationId =
    existingConversationId ??
    (await getOrCreateChannelConversation(
      userId,
      workspaceId,
      userMessage,
      channel,
      channelMetadata,
    ));

  // Build message parts: text first, then any image attachments as data URLs
  const messageParts: any[] = [{ type: "text", text: userMessage }];
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      messageParts.push({
        type: "file",
        mediaType: attachment.mimeType,
        url: `data:${attachment.mimeType};base64,${attachment.data}`,
        ...(attachment.name ? { filename: attachment.name } : {}),
      });
    }
  }

  // Call the same flow as web chat no_stream
  const assistantMessage = await noStreamProcess(
    {
      id: conversationId,
      message: {
        parts: messageParts,
        role: "user",
      },
      source: channel,
      skipUserMessage,
      messageUserType,
      triggerContext,
      onMessage,
      channelMetadata,
      executorTools,
    },
    userId,
    workspaceId,
  );

  const responseText = assistantMessage.text || "I processed your request.";

  return { responseText, conversationId, parts: assistantMessage.parts ?? [] };
}
