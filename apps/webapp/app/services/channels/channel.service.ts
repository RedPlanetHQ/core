import { processInboundMessage } from "~/services/agent/message-processor";
import type { ChannelType } from "~/services/agent/prompts/channel-formats";
import { logger } from "~/services/logger.service";
import { getChannel } from "./registry";
import type { InboundMessage, ReplyMetadata } from "./types";
import { createAuthorizationCode } from "../personalAccessToken.server";
import { env } from "~/env.server";

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
        await sendChannelInvite(result.unknownContact, channel.sendReply.bind(channel));
      } catch (err) {
        logger.error(`Failed to send invite via ${slug}`, { error: String(err) });
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
    if (channel.capabilities.sendTypingIndicator && channel.sendTypingIndicator) {
      channel.sendTypingIndicator(msg.metadata).catch((err) => {
        logger.warn(`[${slug}] Typing indicator failed`, { error: String(err) });
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
 * Send a signup/verification invite to an unknown user via their channel.
 */
export async function sendChannelInvite(
  unknownContact: {
    identifier: string;
    channel: string;
    metadata?: Record<string, string>;
  },
  sendReply: (to: string, text: string, metadata?: ReplyMetadata) => Promise<void>,
): Promise<void> {
  const authCode = await createAuthorizationCode();
  const signupUrl = `${env.APP_ORIGIN}/account/authorization-code/${authCode.code}`;

  const message = `Hey! I'm CORE, your personal assistant.\n\nTo get started, verify your account here:\n${signupUrl}`;

  logger.info(`Sending invite to unknown ${unknownContact.channel} user`, {
    identifier: unknownContact.identifier,
  });

  await sendReply(unknownContact.identifier, message, unknownContact.metadata);
}
