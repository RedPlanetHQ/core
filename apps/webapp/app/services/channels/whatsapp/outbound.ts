import { prisma } from "~/db.server";
import { sendWhatsAppMessage, type TwilioCredentials } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";
import { env } from "~/env.server";

/**
 * Check whether the workspace has a user message within the last 24 hours
 * (WhatsApp Business API policy — can only send proactive messages in this window).
 */
async function isWithin24hWindow(workspaceId: string): Promise<boolean> {
  try {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentUserMessage = await prisma.conversationHistory.findFirst({
      where: {
        conversation: {
          workspaceId,
          source: "whatsapp",
        },
        userType: "User",
        createdAt: { gte: cutoffTime },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const isWithin = recentUserMessage !== null;
    logger.info(`WhatsApp 24h window check for workspace ${workspaceId}: ${isWithin}`, {
      lastUserMessage: recentUserMessage?.createdAt,
      cutoffTime,
    });

    return isWithin;
  } catch (error) {
    logger.error("Failed to check WhatsApp 24h window", { error });
    return false;
  }
}

/**
 * Resolve Twilio credentials for a workspace.
 * Uses channel config if a custom WhatsApp channel exists, else falls back to env vars.
 */
async function resolveCredentials(
  workspaceId: string,
): Promise<TwilioCredentials | null> {
  const channel = await prisma.channel.findFirst({
    where: { workspaceId, type: "whatsapp", isActive: true },
    orderBy: { isDefault: "desc" },
  });

  if (channel) {
    const config = channel.config as Record<string, string>;
    if (config.account_sid && config.auth_token && config.whatsapp_number) {
      return {
        accountSid: config.account_sid,
        authToken: config.auth_token,
        whatsappNumber: config.whatsapp_number,
      };
    }
  }

  // Fallback to env vars
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_NUMBER) {
    return {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      whatsappNumber: env.TWILIO_WHATSAPP_NUMBER,
    };
  }

  return null;
}

/**
 * Send a WhatsApp reply.
 * Checks the 24-hour window policy before sending — silently skips if outside.
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  if (metadata?.workspaceId) {
    const allowed = await isWithin24hWindow(metadata.workspaceId);
    if (!allowed) {
      logger.info("WhatsApp 24h window expired, skipping send", {
        to,
        workspaceId: metadata.workspaceId,
      });
      return;
    }

    const creds = await resolveCredentials(metadata.workspaceId);
    if (creds) {
      await sendWhatsAppMessage(to, text, creds);
      return;
    }
  }

  // No workspaceId or no channel found — use env vars (no creds arg = env fallback)
  await sendWhatsAppMessage(to, text);
}
