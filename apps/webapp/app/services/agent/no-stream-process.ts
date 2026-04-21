import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
  setActiveStreamId,
  clearActiveStreamId,
} from "../conversation.server";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { generateId, stepCountIs, JsonToSseTransformStream } from "ai";
import { Agent, convertMessages } from "@mastra/core/agent";
import type { OutputProcessor } from "@mastra/core/processors";
import { buildAgentContext } from "./context";
import { getMastra } from "./mastra";
import { logger } from "~/services/logger.service";
import {
  getDefaultChatModelId,
  resolveModelConfig,
} from "~/services/llm-provider.server";
import {
  type Trigger,
  type DecisionContext,
} from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/executors/base";
import { createUIStreamWithApprovals } from "./mastra-stream.server";
import { getResumableStreamContext } from "~/bullmq/connection";
import { deductCredits } from "~/trigger/utils/utils";
import { addToQueue } from "~/lib/ingest.server";
import {
  selectModelMessages,
  generateWithRetry,
  describeAgentError,
  type MessageEntry,
} from "./context-window";

interface NoStreamProcessBody {
  id: string;
  message?: {
    id?: string;
    parts: any[];
    role: string;
  };
  messages?: {
    id?: string;
    parts: any[];
    role: string;
  }[];
  needsApproval?: boolean;
  source: string;
  /** Override the user type for the inbound message (e.g. System for reminders) */
  messageUserType?: UserTypeEnum;
  /** Trigger context — enables think tool for non-user triggers */
  triggerContext?: {
    trigger: Trigger;
    context: DecisionContext;
    reminderText: string;
    userPersona?: string;
  };
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>;
  /** Channel-specific metadata (messageSid, slackUserId, threadTs, etc.) */
  channelMetadata?: Record<string, string>;
  /** If true, the user message won't be saved to conversation history (still used as AI context) */
  skipUserMessage?: boolean;
  /** Optional executor tools — uses HttpOrchestratorTools for trigger/job contexts */
  executorTools?: OrchestratorTools;
  /** When set, adds add_comment tool for daily scratchpad responses */
  scratchpadPageId?: string;
  /** When true, write tools require user approval (default false) */
  interactive?: boolean;
}

export async function noStreamProcess(
  body: NoStreamProcessBody,
  userId: string,
  workspaceId: string,
) {
  const conversation = await getConversationAndHistory(body.id, userId);
  const isAssistantApproval = body.needsApproval;

  await updateConversationStatus(body.id, "running");

  const conversationHistory = conversation?.ConversationHistory ?? [];

  if (conversationHistory.length === 1 && !isAssistantApproval) {
    const message = body.message?.parts[0].text;
    // Trigger conversation title task
    await enqueueCreateConversationTitle({
      conversationId: body.id,
      message,
    });
  }

  const messageUserType = body.messageUserType ?? UserTypeEnum.User;

  if (
    conversationHistory.length > 1 &&
    !isAssistantApproval &&
    !body.skipUserMessage
  ) {
    const message = body.message?.parts[0].text;
    const messageParts = body.message?.parts;

    await upsertConversationHistory(
      message.id ?? crypto.randomUUID(),
      messageParts,
      body.id,
      messageUserType,
      false,
    );
  }

  const normalizeParts = (parts: any[] | undefined) =>
    (Array.isArray(parts) ? parts : []).filter(Boolean);

  const hasNonEmptyParts = (parts: any[] | undefined) =>
    normalizeParts(parts).length > 0;

  const historyMessages: MessageEntry[] = conversationHistory
    .map((history: any) => {
      const role =
        history.role ?? (history.userType === "Agent" ? "assistant" : "user");
      const normalized = normalizeParts(history.parts);
      const parts = (
        role === "assistant"
          ? normalized.filter((p: any) => p.type === "text")
          : normalized
      ).map((p: any) => {
        if (!p?.providerMetadata?.openai) return p;
        const { openai: _openai, ...restMeta } = p.providerMetadata;
        const cleaned = { ...p };
        if (Object.keys(restMeta).length > 0) {
          cleaned.providerMetadata = restMeta;
        } else {
          delete cleaned.providerMetadata;
        }
        return cleaned;
      });
      return { parts, role, id: history.id };
    })
    .filter((m) => hasNonEmptyParts(m.parts));

  const message = body.message?.parts[0].text;
  let finalMessages: MessageEntry[];

  if (!isAssistantApproval) {
    const id = body.message?.id;
    const userMessageId = id ?? generateId();
    const currentMessage: MessageEntry = {
      id: userMessageId,
      role: "user",
      parts: body.message?.parts ?? [{ text: message, type: "text" }],
    };
    const selection = await selectModelMessages({
      workspaceId,
      conversationId: body.id,
      history: historyMessages,
      currentMessage,
    });
    logger.info("Agent context selection", {
      conversationId: body.id,
      mode: selection.mode,
      totalMessages: selection.stats.totalMessages,
      keptMessages: selection.stats.keptMessages,
      estimatedTokens: selection.stats.estimatedTokens,
      compactTokens: selection.stats.compactTokens,
    });
    finalMessages = selection.messages;
  } else {
    finalMessages = body.messages as any;
  }

  const modelString = getDefaultChatModelId();
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
    thinkAgent,
    gatewayAgents,
  } = await buildAgentContext({
    userId,
    workspaceId,
    source: body.source as any,
    finalMessages,
    triggerContext: body.triggerContext,
    onMessage: body.onMessage,
    channelMetadata: body.channelMetadata,
    conversationId: body.id,
    executorTools: body.executorTools,
    interactive: body.interactive ?? false,
    modelConfig,
    scratchpadPageId: body.scratchpadPageId,
  });

  // Create core agent with subagents — think only present for triggered flows
  const subagents: Record<string, Agent> = {
    gather_context: gatherContextAgent,
    take_action: takeActionAgent,
  };

  if (thinkAgent) subagents.think = thinkAgent;
  for (const gw of gatewayAgents) {
    subagents[gw.id] = gw;
  }

  const agent = new Agent({
    id: "core-agent",
    name: "Core Agent",
    model: modelConfig as any,
    instructions: systemPrompt,
    agents: subagents,
  });

  // Wire Mastra for storage on all agent levels
  const mastra = getMastra();
  (agent as any).__registerMastra(mastra);
  (gatherContextAgent as any).__registerMastra(mastra);
  (takeActionAgent as any).__registerMastra(mastra);
  if (thinkAgent) (thinkAgent as any).__registerMastra(mastra);
  for (const gw of gatewayAgents) {
    (gw as any).__registerMastra(mastra);
  }

  // Capture final parts/text from outputProcessor for channel reply
  let capturedParts: any[] = [];
  let capturedText = "";

  const messageHistoryProcessor: OutputProcessor = {
    id: "message-history",
    async processInput({ messages }: any) {
      return messages;
    },
    async processOutputStep({ messages }: any) {
      const converted = convertMessages(messages).to("AIV5.UI") as any[];
      const lastMsg = converted[converted.length - 1];
      capturedParts = lastMsg?.parts ?? [];
      capturedText = capturedParts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      return messages;
    },
  };

  let agentResult: any;
  try {
    agentResult = await generateWithRetry({
      agent,
      modelMessages: modelMessages as unknown[],
      generateOptions: {
        toolsets: { core: tools },
        stopWhen: [stepCountIs(10)],
        modelSettings: { temperature: 0.5 },
        outputProcessors: [messageHistoryProcessor],
      },
      conversationId: body.id,
    });
  } catch (error) {
    // The agent blew up mid-generate (context overflow, provider timeout, etc.).
    // generateWithRetry already tried to recover from context-length errors by
    // dropping rounds; reaching this catch means that didn't work or the error
    // was of a different kind. Persist a graceful assistant message so the
    // user sees something instead of a silent drop, then mark the conversation
    // failed so status is accurate.
    const { kind, userMessage } = describeAgentError(error);
    logger.warn(
      "Agent generate failed after retries, posting fallback message",
      {
        conversationId: body.id,
        kind,
        error: error instanceof Error ? error.message : String(error),
        historyLength: conversationHistory.length,
      },
    );

    const fallbackMessageId = crypto.randomUUID();
    const fallbackParts = [{ type: "text", text: userMessage }];
    try {
      await upsertConversationHistory(
        fallbackMessageId,
        fallbackParts,
        body.id,
        UserTypeEnum.Agent,
        false,
      );
    } catch (persistError) {
      logger.error("Failed to persist fallback assistant message", {
        conversationId: body.id,
        error:
          persistError instanceof Error
            ? persistError.message
            : String(persistError),
      });
    }
    await updateConversationStatus(body.id, "failed");

    return {
      id: fallbackMessageId,
      role: "assistant",
      parts: fallbackParts,
      text: userMessage,
    };
  }

  // Build assistant parts from result.steps (handle Mastra payload wrapper)
  const assistantMessageId = crypto.randomUUID();
  const assistantParts: any[] = [];

  for (const step of agentResult.steps) {
    if (agentResult.steps.length > 1 && step !== agentResult.steps[0]) {
      assistantParts.push({ type: "step-start" });
    }

    for (const toolCall of step.toolCalls ?? []) {
      const tc = toolCall.payload ?? toolCall;
      const toolResult = (step.toolResults ?? []).find((r: any) => {
        const tr = r.payload ?? r;
        return tr.toolCallId === tc.toolCallId;
      });
      const tr = toolResult?.payload ?? toolResult;
      assistantParts.push({
        type: `tool-${tc.toolName}`,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        state: "output-available",
        input: tc.args,
        output: tr?.result,
      });
    }

    if (step.text) {
      assistantParts.push({ type: "text", text: step.text });
    }
  }

  const assistantMessage = {
    id: assistantMessageId,
    role: "assistant",
    parts: assistantParts,
  };

  try {
    await upsertConversationHistory(
      assistantMessageId,
      assistantParts,
      body.id,
      UserTypeEnum.Agent,
      false,
    );

    if (agentResult.text) {
      await addToQueue(
        {
          episodeBody: `<user>${message}</user><assistant>${agentResult.text}</assistant>`,
          source: body.source,
          referenceTime: new Date().toISOString(),
          type: EpisodeType.CONVERSATION,
          sessionId: body.id,
        },
        userId,
        workspaceId,
      );
    }

    if (!isBYOK) {
      await deductCredits(workspaceId, userId, "chatMessage", 1);
    }
  } finally {
    await updateConversationStatus(body.id, "completed");
  }

  return { ...assistantMessage, text: agentResult.text };

  // const uiStream = createUIStreamWithApprovals(agentResult);
  // const sseStream = uiStream.pipeThrough(new JsonToSseTransformStream());
  // const streamId = generateId();
  // await setActiveStreamId(body.id, streamId);

  // try {
  //   const ctx = getResumableStreamContext();
  //   const resumable = await ctx.createNewResumableStream(
  //     streamId,
  //     () => sseStream,
  //   );
  //   if (resumable) {
  //     const reader = resumable.getReader();
  //     while (true) {
  //       const { done } = await reader.read();
  //       if (done) break;
  //     }
  //     reader.releaseLock();
  //   }
  // } catch (error) {
  //   await updateConversationStatus(body.id, "failed");
  //   throw error;
  // } finally {
  //   await clearActiveStreamId(body.id);
  // }

  // return {
  //   id: crypto.randomUUID(),
  //   role: "assistant",
  //   parts: capturedParts,
  //   text: capturedText,
  // };
}
