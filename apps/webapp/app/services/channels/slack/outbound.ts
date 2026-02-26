import { prisma } from "~/db.server";
import { sendSlackDM, sendSlackMessage } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";

/**
 * Look up the Slack bot token for a given Slack user ID.
 */
export async function getSlackBotToken(
  slackUserId: string,
  workspaceId?: string,
): Promise<string | null> {
  const account = await prisma.integrationAccount.findFirst({
    where: {
      accountId: slackUserId,
      integrationDefinition: { slug: "slack" },
      isActive: true,
      deleted: null,
      ...(workspaceId ? { workspaceId } : {}),
    },
    select: {
      integrationConfiguration: true,
    },
  });

  if (!account) {
    logger.error("No Slack integration account found for user", { slackUserId });
    return null;
  }

  const config = account.integrationConfiguration as Record<string, string>;
  return config?.bot_token ?? null;
}

/**
 * Send a Slack reply.
 * - If metadata has slackChannel/threadTs (from @mention), replies in the channel thread.
 * - Otherwise, sends a DM.
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  const botToken = await getSlackBotToken(to, metadata?.workspaceId as string | undefined);

  if (!botToken) {
    logger.error("No bot_token in Slack integration config", { slackUserId: to });
    return;
  }

  // @mention — reply in the channel thread
  const slackChannel = metadata?.slackChannel as string | undefined;
  if (slackChannel) {
    const threadTs = metadata?.threadTs as string | undefined;
    await sendSlackMessage(botToken, slackChannel, text, threadTs);
    return;
  }

  // DM
  await sendSlackDM(botToken, to, text);
}
