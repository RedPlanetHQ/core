import {
  generateId,
  createUIMessageStreamResponse,
  JsonToSseTransformStream,
  UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { toAISdkStream } from "@redplanethq/ai";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { addToQueue } from "~/lib/ingest.server";
import {
  upsertConversationHistory,
  updateConversationStatus,
  clearActiveStreamId,
} from "~/services/conversation.server";
import { deductCredits } from "~/trigger/utils/utils";
import { creditsForTokens } from "~/jobs/credit_utils";
import {
  recordTokenUsage,
  type TokenUsageSource,
} from "~/services/tokenUsage.server";
import { logger } from "~/services/logger.service";
import { convertMastraChunkToAISDKv5 } from "@mastra/core/stream";
import { getResumableStreamContext } from "~/bullmq/connection";
import { unregisterStream } from "./stream-registry.server";

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
  /** Optional real token usage from the streaming agent result. */
  inputTokens?: number;
  outputTokens?: number;
  /** Bucket the tokens under. Defaults to "conversation". */
  tokenUsageSource?: TokenUsageSource;
  /** Model identifier for the rollup. */
  model?: string;
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
  inputTokens,
  outputTokens,
  tokenUsageSource,
  model,
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

  // Roll up token usage into the daily bucket. If the caller passed real
  // usage from agentResult.usage, use it. Otherwise fall back to a rough
  // char/4 estimate over the assistant text — good enough for the daily
  // aggregate until every streaming caller plumbs usage through.
  let inTok = Math.max(0, Math.floor(inputTokens ?? 0));
  let outTok = Math.max(0, Math.floor(outputTokens ?? 0));
  if (inTok === 0 && outTok === 0) {
    const textLen = parts
      .filter((p: any) => p.type === "text" && typeof p.text === "string")
      .reduce((n: number, p: any) => n + p.text.length, 0);
    const userLen = (incomingUserText ?? "").length;
    inTok = Math.floor(userLen / 4);
    outTok = Math.floor(textLen / 4);
  }

  // Charge from real token usage — the flat per-turn cost was replaced so a
  // turn that spends 20K tokens on tool loops isn't priced the same as a
  // one-sentence reply. Falls back to the char/4 estimate above when the
  // agent didn't report `totalUsage` (self-hosted / older providers).
  if (!isBYOK) {
    const chatCredits = creditsForTokens(inTok, outTok);
    await deductCredits(workspaceId, userId, "chatMessage", chatCredits);
  }

  await recordTokenUsage({
    workspaceId,
    userId,
    source: tokenUsageSource ?? "conversation",
    inputTokens: inTok,
    outputTokens: outTok,
    model,
  });

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

  type ApprovalChunk = {
    type?: string;
    data?: {
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      args?: unknown;
    };
  };

  return mastraStream.pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        const c = chunk as ApprovalChunk;
        if (
          c?.type === "data-tool-call-approval" &&
          c?.data?.toolCallId
        ) {
          const approvalId = generateId();
          logger.info(`[conversation] tool-call-approval:`, {
            toolCallId: c.data.toolCallId,
            toolName: c.data.toolName,
          });
          if (onApprovalDetected) {
            await onApprovalDetected(c.data.toolCallId, approvalId);
          }
          controller.enqueue({
            type: "tool-approval-request",
            approvalId,
            toolCallId: c.data.toolCallId,
            toolName: c.data.toolName,
            input: c.data.input ?? c.data.args,
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
        // `cancel` isn't part of the standard Transformer type but the DOM
        // implementation invokes it when the readable side is cancelled.
        ...({ cancel: () => onCancel() } as object),
      }),
    );
  }

  return createUIMessageStreamResponse({
    stream,
  });
}

/**
 * Wraps a Mastra agent result in a resumable SSE stream keyed by `streamId`.
 *
 * The underlying run survives client disconnects: the stream is buffered in
 * Redis via `resumable-stream`, so tab closes / network flaps don't abort it.
 * Only an explicit stop (via `stream-registry.stopStream`) or successful
 * completion terminates the producer.
 *
 * Finalization responsibilities:
 *  - On success: `messageHistoryProcessor` already sets status=completed and
 *    persists the assistant message. This helper only clears `activeStreamId`
 *    and unregisters the abort controller.
 *  - On cancel/failure: sets status=cancelled/failed and clears activeStreamId.
 *    No partial assistant message is persisted (cancelled runs leave no trace).
 */
export async function createResumableUIResponse(params: {
  agentResult: any;
  streamId: string;
  conversationId: string;
  abortSignal: AbortSignal;
  onApprovalDetected?: (toolCallId: string, approvalId: string) => Promise<void>;
}): Promise<Response> {
  const {
    agentResult,
    streamId,
    conversationId,
    abortSignal,
    onApprovalDetected,
  } = params;

  const source = createUIStreamWithApprovals(
    agentResult,
    onApprovalDetected,
  ).pipeThrough(new JsonToSseTransformStream());

  let settled = false;
  const settle = async (status: "completed" | "cancelled" | "failed") => {
    if (settled) return;
    settled = true;
    try {
      if (status !== "completed") {
        await updateConversationStatus(conversationId, status);
      }
      await clearActiveStreamId(conversationId);
      unregisterStream(streamId);
    } catch (err) {
      logger.error("[conversation] stream finalize failed", {
        conversationId,
        streamId,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const makeStream = (): ReadableStream<string> =>
    new ReadableStream<string>({
      async start(controller) {
        const reader = source.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
          await settle("completed");
        } catch (err) {
          const isAbort = abortSignal.aborted;
          controller.error(err);
          await settle(isAbort ? "cancelled" : "failed");
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // reader already released — ignore
          }
        }
      },
    });

  const ctx = getResumableStreamContext();
  const resumable = await ctx.createNewResumableStream(streamId, makeStream);
  if (!resumable) {
    await settle("failed");
    return new Response(null, { status: 204 });
  }

  return new Response(resumable as unknown as BodyInit, {
    headers: UI_MESSAGE_STREAM_HEADERS,
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
