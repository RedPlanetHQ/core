import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { verifySlackSignature } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundMessage } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SlackEventPayload {
  type: string;
  event?: {
    type: string;
    channel_type?: string;
    channel?: string;
    user?: string;
    text?: string;
    bot_id?: string;
    subtype?: string;
    ts?: string;
    thread_ts?: string;
  };
}

/**
 * Check if a Slack event is a DM or @mention directed at CORE.
 */
export function isSlackDMOrMention(eventBody: SlackEventPayload): boolean {
  if (eventBody.type !== "event_callback") return false;
  const event = eventBody.event;
  if (!event) return false;

  // DM message
  if (event.type === "message" && event.channel_type === "im") {
    if (event.bot_id || event.subtype) return false;
    if (!event.user || !event.text) return false;
    return true;
  }

  // @mention in a channel
  if (event.type === "app_mention") {
    if (!event.user || !event.text) return false;
    return true;
  }

  return false;
}

/**
 * Parse a pre-parsed Slack event body into an InboundMessage.
 * Called from the webhook route which already has the JSON.
 */
export async function parseSlackDMEvent(
  eventBody: SlackEventPayload,
): Promise<InboundMessage | null> {
  const event = eventBody.event;
  if (!event) return null;

  const slackUserId = event.user;
  const text = event.text;

  if (!slackUserId || !text) return null;

  // Look up CORE user via IntegrationAccount
  const account = await prisma.integrationAccount.findFirst({
    where: {
      accountId: slackUserId,
      integrationDefinition: { slug: "slack" },
      isActive: true,
      deleted: null,
    },
    select: {
      integratedById: true,
      workspaceId: true,
    },
  });

  if (!account) {
    logger.warn("Slack DM from unknown user", { slackUserId });
    return null;
  }

  // For app_mention, include channel and thread_ts so reply goes to the thread
  const metadata: Record<string, string> = {};
  if (event.type === "app_mention" && event.channel) {
    metadata.slackChannel = event.channel;
    // Use thread_ts if mention is inside a thread, otherwise ts to start a new thread
    const threadTs = event.thread_ts ?? event.ts;
    if (threadTs) {
      metadata.threadTs = threadTs;
    }
  }

  return {
    userId: account.integratedById,
    workspaceId: account.workspaceId,
    userMessage: text,
    replyTo: slackUserId,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

/**
 * Parse a raw Slack Events API request into an InboundMessage.
 * ChannelHandler interface — used if events arrive at /api/v1/channels/slack.
 */
export async function parseInbound(
  request: Request,
): Promise<InboundMessage | null> {
  const rawBody = await request.text();

  if (env.SLACK_SIGNING_SECRET) {
    const timestamp = request.headers.get("X-Slack-Request-Timestamp") ?? "";
    const signature = request.headers.get("X-Slack-Signature") ?? "";

    if (!verifySlackSignature(env.SLACK_SIGNING_SECRET, timestamp, rawBody, signature)) {
      logger.warn("Invalid Slack signature");
      return null;
    }
  }

  let body: SlackEventPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!isSlackDMOrMention(body)) return null;

  return parseSlackDMEvent(body);
}
