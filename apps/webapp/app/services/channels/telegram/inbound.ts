import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type { InboundParseResult } from "../types";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
    };
    chat: {
      id: number;
      type: string; // "private" | "group" | "supergroup" | "channel"
    };
    text?: string;
    date: number;
  };
}

/**
 * Parse a Telegram webhook update into an InboundParseResult.
 * Maps Telegram chat_id → CORE user via Channel.config.chat_id.
 */
export async function parseTelegramUpdate(
  update: TelegramUpdate,
  channelId?: string,
): Promise<InboundParseResult> {
  const message = update.message;
  if (!message) return {};

  const text = message.text ?? "";
  if (!text.trim()) return {};

  const telegramChatId = String(message.chat.id);

  // Look up Channel by chat_id in config
  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, type: "telegram", isActive: true },
      })
    : await prisma.channel.findFirst({
        where: {
          type: "telegram",
          isActive: true,
        },
      });

  if (!channel) {
    logger.warn("No active Telegram channel found", { telegramChatId, channelId });
    return {};
  }

  const config = channel.config as Record<string, string>;
  if (config.chat_id && config.chat_id !== telegramChatId) {
    logger.info("Telegram message from unknown chat, ignoring", {
      telegramChatId,
      expectedChatId: config.chat_id,
    });
    return {};
  }

  // Find the workspace user
  const workspace = await prisma.workspace.findUnique({
    where: { id: channel.workspaceId },
    include: { UserWorkspace: { include: { user: true }, take: 1 } },
  });

  const user = workspace?.UserWorkspace[0]?.user;
  if (!user) {
    logger.warn("No user found for workspace", { workspaceId: channel.workspaceId });
    return {};
  }

  const metadata: Record<string, string> = {
    channel: "telegram",
    telegramChatId,
    channelId: channel.id,
    messageId: String(message.message_id),
  };

  if (message.from?.username) {
    metadata.telegramUsername = message.from.username;
  }

  return {
    message: {
      userId: user.id,
      workspaceId: channel.workspaceId,
      userMessage: text,
      replyTo: telegramChatId,
      metadata,
    },
  };
}

export async function parseInbound(
  request: Request,
): Promise<InboundParseResult> {
  let body: TelegramUpdate;
  try {
    body = await request.json();
  } catch {
    return {};
  }

  return parseTelegramUpdate(body);
}
