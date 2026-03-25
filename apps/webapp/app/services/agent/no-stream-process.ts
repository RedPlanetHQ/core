import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
} from "../conversation.server";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { generateId, stepCountIs } from "ai";
import { Agent } from "@mastra/core/agent";
import { buildAgentContext } from "./context";
import { getMastra } from "./mastra";
import { toRouterString } from "~/lib/model.server";
import { env } from "~/env.server";
import { addToQueue } from "~/lib/ingest.server";
import {
  type Trigger,
  type DecisionContext,
} from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/executors/base";
import { deductCredits } from "~/trigger/utils/utils";

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
    finalMessages = [
      ...messages,
      {
        parts: body.message?.parts ?? [{ text: message, type: "text" }],
        role: "user",
        id: userMessageId,
      },
    ];
  } else {
    finalMessages = body.messages as any;
  }

  const { systemPrompt, tools, modelMessages, gatherContextAgent, takeActionAgent, thinkAgent, gatewayAgents } =
    await buildAgentContext({
      userId,
      workspaceId,
      source: body.source as any,
      finalMessages,
      triggerContext: body.triggerContext,
      onMessage: body.onMessage,
      channelMetadata: body.channelMetadata,
      conversationId: body.id,
      executorTools: body.executorTools,
    });

  // Create core agent with subagents — think only present for triggered flows
  const subagents: Record<string, Agent> = {
    gather_context: gatherContextAgent,
    take_action: takeActionAgent,
  };
  if (thinkAgent) subagents.think = thinkAgent;

  const agent = new Agent({
    id: "core-agent",
    name: "Core Agent",
    model: toRouterString(env.MODEL) as any,
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

  let result: any;
  try {
    result = await agent.generate(modelMessages, {
      toolsets: { core: tools },
      stopWhen: [stepCountIs(10)],
      modelSettings: { temperature: 0.5 },
    });
  } catch (error) {
    await updateConversationStatus(body.id, "failed");
    throw error;
  }

  // Build assistant parts from result.steps (handle Mastra payload wrapper)
  const assistantMessageId = crypto.randomUUID();
  const assistantParts: any[] = [];

  for (const step of result.steps) {
    if (result.steps.length > 1 && step !== result.steps[0]) {
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

  await upsertConversationHistory(
    assistantMessageId,
    assistantParts,
    body.id,
    UserTypeEnum.Agent,
    false,
  );

  if (result.text) {
    await addToQueue(
      {
        episodeBody: `<user>${message}</user><assistant>${result.text}</assistant>`,
        source: body.source,
        referenceTime: new Date().toISOString(),
        type: EpisodeType.CONVERSATION,
        sessionId: body.id,
      },
      userId,
      workspaceId,
    );
  }

  await deductCredits(workspaceId, userId, "chatMessage", 1);
  await updateConversationStatus(body.id, "completed");

  return { ...assistantMessage, text: result.text };
}
