import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type LanguageModel,
  experimental_createMCPClient as createMCPClient,
  generateId,
  stepCountIs,
} from "ai";
import { z } from "zod";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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
import { env } from "~/env.server";

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
  async ({ body, authentication, request }) => {
    const message = body.message.parts[0].text;
    const id = body.message.id;
    const apiEndpoint = `${env.APP_ORIGIN}/api/v1/mcp?source=core`;

    const url = new URL(apiEndpoint);

    const mcpClient = await createMCPClient({
      transport: new StreamableHTTPClientTransport(url, {
        sessionId: body.id,
        requestInit: {
          headers: {
            Cookie: request.headers.get("Cookie") || "",
          },
        },
      }),
    });

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
      await createConversationHistory(message, body.id, UserTypeEnum.User);
    }

    const messages = conversationHistory.map((history: any) => {
      return {
        parts: [{ text: history.message, type: "text" }],
        role: "user",
        id: history.id,
      };
    });

    const tools = await mcpClient.tools();

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
        ...convertToModelMessages(validatedMessages),
      ],
      tools,

      stopWhen: [stepCountIs(10), hasAnswer, hasQuestion],
    });

    result.consumeStream(); // no await

    return result.toUIMessageStreamResponse({
      originalMessages: validatedMessages,
      onFinish: async ({ messages }) => {
        const lastMessage = messages.pop();
        let message = "";
        lastMessage?.parts.forEach((part) => {
          if (part.type === "text") {
            message += part.text;
          }
        });
        await mcpClient.close();

        await createConversationHistory(message, body.id, UserTypeEnum.Agent);
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
