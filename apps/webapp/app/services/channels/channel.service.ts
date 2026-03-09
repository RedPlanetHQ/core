import { processInboundMessage } from "~/services/agent/message-processor";
import type { ChannelType } from "~/services/agent/prompts/channel-formats";
import { logger } from "~/services/logger.service";
import { getChannel } from "./registry";
import type { InboundMessage, ReplyMetadata } from "./types";
import { createAuthorizationCode } from "../personalAccessToken.server";
import { env } from "~/env.server";
import type { BackgroundTask } from "@core/database";
import {
  createConversation,
  upsertConversationHistory,
} from "../conversation.server";
import { UserTypeEnum } from "@core/types";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";

/**
 * Process an inbound message through the channel pipeline.
 * Accepts either a Request (parses via channel handler) or a pre-parsed InboundMessage.
 */
export async function handleChannelMessage(
  slug: string,
  input: Request | InboundMessage,
): Promise<Response> {
  const channel = getChannel(slug);

  let msg: InboundMessage | undefined;

  if (input instanceof Request) {
    const result = await channel.parseInbound(input);

    if (result.unknownContact) {
      try {
        await sendChannelInvite(
          result.unknownContact,
          channel.sendReply.bind(channel),
        );
      } catch (err) {
        logger.error(`Failed to send invite via ${slug}`, {
          error: String(err),
        });
      }
      return channel.emptyResponse();
    }

    msg = result.message;
  } else {
    msg = input;
  }

  if (!msg) {
    return channel.emptyResponse();
  }

  try {
    logger.info(`[${slug}] Processing message from ${msg.replyTo}`, {
      userId: msg.userId,
      workspaceId: msg.workspaceId,
    });

    // Send typing indicator immediately (non-blocking) so user knows we're processing
    if (
      channel.capabilities.sendTypingIndicator &&
      channel.sendTypingIndicator
    ) {
      channel.sendTypingIndicator(msg.metadata).catch((err) => {
        logger.warn(`[${slug}] Typing indicator failed`, {
          error: String(err),
        });
      });
    }

    // Build onMessage callback for intermediate ack messages (channel-configurable)
    const onMessage = channel.capabilities.sendAcknowledgeMessage
      ? async (ackMessage: string) => {
          await channel.sendReply(msg!.replyTo, ackMessage, {
            ...msg!.metadata,
            workspaceId: msg!.workspaceId,
          });
        }
      : undefined;

    const { responseText } = await processInboundMessage({
      userId: msg.userId,
      workspaceId: msg.workspaceId,
      channel: slug as ChannelType,
      userMessage: msg.userMessage,
      onMessage,
      channelMetadata: msg.metadata,
      attachments: msg.attachments,
    });

    logger.info(`[${slug}] Got response, sending reply to ${msg.replyTo}`, {
      responseLength: responseText.length,
    });

    await channel.sendReply(msg.replyTo, responseText, {
      ...msg.metadata,
      workspaceId: msg.workspaceId,
    });

    logger.info(`[${slug}] Reply sent successfully to ${msg.replyTo}`);
  } catch (err) {
    logger.error(`${slug} message processing failed`, {
      userId: msg.userId,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  return channel.emptyResponse();
}

/**
 * Process a background task through the channel pipeline.
 * Uses the task's intent as AI context (not stored as user message) and
 * sends the response via the task's callbackChannel.
 */
export async function handleBackgroundMessage(
  task: BackgroundTask,
  executorTools?: OrchestratorTools,
): Promise<void> {
  const slug = task.callbackChannel;
  const channel = getChannel(slug);

  try {
    logger.info(`[background][${slug}] Processing task ${task.id}`, {
      userId: task.userId,
      workspaceId: task.workspaceId,
    });

    const metadata =
      (task.callbackMetadata as Record<string, string> | null) ?? {};

    const conversation = await createConversation(
      task.workspaceId,
      task.userId,
      {
        message: task.intent,
        parts: [{ text: task.intent, type: "text" }],
        userType: UserTypeEnum.User,
        asyncJobId: task.id,
        source: "background-task",
      },
    );

    const { responseText } = await processInboundMessage({
      userId: task.userId,
      workspaceId: task.workspaceId,
      channel: slug as ChannelType,
      userMessage: task.intent,
      conversationId: conversation.conversationId,
      skipUserMessage: true,
      channelMetadata: metadata,
      disableBackgroundTaskTools: true,
      executorTools,
    });

    if (responseText && task.callbackConversationId) {
      await upsertConversationHistory(
        crypto.randomUUID(),
        [{ text: responseText, type: "text" }],
        task.callbackConversationId,
        UserTypeEnum.Agent,
      );
    }

    logger.info(`[background][${slug}] Got response for task ${task.id}`);

    const replyTo = (metadata.replyTo as string | undefined) ?? task.userId;
    await channel.sendReply(replyTo, responseText, {
      ...metadata,
      workspaceId: task.workspaceId,
    });
  } catch (err) {
    logger.error(`[background][${slug}] Failed for task ${task.id}`, {
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}

/**
 * Send a signup/verification invite to an unknown user via their channel.
 */
export async function sendChannelInvite(
  unknownContact: {
    identifier: string;
    channel: string;
    metadata?: Record<string, string>;
  },
  sendReply: (
    to: string,
    text: string,
    metadata?: ReplyMetadata,
  ) => Promise<void>,
): Promise<void> {
  const authCode = await createAuthorizationCode();
  const token = Buffer.from(
    JSON.stringify({
      authorizationCode: authCode.code,
      identifier: unknownContact.identifier,
      source: unknownContact.channel,
    }),
  ).toString("base64");
  const signupUrl = `${env.APP_ORIGIN}/agent/verify/${token}`;

  const message = `Hey! I'm CORE, your personal assistant.\n\nTo get started, verify your account here:\n${signupUrl}`;

  logger.info(`Sending invite to unknown ${unknownContact.channel} user`, {
    identifier: unknownContact.identifier,
  });

  await sendReply(unknownContact.identifier, message, unknownContact.metadata);
}
