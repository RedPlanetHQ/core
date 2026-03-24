import { prisma } from "~/db.server";
import { sendTelegramMessage } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";

/**
 * Send a Telegram reply.
 * `to` = chat_id.
 * Bot token is looked up from the Channel record via metadata.channelId,
 * falling back to the first active Telegram channel in the workspace.
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  const channelId = metadata?.channelId as string | undefined;
  const workspaceId = metadata?.workspaceId as string | undefined;

  let channel;

  if (channelId) {
    channel = await prisma.channel.findFirst({
      where: { id: channelId, type: "telegram", isActive: true },
    });
  }

  if (!channel && workspaceId) {
    channel = await prisma.channel.findFirst({
      where: { workspaceId, type: "telegram", isActive: true },
      orderBy: { isDefault: "desc" },
    });
  }

  if (!channel) {
    logger.error("No active Telegram channel found for reply", { to, channelId, workspaceId });
    return;
  }

  const config = channel.config as Record<string, string>;
  const botToken = config.bot_token;

  if (!botToken) {
    logger.error("No bot_token in Telegram channel config", { channelId: channel.id });
    return;
  }

  // Telegram has a 4096 char limit per message; split if needed
  const chunks = chunkText(text, 4000);
  for (const chunk of chunks) {
    await sendTelegramMessage(botToken, to, chunk);
  }
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const idx = remaining.lastIndexOf("\n\n", max);
    const at = idx > 0 ? idx : max;
    chunks.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
