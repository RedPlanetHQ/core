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
// WhatsApp channel
// ---------------------------------------------------------------------------

/**
 * Called after the user connects WhatsApp via the verify token flow.
 * Attaches phone_number + workspaceId to an existing custom WhatsApp channel
 * (one with account_sid already configured), or creates a minimal one that
 * falls back to env-var Twilio credentials at send time.
 */
export async function ensureWhatsAppChannel(
  workspaceId: string,
  phoneNumber: string,
): Promise<void> {
  const existing = await prisma.channel.findFirst({
    where: { workspaceId, type: "whatsapp" },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    const config = existing.config as Record<string, string>;
    await prisma.channel.update({
      where: { id: existing.id },
      data: {
        config: { ...config, phone_number: phoneNumber, workspaceId },
        isActive: true,
      },
    });
    return;
  }

  await prisma.channel.create({
    data: {
      workspaceId,
      name: "WhatsApp",
      type: "whatsapp",
      config: { phone_number: phoneNumber, workspaceId },
      isDefault: false,
      isActive: true,
    },
  });

  logger.info("Created WhatsApp channel", { workspaceId, phoneNumber });
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
// Channel context — single source of truth for agent / reminder code
// ---------------------------------------------------------------------------

export interface ChannelRecord {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

export interface WorkspaceChannelContext {
  /** Raw channel records (active, ordered default-first) */
  channels: ChannelRecord[];
  /** Unique channel types present (e.g. ["email", "slack"]) */
  availableTypes: MessageChannel[];
  /** Channel names for LLM-facing enum (e.g. ["Email", "Work Slack"]) */
  channelNames: string[];
  /** Default channel type (from first default channel, or "email") */
  defaultChannelType: MessageChannel;
  /** Default channel name */
  defaultChannelName: string;
  /**
   * Resolve a channel name or type → { channelId, channelType }.
   * Tries name match first, then type match. Returns null if not found.
   */
  resolveChannel: (nameOrType: string) => {
    channelId: string;
    channelType: MessageChannel;
  } | null;
}

/**
 * Load all active channels for a workspace and return a reusable context object.
 * This is the single query — call once and thread the result through.
 */
export async function getWorkspaceChannelContext(
  workspaceId: string,
): Promise<WorkspaceChannelContext> {
  const records = await prisma.channel.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, type: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  const byName = new Map<string, ChannelRecord>();
  const byType = new Map<string, ChannelRecord>(); // first record per type
  const types = new Set<MessageChannel>();

  for (const ch of records) {
    byName.set(ch.name, ch);
    if (!byType.has(ch.type)) byType.set(ch.type, ch);
    types.add(ch.type as MessageChannel);
  }

  const defaultRecord = records.find((ch) => ch.isDefault) ?? records[0];

  return {
    channels: records,
    availableTypes: Array.from(types),
    channelNames: records.map((ch) => ch.name),
    defaultChannelType: (defaultRecord?.type as MessageChannel) ?? "email",
    defaultChannelName: defaultRecord?.name ?? "Email",
    resolveChannel(nameOrType: string) {
      // Try exact name match first
      const byNameMatch = byName.get(nameOrType);
      if (byNameMatch) {
        return {
          channelId: byNameMatch.id,
          channelType: byNameMatch.type as MessageChannel,
        };
      }
      // Fall back to type match (backward compat: LLM passes "slack" instead of "Work Slack")
      const byTypeMatch = byType.get(nameOrType);
      if (byTypeMatch) {
        return {
          channelId: byTypeMatch.id,
          channelType: byTypeMatch.type as MessageChannel,
        };
      }
      return null;
    },
  };
}

/**
 * Resolve a channel name or type to its MessageChannel type.
 * Looks up by channelId first, then by name/type from the workspace context.
 * Falls back to "email" if nothing matches.
 */
export async function resolveChannelType(
  workspaceId: string,
  channelNameOrType: string,
  channelId?: string | null,
): Promise<MessageChannel> {
  if (channelId) {
    const record = await prisma.channel.findFirst({
      where: { id: channelId, isActive: true },
      select: { type: true },
    });
    if (record) return record.type as MessageChannel;
  }

  // Try as a type directly
  const validTypes: MessageChannel[] = [
    "email",
    "slack",
    "whatsapp",
    "telegram",
  ];
  if (validTypes.includes(channelNameOrType as MessageChannel)) {
    return channelNameOrType as MessageChannel;
  }

  // Try as a name from the Channel table
  const record = await prisma.channel.findFirst({
    where: { workspaceId, name: channelNameOrType, isActive: true },
    select: { type: true },
  });
  if (record) return record.type as MessageChannel;

  return "email";
}

/**
 * @deprecated Use getWorkspaceChannelContext instead.
 */
export async function getAvailableChannels(
  workspaceId: string,
): Promise<MessageChannel[]> {
  const ctx = await getWorkspaceChannelContext(workspaceId);
  return ctx.availableTypes;
}
