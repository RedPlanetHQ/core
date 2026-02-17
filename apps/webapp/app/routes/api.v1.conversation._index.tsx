import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type LanguageModel,
  generateId,
  stepCountIs,
  type ModelMessage,
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
import { IntegrationLoader } from "~/utils/mcp/integration-loader";


import { addToQueue } from "~/lib/ingest.server";
import { getPersonaDocumentForUser } from "~/services/document.server";
import { getCorePrompt } from "~/services/agent/prompts";
import { getUserById } from "~/models/user.server";
import { createTools } from "~/services/agent/core-agent";

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

    // Get user's connected integrations
    const connectedIntegrations =
      await IntegrationLoader.getConnectedIntegrationAccounts(
        authentication.userId,
        authentication.workspaceId ?? "",
      );

    const integrationsList = connectedIntegrations
      .map(
        (int, index) =>
          `${index + 1}. **${int.integrationDefinition.name}** (Account ID: ${int.id})`,
      )
      .join("\n");

    let finalMessages = messages;

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

    const user = await getUserById(authentication.userId);
    // Fetch user's persona to condition AI behavior
    const latestPersona = await getPersonaDocumentForUser(authentication.workspaceId as string);
    const personaContent = latestPersona
      ? latestPersona
      : "";

    const metadata = user?.metadata as Record<string, unknown> | null;
    const timezone = metadata?.timezone as string ?? "UTC"
    const tools = await createTools(authentication.userId, authentication.workspaceId as string, timezone, body.source);


    // Build system prompt with persona context if available
    // Using minimal prompt for better execution without explanatory text
    // Use onboarding-specific capabilities if onboarding summary is available
    let systemPrompt = getCorePrompt('web', {
      name: user?.displayName ?? user?.name ?? user?.email ?? "",
      email: user?.email ?? "",
      timezone,
    }, personaContent);


    // Add connected integrations context
    const integrationsContext = `
    <connected_integrations>
    You have ${connectedIntegrations.length} connected integration accounts:
    ${integrationsList}

    To use these integrations, follow the 2-step workflow:
    1. get_integration_actions (provide accountId and query to discover available actions)
    2. execute_integration_action (provide accountId and action name to execute)

    IMPORTANT: Always use the Account ID when calling get_integration_actions and execute_integration_action.
    </connected_integrations>`;

    systemPrompt = `${systemPrompt}${integrationsContext}`;

    // Add current date and time context
    const now = new Date();
    const dateTimeContext = `
    <current_datetime>
    Current date and time: ${now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })}
    </current_datetime>`;

    systemPrompt = `${systemPrompt}${dateTimeContext}`;


    // If onboarding and no messages yet, generate first message from agent
    let modelMessages: ModelMessage[];
    if (conversationHistory.length === 0) {
      // Start with agent greeting - no user message yet
      modelMessages = [];
    } else {
      modelMessages = await convertToModelMessages(validatedMessages, {
        tools,
      });
    }

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

            // await addToQueue(
            //   {
            //     episodeBody: `<user>${message}</user><assistant>${messageText}</assistant>`,
            //     source: "core",
            //     referenceTime: new Date().toISOString(),
            //     type: EpisodeType.CONVERSATION,
            //     sessionId: body.id,
            //   },
            //   authentication.userId,
            //   authentication.workspaceId || ""
            // );
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
