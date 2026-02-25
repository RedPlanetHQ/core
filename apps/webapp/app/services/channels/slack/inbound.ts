import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { verifySlackSignature } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundParseResult } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SlackEventPayload {
  type: string;
  authorizations?: Array<{
    user_id?: string;
    is_bot?: boolean;
  }>;
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
 * For DMs, verifies the channel includes the CORE bot as a member.
 */
export async function isSlackDMOrMention(eventBody: SlackEventPayload): Promise<boolean> {
  if (eventBody.type !== "event_callback") return false;
  const event = eventBody.event;
  if (!event) return false;

  // DM message
  if (event.type === "message" && event.channel_type === "im") {
    if (event.bot_id || event.subtype) return false;
    if (!event.user || !event.text) return false;

    // Verify this DM is with the CORE bot
    if (event.channel) {
      const botDM = await isDMWithBot(event.channel);
      if (!botDM) return false;
    }

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
 * Check if a DM channel includes the CORE bot as a member.
 * Returns true if SLACK_BOT_USER_ID is not configured (skip check).
 */
async function isDMWithBot(channelId: string): Promise<boolean> {
  const botUserId = env.SLACK_BOT_USER_ID;
  if (!botUserId) return true;

  // Find any active Slack integration account to get a bot token
  const account = await prisma.integrationAccount.findFirst({
    where: {
      integrationDefinition: { slug: "slack" },
      isActive: true,
      deleted: null,
    },
    select: { integrationConfiguration: true },
  });

  if (!account) return false;

  const config = account.integrationConfiguration as Record<string, string>;
  const botToken = config?.bot_token;
  if (!botToken) return false;

  try {
    const res = await fetch(`https://slack.com/api/conversations.members?channel=${channelId}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = await res.json();
    if (!data.ok) {
      logger.warn("Failed to check DM members", { error: data.error, channelId });
      return false;
    }
    return (data.members as string[]).includes(botUserId);
  } catch (err) {
    logger.error("Error checking DM members", { error: String(err) });
    return false;
  }
}

/**
 * Parse a pre-parsed Slack event body into an InboundParseResult.
 * Called from the webhook route which already has the JSON.
 */
export async function parseSlackDMEvent(
  eventBody: SlackEventPayload,
): Promise<InboundParseResult> {
  const event = eventBody.event;
  if (!event) return {};

  const slackUserId = event.user;
  const text = event.text;

  if (!slackUserId || !text) return {};

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
    logger.warn("Slack message from unknown user", { slackUserId });
    return {};
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
    message: {
      userId: account.integratedById,
      workspaceId: account.workspaceId,
      userMessage: text,
      replyTo: slackUserId,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
  };
}

/**
 * Parse a raw Slack Events API request into an InboundParseResult.
 * ChannelHandler interface — used if events arrive at /api/v1/channels/slack.
 */
export async function parseInbound(
  request: Request,
): Promise<InboundParseResult> {
  const rawBody = await request.text();

  if (env.SLACK_SIGNING_SECRET) {
    const timestamp = request.headers.get("X-Slack-Request-Timestamp") ?? "";
    const signature = request.headers.get("X-Slack-Signature") ?? "";

    if (!verifySlackSignature(env.SLACK_SIGNING_SECRET, timestamp, rawBody, signature)) {
      logger.warn("Invalid Slack signature");
      return {};
    }
  }

  let body: SlackEventPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return {};
  }

  if (!isSlackDMOrMention(body)) return {};

  return parseSlackDMEvent(body);
}
