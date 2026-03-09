import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { verifySlackSignature } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundAttachment, InboundParseResult } from "../types";

export interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

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
    files?: SlackFile[];
  };
}

/**
 * Check if a Slack event is a DM or @mention directed at CORE.
 * Synchronous — no API calls, so we can respond to Slack within 3 seconds.
 */
export function isSlackDMOrMention(eventBody: SlackEventPayload): boolean {
  if (eventBody.type !== "event_callback") return false;
  const event = eventBody.event;
  if (!event) return false;

  // DM message
  if (event.type === "message" && event.channel_type === "im") {
    if (event.bot_id || event.subtype) return false;
    if (!event.user) return false;
    // Allow messages with files even if text is empty
    if (!event.text && (!event.files || event.files.length === 0)) return false;
    return true;
  }

  // @mention in a channel
  if (event.type === "app_mention") {
    if (!event.user) return false;
    if (!event.text && (!event.files || event.files.length === 0)) return false;
    return true;
  }

  return false;
}

/**
 * Check if a DM channel includes the CORE bot as a member.
 * Uses the sending user's IntegrationAccount to get a bot token for the API call.
 * Returns true if bot_user_id is not in the integration config (skip check).
 */
async function isDMWithBot(
  channelId: string,
  slackUserId: string,
): Promise<boolean> {
  const account = await prisma.integrationAccount.findFirst({
    where: {
      accountId: slackUserId,
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

  const botUserId = config?.bot_user_id;
  if (!botUserId) return true;

  try {
    const res = await fetch(
      `https://slack.com/api/conversations.members?channel=${channelId}`,
      {
        headers: { Authorization: `Bearer ${botToken}` },
      },
    );
    const data = await res.json();
    if (!data.ok) {
      logger.warn("Failed to check DM members", {
        error: data.error,
        channelId,
      });
      return false;
    }
    return (data.members as string[]).includes(botUserId);
  } catch (err) {
    logger.error("Error checking DM members", { error: String(err) });
    return false;
  }
}

async function downloadSlackFile(
  url: string,
  botToken: string,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (err) {
    logger.warn("Failed to download Slack file", { url, error: String(err) });
    return null;
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
  const text = event.text ?? "";

  if (!slackUserId) return {};
  if (!text && (!event.files || event.files.length === 0)) return {};

  // For DMs, verify the channel is with the CORE bot (not some other DM)
  if (event.channel_type === "im" && event.channel) {
    const botDM = await isDMWithBot(event.channel, slackUserId);
    if (!botDM) {
      logger.info("Ignoring DM not directed at CORE bot", { channel: event.channel });
      return {};
    }
  }

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
      integrationConfiguration: true,
    },
  });

  if (!account) {
    logger.warn("Slack message from unknown user", { slackUserId });
    return {};
  }

  const config = account.integrationConfiguration as Record<string, string> | null;
  const botToken = config?.bot_token;

  // Include channel context for typing indicators and integration queries
  const metadata: Record<string, string> = {
    channel: "slack",
    slackUserId,
  };
  // Always capture the Slack channel ID (DM or channel) and message timestamp
  if (event.channel) {
    metadata.eventChannel = event.channel;
  }
  if (event.ts) {
    metadata.messageTs = event.ts;
  }
  // Capture thread_ts for all message types (DMs and @mentions)
  // Set as sessionId so message-processor creates a separate conversation per thread
  if (event.thread_ts) {
    metadata.threadTs = event.thread_ts;
    metadata.sessionId = event.thread_ts;
  }
  if (event.type === "app_mention" && event.channel) {
    // For @mentions, also set slackChannel for reply routing
    metadata.slackChannel = event.channel;
    // Use thread_ts or message ts as threadTs for reply routing
    if (!metadata.threadTs && event.ts) {
      metadata.threadTs = event.ts;
      metadata.sessionId = event.ts;
    }
  }

  // Download any image files attached to the message
  const attachments: InboundAttachment[] = [];
  if (event.files && botToken) {
    for (const file of event.files) {
      const downloadUrl = file.url_private_download ?? file.url_private;
      if (!downloadUrl || !file.mimetype?.startsWith("image/")) continue;
      const data = await downloadSlackFile(downloadUrl, botToken);
      if (data) {
        attachments.push({
          data,
          mimeType: file.mimetype,
          name: file.name,
          originalUrl: file.url_private,
        });
      }
    }
  }

  return {
    message: {
      userId: account.integratedById,
      workspaceId: account.workspaceId,
      userMessage: text,
      replyTo: slackUserId,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
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

    if (
      !verifySlackSignature(
        env.SLACK_SIGNING_SECRET,
        timestamp,
        rawBody,
        signature,
      )
    ) {
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
