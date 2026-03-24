import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type { MessageChannel } from "~/services/agent/types";
import {
  setTelegramWebhook,
  deleteTelegramWebhook,
} from "~/services/channels/telegram/client";

export const DEFAULT_EMAIL_DOMAIN = "getcore.me";

export interface ChannelCreateData {
  name: string;
  type: "slack" | "telegram" | "whatsapp" | "email";
  config: Record<string, string>;
  isDefault?: boolean;
}

export interface ChannelUpdateData {
  name?: string;
  config?: Record<string, string>;
  isDefault?: boolean;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Default email channel
// ---------------------------------------------------------------------------

/**
 * Returns the canonical email address for a workspace's default email channel.
 */
export function workspaceEmailAddress(workspaceSlug: string): string {
  return `${workspaceSlug}@${DEFAULT_EMAIL_DOMAIN}`;
}

/**
 * Ensures a default email channel exists for the workspace.
 * Called on workspace creation and as a fallback on first use.
 */
export async function ensureDefaultEmailChannel(
  workspaceId: string,
  workspaceSlug: string,
): Promise<void> {
  const existing = await prisma.channel.findFirst({
    where: { workspaceId, type: "email" },
  });

  if (existing) return;

  await prisma.channel.create({
    data: {
      workspaceId,
      name: "Email",
      type: "email",
      config: { address: workspaceEmailAddress(workspaceSlug) },
      isDefault: true,
    },
  });

  logger.info("Created default email channel", { workspaceId, workspaceSlug });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getChannels(workspaceId: string) {
  return prisma.channel.findMany({
    where: { workspaceId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function getChannelById(channelId: string, workspaceId: string) {
  return prisma.channel.findFirst({
    where: { id: channelId, workspaceId },
  });
}

export async function createChannel(
  workspaceId: string,
  data: ChannelCreateData,
): Promise<{ id: string }> {
  if (data.isDefault) {
    await prisma.channel.updateMany({
      where: { workspaceId, type: data.type, isDefault: true },
      data: { isDefault: false },
    });
  }

  const channel = await prisma.channel.create({
    data: {
      workspaceId,
      name: data.name,
      type: data.type,
      config: data.config,
      isDefault: data.isDefault ?? false,
    },
  });

  // For Telegram: register webhook after creation so channelId is included in the URL
  if (data.type === "telegram") {
    const origin = process.env.APP_URL || "https://app.getcore.me";
    await setTelegramWebhook(
      data.config.bot_token,
      `${origin}/webhooks/telegram?channelId=${channel.id}`,
    );
  }

  logger.info("Channel created", {
    channelId: channel.id,
    type: data.type,
    workspaceId,
  });
  return { id: channel.id };
}

export async function updateChannel(
  channelId: string,
  workspaceId: string,
  data: ChannelUpdateData,
): Promise<void> {
  const existing = await prisma.channel.findFirst({
    where: { id: channelId, workspaceId },
  });

  if (!existing) throw new Error("Channel not found");

  if (data.isDefault) {
    await prisma.channel.updateMany({
      where: {
        workspaceId,
        type: existing.type,
        isDefault: true,
        id: { not: channelId },
      },
      data: { isDefault: false },
    });
  }

  await prisma.channel.update({
    where: { id: channelId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.config !== undefined && { config: data.config }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function deleteChannel(
  channelId: string,
  workspaceId: string,
): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, workspaceId },
  });

  if (!channel) throw new Error("Channel not found");

  // Email channels are permanent and cannot be removed
  if (channel.type === "email") {
    throw new Error("Default email channel cannot be removed");
  }

  // For Telegram: deregister webhook
  if (channel.type === "telegram") {
    const config = channel.config as Record<string, string>;
    await deleteTelegramWebhook(config.bot_token).catch((err) => {
      logger.warn("Failed to delete Telegram webhook", { error: String(err) });
    });
  }

  await prisma.channel.update({
    where: { id: channelId },
    data: { isActive: false },
  });

  logger.info("Channel deactivated", { channelId, workspaceId });
}

// ---------------------------------------------------------------------------
// Available channels for reminders
// ---------------------------------------------------------------------------

/**
 * Returns the list of available channel slugs for a workspace.
 * Always includes email. Also includes any active Channel records.
 * Used to validate reminder creation.
 */
export async function getAvailableChannels(
  workspaceId: string,
): Promise<MessageChannel[]> {
  const [workspace, channels] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { UserWorkspace: { include: { user: true }, take: 1 } },
    }),
    prisma.channel.findMany({
      where: { workspaceId, isActive: true },
      select: { type: true },
    }),
  ]);

  const user = workspace?.UserWorkspace[0]?.user;
  const available = new Set<MessageChannel>(["email"]);

  if (user?.phoneNumber) available.add("whatsapp");

  for (const ch of channels) {
    const type = ch.type as MessageChannel;
    if (type === "slack" || type === "telegram") {
      available.add(type);
    }
  }

  return Array.from(available);
}
