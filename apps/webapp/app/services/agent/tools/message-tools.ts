/**
 * Message delivery tool for trigger & background task contexts.
 *
 * Gives the butler a direct way to send messages to the user on their
 * configured channel — without relying on the pipeline's shouldMessage gate.
 */

import { type Tool, tool } from "ai";
import { z } from "zod";
import { UserTypeEnum } from "@core/types";

import { getChannel } from "~/services/channels";
import { getWorkspaceChannelContext } from "~/services/channel.server";
import { getOrCreateChannelConversation } from "~/services/agent/message-processor";
import { upsertConversationHistory } from "~/services/conversation.server";
import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

interface GetMessageToolsParams {
  workspaceId: string;
  userId: string;
  userEmail: string;
  userPhoneNumber?: string;
  /** Channel name/type from the trigger's reminder config */
  triggerChannel?: string;
  /** Channel ID from the trigger's reminder config */
  triggerChannelId?: string | null;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function getMessageTools(
  params: GetMessageToolsParams,
): Record<string, Tool> {
  const {
    workspaceId,
    userId,
    userEmail,
    userPhoneNumber,
    triggerChannel,
    triggerChannelId,
  } = params;

  return {
    send_message: tool({
      description:
        "Send a message to the user on their messaging channel. Use this to notify, update, or deliver results. Compose a natural, concise message — not a system notification.",
      inputSchema: z.object({
        message: z.string().describe("The message to send to the user"),
        subject: z
          .string()
          .optional()
          .describe("Email subject line. Only used when delivering via email."),
      }),
      execute: async ({ message, subject }) => {
        try {
          // ---------------------------------------------------------------
          // Resolve channel: trigger config → user default → email
          // ---------------------------------------------------------------
          let channelRecord: {
            id: string;
            type: string;
            config: Record<string, string>;
          } | null = null;

          // 1. Try trigger's channelId (most precise)
          if (triggerChannelId) {
            channelRecord = (await prisma.channel.findFirst({
              where: {
                id: triggerChannelId,
                workspaceId,
                isActive: true,
              },
            })) as typeof channelRecord;
          }

          // 2. Try trigger's channel name/type
          if (!channelRecord && triggerChannel) {
            channelRecord = (await prisma.channel.findFirst({
              where: {
                workspaceId,
                isActive: true,
                OR: [{ name: triggerChannel }, { type: triggerChannel }],
              },
              orderBy: { isDefault: "desc" },
            })) as typeof channelRecord;
          }

          // 3. Fall back to user's default channel
          if (!channelRecord) {
            const ctx = await getWorkspaceChannelContext(workspaceId);
            const defaultCh = ctx.channels.find((c) => c.isDefault) ?? ctx.channels[0];
            if (defaultCh) {
              channelRecord = (await prisma.channel.findFirst({
                where: { id: defaultCh.id, isActive: true },
              })) as typeof channelRecord;
            }
          }

          if (!channelRecord) {
            logger.warn("[send_message] No channel found, cannot deliver", {
              workspaceId,
              triggerChannel,
            });
            return "No active channel found. Message not sent.";
          }

          // ---------------------------------------------------------------
          // Resolve replyTo
          // ---------------------------------------------------------------
          const config = (channelRecord.config ?? {}) as Record<string, string>;
          const channelType = channelRecord.type;
          let replyTo: string;

          if (channelType === "slack") {
            replyTo = config.user_id ?? userEmail;
          } else if (channelType === "whatsapp") {
            replyTo = config.phone_number ?? userPhoneNumber ?? userEmail;
          } else if (channelType === "telegram") {
            replyTo = config.chat_id ?? userEmail;
          } else {
            replyTo = userEmail;
          }

          // ---------------------------------------------------------------
          // Send
          // ---------------------------------------------------------------
          const handler = getChannel(channelType);
          const metadata: Record<string, string> = {
            workspaceId,
            channelId: channelRecord.id,
          };

          if (channelType === "email" && subject) {
            metadata.subject = subject.slice(0, 120);
          }

          logger.info(`[send_message] Sending ${channelType} message`, {
            replyTo,
            channelId: channelRecord.id,
            messageLength: message.length,
            preview: message.slice(0, 100),
          });

          await handler.sendReply(replyTo, message, metadata);

          // ---------------------------------------------------------------
          // Mirror to channel conversation for reply context
          // ---------------------------------------------------------------
          try {
            const channelConversationId =
              await getOrCreateChannelConversation(
                userId,
                workspaceId,
                message,
                channelType,
                undefined,
                UserTypeEnum.Agent,
              );
            await upsertConversationHistory(
              crypto.randomUUID(),
              [{ text: message, type: "text" }],
              channelConversationId,
              UserTypeEnum.Agent,
              false,
            );
          } catch (mirrorError) {
            logger.warn("[send_message] Failed to mirror to channel conversation", {
              error: mirrorError,
            });
          }

          logger.info(`[send_message] Sent via ${channelType}`);
          return `Message sent via ${channelType}.`;
        } catch (error) {
          logger.error("[send_message] Failed to send message", { error });
          return `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
