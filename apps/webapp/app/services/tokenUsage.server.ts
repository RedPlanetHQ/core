import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

export type TokenUsageSource =
  | "memory_ingestion"
  | "conversation"
  | "task_conversation"
  | "background";

interface RecordTokenUsageInput {
  workspaceId: string;
  /** null when the call has no per-user actor (background/system work). */
  userId: string | null | undefined;
  source: TokenUsageSource;
  inputTokens: number;
  outputTokens: number;
  /** Model identifier (e.g. "claude-sonnet-4-6"). "" when unknown. */
  model?: string;
  /**
   * The makeModelCall `cacheKey` — "reflect-world", "extract-voice",
   * "conversationTitle", etc. Rolled up per key so dashboards can break
   * down which prompt is bleeding tokens. "" for chat/streaming turns.
   */
  operationKey?: string;
}

function utcDayBucket(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Extract input/output tokens from a Mastra agent result.
 *
 * Prefers `totalUsage` (sum across all steps of a tool loop) over `usage`
 * (last step only). For any agent that runs tool calls — which is most of
 * ours — `usage` alone undercounts the turn by 5-10x.
 */
export function pickAgentResultTokens(agentResult: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  const r = agentResult as
    | { totalUsage?: { inputTokens?: number; outputTokens?: number }; usage?: { inputTokens?: number; outputTokens?: number } }
    | null
    | undefined;
  const usage = r?.totalUsage ?? r?.usage;
  return {
    inputTokens: Number(usage?.inputTokens ?? 0),
    outputTokens: Number(usage?.outputTokens ?? 0),
  };
}

/**
 * Normalize a recording input into the values that land in the DB row.
 * Returns null when the row would be a no-op (both token counts zero).
 * Exposed so tests can assert on the derived shape without mocking Prisma.
 */
export interface NormalizedUsageRow {
  date: Date;
  workspaceId: string;
  userId: string | null;
  source: TokenUsageSource;
  model: string;
  operationKey: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function buildUsageRow(
  input: RecordTokenUsageInput,
): NormalizedUsageRow | null {
  const inTok = Math.max(0, Math.floor(input.inputTokens || 0));
  const outTok = Math.max(0, Math.floor(input.outputTokens || 0));
  const total = inTok + outTok;
  if (total === 0) return null;

  return {
    date: utcDayBucket(),
    workspaceId: input.workspaceId,
    // Coerce empty string to null so the DB stores a real NULL for the FK.
    userId: input.userId && input.userId.length > 0 ? input.userId : null,
    source: input.source,
    model: input.model ?? "",
    operationKey: input.operationKey ?? "",
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: total,
  };
}

/**
 * Roll up an LLM call's token usage into the daily bucket for
 * (date, userId, workspaceId, source, model, operationKey). Concurrent calls
 * collapse into one row via atomic increments.
 *
 * Never throws: usage recording must not break the request path.
 */
export async function recordTokenUsage(
  input: RecordTokenUsageInput,
): Promise<void> {
  const row = buildUsageRow(input);
  if (!row) return;
  const {
    date,
    workspaceId,
    userId: userKey,
    source,
    model: modelKey,
    operationKey: opKey,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: total,
  } = row;

  // Raw SQL upsert. Two reasons we don't use Prisma's compound-key upsert:
  //   1. Prisma 5's generated compound-key where type doesn't accept `null`
  //      even though our column + unique constraint support it via
  //      NULLS NOT DISTINCT — trying to pass null fails typecheck.
  //   2. Postgres's INSERT ... ON CONFLICT DO UPDATE is a single atomic
  //      statement, so concurrent callers can't race between find + create.
  try {
    await prisma.$executeRaw`
      INSERT INTO "DailyTokenUsage" (
        "id", "createdAt", "updatedAt",
        "date", "source", "model", "operationKey",
        "inputTokens", "outputTokens", "totalTokens", "eventCount",
        "workspaceId", "userId"
      ) VALUES (
        gen_random_uuid(), NOW(), NOW(),
        ${date}::date, ${source}::"TokenUsageSource", ${modelKey}, ${opKey},
        ${inTok}, ${outTok}, ${total}, 1,
        ${workspaceId}, ${userKey}
      )
      ON CONFLICT ("date", "userId", "workspaceId", "source", "model", "operationKey")
      DO UPDATE SET
        "inputTokens"  = "DailyTokenUsage"."inputTokens"  + EXCLUDED."inputTokens",
        "outputTokens" = "DailyTokenUsage"."outputTokens" + EXCLUDED."outputTokens",
        "totalTokens"  = "DailyTokenUsage"."totalTokens"  + EXCLUDED."totalTokens",
        "eventCount"   = "DailyTokenUsage"."eventCount"   + 1,
        "updatedAt"    = NOW()
    `;
  } catch (error) {
    logger.warn("recordTokenUsage failed", {
      error,
      workspaceId,
      userId: userKey,
      source,
      model: modelKey,
      operationKey: opKey,
      inputTokens: inTok,
      outputTokens: outTok,
    });
  }
}
