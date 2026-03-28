import { embed, type ModelMessage } from "ai";
import { type z } from "zod";
import {
  createOpenAI,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import {
  ModelRouterLanguageModel,
  ModelRouterEmbeddingModel,
} from "@mastra/core/llm";
import { logger } from "~/services/logger.service";

import { createOllama } from "ollama-ai-provider-v2";
import {
  getModelForTaskSync,
  getModelForBatchSync,
  getDefaultChatProviderType,
  getDefaultChatModelId,
  getDefaultEmbeddingInfo,
  getProviderConfig,
  getEmbeddingDimensions,
  resolveApiKey,
  resolveApiKeyForWorkspace,
  resolveModelForWorkspace,
} from "~/services/llm-provider.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelComplexity = "high" | "medium" | "low";

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface AvailableModel {
  id: string; // "openai/gpt-5-2025-08-07"
  label: string; // "GPT-5"
  provider: string; // "openai"
}

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

/**
 * Infer provider from a bare model ID (no "/" prefix).
 * Falls back to default chat provider from DB cache.
 */
function inferProvider(modelId: string): string {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o3") || modelId.startsWith("o4"))
    return "openai";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("us.amazon") || modelId.startsWith("us.meta"))
    return "bedrock";
  return getDefaultChatProviderType();
}

/**
 * Convert a bare model ID to a "provider/model" router string.
 * Already-prefixed strings pass through unchanged.
 */
export function toRouterString(modelId: string): string {
  if (modelId.includes("/")) return modelId;
  return `${inferProvider(modelId)}/${modelId}`;
}

/**
 * Extract provider from a model string.
 */
export function getProvider(modelString: string): string {
  if (modelString.includes("/")) return modelString.split("/")[0];
  return inferProvider(modelString);
}

/**
 * Extract bare model ID from a router string.
 */
function getModelId(modelString: string): string {
  if (modelString.includes("/")) return modelString.split("/").slice(1).join("/");
  return modelString;
}

// ---------------------------------------------------------------------------
// Model complexity routing (DB-backed sync cache)
// ---------------------------------------------------------------------------

export function getModelForTask(complexity: ModelComplexity = "medium"): string {
  return getModelForTaskSync(complexity);
}

export function getModelForBatch(): string {
  return getModelForBatchSync();
}

// ---------------------------------------------------------------------------
// Core: getModel — returns a LanguageModel instance
// ---------------------------------------------------------------------------

/**
 * Create a LanguageModel from a model string.
 *
 * Accepts:
 *   - Router strings: "openai/gpt-5-2025-08-07", "anthropic/claude-sonnet-4-5"
 *   - Bare model IDs: "gpt-5-2025-08-07" (provider inferred from prefix or DB default)
 *
 * Ollama and OpenAI proxy (baseUrl in provider config) use direct AI SDK providers
 * since Mastra's router doesn't handle custom URLs.
 * All other providers use Mastra's ModelRouterLanguageModel.
 */
export const getModel = (takeModel?: string) => {
  const model = takeModel || getDefaultChatModelId();
  const provider = getProvider(model);
  const modelId = getModelId(model);

  // Ollama: use direct AI SDK provider (needs custom URL)
  if (provider === "ollama" || getDefaultChatProviderType() === "ollama") {
    const ollamaConfig = getProviderConfig("ollama");
    const ollamaUrl = ollamaConfig.baseUrl;
    if (!ollamaUrl) {
      throw new Error("Ollama provider selected but no baseUrl configured.");
    }
    if (!modelId) {
      throw new Error("No chat model configured for Ollama.");
    }
    const ollama = createOllama({ baseURL: ollamaUrl });
    return ollama(modelId);
  }

  // OpenAI proxy: use direct AI SDK provider (needs custom base URL)
  const openaiConfig = getProviderConfig("openai");
  if (provider === "openai" && openaiConfig.baseUrl) {
    const openaiKey = resolveApiKey("openai");
    if (!openaiKey) {
      throw new Error(
        "OpenAI proxy configured but OPENAI_API_KEY is missing.",
      );
    }
    const openaiClient = createOpenAI({
      baseURL: openaiConfig.baseUrl,
      apiKey: openaiKey,
    });
    const apiMode = openaiConfig.apiMode ?? "responses";
    return apiMode === "chat_completions"
      ? openaiClient.chat(modelId)
      : openaiClient.responses(modelId);
  }

  // All other providers: use Mastra model router
  const routerString = toRouterString(model);
  return new ModelRouterLanguageModel(routerString as any);
};

// ---------------------------------------------------------------------------
// Provider options helpers
// ---------------------------------------------------------------------------

function buildOpenAIProviderOptions(
  model: string,
  cacheKey: string,
  reasoningEffort?: ModelComplexity,
): Record<string, any> | undefined {
  const provider = getProvider(model);
  if (provider !== "openai") return undefined;

  const openaiConfig = getProviderConfig("openai");

  // Skip for proxy mode (no Responses API support)
  if (openaiConfig.baseUrl) return undefined;

  const apiMode = openaiConfig.apiMode ?? "responses";
  if (apiMode !== "responses") return undefined;

  const modelId = getModelId(model);
  const options: OpenAIResponsesProviderOptions = {
    promptCacheKey: cacheKey,
  };

  if (modelId.startsWith("gpt-5")) {
    if (modelId.includes("mini")) {
      options.reasoningEffort = "low";
    } else {
      options.promptCacheRetention = "24h";
      options.reasoningEffort = reasoningEffort || "none";
    }
  }

  return { openai: options };
}

// ---------------------------------------------------------------------------
// Token usage helpers
// ---------------------------------------------------------------------------

function toTokenUsage(usage: any): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
  };
}

function logTokenUsage(prefix: string, model: string, tokenUsage: TokenUsage | undefined) {
  if (!tokenUsage) return;
  logger.log(
    `[${prefix}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens}${tokenUsage.cachedInputTokens ? `, cached: ${tokenUsage.cachedInputTokens}` : ""})`,
  );
}

// ---------------------------------------------------------------------------
// Mastra Agent factory
// ---------------------------------------------------------------------------

export function createAgent(
  modelString: string,
  instructions?: string,
  tools?: ToolsInput,
  options?: { apiKey?: string },
): Agent {
  const provider = getProvider(modelString);
  const openaiConfig = getProviderConfig("openai");

  // BYOK: use OpenAICompatibleConfig with explicit apiKey
  if (options?.apiKey) {
    const routerString = toRouterString(modelString) as `${string}/${string}`;
    return new Agent({
      id: `model-call-${modelString}`,
      name: `Model Call (${modelString})`,
      model: { id: routerString, apiKey: options.apiKey } as any,
      instructions: instructions || "",
      ...(tools && { tools }),
    });
  }

  // Ollama/proxy: use direct AI SDK model instance
  if (provider === "ollama" || (provider === "openai" && openaiConfig.baseUrl)) {
    return new Agent({
      id: `model-call-${modelString}`,
      name: `Model Call (${modelString})`,
      model: getModel(modelString) as any,
      instructions: instructions || "",
      ...(tools && { tools }),
    });
  }

  // All other providers: use Mastra router string
  return new Agent({
    id: `model-call-${modelString}`,
    name: `Model Call (${modelString})`,
    model: toRouterString(modelString) as any,
    instructions: instructions || "",
    ...(tools && { tools }),
  });
}

// ---------------------------------------------------------------------------
// makeModelCall
// ---------------------------------------------------------------------------

export async function makeModelCall(
  stream: boolean,
  messages: ModelMessage[],
  onFinish: (text: string, model: string, usage?: TokenUsage) => void,
  options?: any,
  complexity: ModelComplexity = "medium",
  cacheKey?: string,
  reasoningEffort?: "low" | "medium" | "high",
  workspaceId?: string,
) {
  // Resolve model + BYOK key for the workspace (picks provider-appropriate model)
  const { modelId: model, apiKey, isBYOK } = await resolveModelForWorkspace(workspaceId, complexity);
  logger.info(`complexity: ${complexity}, model: ${model}${isBYOK ? " (BYOK)" : ""}`);

  const providerOptions = buildOpenAIProviderOptions(
    model,
    cacheKey || `ingestion-${complexity}`,
    reasoningEffort,
  );

  const agent = createAgent(model, undefined, undefined, apiKey ? { apiKey } : undefined);

  if (stream) {
    const result = await agent.stream(messages as any, {
      ...(providerOptions && { providerOptions }),
    });
    const text = await result.text;
    const usage = await result.usage;
    const tokenUsage = toTokenUsage(usage);
    logTokenUsage(complexity.toUpperCase(), model, tokenUsage);
    onFinish(text, model, tokenUsage);
    return text;
  }

  const result = await agent.generate(messages as any, {
    ...(providerOptions && { providerOptions }),
  });

  const tokenUsage = toTokenUsage(result.usage);
  logTokenUsage(complexity.toUpperCase(), model, tokenUsage);
  onFinish(result.text, model, tokenUsage);

  return result.text;
}

// ---------------------------------------------------------------------------
// makeStructuredModelCall
// ---------------------------------------------------------------------------

/**
 * Tolerant JSON parser for proxy/self-hosted models that wrap JSON in fences.
 */
function tryParseJsonFromText(raw: string): unknown | undefined {
  const trimmed = (raw ?? "").toString().trim();
  if (!trimmed) return undefined;

  const unfenced = trimmed.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? unfenced.slice(start, end + 1).trim() : "";
  if (!candidate) return undefined;

  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function needsTolerantParsing(): boolean {
  const openaiConfig = getProviderConfig("openai");
  const apiMode = openaiConfig.apiMode ?? "responses";
  const isProxyChatMode = apiMode === "chat_completions" && !!openaiConfig.baseUrl;
  const isOllama = getDefaultChatProviderType() === "ollama";
  return isProxyChatMode || isOllama;
}

export async function makeStructuredModelCall<T extends z.ZodType>(
  schema: T,
  messages: ModelMessage[],
  complexity: ModelComplexity = "medium",
  cacheKey?: string,
  temperature?: number,
  workspaceId?: string,
): Promise<{ object: z.infer<T>; usage: TokenUsage | undefined }> {
  // Resolve model + BYOK key for the workspace (picks provider-appropriate model)
  const { modelId: model, apiKey } = await resolveModelForWorkspace(workspaceId, complexity);
  logger.info(`[Structured] complexity: ${complexity}, model: ${model}`);

  const providerOptions = buildOpenAIProviderOptions(
    model,
    cacheKey || `structured-${complexity}`,
  );

  // Proxy/Ollama: manual JSON extraction (no structured output support)
  if (needsTolerantParsing()) {
    const { object, usage } = await structuredCallWithTolerantParsing(
      schema,
      messages,
      model,
      temperature,
      apiKey,
    );
    const tokenUsage = toTokenUsage(usage);
    logTokenUsage(`Structured/${complexity.toUpperCase()}`, model, tokenUsage);
    return { object, usage: tokenUsage };
  }

  // Standard path: Mastra Agent with structuredOutput
  const agent = createAgent(model, undefined, undefined, apiKey ? { apiKey } : undefined);

  try {
    const result = await agent.generate(messages as any, {
      structuredOutput: {
        schema,
        providerOptions: providerOptions
          ? { ...providerOptions, openai: { ...providerOptions.openai, strictJsonSchema: false } }
          : undefined,
      },
      ...(temperature !== undefined && { temperature }),
    });

    const tokenUsage = toTokenUsage(result.usage);
    logTokenUsage(`Structured/${complexity.toUpperCase()}`, model, tokenUsage);
    return { object: result.object, usage: tokenUsage };
  } catch (error) {
    // Fallback: try to recover JSON from error text
    const rawText = extractTextFromError(error);
    const parsed = rawText ? tryParseJsonFromText(rawText) : undefined;
    const validated = parsed ? schema.safeParse(parsed) : undefined;

    if (validated?.success) {
      logger.warn("[Structured] Tolerant output repair: recovered JSON from non-strict model output.", { model, complexity });
      const usage = extractUsageFromError(error);
      const tokenUsage = toTokenUsage(usage);
      logTokenUsage(`Structured/${complexity.toUpperCase()}`, model, tokenUsage);
      return { object: validated.data, usage: tokenUsage };
    }

    throw error;
  }
}

async function structuredCallWithTolerantParsing<T extends z.ZodType>(
  schema: T,
  messages: ModelMessage[],
  modelString: string,
  temperature?: number,
  apiKey?: string,
): Promise<{ object: z.infer<T>; usage: any }> {
  const jsonPreamble =
    "Return ONLY a single valid JSON object that matches the requested schema. " +
    "Do not wrap it in Markdown fences. Do not include extra text. " +
    "Include every required key; use null for nullable fields; use [] for empty arrays.";

  const agentOpts = apiKey ? { apiKey } : undefined;
  const agent = createAgent(modelString, jsonPreamble, undefined, agentOpts);

  const textResult = await agent.generate(messages as any, {
    ...(temperature !== undefined && { temperature }),
  } as any);

  const parsed = tryParseJsonFromText(textResult.text);
  const validated = parsed ? schema.safeParse(parsed) : undefined;
  if (validated?.success) {
    return { object: validated.data, usage: textResult.usage };
  }

  // Repair attempt
  const repairAgent = createAgent(
    modelString,
    "You are a JSON repair assistant. Convert the user's content into a single valid JSON object. " +
    "Return ONLY the JSON object, with no Markdown fences and no extra text.",
    undefined,
    agentOpts,
  );

  const repairResult = await repairAgent.generate(
    [{ role: "user", content: textResult.text }] as any,
    { temperature: 0 } as any,
  );

  const repairedParsed = tryParseJsonFromText(repairResult.text);
  const repairedValidated = repairedParsed ? schema.safeParse(repairedParsed) : undefined;
  if (repairedValidated?.success) {
    return { object: repairedValidated.data, usage: repairResult.usage ?? textResult.usage };
  }

  const err = new Error(
    "No object generated: could not parse/validate JSON from proxy/self-hosted model output.",
  ) as Error & { text?: string; repairText?: string };
  err.text = textResult.text;
  err.repairText = repairResult.text;
  throw err;
}

function extractTextFromError(error: unknown): string {
  const getText = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    return typeof (value as any).text === "string" ? (value as any).text : undefined;
  };
  const getCause = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return undefined;
    return (value as any).cause;
  };

  return getText(error) || getText(getCause(error)) || getText(getCause(getCause(error))) || "";
}

function extractUsageFromError(error: unknown): any {
  if (!error || typeof error !== "object") return undefined;
  const usage = (error as any).usage;
  if (!usage || typeof usage !== "object") return undefined;
  return usage;
}

// ---------------------------------------------------------------------------
// Available models (DB-backed, via llm-provider.server.ts)
// ---------------------------------------------------------------------------
export function getDefaultModelString(): string {
  return toRouterString(getDefaultChatModelId());
}

// ---------------------------------------------------------------------------
// Embeddings — Mastra ModelRouterEmbeddingModel
// ---------------------------------------------------------------------------

function getEmbeddingModel() {
  const embeddingInfo = getDefaultEmbeddingInfo();

  if (!embeddingInfo) {
    // Fallback: use OpenAI text-embedding-3-small via router
    return new ModelRouterEmbeddingModel("openai/text-embedding-3-small" as any);
  }

  const { modelId, providerType } = embeddingInfo;
  const providerConfig = getProviderConfig(providerType);

  // Ollama: use config object with custom URL
  if (providerType === "ollama") {
    const baseUrl = providerConfig.baseUrl;
    if (!baseUrl) {
      throw new Error(
        "Ollama embedding selected but no baseUrl configured for Ollama provider.",
      );
    }
    return new ModelRouterEmbeddingModel({
      providerId: "ollama",
      modelId,
      url: `${baseUrl.replace(/\/+$/, "")}/v1`,
      apiKey: "not-needed",
    });
  }

  // OpenAI proxy: use config object with custom URL
  if (providerType === "openai" && providerConfig.baseUrl) {
    const openaiKey = resolveApiKey("openai");
    if (!openaiKey) {
      throw new Error(
        "OpenAI proxy configured but OPENAI_API_KEY is missing.",
      );
    }
    return new ModelRouterEmbeddingModel({
      providerId: "openai",
      modelId,
      url: providerConfig.baseUrl,
      apiKey: openaiKey,
    });
  }

  // All other providers: use router string
  return new ModelRouterEmbeddingModel(`${providerType}/${modelId}` as any);
}

export async function getEmbedding(text: string) {
  const targetDim = getEmbeddingDimensions();
  const embeddingInfo = getDefaultEmbeddingInfo();
  const embeddingProviderType = embeddingInfo?.providerType ?? "openai";
  const embeddingModelId = embeddingInfo?.modelId ?? "text-embedding-3-small";

  const maxRetries = 3;
  let lastEmbedding: number[] = [];
  let textForEmbedding = (text ?? "").toString();

  const embeddingModel = getEmbeddingModel();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { embedding } = await embed({
        model: embeddingModel,
        value: textForEmbedding,
        ...(targetDim && embeddingProviderType === "google" && {
          providerOptions: {
            google: { outputDimensionality: targetDim },
          },
        }),
      });
      lastEmbedding = embedding;

      if (lastEmbedding.length > 0) {
        if (targetDim && targetDim > 0) {
          if (lastEmbedding.length < targetDim) {
            logger.warn(
              `Embedding dimension mismatch: got ${lastEmbedding.length}, expected ${targetDim}. Padding with zeros; update embedding model dimensions to fix permanently.`,
            );
            lastEmbedding = lastEmbedding.concat(
              new Array(targetDim - lastEmbedding.length).fill(0),
            );
          } else if (lastEmbedding.length > targetDim) {
            throw new Error(
              `Embedding dimension mismatch: got ${lastEmbedding.length}, expected ${targetDim}. Update embedding model dimensions and re-embed/migrate vectors.`,
            );
          }
        }
        return lastEmbedding;
      }

      if (attempt < maxRetries) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries}: Got empty embedding, retrying...`,
        );
      }
    } catch (error) {
      const errorString =
        error instanceof Error ? error.message : String(error);
      const isContextLengthError =
        /context length/i.test(errorString) ||
        /exceeds the context length/i.test(errorString);

      if (
        isContextLengthError &&
        attempt < maxRetries &&
        textForEmbedding.length > 256
      ) {
        const prevLen = textForEmbedding.length;
        textForEmbedding = textForEmbedding.slice(
          0,
          Math.max(256, Math.floor(textForEmbedding.length / 2)),
        );
        logger.warn(
          `Embedding input exceeded model context; truncating from ${prevLen} to ${textForEmbedding.length} chars and retrying...`,
        );
        continue;
      }

      logger.error(
        `Embedding attempt ${attempt}/${maxRetries} failed: ${error}`,
      );
    }
  }

  throw new Error(
    `Failed to generate non-empty embedding after ${maxRetries} attempts (provider=${embeddingProviderType}, model=${embeddingModelId}).`,
  );
}
