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
  team_id?: string;
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
    if (event.bot_id) return false;
    // Allow file_share subtype (image/file uploads), reject other subtypes
    if (event.subtype && event.subtype !== "file_share") return false;
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
 * Find the Slack Channel record for this event using the bot_user_id
 * from authorizations — uniquely identifies which workspace/installation
 * received the event even when multiple workspaces share the same Slack team.
 */
async function findChannelByAuthorization(slackUserId: string) {
  if (!slackUserId) return null;

  return prisma.channel.findFirst({
    where: {
      type: "slack",
      isActive: true,
      config: { path: ["user_id"], equals: slackUserId },
    },
  });
}

/**
 * Check if a DM channel includes the CORE bot as a member.
 * Looks up the Channel record via bot_user_id from authorizations.
 * Returns true if bot_user_id is not configured (skip check).
 */
async function isDMWithBot(
  slackChannelId: string,
  slackUserId: string,
): Promise<boolean> {
  const channel = await findChannelByAuthorization(slackUserId);
  if (!channel) return false;

  const config = channel.config as Record<string, string>;
  const botToken = config.bot_token;
  if (!botToken) return false;

  const botUserId = config.bot_user_id;
  if (!botUserId) return true;

  try {
    const res = await fetch(
      `https://slack.com/api/conversations.members?channel=${slackChannelId}`,
      {
        headers: { Authorization: `Bearer ${botToken}` },
      },
    );
    const data = await res.json();
    if (!data.ok) {
      logger.warn("Failed to check DM members", {
        error: data.error,
        slackChannelId,
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
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch (err) {
    logger.warn("Failed to download Slack file", { url, error: String(err) });
    return null;
  }
}

/**
 * Parse a pre-parsed Slack event body into an InboundParseResult.
 * Looks up the Channel record via user_id (sender's Slack ID) for precise
 * per-user routing. Falls back to bot_user_id authorization match if no
 * user_id is stored (e.g. manually configured channels).
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

  // For DMs, verify the channel is with the CORE bot
  if (event.channel_type === "im" && event.channel) {
    const botDM = await isDMWithBot(event.channel, slackUserId);
    if (!botDM) {
      logger.info("Ignoring DM not directed at CORE bot", {
        channel: event.channel,
      });
      return {};
    }
  }

  // Look up Channel by the sender's Slack user_id stored in config.
  // This is set on OAuth connect (account.accountId) and optionally on manual config.
  let channel = await prisma.channel.findFirst({
    where: {
      type: "slack",
      isActive: true,
      config: { path: ["user_id"], equals: slackUserId },
    },
  });

  // Fallback: match by bot_user_id from authorizations (covers manual channels
  // where user_id is not set, single-user workspaces)
  if (!channel) {
    channel = await findChannelByAuthorization(eventBody);
  }

  if (!channel) {
    logger.warn("No Slack channel found for inbound message", { slackUserId });
    return {};
  }

  const config = channel.config as Record<string, string>;
  const botToken = config.bot_token;

  // Resolve the CORE user for this workspace
  const workspace = await prisma.workspace.findUnique({
    where: { id: channel.workspaceId },
    include: { UserWorkspace: { include: { user: true }, take: 1 } },
  });

  const workspaceUser = workspace?.UserWorkspace[0];
  if (!workspaceUser) {
    logger.warn("No user found for workspace", {
      workspaceId: channel.workspaceId,
    });
    return {};
  }

  const metadata: Record<string, string> = {
    channel: "slack",
    slackUserId,
  };

  if (event.channel) {
    metadata.eventChannel = event.channel;
  }
  if (event.ts) {
    metadata.messageTs = event.ts;
  }
  if (event.thread_ts) {
    metadata.threadTs = event.thread_ts;
    metadata.sessionId = event.thread_ts;
  }
  if (event.type === "app_mention" && event.channel) {
    metadata.slackChannel = event.channel;
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
      userId: workspaceUser.userId,
      workspaceId: channel.workspaceId,
      userMessage: text,
      replyTo: slackUserId,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  };
}

/**
 * Parse a raw Slack Events API request into an InboundParseResult.
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
