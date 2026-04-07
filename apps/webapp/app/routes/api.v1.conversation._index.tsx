import { generateId, stepCountIs } from "ai";
import { z } from "zod";
import { Agent, convertMessages } from "@mastra/core/agent";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
} from "~/services/conversation.server";
import { toRouterString } from "~/lib/model.server";
import {
  getDefaultChatModelId,
  resolveModelConfig,
} from "~/services/llm-provider.server";
import { UserTypeEnum } from "@core/types";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { buildAgentContext } from "~/services/agent/context";
import { mastra } from "~/services/agent/mastra";
import { logger } from "~/services/logger.service";
import {
  saveConversationResult,
  streamToUIResponse,
  drainAgentResult,
} from "~/services/agent/mastra-stream.server";
import {
  InputProcessor,
  type OutputProcessor,
  type Processor,
} from "@mastra/core/processors";
import { patchArgsDeep } from "~/services/agent/tool-args-patch-processor";

import { RequestContext } from "@mastra/core/request-context";
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
  interactive: z.boolean().optional().default(true),
  toolArgOverrides: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional(),
  source: z.string().default("core"),
  modelId: z.string().optional(),
});

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

    const workspaceId = authentication.workspaceId as string;
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
      userId: authentication.userId,
      workspaceId,
      source: body.source as any,
      finalMessages: useEmptyMessages ? [] : finalMessages,
      conversationId: body.id,
      interactive: body.interactive,
      modelConfig,
    });

    const subagents: Record<string, Agent> = {
      gather_context: gatherContextAgent,
      take_action: takeActionAgent,
    };
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
    agent.__registerMastra(mastra);
    gatherContextAgent.__registerMastra(mastra);
    takeActionAgent.__registerMastra(mastra);
    for (const gw of gatewayAgents) {
      (gw as any).__registerMastra(mastra);
    }

    const saveParams = {
      conversationId: body.id,
      incomingUserText,
      incognito: conversation?.incognito,
      userId: authentication.userId,
      workspaceId: workspaceId || "",
      isBYOK,
    };

    const messageHistoryProcessor: Processor<"message-history"> = {
      id: "message-history",
      async processInput({ messages }) {
        return messages;
      },
      async processOutputResult({ messages }) {
        const convertedMessages = convertMessages(messages).to("AIV5.UI");
        console.log(convertedMessages);
        await saveConversationResult({
          parts: convertedMessages[convertedMessages.length - 1]
            ? convertedMessages[convertedMessages.length - 1].parts
            : [],
          ...saveParams,
        });
        return messages;
      },
    };

    // -----------------------------------------------------------------------
    // Resume path — user approved/declined a suspended tool
    // -----------------------------------------------------------------------
    if (isAssistantApproval) {
      const rawOverrides = body.toolArgOverrides ?? {};

      // Extract approval decisions from toolArgOverrides entries (approved key)
      const toolDecisions = Object.entries(rawOverrides).filter(
        ([, entry]) => "approved" in entry,
      ) as [string, { approved: boolean } & Record<string, unknown>][];

      logger.info(
        `[conversation] resuming: ${toolDecisions.length} approval(s), runId=${body.id}`,
      );

      let resumeResult: any;

      // Build nested arg overrides: strip 'approved' from each entry so only
      // the real tool args remain (accountId, action, parameters, etc.).
      // Entries that have nothing left after stripping are excluded.
      const nestedArgOverrides = Object.fromEntries(
        Object.entries(rawOverrides)
          .map(([id, { approved: _approved, ...rest }]) => [id, rest])
          .filter(([, rest]) => Object.keys(rest as object).length > 0),
      ) as Record<string, Record<string, unknown>>;

      const requestContext = new RequestContext<any>();
      requestContext.set(
        "toolArgsOverride",
        JSON.stringify(nestedArgOverrides),
      );
      try {
        for (let i = 0; i < toolDecisions.length; i++) {
          const [toolCallId, entry] = toolDecisions[i];
          const isLast = i === toolDecisions.length - 1;
          const { approved, ...args } = entry;

          if (approved) {
            resumeResult = await agent.approveToolCall({
              runId: body.id,
              toolCallId,
              toolCallConcurrency: 1,
              requestContext,
              prepareStep: (stepArgs) => {
                if (Object.keys(nestedArgOverrides).length === 0) return;
                // Deep-walk messages and patch args for any matching toolCallId,
                // regardless of how deeply nested the tool call is.
                //

                const patchedMessages = patchArgsDeep(
                  stepArgs.messages,
                  nestedArgOverrides,
                );

                return {
                  messages: patchedMessages as typeof stepArgs.messages,
                };
              },
              outputProcessors: [messageHistoryProcessor as OutputProcessor],
            });
          } else {
            resumeResult = await agent.declineToolCall({
              runId: body.id,
              toolCallId,
              outputProcessors: [messageHistoryProcessor as OutputProcessor],
            });
          }

          // Drain intermediate streams so each Mastra run finishes (and its
          // outputProcessors fire) before the next tool decision is processed.
          if (!isLast) {
            await drainAgentResult(resumeResult);
            resumeResult = undefined;
          }
        }
        logger.info(
          `[conversation] resume complete, runId=${resumeResult?.runId ?? body.id}`,
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

    // When the client aborts (user clicks Stop), update status so it doesn't stay "running"
    request.signal.addEventListener("abort", () => {
      updateConversationStatus(body.id, "completed").catch(() => {});
    });

    const stream = await agent.stream(modelMessages, {
      toolsets: { core: tools },
      runId: body.id,
      stopWhen: [stepCountIs(10)],
      toolCallConcurrency: 1,
      outputProcessors: [messageHistoryProcessor as OutputProcessor],
      modelSettings: { temperature: 0.5 },
      abortSignal: request.signal,
    });

    return streamToUIResponse(stream);
  },
);

export { loader, action };
