/**
 * Voice-turn endpoint — entry point for the desktop voice widget.
 *
 * POST { conversationId?, transcript, pageContext?, mode? }
 *   - Resolves (or creates) the user's persistent "Quick Chat" conversation.
 *   - Persists the user's turn (transcript only — pageContext is per-request,
 *     not stored in conversation history).
 *   - Streams the agent reply via the same Mastra runtime as the main chat,
 *     with the voice-mode prompt block appended when mode === "voice".
 *
 * The response shape matches /api/v1/conversation: AI SDK v6 SSE.
 */

import { generateId, stepCountIs } from "ai";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import { type OutputProcessor, type Processor } from "@mastra/core/processors";
import { convertMessages } from "@mastra/core/agent";

import { UserTypeEnum } from "@core/types";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
  setActiveStreamId,
  clearActiveStreamId,
} from "~/services/conversation.server";
import {
  getDefaultChatModelId,
  resolveModelConfig,
} from "~/services/llm-provider.server";
import { buildAgentContext } from "~/services/agent/context";
import { mastra } from "~/services/agent/mastra";
import {
  saveConversationResult,
  createResumableUIResponse,
} from "~/services/agent/mastra-stream.server";
import {
  registerStream,
  unregisterStream,
} from "~/services/agent/stream-registry.server";
import { logger } from "~/services/logger.service";
import { getOrCreateQuickChat } from "~/services/voice-conversation.server";

const PageContextSchema = z.object({
  app: z.string(),
  title: z.string().optional(),
  text: z.string().optional(),
});

const VoiceTurnRequestSchema = z.object({
  conversationId: z.string().nullish(),
  transcript: z.string().min(1),
  pageContext: PageContextSchema.nullish(),
  mode: z.enum(["voice", "text"]).default("voice"),
  modelId: z.string().nullish(),
});

const { loader, action } = createHybridActionApiRoute(
  {
    body: VoiceTurnRequestSchema,
    allowJWT: true,
    authorization: { action: "conversation" },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const workspaceId = authentication.workspaceId as string;
    const userId = authentication.userId;

    const conversationId =
      body.conversationId ?? (await getOrCreateQuickChat(workspaceId, userId));

    // Persist user turn (transcript text only — pageContext stays per-request)
    const userMessageId = crypto.randomUUID();
    await upsertConversationHistory(
      userMessageId,
      [{ type: "text", text: body.transcript }],
      conversationId,
      UserTypeEnum.User,
    );

    // Build conversation history snapshot for the model
    const conversation = await getConversationAndHistory(conversationId, userId);
    const history = (conversation?.ConversationHistory ?? []).map(
      (h: any) => ({
        id: h.id,
        role: h.userType === "Agent" ? "assistant" : "user",
        parts:
          h.parts && Array.isArray(h.parts) && h.parts.length > 0
            ? h.parts
            : [{ type: "text", text: h.message ?? "" }],
      }),
    );

    const modelString = body.modelId ?? getDefaultChatModelId();
    const { modelConfig, isBYOK } = await resolveModelConfig(
      modelString,
      workspaceId,
    );

    const {
      systemPrompt,
      tools,
      modelMessages,
      gatherContextAgent,
      takeActionAgent,
      gatewayAgents,
    } = await buildAgentContext({
      userId,
      workspaceId,
      source: "core" as any,
      finalMessages: history,
      conversationId,
      interactive: false,
      modelConfig,
      mode: body.mode,
      pageContext: body.pageContext ?? null,
    });

    const subagents: Record<string, Agent> = {
      gather_context: gatherContextAgent,
      take_action: takeActionAgent,
    };
    for (const gw of gatewayAgents) {
      subagents[gw.id] = gw;
    }

    const agent = new Agent({
      id: "core-voice-agent",
      name: "Core Voice Agent",
      model: modelConfig as any,
      instructions: systemPrompt,
      agents: subagents,
    });
    agent.__registerMastra(mastra);
    gatherContextAgent.__registerMastra(mastra);
    takeActionAgent.__registerMastra(mastra);
    for (const gw of gatewayAgents) {
      (gw as any).__registerMastra(mastra);
    }

    const messageHistoryProcessor: Processor<"message-history"> = {
      id: "message-history",
      async processInput({ messages }) {
        return messages;
      },
      async processOutputResult({ messages }) {
        const convertedMessages = convertMessages(messages).to("AIV6.UI");
        const last = convertedMessages[convertedMessages.length - 1];
        await saveConversationResult({
          parts: last ? last.parts : [],
          conversationId,
          incomingUserText: body.transcript,
          incognito: conversation?.incognito,
          userId,
          workspaceId,
          isBYOK,
        });
        return messages;
      },
    };

    await updateConversationStatus(conversationId, "running");

    const streamId = generateId();
    const abortController = new AbortController();
    registerStream(streamId, abortController);
    await setActiveStreamId(conversationId, streamId);

    let stream;
    try {
      stream = await agent.stream(modelMessages, {
        toolsets: { core: tools },
        runId: conversationId,
        stopWhen: [stepCountIs(10)],
        toolCallConcurrency: 1,
        outputProcessors: [messageHistoryProcessor as OutputProcessor],
        modelSettings: { temperature: 0.5 },
        abortSignal: abortController.signal,
      });
    } catch (error) {
      logger.error("[voice-turn] agent.stream failed to start", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      unregisterStream(streamId);
      await clearActiveStreamId(conversationId);
      await updateConversationStatus(conversationId, "failed");
      throw error;
    }

    return createResumableUIResponse({
      agentResult: stream,
      streamId,
      conversationId,
      abortSignal: abortController.signal,
    });
  },
);

export { loader, action };
