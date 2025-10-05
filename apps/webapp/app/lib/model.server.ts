import {
  type CoreMessage,
  type LanguageModelV1,
  embed,
  generateText,
  streamText,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";

import { createOllama, type OllamaProvider } from "ollama-ai-provider";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export type ModelComplexity = 'high' | 'low';

/**
 * Get the appropriate model for a given complexity level.
 * HIGH complexity uses the configured MODEL.
 * LOW complexity automatically downgrades to cheaper variants if possible.
 */
export function getModelForTask(complexity: ModelComplexity = 'high'): string {
  const baseModel = process.env.MODEL || 'gpt-4.1-2025-04-14';

  // HIGH complexity - always use the configured model
  if (complexity === 'high') {
    return baseModel;
  }

  // LOW complexity - automatically downgrade expensive models to cheaper variants
  // If already using a cheap model, keep it
  const downgrades: Record<string, string> = {
    // OpenAI downgrades
    'gpt-5-2025-08-07': 'gpt-5-mini-2025-08-07',
    'gpt-4.1-2025-04-14': 'gpt-4.1-mini-2025-04-14',

    // Anthropic downgrades
    'claude-sonnet-4-5': 'claude-3-5-haiku-20241022',
    'claude-3-7-sonnet-20250219': 'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229': 'claude-3-5-haiku-20241022',

    // Google downgrades
    'gemini-2.5-pro-preview-03-25': 'gemini-2.5-flash-preview-04-17',
    'gemini-2.0-flash': 'gemini-2.0-flash-lite',

    // AWS Bedrock downgrades (keep same model - already cost-optimized)
    'us.amazon.nova-premier-v1:0': 'us.amazon.nova-premier-v1:0',
  };

  return downgrades[baseModel] || baseModel;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function makeModelCall(
  stream: boolean,
  messages: CoreMessage[],
  onFinish: (text: string, model: string, usage?: TokenUsage) => void,
  options?: any,
  complexity: ModelComplexity = 'high',
) {
  let modelInstance: LanguageModelV1 | undefined;
  let model = getModelForTask(complexity);
  const ollamaUrl = process.env.OLLAMA_URL;
  let ollama: OllamaProvider | undefined;

  if (ollamaUrl) {
    ollama = createOllama({
      baseURL: ollamaUrl,
    });
  }

  const bedrock = createAmazonBedrock({
    region: process.env.AWS_REGION || 'us-east-1',
    credentialProvider: fromNodeProviderChain(),
  });

  const generateTextOptions: any = {}


  console.log('complexity:', complexity, 'model:', model)
  switch (model) {
    case "gpt-4.1-2025-04-14":
    case "gpt-4.1-mini-2025-04-14":
    case "gpt-5-mini-2025-08-07":
    case "gpt-5-2025-08-07":
    case "gpt-4.1-nano-2025-04-14":
      modelInstance = openai(model, { ...options });
      generateTextOptions.temperature = 1
      break;

    case "claude-3-7-sonnet-20250219":
    case "claude-3-opus-20240229":
    case "claude-3-5-haiku-20241022":
      modelInstance = anthropic(model, { ...options });
      break;

    case "gemini-2.5-flash-preview-04-17":
    case "gemini-2.5-pro-preview-03-25":
    case "gemini-2.0-flash":
    case "gemini-2.0-flash-lite":
      modelInstance = google(model, { ...options });
      break;

    case "us.meta.llama3-3-70b-instruct-v1:0":
    case "us.deepseek.r1-v1:0":
    case "qwen.qwen3-32b-v1:0":
    case "openai.gpt-oss-120b-1:0":
    case "us.mistral.pixtral-large-2502-v1:0":
    case "us.amazon.nova-premier-v1:0":
      modelInstance = bedrock(`${model}`);
      generateTextOptions.maxTokens = 100000
      break;

    default:
      if (ollama) {
        modelInstance = ollama(model);
      }
      logger.warn(`Unsupported model type: ${model}`);
      break;
  }

  if (!modelInstance) {
    throw new Error(`Unsupported model type: ${model}`);
  }

  if (stream) {
    return streamText({
      model: modelInstance,
      messages,
      ...generateTextOptions,
      onFinish: async ({ text, usage }) => {
        const tokenUsage = usage ? {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        } : undefined;

        if (tokenUsage) {
          logger.log(`[${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens})`);
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

  const tokenUsage = usage ? {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  } : undefined;

  if (tokenUsage) {
    logger.log(`[${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens})`);
  }

  onFinish(text, model, tokenUsage);

  return text;
}

/**
 * Determines if a given model is proprietary (OpenAI, Anthropic, Google, Grok)
 * or open source (accessed via Bedrock, Ollama, etc.)
 */
export function isProprietaryModel(modelName?: string, complexity: ModelComplexity = 'high'): boolean {
  const model = modelName || getModelForTask(complexity);
  if (!model) return false;

  // Proprietary model patterns
  const proprietaryPatterns = [
    /^gpt-/,           // OpenAI models
    /^claude-/,        // Anthropic models
    /^gemini-/,        // Google models
    /^grok-/,          // xAI models
  ];

  return proprietaryPatterns.some(pattern => pattern.test(model));
}

export async function getEmbedding(text: string) {
  const ollamaUrl = process.env.OLLAMA_URL;

  // Default to using Ollama
  const model = process.env.EMBEDDING_MODEL;

  if (model === "text-embedding-3-small") {
    // Use OpenAI embedding model when explicitly requested
    const embeddingSize = parseInt(process.env.EMBEDDING_MODEL_SIZE || "1024", 10);
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small", {
        dimensions: embeddingSize,
      }),
      value: text,
    });
    return embedding;
  }

  const ollama = createOllama({
    baseURL: ollamaUrl,
  });
  const { embedding } = await embed({
    model: ollama.embedding(model as string),
    value: text,
  });

  return embedding;
}
