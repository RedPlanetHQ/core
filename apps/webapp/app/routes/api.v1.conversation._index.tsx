import {
  generateId,
  stepCountIs,
  createUIMessageStreamResponse,
  createUIMessageStream,
} from "ai";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import { toAISdkStream } from "@mastra/ai-sdk";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getConversationAndHistory,
  updateConversationStatus,
  upsertConversationHistory,
} from "~/services/conversation.server";
import { Agent } from "@mastra/core/agent";

import { toRouterString } from "~/lib/model.server";
import { env } from "~/env.server";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { enqueueCreateConversationTitle } from "~/lib/queue-adapter.server";
import { addToQueue } from "~/lib/ingest.server";
import { buildAgentContext } from "~/services/agent/context";
import { getMastra } from "~/services/agent/mastra";
import { deductCredits } from "~/trigger/utils/utils";
import { logger } from "~/services/logger.service";

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
  source: z.string().default("core"),
});

/**
 * Detect whether the user approved or declined from the messages array.
 */
function detectApprovalFromMessages(messages: any[]): boolean {
  if (!messages?.length) return false;
  const last = messages[messages.length - 1];
  if (!last?.parts) return false;
  for (const part of last.parts) {
    if (part.state === "approval-responded" && part.approval) {
      return part.approval.approved === true;
    }
  }
  return false;
}

const { loader, action } = createHybridActionApiRoute(
  {
    body: ChatRequestSchema,
    allowJWT: true,
    authorization: {
      action: "conversation",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication, request }) => {
    const conversation = await getConversationAndHistory(
      body.id,
      authentication.userId,
    );
    const isAssistantApproval = body.needsApproval;

    const conversationHistory = conversation?.ConversationHistory ?? [];
    const normalizeParts = (parts: any[] | undefined) =>
      (Array.isArray(parts) ? parts : []).filter(Boolean);
    const hasNonEmptyParts = (parts: any[] | undefined) =>
      normalizeParts(parts).length > 0;
    const incomingUserText = body.message?.parts?.[0]?.text;

    if (
      conversationHistory.length === 1 &&
      !isAssistantApproval &&
      incomingUserText
    ) {
      // Trigger conversation title task
      await enqueueCreateConversationTitle({
        conversationId: body.id,
        message: incomingUserText,
      });
    }

    if (conversationHistory.length > 1 && !isAssistantApproval) {
      const messageParts = body.message?.parts;
      const normalizedMessageParts = normalizeParts(messageParts);

      if (hasNonEmptyParts(normalizedMessageParts)) {
        await upsertConversationHistory(
          body.message?.id ?? crypto.randomUUID(),
          normalizedMessageParts,
          body.id,
          UserTypeEnum.User,
        );
      }
    }

    if (conversationHistory.length === 0) {
      const messageParts = body.message?.parts;
      const normalizedMessageParts = normalizeParts(messageParts);

      if (hasNonEmptyParts(normalizedMessageParts)) {
        await upsertConversationHistory(
          body.message?.id ?? crypto.randomUUID(),
          normalizedMessageParts,
          body.id,
          UserTypeEnum.User,
        );
      }
    }

    const messages = conversationHistory.map((history: any) => {
      const role =
        history.role ?? (history.userType === "Agent" ? "assistant" : "user");
      // For assistant messages, only inject text parts — tool call internals bloat context
      const normalizedParts = normalizeParts(history.parts);
      const parts =
        role === "assistant"
          ? normalizedParts.filter((p: any) => p.type === "text")
          : normalizedParts;
      return { parts, role, id: history.id };
    });

    const finalFromHistory = messages.filter((m: any) =>
      hasNonEmptyParts(m.parts),
    );
    let finalMessages = finalFromHistory;
    const incomingMessageId = body.message?.id;

    if (!isAssistantApproval) {
      const message = incomingUserText;
      const id = body.message?.id;

      const last = finalFromHistory[finalFromHistory.length - 1];
      const alreadyInHistory = !!(
        incomingMessageId && last?.id === incomingMessageId
      );

      if (message && !alreadyInHistory) {
        finalMessages = [
          ...finalFromHistory,
          {
            parts: [{ text: message, type: "text" }],
            role: "user",
            id: id ?? generateId(),
          },
        ];
      }
    } else {
      finalMessages = (body.messages as any[]) ?? [];
      finalMessages = finalMessages
        .map((m: any) => ({
          ...m,
          parts: normalizeParts(m.parts),
        }))
        .filter((m: any) => hasNonEmptyParts(m.parts));
    }

    // If onboarding and no messages yet, use empty messages for agent greeting
    // But not for task conversations — those always have the user's first message
    const isTaskConversation = !!conversation?.asyncJobId;
    const useEmptyMessages =
      conversationHistory.length === 0 && !isTaskConversation;

    const { systemPrompt, tools, modelMessages, gatherContextAgent, takeActionAgent, gatewayAgents } =
      await buildAgentContext({
        userId: authentication.userId,
        workspaceId: authentication.workspaceId as string,
        source: body.source as any,
        finalMessages: useEmptyMessages ? [] : finalMessages,
        conversationId: body.id,
      });

    // Create core agent with gather_context + take_action orchestrators as subagents
    const agent = new Agent({
      id: "core-agent",
      name: "Core Agent",
      model: toRouterString(env.MODEL) as any,
      instructions: systemPrompt,
      agents: { gather_context: gatherContextAgent, take_action: takeActionAgent },
    });

    // Wire Mastra for storage on all agent levels
    const mastra = getMastra();
    (agent as any).__registerMastra(mastra);
    (gatherContextAgent as any).__registerMastra(mastra);
    (takeActionAgent as any).__registerMastra(mastra);
    for (const gw of gatewayAgents) {
      (gw as any).__registerMastra(mastra);
    }

    // -----------------------------------------------------------------------
    // Approval resume path
    // -----------------------------------------------------------------------
    if (isAssistantApproval) {
      // conversationId IS the runId — we pass body.id as runId on initial stream
      const approved = detectApprovalFromMessages(body.messages ?? []);
      logger.info(`[conversation] resuming approval: approved=${approved}, runId=${body.id}`);

      const resumeResult = approved
        ? await (agent as any).approveToolCall({ runId: body.id, maxSteps: 10 })
        : await (agent as any).declineToolCall({ runId: body.id, maxSteps: 10 });

      // Manual UIMessageStream (workaround: toAISdkStream crashes on resumed streams)
      const textPartId = generateId();
      const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
          writer.write({ type: "text-start", id: textPartId });
          const reader = resumeResult.textStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                writer.write({ type: "text-delta", id: textPartId, delta: value });
              }
            }
          } finally {
            reader.releaseLock();
          }
          writer.write({ type: "text-end", id: textPartId });

          // Save assistant message
          const finalText = await resumeResult.text;
          if (finalText) {
            const assistantMessageId = crypto.randomUUID();
            const assistantParts = [{ type: "text", text: finalText }];
            await upsertConversationHistory(
              assistantMessageId,
              assistantParts,
              body.id,
              UserTypeEnum.Agent,
            );

            if (!conversation?.incognito) {
              await addToQueue(
                {
                  episodeBody: `<user>${incomingUserText ?? ""}</user><assistant>${finalText}</assistant>`,
                  source: "core",
                  referenceTime: new Date().toISOString(),
                  type: EpisodeType.CONVERSATION,
                  sessionId: body.id,
                },
                authentication.userId,
                authentication.workspaceId || "",
              );
            }
          }

          await deductCredits(
            authentication.workspaceId || "",
            authentication.userId,
            "chatMessage",
            1,
          );
          await updateConversationStatus(body.id, "completed");
        },
      });

      return createUIMessageStreamResponse({ stream: uiStream });
    }

    // -----------------------------------------------------------------------
    // Initial request path
    // -----------------------------------------------------------------------
    await updateConversationStatus(body.id, "running");

    // Collect steps for building assistant parts after stream completes
    const collectedSteps: any[] = [];

    const stream = await agent.stream(modelMessages, {
      toolsets: { core: tools },
      runId: body.id,
      stopWhen: [stepCountIs(10)],
      modelSettings: { temperature: 0.5 },
      onStepFinish: (step: any) => {
        collectedSteps.push(step);
      },
    });

    // Save assistant message after stream completes
    stream.text
      .then(async (finalText) => {
        const assistantMessageId = crypto.randomUUID();
        const assistantParts: any[] = [];

        for (const step of collectedSteps) {
          if (collectedSteps.length > 1 && step !== collectedSteps[0]) {
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

        // Fallback: if no steps collected, save final text
        if (assistantParts.length === 0 && finalText) {
          assistantParts.push({ type: "text", text: finalText });
        }

        if (assistantParts.length > 0) {
          await upsertConversationHistory(
            assistantMessageId,
            assistantParts,
            body.id,
            UserTypeEnum.Agent,
          );

          // Extract text parts for ingestion
          const textParts = assistantParts
            .filter((p: any) => p.type === "text" && p.text)
            .map((p: any) => p.text);

          if (textParts.length > 0 && !conversation?.incognito) {
            const messageText = textParts.join("\n");

            await addToQueue(
              {
                episodeBody: `<user>${incomingUserText ?? ""}</user><assistant>${messageText}</assistant>`,
                source: "core",
                referenceTime: new Date().toISOString(),
                type: EpisodeType.CONVERSATION,
                sessionId: body.id,
              },
              authentication.userId,
              authentication.workspaceId || "",
            );
          }
        }

        await deductCredits(
          authentication.workspaceId || "",
          authentication.userId,
          "chatMessage",
          1,
        );

        await updateConversationStatus(body.id, "completed");
      })
      .catch((err) => {
        logger.error("[conversation] failed to save stream result", {
          error: String(err),
        });
        updateConversationStatus(body.id, "failed");
      });

    // Transform stream: convert data-tool-call-approval → tool-approval-request
    const mastraStream = toAISdkStream(stream, { from: "agent", version: "v6" });
    const transformed = mastraStream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          if (chunk?.type === "data-tool-call-approval" && chunk?.data?.toolCallId) {
            const approvalId = generateId();
            controller.enqueue({
              type: "tool-approval-request",
              approvalId,
              toolCallId: chunk.data.toolCallId,
            });
          } else {
            controller.enqueue(chunk);
          }
        },
      }),
    );

    return createUIMessageStreamResponse({ stream: transformed });
  },
);

export { loader, action };
