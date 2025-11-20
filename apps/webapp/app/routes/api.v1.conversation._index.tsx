import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type LanguageModel,
  generateId,
  stepCountIs,
  tool,
  jsonSchema,
  type Tool,
} from "ai";
import { z } from "zod";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  createConversationHistory,
  getConversationAndHistory,
} from "~/services/conversation.server";

import { getModel } from "~/lib/model.server";
import { UserTypeEnum } from "@core/types";
import {
  hasAnswer,
  hasQuestion,
  REACT_SYSTEM_PROMPT,
} from "~/lib/prompt.server";
import { getUserPersonaContent } from "~/services/graphModels/document";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { callMemoryTool, memoryTools } from "~/utils/mcp/memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { logger } from "~/services/logger.service";

const ChatRequestSchema = z.object({
  message: z.object({
    id: z.string().optional(),
    parts: z.array(z.any()),
    role: z.string(),
  }),
  id: z.string(),
});

const { loader, action } = createHybridActionApiRoute(
  {
    body: ChatRequestSchema,
    allowJWT: true,
    authorization: {
      action: "conversation",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const message = body.message.parts[0].text;
    const messageParts = body.message.parts;
    const id = body.message.id;
    const workspace = await getWorkspaceByUser(authentication.userId);

    const integrationsConnection =
      await IntegrationLoader.loadIntegrationTransports(
        body.id,
        authentication.userId,
        workspace?.id as string,
        undefined,
      );

    logger.log(
      `Loaded ${integrationsConnection.loaded} integration transports`,
    );

    const conversation = await getConversationAndHistory(
      body.id,
      authentication.userId,
    );

    const conversationHistory = conversation?.ConversationHistory ?? [];

    if (conversationHistory.length === 1) {
      // Trigger conversation title task
      await enqueueCreateConversationTitle({
        conversationId: body.id,
        message,
      });
    }

    if (conversationHistory.length > 1) {
      await createConversationHistory(messageParts, body.id, UserTypeEnum.User);
    }

    const messages = conversationHistory.map((history: any) => {
      return {
        parts: history.parts,
        role: history.role ?? (history.userType === "Agent" ? "assistant" : "user"),
        id: history.id,
      };
    });

    const tools: Record<string, Tool> = {};

    memoryTools.forEach((mt) => {
      tools[mt.name] = tool({
        name: mt.name,
        inputSchema: jsonSchema(mt.inputSchema as any),
        description: mt.description,
        execute: async (params) => {
          return await callMemoryTool(
            mt.name,
            {
              sessionId: body.id,
              ...params,
              userId: authentication.userId,
              workspaceId: workspace?.id,
            },
            authentication.userId,
            "core",
          );
        },
      });
    });

    const finalMessages = [
      ...messages,
      {
        parts: [{ text: message, type: "text" }],
        role: "user",
        id: id ?? generateId(),
      },
    ];

    const validatedMessages = await validateUIMessages({
      messages: finalMessages,
    });

    // Fetch user's persona to condition AI behavior
    const personaContent = await getUserPersonaContent(authentication.userId);

    // Build system prompt with persona context if available
    let systemPrompt = REACT_SYSTEM_PROMPT;
    if (personaContent) {
      systemPrompt = `${REACT_SYSTEM_PROMPT}

<user_persona>
You are interacting with a user who has the following persona. Use this to understand their communication style, preferences, worldview, and behavior patterns. Adapt your responses to match their style and expectations.

${personaContent}
</user_persona>`;
    }

    const result = streamText({
      model: getModel() as LanguageModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...convertToModelMessages(validatedMessages, {
          tools,
        }),
      ],
      tools,

      stopWhen: [stepCountIs(10), hasAnswer, hasQuestion],
    });

    result.consumeStream(); // no await

    return result.toUIMessageStreamResponse({
      originalMessages: validatedMessages,
      onFinish: async ({ messages }) => {
        const lastMessage = messages.pop();

        await createConversationHistory(
          lastMessage?.parts,
          body.id,
          UserTypeEnum.Agent,
        );
      },
      // async consumeSseStream({ stream }) {
      //   // Create a resumable stream from the SSE stream
      //   const streamContext = createResumableStreamContext({ waitUntil: null });
      //   await streamContext.createNewResumableStream(
      //     conversation.conversationHistoryId,
      //     () => stream,
      //   );
      // },
    });
  },
);

export { loader, action };
