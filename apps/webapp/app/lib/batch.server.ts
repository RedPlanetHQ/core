import {
  type CreateBatchParams,
  type GetBatchParams,
  type BatchJob,
} from "./batch/types";
import { OpenAIBatchProvider } from "./batch/providers/openai";
import { AnthropicBatchProvider } from "./batch/providers/anthropic";
import { logger } from "~/services/logger.service";
import { generateObject, generateText, type LanguageModel } from "ai";
import {
  getModel,
  getModelForBatch,
  makeStructuredModelCall,
} from "~/lib/model.server";

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
  const normalizedModelId = (modelId || "").toLowerCase();
  const hasOpenAIBaseUrl =
    typeof process.env.OPENAI_BASE_URL === "string" &&
    process.env.OPENAI_BASE_URL.trim().length > 0;

  // Anthropic models
  if (normalizedModelId.includes("claude")) {
    if (!anthropicProvider) {
      anthropicProvider = new AnthropicBatchProvider();
    }
    return anthropicProvider;
  }

  // If an OpenAI base URL is configured, assume we're using an OpenAI-compatible endpoint
  // (often a proxy) and route batch calls through the OpenAI provider regardless of model name.
  if (hasOpenAIBaseUrl) {
    if (!openaiProvider) {
      openaiProvider = new OpenAIBatchProvider();
    }
    return openaiProvider;
  }

  // OpenAI models
  if (normalizedModelId.includes("gpt") || normalizedModelId.includes("o1")) {
    if (!openaiProvider) {
      openaiProvider = new OpenAIBatchProvider();
    }
    return openaiProvider;
  }

  throw new Error(`No batch provider available for model: ${modelId}`);
}

function createInlineBatchId() {
  return `inline-${crypto.randomUUID()}`;
}

function isContentOnlySchema(schema: unknown): boolean {
  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape;
  if (!shape || typeof shape !== "object") return false;
  const keys = Object.keys(shape);
  return (
    keys.length === 1 &&
    keys[0] === "content" &&
    typeof shape.content === "object" &&
    shape.content !== null
  );
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
  const openaiApiMode = (process.env.OPENAI_API_MODE || "").trim().toLowerCase();
  const hasOpenAIBaseUrl =
    typeof process.env.OPENAI_BASE_URL === "string" &&
    process.env.OPENAI_BASE_URL.trim().length > 0;
  const isProxyChatMode =
    hasOpenAIBaseUrl && openaiApiMode === "chat_completions";

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
          if (isProxyChatMode) {
            const temperature =
              typeof request.options?.temperature === "number"
                ? request.options.temperature
                : undefined;
            try {
              const { object } = await makeStructuredModelCall(
                params.outputSchema as any,
                messages as any,
                "high",
                undefined,
                temperature,
              );

              return { customId: request.customId, response: object as any };
            } catch (error) {
              // For simple `{ content: string }` payloads (persona/aspect sections),
              // degrade to plain text and wrap it so callers can continue.
              if (isContentOnlySchema(params.outputSchema)) {
                const { text } = await generateText({
                  model,
                  messages,
                  ...(request.options || {}),
                });
                return {
                  customId: request.customId,
                  response: { content: text } as any,
                };
              }
              throw error;
            }
          }

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

  logger.info(`[batch] Using inline batch execution.`, {
    batchId,
    totalRequests: params.requests.length,
    mode: isProxyChatMode ? "proxy_chat_completions" : "generic_inline",
  });

  return { batchId };
}

/**
 * Create a new batch job for multiple AI requests
 * Similar to makeModelCall but for batch processing
 */
export async function createBatch<T = any>(params: CreateBatchParams<T>) {
  try {
    const modelId = process.env.MODEL as string;
    if (!modelId) {
      throw new Error("MODEL environment variable is not set");
    }

    const provider = getProvider(modelId);
    const openaiApiMode = (process.env.OPENAI_API_MODE || "").trim().toLowerCase();
    const hasOpenAIBaseUrl =
      typeof process.env.OPENAI_BASE_URL === "string" &&
      process.env.OPENAI_BASE_URL.trim().length > 0;
    const forceInlineForProxy =
      provider.providerName === "openai" &&
      hasOpenAIBaseUrl &&
      openaiApiMode === "chat_completions";

    logger.info(
      `Creating batch with ${provider.providerName} provider for model ${modelId}`,
    );

    // OpenAI-compatible proxies in chat-completions mode typically don't expose `/batches`.
    // Route directly to inline execution instead of attempting the Batch API first.
    if (forceInlineForProxy) {
      return await runInlineBatch(params);
    }

    return await provider.createBatch(params);
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

    const modelId = process.env.MODEL as string;
    if (!modelId) {
      throw new Error("MODEL environment variable is not set");
    }

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

    const modelId = process.env.MODEL as string;
    if (!modelId) {
      throw new Error("MODEL environment variable is not set");
    }

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

  if (process.env.OPENAI_API_KEY) {
    models.openai = new OpenAIBatchProvider().supportedModels;
  }

  if (process.env.ANTHROPIC_API_KEY) {
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
