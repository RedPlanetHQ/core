import { processInboundMessage } from "~/services/agent/message-processor";
import type { ChannelType } from "~/services/agent/prompts/channel-formats";
import { logger } from "~/services/logger.service";
import { getChannel } from "./registry";
import type { InboundMessage } from "./types";

/**
 * Process an inbound message through the channel pipeline.
 * Accepts either a Request (parses via channel handler) or a pre-parsed InboundMessage.
 */
export async function handleChannelMessage(
  slug: string,
  input: Request | InboundMessage,
): Promise<Response> {
  const channel = getChannel(slug);

  // If input is a Request, parse it via the channel handler
  let msg: InboundMessage | null;
  if (input instanceof Request) {
    msg = await channel.parseInbound(input);
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

    const { responseText } = await processInboundMessage({
      userId: msg.userId,
      workspaceId: msg.workspaceId,
      channel: slug as ChannelType,
      userMessage: msg.userMessage,
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
