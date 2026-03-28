import { prisma } from "~/db.server";
import { sendSlackDM, sendSlackMessage } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";
import {
  markdownToSlackBlocks,
  markdownToPlainText,
} from "./slack-format";

/**
 * Look up the Slack bot token from the Channel table.
 * Prefers a specific Channel by channelId; falls back to the workspace's
 * default (or first active) Slack channel.
 */
export async function getSlackBotToken(
  workspaceId: string,
  channelId?: string,
): Promise<{ botToken: string } | null> {
  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, workspaceId, type: "slack", isActive: true },
      })
    : await prisma.channel.findFirst({
        where: { workspaceId, type: "slack", isActive: true },
        orderBy: { isDefault: "desc" },
      });

  if (!channel) {
    logger.error("No active Slack channel found", { workspaceId, channelId });
    return null;
  }

  const config = channel.config as Record<string, string>;
  if (!config.bot_token) {
    logger.error("No bot_token in Slack channel config", { channelId: channel.id });
    return null;
  }

  return { botToken: config.bot_token };
}

/**
 * Send a Slack reply.
 * - If metadata has slackChannel/threadTs (from @mention), replies in the channel thread.
 * - If metadata has channelId, uses that Channel record's channel_id for delivery.
 * - Otherwise, sends a DM to `to` (Slack user ID).
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  const workspaceId = metadata?.workspaceId as string | undefined;
  const channelId = metadata?.channelId as string | undefined;

  if (!workspaceId) {
    logger.error("No workspaceId in Slack reply metadata", { to });
    return;
  }

  const result = await getSlackBotToken(workspaceId, channelId);
  if (!result) return;

  const { botToken } = result;
  const blocks = markdownToSlackBlocks(text);
  const plainText = markdownToPlainText(text);

  // @mention — reply in the channel thread
  const slackChannel = metadata?.slackChannel as string | undefined;
  if (slackChannel) {
    const threadTs = metadata?.threadTs as string | undefined;
    await sendSlackMessage(botToken, slackChannel, plainText, threadTs, blocks);
    return;
  }

  // DM — `to` is the Slack user ID (set from inbound replyTo)
  await sendSlackDM(botToken, to, plainText, blocks);
}
