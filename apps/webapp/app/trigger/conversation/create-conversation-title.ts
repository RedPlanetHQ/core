import { PrismaClient } from "@prisma/client";
import { LLMMappings } from "@core/types";
import { logger, task } from "@trigger.dev/sdk/v3";
import { generate } from "../chat/stream-utils";
import { conversationTitlePrompt } from "./prompt";

const prisma = new PrismaClient();
export const createConversationTitle = task({
  id: "create-conversation-title",
  run: async (payload: { conversationId: string; message: string }) => {
    let conversationTitleResponse = "";
    const gen = generate(
      [
        {
          role: "user",
          content: conversationTitlePrompt.replace(
            "{{message}}",
            payload.message,
          ),
        },
      ],
      false,
      () => {},
      undefined,
      "",
      LLMMappings.GPT41,
    );

    for await (const chunk of gen) {
      if (typeof chunk === "string") {
        conversationTitleResponse += chunk;
      } else if (chunk && typeof chunk === "object" && chunk.message) {
        conversationTitleResponse += chunk.message;
      }
    }

    const outputMatch = conversationTitleResponse.match(
      /<output>(.*?)<\/output>/s,
    );

    logger.info(`Conversation title data: ${JSON.stringify(outputMatch)}`);

    if (!outputMatch) {
      logger.error("No output found in recurrence response");
      throw new Error("Invalid response format from AI");
    }

    const jsonStr = outputMatch[1].trim();
    const conversationTitleData = JSON.parse(jsonStr);

    if (conversationTitleData) {
      await prisma.conversation.update({
        where: {
          id: payload.conversationId,
        },
        data: {
          title: conversationTitleData.title,
        },
      });
    }
  },
});
