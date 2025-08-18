import {
  type CreateBatchParams,
  type GetBatchParams,
  type BatchJob,
} from "./batch/types";
import { OpenAIBatchProvider } from "./batch/providers/openai";
import { AnthropicBatchProvider } from "./batch/providers/anthropic";
import { logger } from "~/services/logger.service";

// Global provider instances (singleton pattern)
let openaiProvider: OpenAIBatchProvider | null = null;
let anthropicProvider: AnthropicBatchProvider | null = null;

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
    logger.info(
      `Creating batch with ${provider.providerName} provider for model ${modelId}`,
    );

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
