import { generateId, stepCountIs } from "ai";
import { z } from "zod";
import { Agent, convertMessages } from "@mastra/core/agent";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
} from "~/services/conversation.server";
import { Agent } from "@mastra/core/agent";

import { toRouterString } from "~/lib/model.server";
import { env } from "~/env.server";
import { UserTypeEnum } from "@core/types";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { buildAgentContext } from "~/services/agent/context";
import { getMastra } from "~/services/agent/mastra";
import { logger } from "~/services/logger.service";
import {
  saveConversationResult,
  streamToUIResponse,
} from "~/services/agent/mastra-stream.server";
import { type OutputProcessor, type Processor } from "@mastra/core/processors";

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
  approved: z.boolean().optional(),
  toolCallId: z.string().optional(),
  source: z.string().default("core"),
});

function detectApprovalFromMessages(messages: any[]): boolean {
  if (!messages?.length) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg?.parts) continue;
    for (const part of msg.parts) {
      if (
        part.state === "approval-responded" &&
        part.approval?.approved === true
      ) {
        return true;
      }
    }
  }
  return false;
}

const normalizeParts = (parts: any[] | undefined) =>
  (Array.isArray(parts) ? parts : []).filter(Boolean);

const hasNonEmptyParts = (parts: any[] | undefined) =>
  normalizeParts(parts).length > 0;

const { loader, action } = createHybridActionApiRoute(
  {
    body: ChatRequestSchema,
    allowJWT: true,
    authorization: { action: "conversation" },
    corsStrategy: "all",
  },
  async ({ body, authentication, request }) => {
    const conversation = await getConversationAndHistory(
      body.id,
      authentication.userId,
    );
    const isAssistantApproval = body.needsApproval;
    const conversationHistory = conversation?.ConversationHistory ?? [];
    const incomingUserText = body.message?.parts?.[0]?.text;

    // -----------------------------------------------------------------------
    // Persist incoming user message (skip on approval flows)
    // -----------------------------------------------------------------------
    if (!isAssistantApproval) {
      if (conversationHistory.length === 1 && incomingUserText) {
        await enqueueCreateConversationTitle({
          conversationId: body.id,
          message: incomingUserText,
        });
      }

      const messageParts = normalizeParts(body.message?.parts);
      if (
        hasNonEmptyParts(messageParts) &&
        (conversationHistory.length === 0 || conversationHistory.length > 1)
      ) {
        await upsertConversationHistory(
          body.message?.id ?? crypto.randomUUID(),
          messageParts,
          body.id,
          UserTypeEnum.User,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Build message list for the model
    // -----------------------------------------------------------------------
    const historyMessages = conversationHistory.map((history: any) => {
      const role =
        history.role ?? (history.userType === "Agent" ? "assistant" : "user");
      const normalized = normalizeParts(history.parts);
      const parts =
        role === "assistant"
          ? normalized.filter((p: any) => p.type === "text")
          : normalized;
      return { parts, role, id: history.id };
    });

    const validHistory = historyMessages.filter((m: any) =>
      hasNonEmptyParts(m.parts),
    );

    let finalMessages: any[];
    if (isAssistantApproval) {
      finalMessages = ((body.messages as any[]) ?? [])
        .map((m: any) => ({ ...m, parts: normalizeParts(m.parts) }))
        .filter((m: any) => hasNonEmptyParts(m.parts));
    } else {
      const alreadyInHistory =
        !!body.message?.id &&
        validHistory[validHistory.length - 1]?.id === body.message.id;

      finalMessages =
        incomingUserText && !alreadyInHistory
          ? [
              ...validHistory,
              {
                parts: [{ text: incomingUserText, type: "text" }],
                role: "user",
                id: body.message?.id ?? generateId(),
              },
            ]
          : validHistory;
    }

    // -----------------------------------------------------------------------
    // Build agent + context
    // -----------------------------------------------------------------------
    const isTaskConversation = !!conversation?.asyncJobId;
    const useEmptyMessages =
      conversationHistory.length === 0 && !isTaskConversation;

    const {
      systemPrompt,
      tools,
      modelMessages,
      gatherContextAgent,
      takeActionAgent,
      gatewayAgents,
    } = await buildAgentContext({
      userId: authentication.userId,
      workspaceId: authentication.workspaceId as string,
      source: body.source as any,
      finalMessages: useEmptyMessages ? [] : finalMessages,
      conversationId: body.id,
    });

    const agent = new Agent({
      id: "core-agent",
      name: "Core Agent",
      model: toRouterString(env.MODEL),
      instructions: systemPrompt,
      agents: {
        gather_context: gatherContextAgent,
        take_action: takeActionAgent,
      },
    });

    const mastra = getMastra();
    agent.__registerMastra(mastra);
    gatherContextAgent.__registerMastra(mastra);
    takeActionAgent.__registerMastra(mastra);
    for (const gw of gatewayAgents) {
      gw.__registerMastra(mastra);
    }

    const saveParams = {
      conversationId: body.id,
      incomingUserText,
      incognito: conversation?.incognito,
      userId: authentication.userId,
      workspaceId: authentication.workspaceId || "",
    };

    const messageHistoryProcessor: Processor<"message-history"> = {
      id: "message-history",
      async processInput({ messages }) {
        return messages;
      },
      async processOutputResult({ messages }) {
        const convertedMessages = convertMessages(messages).to("AIV5.UI");
        await saveConversationResult({
          parts: convertedMessages[convertMessages.length - 1].parts,
          ...saveParams,
        });
        return messages;
      },
    };

    // -----------------------------------------------------------------------
    // Resume path — user approved/declined a suspended tool
    // -----------------------------------------------------------------------
    if (isAssistantApproval) {
      const approved =
        body.approved !== undefined
          ? body.approved
          : detectApprovalFromMessages(body.messages ?? []);

      logger.info(
        `[conversation] resuming: approved=${approved}, runId=${body.id}`,
      );

      let resumeResult;
      try {
        resumeResult = approved
          ? await agent.approveToolCall({
              runId: body.id,
              outputProcessors: [messageHistoryProcessor as OutputProcessor],
            })
          : await agent.declineToolCall({ runId: body.id });
        logger.info(
          `[conversation] approveToolCall obtained, runId=${resumeResult.runId}`,
        );
      } catch (err) {
        logger.error(`[conversation] approveToolCall failed`, {
          error: String(err),
          stack: (err as any)?.stack,
        });
        await updateConversationStatus(body.id, "failed");
        throw err;
      }

      return streamToUIResponse(resumeResult);
    }

    // -----------------------------------------------------------------------
    // Initial request path
    // -----------------------------------------------------------------------
    await updateConversationStatus(body.id, "running");

    const stream = await agent.stream(modelMessages, {
      toolsets: { core: tools },
      runId: body.id,
      stopWhen: [stepCountIs(10)],
      outputProcessors: [messageHistoryProcessor as OutputProcessor],
      modelSettings: { temperature: 0.5 },
    });

    return streamToUIResponse(stream);
  },
);

export { loader, action };
