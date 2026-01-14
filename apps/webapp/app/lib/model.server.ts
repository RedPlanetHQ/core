import { type CoreMessage, embed, generateText, streamText } from "ai";
import {
  createOpenAI,
  openai,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";

import { createOllama } from "ollama-ai-provider-v2";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

export type ModelComplexity = "high" | "low";

/**
 * Get the appropriate model for a given complexity level.
 * HIGH complexity uses the configured MODEL.
 * LOW complexity automatically downgrades to cheaper variants if possible.
 */
export function getModelForTask(complexity: ModelComplexity = "high"): string {
  const baseModel = process.env.MODEL || "gpt-4.1-2025-04-14";

  // HIGH complexity - always use the configured model
  if (complexity === "high") {
    return baseModel;
  }

  // LOW complexity - automatically downgrade expensive models to cheaper variants
  // If already using a cheap model, keep it
  const downgrades: Record<string, string> = {
    // OpenAI downgrades
    "gpt-5.1-2025-11-13": "gpt-5-mini-2025-08-07",
    "gpt-5-2025-08-07": "gpt-5-mini-2025-08-07",
    "gpt-4.1-2025-04-14": "gpt-4.1-mini-2025-04-14",

    // Anthropic downgrades
    "claude-sonnet-4-5": "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-20250219": "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229": "claude-3-5-haiku-20241022",

    // Google downgrades
    "gemini-2.5-pro-preview-03-25": "gemini-2.5-flash-preview-04-17",
    "gemini-2.0-flash": "gemini-2.0-flash-lite",

    // AWS Bedrock downgrades (keep same model - already cost-optimized)
    "us.amazon.nova-premier-v1:0": "us.amazon.nova-premier-v1:0",
  };

  return downgrades[baseModel] || baseModel;
}

export const getModel = (takeModel?: string) => {
  let model = takeModel;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  let ollamaUrl = process.env.OLLAMA_URL;
  model = model || process.env.MODEL || "gpt-4.1-2025-04-14";

  let modelInstance;
  let modelTemperature = Number(process.env.MODEL_TEMPERATURE) || 1;
  ollamaUrl = undefined;

  // First check if Ollama URL exists and use Ollama
  if (ollamaUrl) {
    const ollama = createOllama({
      baseURL: ollamaUrl,
    });
    modelInstance = ollama(model || "llama2"); // Default to llama2 if no model specified
  } else {
    // If no Ollama, check other models

    if (model.includes("claude")) {
      if (!anthropicKey) {
        throw new Error("No Anthropic API key found. Set ANTHROPIC_API_KEY");
      }
      modelInstance = anthropic(model);
      modelTemperature = 0.5;
    } else if (model.includes("gemini")) {
      if (!googleKey) {
        throw new Error("No Google API key found. Set GOOGLE_API_KEY");
      }
      modelInstance = google(model);
    } else {
      if (!openaiKey) {
        throw new Error("No OpenAI API key found. Set OPENAI_API_KEY");
      }
      modelInstance = openai.responses(model);
    }

    return modelInstance;
  }
};

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export async function makeModelCall(
  stream: boolean,
  messages: CoreMessage[],
  onFinish: (text: string, model: string, usage?: TokenUsage) => void,
  options?: any,
  complexity: ModelComplexity = "high",
  cacheKey?: string,
  reasoningEffort?: "low" | "medium" | "high",
) {
  let model = getModelForTask(complexity);
  logger.info(`complexity: ${complexity}, model: ${model}`);

  const modelInstance = getModel(model);
  const generateTextOptions: any = {};

  // Add OpenAI provider options for prompt caching and disable web search
  if (model.includes("gpt")) {
    const openaiOptions: OpenAIResponsesProviderOptions = {
      promptCacheKey: cacheKey || `ingestion-${complexity}`,
    };

    // 24h retention and reasoning options only available for non-mini gpt-5 models
    if (model.startsWith("gpt-5")) {
      if (model.includes("mini")) {
        openaiOptions.reasoningEffort = "low";
      } else {
        openaiOptions.promptCacheRetention = "24h";
        openaiOptions.reasoningEffort = "none";
        if (reasoningEffort) {
          openaiOptions.reasoningEffort = reasoningEffort;
        }
      }
    }

    generateTextOptions.providerOptions = {
      openai: openaiOptions,
    };
  }

  if (!modelInstance) {
    throw new Error(`Unsupported model type: ${model}`);
  }

  if (stream) {
    return streamText({
      model: modelInstance,
      messages,
      ...options,
      ...generateTextOptions,
      onFinish: async ({ text, usage }) => {
        const tokenUsage = usage
          ? {
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined;

        if (tokenUsage) {
          logger.log(
            `[${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens})`,
          );
        }

        onFinish(text, model, tokenUsage);
      },
    });
  }

  const { text, usage } = await generateText({
    model: modelInstance,
    messages,
    ...generateTextOptions,
  });

  const tokenUsage = usage
    ? {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
      }
    : undefined;

  if (tokenUsage) {
    logger.log(
      `[${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens}, cached: ${tokenUsage.cachedInputTokens})`,
    );
  }

  onFinish(text, model, tokenUsage);

  return text;
}

/**
 * Determines if a given model is proprietary (OpenAI, Anthropic, Google, Grok)
 * or open source (accessed via Bedrock, Ollama, etc.)
 */
export function isProprietaryModel(
  modelName?: string,
  complexity: ModelComplexity = "high",
): boolean {
  const model = modelName || getModelForTask(complexity);
  if (!model) return false;

  // Proprietary model patterns
  const proprietaryPatterns = [
    /^gpt-/, // OpenAI models
    /^claude-/, // Anthropic models
    /^gemini-/, // Google models
    /^grok-/, // xAI models
  ];

  return proprietaryPatterns.some((pattern) => pattern.test(model));
}

export async function getEmbedding(text: string) {
  const ollamaUrl = process.env.OLLAMA_URL;
  const model = process.env.EMBEDDING_MODEL;
  const maxRetries = 3;
  let lastEmbedding: number[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (model === "text-embedding-3-small") {
        // Use OpenAI embedding model when explicitly requested
        const { embedding } = await embed({
          model: openai.embedding("text-embedding-3-small"),
          value: text,
        });
        lastEmbedding = embedding;
      } else {
        // Use Ollama's OpenAI-compatible endpoint for embeddings
        // This avoids EmbeddingModelV3/V2 compatibility issues with third-party providers
        // Normalize the URL: remove trailing slash, /api, and /v1 if present, then add /v1
        const baseUrl = ollamaUrl
          ?.replace(/\/+$/, "")
          .replace(/\/v1$/, "")
          .replace(/\/api$/, "");
        const ollamaOpenAI = createOpenAI({
          baseURL: `${baseUrl}/v1`,
          apiKey: "ollama", // Required but not used by Ollama
        });
        const { embedding } = await embed({
          model: ollamaOpenAI.embedding(model as string),
          value: text,
        });
        lastEmbedding = embedding;
      }

      // If embedding is not empty, return it immediately
      if (lastEmbedding.length > 0) {
        return lastEmbedding;
      }

      // If empty, log and retry (unless it's the last attempt)
      if (attempt < maxRetries) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries}: Got empty embedding, retrying...`,
        );
      }
    } catch (error) {
      logger.error(
        `Embedding attempt ${attempt}/${maxRetries} failed: ${error}`,
      );
    }
  }

  // Return last embedding even if empty after all retries
  logger.warn(
    `All ${maxRetries} attempts returned empty embedding, returning last response`,
  );
  return lastEmbedding;
}
