import { generateId, createUIMessageStreamResponse } from "ai";
import { toAISdkStream } from "@redplanethq/ai";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { addToQueue } from "~/lib/ingest.server";
import {
  upsertConversationHistory,
  updateConversationStatus,
} from "~/services/conversation.server";
import { deductCredits } from "~/trigger/utils/utils";
import { logger } from "~/services/logger.service";
import { convertMastraChunkToAISDKv5 } from "@mastra/core/stream";

/**
 * Builds assistant message parts from LLMStepResult[].
 * Parts are stored in AI SDK v6 UIMessage format:
 *   - { type: "tool-invocation", toolCallId, toolName, args, state: "result", result }
 *   - { type: "step-start" }
 *   - { type: "text", text }
 */
export function buildAssistantPartsFromSteps(steps: any[]): any[] {
  const parts: any[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    console.log(JSON.stringify(step) + "\n\n");
    parts.push(convertMastraChunkToAISDKv5({ chunk: step, mode: "stream" }));
  }

  return parts;
}

export interface SaveConversationResultParams {
  parts: any[];
  conversationId: string;
  incomingUserText: string | undefined;
  incognito: boolean | undefined;
  userId: string;
  workspaceId: string;
}

export async function saveConversationResult({
  parts,
  conversationId,
  incomingUserText,
  incognito,
  userId,
  workspaceId,
}: SaveConversationResultParams): Promise<void> {
  if (parts.length === 0) {
    const fallbackText = parts
      .map((s: any) => s.text)
      .filter(Boolean)
      .join("\n");
    if (fallbackText) parts.push({ type: "text", text: fallbackText });
  }

  if (parts.length > 0) {
    await upsertConversationHistory(
      crypto.randomUUID(),
      parts,
      conversationId,
      UserTypeEnum.Agent,
    );

    const textParts = parts
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text);

    if (textParts.length > 0 && !incognito) {
      await addToQueue(
        {
          episodeBody: `<user>${incomingUserText ?? ""}</user><assistant>${textParts.join("\n")}</assistant>`,
          source: "core",
          referenceTime: new Date().toISOString(),
          type: EpisodeType.CONVERSATION,
          sessionId: conversationId,
        },
        userId,
        workspaceId,
      );
    }
  }

  await deductCredits(workspaceId, userId, "chatMessage", 1);
  await updateConversationStatus(conversationId, "completed");
}

/**
 * Wraps a Mastra agent result in an AI SDK v6 UI stream, transforming
 * tool-call-approval chunks into tool-approval-request events for the frontend.
 */
export function createUIStreamWithApprovals(agentResult: any): ReadableStream {
  const mastraStream = toAISdkStream(agentResult, {
    from: "agent",
    version: "v6",
  });

  return mastraStream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (
          chunk?.type === "data-tool-call-approval" &&
          chunk?.data?.toolCallId
        ) {
          logger.info(`[conversation] tool-call-approval:`, {
            toolCallId: chunk.data.toolCallId,
            toolName: chunk.data.toolName,
          });
          controller.enqueue({
            type: "tool-approval-request",
            approvalId: generateId(),
            toolCallId: chunk.data.toolCallId,
          });
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  );
}

export function streamToUIResponse(agentResult: any): Response {
  return createUIMessageStreamResponse({
    stream: createUIStreamWithApprovals(agentResult),
  });
}
