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
import {
  AGENT_SYSTEM_PROMPT,
  SOL_CAPABILITIES,

} from "~/lib/prompt.server";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { callMemoryTool, memoryTools } from "~/utils/mcp/memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getWorkspaceByUser } from "~/models/workspace.server";

import { addToQueue } from "~/lib/ingest.server";
import { getPersonaDocumentForUser } from "~/services/document.server";

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
  needsApproval: z.boolean().optional(),
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
    const isAssistantApproval = body.needsApproval;

    const workspace = await getWorkspaceByUser(authentication.userId);

    const conversation = await getConversationAndHistory(
      body.id,
      authentication.userId,
    );

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

    const tools: Record<string, Tool> = {};

    memoryTools.forEach((mt) => {
      if (
        [
          "memory_ingest",
          "memory_about_user",
          "initialize_conversation_session",
          "get_integrations",
        ].includes(mt.name)
      ) {
        return;
      }

      // Check if any tool calls have destructiveHint: true
      const hasDestructiveTools = mt.annotations?.destructiveHint === true;
      const executeFn = async (params: any) => {
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
      };

      tools[mt.name] = tool({
        name: mt.name,
        inputSchema: jsonSchema(mt.inputSchema as any),
        description: mt.description,
        needsApproval: hasDestructiveTools,
        execute: executeFn,
      } as any);
    });

    // Get user's connected integrations
    const connectedIntegrations =
      await IntegrationLoader.getConnectedIntegrationAccounts(
        authentication.userId,
        workspace?.id ?? "",
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

    // Fetch user's persona to condition AI behavior
    const latestPersona = await getPersonaDocumentForUser(workspace?.id as string);
    const personaContent = latestPersona
      ? latestPersona
      : "";

    // Build system prompt with persona context if available
    // Using minimal prompt for better execution without explanatory text
    // Use onboarding-specific capabilities if onboarding summary is available
    const capabilities = SOL_CAPABILITIES;

    let systemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n<about_user>${personaContent}</about_user>\n\n${capabilities}`;

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
                episodeBody: messageText,
                source: "core",
                referenceTime: new Date().toISOString(),
                type: EpisodeType.CONVERSATION,
                sessionId: body.id,
              },
              authentication.userId,
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
