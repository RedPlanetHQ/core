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
import { deductCredits } from "~/trigger/utils/utils";

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
    const normalizeParts = (parts: any[] | undefined) =>
      (Array.isArray(parts) ? parts : []).filter(Boolean);
    const hasNonEmptyParts = (parts: any[] | undefined) =>
      normalizeParts(parts).length > 0;
    const incomingUserText = body.message?.parts?.[0]?.text;

    if (conversationHistory.length === 1 && !isAssistantApproval && incomingUserText) {
      // Trigger conversation title task
      await enqueueCreateConversationTitle({
        conversationId: body.id,
        message: incomingUserText,
      });
    }

    if (conversationHistory.length > 1 && !isAssistantApproval) {
      const messageParts = body.message?.parts;
      const normalizedMessageParts = normalizeParts(messageParts);

      if (hasNonEmptyParts(normalizedMessageParts)) {
        await upsertConversationHistory(
          body.message?.id ?? crypto.randomUUID(),
          normalizedMessageParts,
          body.id,
          UserTypeEnum.User,
        );
      }
    }

    const messages = conversationHistory.map((history: any) => {
      return {
        parts: normalizeParts(history.parts),
        role:
          history.role ?? (history.userType === "Agent" ? "assistant" : "user"),
        id: history.id,
      };
    });

    const finalFromHistory = messages.filter((m: any) => hasNonEmptyParts(m.parts));
    let finalMessages = finalFromHistory;
    const incomingMessageId = body.message?.id;

    if (!isAssistantApproval) {
      const message = incomingUserText;
      const id = body.message?.id;

      const last = finalFromHistory[finalFromHistory.length - 1];
      const alreadyInHistory = !!(incomingMessageId && last?.id === incomingMessageId);

      if (message && !alreadyInHistory) {
        finalMessages = [
          ...finalFromHistory,
          {
            parts: [{ text: message, type: "text" }],
            role: "user",
            id: id ?? generateId(),
          },
        ];
      }
    } else {
      finalMessages = (body.messages as any[]) ?? [];
      finalMessages = finalMessages
        .map((m: any) => ({
          ...m,
          parts: normalizeParts(m.parts),
        }))
        .filter((m: any) => hasNonEmptyParts(m.parts));
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
      conversationId: body.id,
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
      onError: (error: any) => {
        return error.message;
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
                episodeBody: `<user>${incomingUserText ?? ""}</user><assistant>${messageText}</assistant>`,
                source: "core",
                referenceTime: new Date().toISOString(),
                type: EpisodeType.CONVERSATION,
                sessionId: body.id,
              },
              authentication.userId,
              authentication.workspaceId || "",
            );
          }
        }

        await deductCredits(
          authentication.workspaceId || "",
          authentication.userId,
          "chatMessage",
          1,
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
