import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import {
  getConversationAndHistory,
  upsertConversationHistory,
} from "../conversation.server";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { generateId, generateText, type LanguageModel, stepCountIs } from "ai";
import { buildAgentContext } from "./agent-context";
import { getModel } from "~/lib/model.server";
import { addToQueue } from "~/lib/ingest.server";
import { type MessagePlan } from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";
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
  /** Action plan from Decision Agent — passed to buildAgentContext for system prompt injection */
  actionPlan?: MessagePlan;
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
    return {
      parts: history.parts,
      role:
        history.role ?? (history.userType === "Agent" ? "assistant" : "user"),
      id: history.id,
    };
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

  const { systemPrompt, tools, modelMessages } = await buildAgentContext({
    userId,
    workspaceId,
    source: body.source as any,
    finalMessages,
    actionPlan: body.actionPlan,
    onMessage: body.onMessage,
    channelMetadata: body.channelMetadata,
    conversationId: body.id,
    executorTools: body.executorTools,
  });

  // Generate response using generateText (non-streaming)
  const result = await generateText({
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

  // Create assistant message with UI-compatible parts
  // (must match the format expected by convertToModelMessages on reload)
  // Build parts from result.steps so tool calls are preserved (not just result.text)
  const assistantMessageId = crypto.randomUUID();
  const assistantParts: any[] = [];

  for (const step of result.steps) {
    // Add step-start marker for multi-step flows (matches streaming format)
    if (result.steps.length > 1 && step !== result.steps[0]) {
      assistantParts.push({ type: "step-start" });
    }

    // Add tool invocation parts (matching the UIMessage format from streamText)
    for (const toolCall of step.toolCalls) {
      const toolResult = step.toolResults.find(
        (r: any) => r.toolCallId === toolCall.toolCallId,
      );
      assistantParts.push({
        type: `tool-${toolCall.toolName}`,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        state: "output-available",
        input: toolCall.input,
        output: toolResult?.output,
      });
    }

    // Add text part if this step produced text
    if (step.text) {
      assistantParts.push({ type: "text", text: step.text });
    }
  }

  const assistantMessage = {
    id: assistantMessageId,
    role: "assistant",
    parts: assistantParts,
  };

  // Save assistant message to history (use assistantParts — UI-compatible format)
  await upsertConversationHistory(
    assistantMessageId,
    assistantParts,
    body.id,
    UserTypeEnum.Agent,
    false,
  );

  // Add to ingestion queue
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

  return { ...assistantMessage, text: result.text };
}
