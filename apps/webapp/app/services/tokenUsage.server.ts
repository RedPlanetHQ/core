import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

export type TokenUsageSource =
  | "memory_ingestion"
  | "conversation"
  | "task_conversation";

interface RecordTokenUsageInput {
  workspaceId: string;
  userId: string;
  source: TokenUsageSource;
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

function utcDayBucket(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Roll up an LLM call's token usage into the daily bucket for
 * (date, userId, workspaceId, source, model). Concurrent calls collapse
 * into one row via atomic increments.
 *
 * Never throws: usage recording must not break the request path.
 */
export async function recordTokenUsage({
  workspaceId,
  userId,
  source,
  inputTokens,
  outputTokens,
  model,
}: RecordTokenUsageInput): Promise<void> {
  const inTok = Math.max(0, Math.floor(inputTokens || 0));
  const outTok = Math.max(0, Math.floor(outputTokens || 0));
  const total = inTok + outTok;

  if (total === 0) {
    return;
  }

  const date = utcDayBucket();
  const modelKey = model ?? "";

  try {
    await prisma.dailyTokenUsage.upsert({
      where: {
        date_userId_workspaceId_source_model: {
          date,
          userId,
          workspaceId,
          source,
          model: modelKey,
        },
      },
      create: {
        date,
        userId,
        workspaceId,
        source,
        model: modelKey,
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: total,
        eventCount: 1,
      },
      update: {
        inputTokens: { increment: inTok },
        outputTokens: { increment: outTok },
        totalTokens: { increment: total },
        eventCount: { increment: 1 },
      },
    });
  } catch (error) {
    logger.warn("recordTokenUsage failed", {
      error,
      workspaceId,
      userId,
      source,
      model: modelKey,
      inputTokens: inTok,
      outputTokens: outTok,
    });
  }
}
