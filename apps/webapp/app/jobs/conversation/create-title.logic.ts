import { z } from "zod";
import { conversationTitlePrompt } from "~/trigger/conversation/prompt";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { makeStructuredModelCall } from "~/lib/model.server";
import { runWithBurstRetry } from "~/services/agent/burst-retry.server";


export interface CreateConversationTitlePayload {
  conversationId: string;
  message: string;
}

export interface CreateConversationTitleResult {
  success: boolean;
  title?: string;
  error?: string;
}

const TitleSchema = z.object({
  title: z.string(),
});

/**
 * Core business logic for creating conversation titles
 * This is shared between Trigger.dev and BullMQ implementations
 */
export async function processConversationTitleCreation(
  payload: CreateConversationTitlePayload,
): Promise<CreateConversationTitleResult> {
  try {
    // Look up workspaceId from conversation for BYOK key resolution
    const conversation = await prisma.conversation.findUnique({
      where: { id: payload.conversationId },
      select: { workspaceId: true },
    });

    const { object } = await runWithBurstRetry("conversation.title", () =>
      makeStructuredModelCall(
        TitleSchema,
        [
          {
            role: "user",
            content: conversationTitlePrompt.replace(
              "{{message}}",
              payload.message,
            ),
          },
        ],
        "medium",
        "conversationTitle",
        undefined,
        conversation?.workspaceId ?? undefined,
      ),
    );

    const title = object.title?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "";

    logger.info(
      `Conversation title data: ${JSON.stringify({ hasTitle: !!title, preview: title.slice(0, 64) })}`,
    );

    if (!title) {
      logger.error("No title found in create conversation title response");
      throw new Error("Invalid response format from AI");
    }

    await prisma.conversation.update({
      where: { id: payload.conversationId },
      data: { title },
    });

    return { success: true, title };
  } catch (error: any) {
    logger.error(
      `Error creating conversation title for ${payload.conversationId}:`,
      error,
    );
    return { success: false, error: error.message };
  }
}
