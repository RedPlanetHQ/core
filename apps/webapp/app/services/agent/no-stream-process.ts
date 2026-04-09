import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
  setActiveStreamId,
  clearActiveStreamId,
} from "../conversation.server";
import { UserTypeEnum } from "@core/types";
import { generateId, stepCountIs, JsonToSseTransformStream } from "ai";
import { Agent, convertMessages } from "@mastra/core/agent";
import type { OutputProcessor } from "@mastra/core/processors";
import { buildAgentContext } from "./context";
import { getMastra } from "./mastra";
import {
  getDefaultChatModelId,
  getBurstSafeBackgroundDelayMs,
  resolveModelConfig,
} from "~/services/llm-provider.server";
import {
  type Trigger,
  type DecisionContext,
} from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/executors/base";
import {
  createUIStreamWithApprovals,
  saveConversationResult,
} from "./mastra-stream.server";
import { runWithBurstRetry } from "./burst-retry.server";
import { getResumableStreamContext } from "~/bullmq/connection";

interface NoStreamProcessBody {
  id: string;
  modelId?: string;
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
    const delayMs = getBurstSafeBackgroundDelayMs();
    await enqueueCreateConversationTitle({
      conversationId: body.id,
      message,
    }, delayMs);
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

  const messages = conversationHistory.map((history: any) => {
    const role =
      history.role ?? (history.userType === "Agent" ? "assistant" : "user");
    // For assistant messages, only inject text parts — tool call internals bloat context
    const parts =
      role === "assistant"
        ? (history.parts ?? []).filter((p: any) => p.type === "text")
        : history.parts;
    return { parts, role, id: history.id };
  });

  const message = body.message?.parts[0].text;
  let finalMessages = messages;

  if (!isAssistantApproval) {
    const id = body.message?.id;
    const userMessageId = id ?? generateId();
    const latestHistoryMessage = messages[messages.length - 1];
    const currentMessageParts =
      body.message?.parts ?? [{ text: message, type: "text" }];
    const alreadyInHistory =
      latestHistoryMessage?.role === "user" &&
      JSON.stringify(latestHistoryMessage.parts ?? []) ===
        JSON.stringify(currentMessageParts);
    finalMessages = [
      ...messages,
      ...(!alreadyInHistory
        ? [
            {
              parts: currentMessageParts,
              role: "user",
              id: userMessageId,
            },
          ]
        : []),
    ];
  } else {
    finalMessages = body.messages as any;
  }

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
  let didPersistResult = false;

  const messageHistoryProcessor: OutputProcessor = {
    id: "message-history",
    async processInput({ messages }: any) {
      return messages;
    },
    async processOutputResult({ messages }: any) {
      const converted = convertMessages(messages).to("AIV5.UI") as any[];
      const lastMsg = converted[converted.length - 1];
      capturedParts = lastMsg?.parts ?? [];
      capturedText = capturedParts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      await saveConversationResult({
        parts: capturedParts,
        conversationId: body.id,
        incomingUserText: message,
        incognito: conversation?.incognito ?? false,
        userId,
        workspaceId,
        isBYOK,
      });
      didPersistResult = true;
      return messages;
    },
  };

  let agentResult: any;
  try {
    agentResult = await runWithBurstRetry("conversation.generate", () =>
      agent.generate(modelMessages, {
        toolsets: { core: tools },
        stopWhen: [stepCountIs(10)],
        modelSettings: { temperature: 0.5 },
        outputProcessors: [messageHistoryProcessor],
      }),
    );
  } catch (error) {
    await updateConversationStatus(body.id, "failed");
    throw error;
  }

  // Build assistant parts from result.steps (handle Mastra payload wrapper)
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

  if (!didPersistResult && assistantParts.length > 0) {
    await saveConversationResult({
      parts: assistantParts,
      conversationId: body.id,
      incomingUserText: message,
      incognito: conversation?.incognito ?? false,
      userId,
      workspaceId,
      isBYOK,
    });
  }

  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: capturedParts.length > 0 ? capturedParts : assistantParts,
    text: capturedText || agentResult.text || "",
  };

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
