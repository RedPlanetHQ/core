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
  deletePersonalAccessToken,
  getOrCreatePersonalAccessToken,
} from "~/services/personalAccessToken.server";
import {
  hasAnswer,
  hasQuestion,
  REACT_SYSTEM_PROMPT,
} from "~/lib/prompt.server";
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
  async ({ body, authentication }) => {
    const randomKeyName = `chat_local`;

    let pat = await getOrCreatePersonalAccessToken({
      name: randomKeyName,
      userId: authentication.userId,
    });

    if (!pat.token) {
      await deletePersonalAccessToken(pat.id);
    }

    pat = await getOrCreatePersonalAccessToken({
      name: randomKeyName,
      userId: authentication.userId,
    });

    const message = body.message.parts[0].text;
    const id = body.message.id;
    const apiEndpoint = `${env.APP_ORIGIN}/api/v1/mcp?source=core`;
    console.log(apiEndpoint);
    const url = new URL(apiEndpoint);

    const mcpClient = await createMCPClient({
      transport: new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: pat.token
            ? {
                Authorization: `Bearer ${pat.token}`,
              }
            : {},
        },
      }),
    });

    const conversation = await getConversationAndHistory(
      body.id,
      authentication.userId,
    );

    const conversationHistory = conversation?.ConversationHistory ?? [];

    if (conversationHistory.length === 0) {
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

    const tools = { ...(await mcpClient.tools()) };

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

    const result = streamText({
      model: getModel() as LanguageModel,
      messages: [
        {
          role: "system",
          content: REACT_SYSTEM_PROMPT,
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
