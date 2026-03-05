import {
  type CreateBatchParams,
  type GetBatchParams,
  type BatchJob,
} from "./batch/types";
import { OpenAIBatchProvider } from "./batch/providers/openai";
import { AnthropicBatchProvider } from "./batch/providers/anthropic";
import { logger } from "~/services/logger.service";
import { generateObject, generateText, type LanguageModel } from "ai";
import { getModel, getModelForBatch } from "~/lib/model.server";
import { env } from "~/env.server";

// Global provider instances (singleton pattern)
let openaiProvider: OpenAIBatchProvider | null = null;
let anthropicProvider: AnthropicBatchProvider | null = null;

// In-memory fallback for environments where the OpenAI Batch API isn't available
// (common with OpenAI-compatible proxies). This keeps the rest of the codebase
// unchanged by returning a "completed" BatchJob that `getBatch()` can retrieve.
const inlineBatches = new Map<string, { job: BatchJob; expiresAt: number }>();

const DEFAULT_INLINE_BATCH_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_INLINE_BATCHES = 500;
const DEFAULT_INLINE_BATCH_CONCURRENCY = 8;

function readPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getInlineBatchTtlMs(): number {
  return readPositiveInt(process.env.INLINE_BATCH_TTL_MS) ?? DEFAULT_INLINE_BATCH_TTL_MS;
}

function getMaxInlineBatches(): number {
  return readPositiveInt(process.env.MAX_INLINE_BATCHES) ?? DEFAULT_MAX_INLINE_BATCHES;
}

function getInlineBatchConcurrency(): number {
  return (
    readPositiveInt(process.env.INLINE_BATCH_CONCURRENCY) ??
    DEFAULT_INLINE_BATCH_CONCURRENCY
  );
}

function pruneInlineBatches(now = Date.now()) {
  for (const [id, entry] of inlineBatches.entries()) {
    if (entry.expiresAt <= now) {
      inlineBatches.delete(id);
    }
  }

  const max = getMaxInlineBatches();
  if (inlineBatches.size <= max) return;

  const oldestFirst = [...inlineBatches.entries()].sort((a, b) => {
    const aTime =
      a[1].job.createdAt instanceof Date ? a[1].job.createdAt.getTime() : 0;
    const bTime =
      b[1].job.createdAt instanceof Date ? b[1].job.createdAt.getTime() : 0;
    return aTime - bTime;
  });

  const toDelete = inlineBatches.size - max;
  for (let i = 0; i < toDelete; i++) {
    inlineBatches.delete(oldestFirst[i][0]);
  }
}

function getProvider(modelId: string) {
  // OpenAI models
  if (modelId.includes("gpt") || modelId.includes("o1")) {
    if (!openaiProvider) {
      openaiProvider = new OpenAIBatchProvider();
    }
    return openaiProvider;
  }

  // Anthropic models
  if (modelId.includes("claude")) {
    if (!anthropicProvider) {
      anthropicProvider = new AnthropicBatchProvider();
    }
    return anthropicProvider;
  }

  throw new Error(`No batch provider available for model: ${modelId}`);
}

function createInlineBatchId() {
  return `inline-${crypto.randomUUID()}`;
}

function isMethodNotAllowedError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const anyError = error as any;
    const statusLike = anyError.status ?? anyError.statusCode ?? anyError.code;
    if (statusLike === 405 || statusLike === "405") return true;
  }
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return message.includes("405") || message.includes("Method Not Allowed");
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function runInlineBatch<T = any>(
  params: CreateBatchParams<T>,
): Promise<{ batchId: string }> {
  const modelId = getModelForBatch();
  const model = getModel(modelId) as LanguageModel;
  if (!model) {
    throw new Error(`Failed to initialize model for inline batch: ${modelId}`);
  }

  const batchId = createInlineBatchId();
  const startedAt = new Date();

  const concurrency = getInlineBatchConcurrency();

  // Execute requests with bounded concurrency (avoids overloading local resources and upstream providers).
  const results = await mapWithConcurrency(
    params.requests,
    concurrency,
    async (request) => {
      try {
        const messages = request.systemPrompt
          ? [{ role: "system" as const, content: request.systemPrompt } as const]
              .concat(request.messages as any)
          : (request.messages as any);

        if (params.outputSchema) {
          const { object } = await generateObject({
            model,
            schema: params.outputSchema as any,
            messages,
            ...(request.options || {}),
          });

          return { customId: request.customId, response: object as any };
        }

        const { text } = await generateText({
          model,
          messages,
          ...(request.options || {}),
        });

        return { customId: request.customId, response: text as any };
      } catch (error) {
        return {
          customId: request.customId,
          error: {
            code: "inline_batch_error",
            message: error instanceof Error ? error.message : String(error),
            type: "api_error" as const,
          },
        };
      }
    },
  );

  const completedAt = new Date();
  inlineBatches.set(batchId, {
    job: {
      batchId,
      status: "completed",
      createdAt: startedAt,
      completedAt,
      totalRequests: params.requests.length,
      completedRequests: params.requests.length,
      failedRequests: results.filter((r: any) => (r as any).error).length,
      results: results as any,
    },
    expiresAt: completedAt.getTime() + getInlineBatchTtlMs(),
  });
  pruneInlineBatches(completedAt.getTime());

  logger.warn(
    `[batch] Falling back to inline execution (batch API unavailable).`,
    { batchId, totalRequests: params.requests.length },
  );

  return { batchId };
}

/**
 * Create a new batch job for multiple AI requests
 * Similar to makeModelCall but for batch processing
 */
export async function createBatch<T = any>(params: CreateBatchParams<T>) {
  try {
    const modelId = env.MODEL;

    const provider = getProvider(modelId);
    logger.info(
      `Creating batch with ${provider.providerName} provider for model ${modelId}`,
    );

    try {
      return await provider.createBatch(params);
    } catch (error) {
      // OpenAI-compatible proxies often do not implement the OpenAI Batch API.
      // If the provider fails with a "405 Method Not Allowed", fall back to
      // executing the requests directly.
      if (provider.providerName === "openai" && isMethodNotAllowedError(error)) {
        return await runInlineBatch(params);
      }
      throw error;
    }
  } catch (error) {
    logger.error("Batch creation failed:", { error });
    throw error;
  }
}

/**
 * Get the status and results of a batch job
 */
export async function getBatch<T = any>(
  params: GetBatchParams,
): Promise<BatchJob> {
  try {
    pruneInlineBatches();
    const inline = inlineBatches.get(params.batchId);
    if (inline) return inline.job;
    if (params.batchId.startsWith("inline-")) {
      throw new Error(
        "Inline batch result not found (may have expired). Increase INLINE_BATCH_TTL_MS or retry with a provider that supports batches.",
      );
    }

    const modelId = env.MODEL;

    const provider = getProvider(modelId);
    return await provider.getBatch<T>(params);
  } catch (error) {
    logger.error("Failed to get batch:", { error });
    throw error;
  }
}

/**
 * Cancel a running batch job (if supported by provider)
 */
export async function cancelBatch(
  params: GetBatchParams,
): Promise<{ success: boolean }> {
  try {
    pruneInlineBatches();
    if (inlineBatches.has(params.batchId)) {
      // Inline batches complete immediately; nothing to cancel.
      return { success: false };
    }

    const modelId = env.MODEL;

    const provider = getProvider(modelId);
    if (provider.cancelBatch) {
      return await provider.cancelBatch(params);
    }

    logger.warn(
      `Cancel batch not supported by ${provider.providerName} provider`,
    );
    return { success: false };
  } catch (error) {
    logger.error("Failed to cancel batch:", { error });
    return { success: false };
  }
}

/**
 * Utility function to create batch requests from simple text prompts
 */
export function createBatchRequests(
  prompts: Array<{ customId: string; prompt: string; systemPrompt?: string }>,
) {
  return prompts.map(({ customId, prompt, systemPrompt }) => ({
    customId,
    messages: [{ role: "user" as const, content: prompt }],
    systemPrompt,
  }));
}

/**
 * Get all supported models for batch processing
 */
export function getSupportedBatchModels() {
  const models: Record<string, string[]> = {};

  if (env.OPENAI_API_KEY) {
    models.openai = new OpenAIBatchProvider().supportedModels;
  }

  if (env.ANTHROPIC_API_KEY) {
    models.anthropic = new AnthropicBatchProvider().supportedModels;
  }

  return models;
}

// Export types for use in other modules
export type {
  CreateBatchParams,
  GetBatchParams,
  BatchJob,
  BatchRequest,
  BatchResponse,
  BatchError,
  BatchStatus,
} from "./batch/types";
