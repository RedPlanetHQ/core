import {
  streamText,
  validateUIMessages,
  type LanguageModel,
  generateId,
  stepCountIs,
} from "ai";
import { z } from "zod";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getConversationAndHistory,
  upsertConversationHistory,
} from "~/services/conversation.server";

import { getModel } from "~/lib/model.server";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { addToQueue } from "~/lib/ingest.server";
import { buildAgentContext } from "~/services/agent/agent-context";

const ChatRequestSchema = z.object({
  message: z
    .object({
      id: z.string().optional(),
      parts: z.array(z.any()),
      role: z.string(),
    })
    .optional(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        parts: z.array(z.any()),
        role: z.string(),
      }),
    )
    .optional(),
  id: z.string(),
  needsApproval: z.boolean().optional(),
  source: z.string().default("core"),
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
    const conversation = await getConversationAndHistory(
      body.id,
      authentication.userId,
    );
    const isAssistantApproval = body.needsApproval;

    const conversationHistory = conversation?.ConversationHistory ?? [];

    if (conversationHistory.length === 1 && !isAssistantApproval) {
      const message = body.message?.parts[0].text;
      // Trigger conversation title task
      await enqueueCreateConversationTitle({
        conversationId: body.id,
        message,
      });
    }

    if (conversationHistory.length > 1 && !isAssistantApproval) {

      const message = body.message?.parts[0].text;
      const messageParts = body.message?.parts;

      await upsertConversationHistory(
        message.id ?? crypto.randomUUID(),
        messageParts,
        body.id,
        UserTypeEnum.User,
      );
    }

    const messages = conversationHistory.map((history: any) => {
      return {
        parts: history.parts,
        role:
          history.role ?? (history.userType === "Agent" ? "assistant" : "user"),
        id: history.id,
      };
    });

    let finalMessages = messages;
    const message = body.message?.parts[0].text;

    if (!isAssistantApproval) {
      const message = body.message?.parts[0].text;
      const id = body.message?.id;

      finalMessages = [
        ...messages,
        {
          parts: [{ text: message, type: "text" }],
          role: "user",
          id: id ?? generateId(),
        },
      ];
    } else {
      finalMessages = body.messages as any;
    }

    const validatedMessages = await validateUIMessages({
      messages: finalMessages,
    });

    // If onboarding and no messages yet, use empty messages for agent greeting
    const useEmptyMessages = conversationHistory.length === 0;

    const { systemPrompt, tools, modelMessages } = await buildAgentContext({
      userId: authentication.userId,
      workspaceId: authentication.workspaceId as string,
      source: body.source as any,
      finalMessages: useEmptyMessages ? [] : finalMessages,
    });

    const result = streamText({
      model: getModel() as LanguageModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...modelMessages,
      ],
      tools,
      stopWhen: [stepCountIs(10)],
      temperature: 0.5,
    });

    result.consumeStream(); // no await


    return result.toUIMessageStreamResponse({
      generateMessageId: () => crypto.randomUUID(),
      originalMessages: validatedMessages,
      onError: (error) => {
        console.log(error)
        return "asdf"
      },
      onFinish: async ({ messages }) => {
        const lastMessage = messages.pop();

        if (lastMessage) {
          await upsertConversationHistory(
            lastMessage?.id ?? crypto.randomUUID(),
            lastMessage?.parts,
            body.id,
            UserTypeEnum.Agent,
          );

          // Extract text from message parts and add to queue for ingestion
          const textParts = lastMessage?.parts
            ?.filter((part: any) => part.type === "text" && part.text)
            .map((part: any) => part.text);

          if (textParts && textParts.length > 0) {
            const messageText = textParts.join("\n");

            await addToQueue(
              {
                episodeBody: `<user>${message}</user><assistant>${messageText}</assistant>`,
                source: "core",
                referenceTime: new Date().toISOString(),
                type: EpisodeType.CONVERSATION,
                sessionId: body.id,
              },
              authentication.userId,
              authentication.workspaceId || ""
            );
          }
        }
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
