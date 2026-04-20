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

    parts.push(convertMastraChunkToAISDKv5({ chunk: step, mode: "stream" }));
  }

  return parts;
}

export interface SaveConversationResultParams {
  /** Stable ID for upsert — reused across intermediate saves and final save. */
  id?: string;
  parts: any[];
  conversationId: string;
  incomingUserText: string | undefined;
  incognito: boolean | undefined;
  userId: string;
  workspaceId: string;
  isBYOK?: boolean;
}

export async function saveConversationResult({
  id,
  parts,
  conversationId,
  incomingUserText,
  incognito,
  userId,
  workspaceId,
  isBYOK,
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
      id ?? crypto.randomUUID(),
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

  if (!isBYOK) {
    await deductCredits(workspaceId, userId, "chatMessage", 1);
  }
  await updateConversationStatus(conversationId, "completed");
}

/**
 * Wraps a Mastra agent result in an AI SDK v6 UI stream, transforming
 * tool-call-approval chunks into tool-approval-request events for the frontend.
 */
export function createUIStreamWithApprovals(
  agentResult: any,
  onApprovalDetected?: (toolCallId: string, approvalId: string) => Promise<void>,
): ReadableStream {
  const mastraStream = toAISdkStream(agentResult, {
    from: "agent",
    version: "v6",
  });

  return mastraStream.pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        if (
          chunk?.type === "data-tool-call-approval" &&
          chunk?.data?.toolCallId
        ) {
          const approvalId = generateId();
          logger.info(`[conversation] tool-call-approval:`, {
            toolCallId: chunk.data.toolCallId,
            toolName: chunk.data.toolName,
          });
          if (onApprovalDetected) {
            await onApprovalDetected(chunk.data.toolCallId, approvalId);
          }
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
}

export function streamToUIResponse(
  agentResult: any,
  onCancel?: () => void,
  onApprovalDetected?: (toolCallId: string, approvalId: string) => Promise<void>,
): Response {
  let stream = createUIStreamWithApprovals(agentResult, onApprovalDetected);

  if (onCancel) {
    // Pipe through a passthrough transform whose cancel() fires when the
    // client disconnects (readable side cancelled). request.signal does not
    // reliably fire in Remix streaming, so this is the reliable hook.
    stream = stream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
        cancel() {
          onCancel();
        },
      }),
    );
  }

  return createUIMessageStreamResponse({
    stream,
  });
}

/**
 * Fully consumes a Mastra agent result stream without sending it to the client.
 * Used to drain intermediate results in a multi-decision approval loop so that
 * each run's outputProcessors (history save) complete before the next starts.
 */
export async function drainAgentResult(agentResult: any): Promise<void> {
  if (!agentResult) return;
  try {
    const stream = toAISdkStream(agentResult, { from: "agent", version: "v6" });
    const reader = (stream as ReadableStream).getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    reader.releaseLock();
  } catch {
    // ignore drain errors — the important side-effects (outputProcessors) already ran
  }
}
