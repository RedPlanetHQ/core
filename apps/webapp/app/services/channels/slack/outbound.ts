import { prisma } from "~/db.server";
import { sendSlackDM, sendSlackMessage } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";

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
  // Find IntegrationAccount for this Slack user to get bot_token
  const account = await prisma.integrationAccount.findFirst({
    where: {
      accountId: to,
      integrationDefinition: { slug: "slack" },
      isActive: true,
      deleted: null,
      ...(metadata?.workspaceId ? { workspaceId: metadata.workspaceId as string } : {}),
    },
    select: {
      integrationConfiguration: true,
    },
  });

  if (!account) {
    logger.error("No Slack integration account found for user", { slackUserId: to });
    return;
  }

  const config = account.integrationConfiguration as Record<string, string>;
  const botToken = config?.bot_token;

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
