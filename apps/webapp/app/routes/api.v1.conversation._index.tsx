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
  getConversationAndHistory,
  upsertConversationHistory,
} from "~/services/conversation.server";

import { getModel } from "~/lib/model.server";
import { UserTypeEnum } from "@core/types";
import { AGENT_SYSTEM_PROMPT, SOL_CAPABILITIES } from "~/lib/prompt.server";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { callMemoryTool, memoryTools } from "~/utils/mcp/memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getWorkspaceByUser } from "~/models/workspace.server";

import { prisma } from "~/db.server";

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
      await IntegrationLoader.getMcpEnabledIntegrationAccounts(
        authentication.userId,
        workspace?.id ?? "",
      );

    const integrationsList = connectedIntegrations
      .map(
        (int, index) =>
          `${index + 1}. **${int.integrationDefinition.name}** (${int.integrationDefinition.slug})`,
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
    const latestPersona = await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: `persona-${workspace?.id}`,
        workspaceId: workspace?.id,
        status: "COMPLETED",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        data: true,
      },
    });
    const personaContent = latestPersona?.data
      ? (latestPersona.data as any).episodeBody
      : null;

    // Build system prompt with persona context if available
    // Using minimal prompt for better execution without explanatory text
    let systemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n${SOL_CAPABILITIES}`;

    // Add connected integrations context
    const integrationsContext = `
    <connected_integrations>
    You have ${connectedIntegrations.length} connected integrations:
    ${integrationsList}

    To use these integrations, follow the 3-step workflow:
    1. get_integration_actions (to discover available actions)
    2. execute_integration_action (to execute the action)
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

    // if (personaContent) {
    //   systemPrompt = `${systemPrompt}

    //   <user_persona>
    //   You are interacting with a user who has the following persona. Use this to understand their communication style, preferences, worldview, and behavior patterns. Adapt your responses to match their style and expectations.

    //   ${personaContent}
    //   </user_persona>`;
    // }

    const modelMessages = await convertToModelMessages(validatedMessages, {
      tools,
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
