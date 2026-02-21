import { prisma } from "~/db.server";
import { sendWhatsAppMessage } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";

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
  }

  await sendWhatsAppMessage(to, text);
}
