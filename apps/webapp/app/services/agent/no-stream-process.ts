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

  if (conversationHistory.length > 1 && !isAssistantApproval) {
    const message = body.message?.parts[0].text;
    const messageParts = body.message?.parts;

    await upsertConversationHistory(
      message.id ?? crypto.randomUUID(),
      messageParts,
      body.id,
      messageUserType,
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
    const message = body.message?.parts[0].text;
    const id = body.message?.id;
    const userMessageId = id ?? generateId();
    finalMessages = [
      ...messages,
      {
        parts: [{ text: message, type: "text" }],
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

  // Create assistant message
  const assistantMessageId = crypto.randomUUID();
  const assistantMessage = {
    id: assistantMessageId,
    role: "assistant",
    parts: result.response.messages,
  };

  // Save assistant message to history
  await upsertConversationHistory(
    assistantMessageId,
    assistantMessage.parts,
    body.id,
    UserTypeEnum.Agent,
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

  return assistantMessage;
}
