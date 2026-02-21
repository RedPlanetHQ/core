/**
 * Unified Channel Webhook Route
 *
 * Dispatches inbound messages to the correct channel handler (WhatsApp, Email, …)
 * via `getChannel(params.channel)`. Awaits processing + reply, then returns.
 */

import { type ActionFunctionArgs, json } from "@remix-run/node";
import { getChannel } from "~/services/channels";
import { processInboundMessage } from "~/services/agent/message-processor";
import { logger } from "~/services/logger.service";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const slug = params.channel;
  if (!slug) {
    return json({ error: "Missing channel" }, { status: 400 });
  }

  let channel;
  try {
    channel = getChannel(slug);
  } catch {
    return json({ error: "Unknown channel" }, { status: 404 });
  }

  const msg = await channel.parseInbound(request);
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
      channel: slug as "whatsapp" | "email",
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
