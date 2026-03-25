import { embed, type ModelMessage } from "ai";
import { type z } from "zod";
import {
  createOpenAI,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import {
  ModelRouterLanguageModel,
  ModelRouterEmbeddingModel,
} from "@mastra/core/llm";
import { logger } from "~/services/logger.service";

import { createOllama } from "ollama-ai-provider-v2";
import { env } from "~/env.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelComplexity = "high" | "low";

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
 * Falls back to CHAT_PROVIDER env var.
 */
function inferProvider(modelId: string): string {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o3") || modelId.startsWith("o4"))
    return "openai";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("us.amazon") || modelId.startsWith("us.meta"))
    return "bedrock";
  return env.CHAT_PROVIDER;
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
// Model complexity routing
// ---------------------------------------------------------------------------

const LOW_COMPLEXITY_DOWNGRADES: Record<string, string> = {
  // OpenAI
  "gpt-5.2-2025-12-11": "gpt-5-mini-2025-08-07",
  "gpt-5.1-2025-11-13": "gpt-5-mini-2025-08-07",
  "gpt-5-2025-08-07": "gpt-5-mini-2025-08-07",
  "gpt-4.1-2025-04-14": "gpt-4.1-mini-2025-04-14",
  // Anthropic
  "claude-sonnet-4-5": "claude-3-5-haiku-20241022",
  "claude-3-7-sonnet-20250219": "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229": "claude-3-5-haiku-20241022",
  // Google
  "gemini-2.5-pro-preview-03-25": "gemini-2.5-flash-preview-04-17",
  "gemini-2.0-flash": "gemini-2.0-flash-lite",
  // Bedrock (already cost-optimized)
  "us.amazon.nova-premier-v1:0": "us.amazon.nova-premier-v1:0",
};

const BATCH_DOWNGRADES: Record<string, string> = {
  "gpt-5.2-2025-12-11": "gpt-5-2025-08-07",
  "gpt-5.1-2025-11-13": "gpt-5-2025-08-07",
};

export function getModelForTask(complexity: ModelComplexity = "high"): string {
  const baseModel = env.MODEL;
  if (complexity === "high") return baseModel;
  return LOW_COMPLEXITY_DOWNGRADES[baseModel] || baseModel;
}

export function getModelForBatch(): string {
  const baseModel = env.MODEL;
  return BATCH_DOWNGRADES[baseModel] || baseModel;
}

// ---------------------------------------------------------------------------
// Core: getModel — returns a LanguageModel instance
// ---------------------------------------------------------------------------

/**
 * Create a LanguageModel from a model string.
 *
 * Accepts:
 *   - Router strings: "openai/gpt-5-2025-08-07", "anthropic/claude-sonnet-4-5"
 *   - Bare model IDs: "gpt-5-2025-08-07" (provider inferred from prefix or CHAT_PROVIDER)
 *
 * Ollama and OpenAI proxy (OPENAI_BASE_URL) use direct AI SDK providers
 * since Mastra's router doesn't handle custom URLs.
 * All other providers use Mastra's ModelRouterLanguageModel.
 */
export const getModel = (takeModel?: string) => {
  const model = takeModel || env.MODEL;
  const provider = getProvider(model);
  const modelId = getModelId(model);

  // Ollama: use direct AI SDK provider (needs custom URL)
  if (provider === "ollama" || env.CHAT_PROVIDER === "ollama") {
    const ollamaUrl = env.OLLAMA_URL;
    if (!ollamaUrl) {
      throw new Error("CHAT_PROVIDER is set to ollama but OLLAMA_URL is not set");
    }
    if (!modelId) {
      throw new Error("No chat model configured for Ollama. Set MODEL.");
    }
    const ollama = createOllama({ baseURL: ollamaUrl });
    return ollama(modelId);
  }

  // OpenAI proxy: use direct AI SDK provider (needs custom base URL)
  if (provider === "openai" && env.OPENAI_BASE_URL) {
    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error(
        "OPENAI_BASE_URL is set but OPENAI_API_KEY is missing. Set OPENAI_API_KEY (any non-empty value for proxies).",
      );
    }
    const openaiClient = createOpenAI({
      baseURL: env.OPENAI_BASE_URL,
      apiKey: openaiKey,
    });
    const openaiApiMode =
      env.OPENAI_API_MODE === "chat" ? "chat_completions" : env.OPENAI_API_MODE;
    return openaiApiMode === "chat_completions"
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
  reasoningEffort?: "low" | "medium" | "high" | "none",
): Record<string, any> | undefined {
  const provider = getProvider(model);
  if (provider !== "openai") return undefined;

  // Skip for proxy mode (no Responses API support)
  if (env.OPENAI_BASE_URL) return undefined;

  const openaiApiMode =
    env.OPENAI_API_MODE === "chat" ? "chat_completions" : env.OPENAI_API_MODE;
  if (openaiApiMode !== "responses") return undefined;

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

function createAgent(modelString: string, instructions?: string): Agent {
  const provider = getProvider(modelString);

  // Ollama/proxy: use direct AI SDK model instance
  if (provider === "ollama" || (provider === "openai" && env.OPENAI_BASE_URL)) {
    return new Agent({
      id: `model-call-${modelString}`,
      name: `Model Call (${modelString})`,
      model: getModel(modelString) as any,
      instructions: instructions || "",
    });
  }

  // All other providers: use Mastra router string
  return new Agent({
    id: `model-call-${modelString}`,
    name: `Model Call (${modelString})`,
    model: toRouterString(modelString) as any,
    instructions: instructions || "",
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
  complexity: ModelComplexity = "high",
  cacheKey?: string,
  reasoningEffort?: "low" | "medium" | "high",
) {
  const model = getModelForTask(complexity);
  logger.info(`complexity: ${complexity}, model: ${model}`);

  const providerOptions = buildOpenAIProviderOptions(
    model,
    cacheKey || `ingestion-${complexity}`,
    reasoningEffort,
  );

  const agent = createAgent(model);

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
  const openaiApiMode =
    env.OPENAI_API_MODE === "chat" ? "chat_completions" : env.OPENAI_API_MODE;
  const isProxyChatMode = openaiApiMode === "chat_completions" && !!env.OPENAI_BASE_URL;
  const isOllama = env.CHAT_PROVIDER === "ollama";
  return isProxyChatMode || isOllama;
}

export async function makeStructuredModelCall<T extends z.ZodType>(
  schema: T,
  messages: ModelMessage[],
  complexity: ModelComplexity = "high",
  cacheKey?: string,
  temperature?: number,
): Promise<{ object: z.infer<T>; usage: TokenUsage | undefined }> {
  const model = getModelForTask(complexity);
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
    );
    const tokenUsage = toTokenUsage(usage);
    logTokenUsage(`Structured/${complexity.toUpperCase()}`, model, tokenUsage);
    return { object, usage: tokenUsage };
  }

  // Standard path: Mastra Agent with structuredOutput
  const agent = createAgent(model);

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
): Promise<{ object: z.infer<T>; usage: any }> {
  const jsonPreamble =
    "Return ONLY a single valid JSON object that matches the requested schema. " +
    "Do not wrap it in Markdown fences. Do not include extra text. " +
    "Include every required key; use null for nullable fields; use [] for empty arrays.";

  const agent = createAgent(modelString, jsonPreamble);

  const textResult = await agent.generate(messages as any, {
    ...(temperature !== undefined && { temperature }),
  });

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
  );

  const repairResult = await repairAgent.generate(
    [{ role: "user", content: textResult.text }] as any,
    { temperature: 0 },
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
// Available models (for multi-model UI)
// ---------------------------------------------------------------------------

export function getAvailableModels(): AvailableModel[] {
  const models: AvailableModel[] = [];

  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL) {
    models.push(
      { id: "openai/gpt-5.2-2025-12-11", label: "GPT-5.2", provider: "openai" },
      { id: "openai/gpt-5-2025-08-07", label: "GPT-5", provider: "openai" },
      { id: "openai/gpt-5-mini-2025-08-07", label: "GPT-5 Mini", provider: "openai" },
      { id: "openai/gpt-4.1-2025-04-14", label: "GPT-4.1", provider: "openai" },
      { id: "openai/gpt-4.1-mini-2025-04-14", label: "GPT-4.1 Mini", provider: "openai" },
    );
  }

  if (env.ANTHROPIC_API_KEY) {
    models.push(
      { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic" },
      { id: "anthropic/claude-3-7-sonnet-20250219", label: "Claude Sonnet 3.7", provider: "anthropic" },
      { id: "anthropic/claude-3-5-haiku-20241022", label: "Claude Haiku", provider: "anthropic" },
    );
  }

  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    models.push(
      { id: "google/gemini-2.5-pro-preview-03-25", label: "Gemini 2.5 Pro", provider: "google" },
      { id: "google/gemini-2.5-flash-preview-04-17", label: "Gemini 2.5 Flash", provider: "google" },
    );
  }

  if (env.OLLAMA_URL) {
    // Ollama models are dynamic — user configures MODEL env var
    const ollamaModel = env.MODEL;
    if (env.CHAT_PROVIDER === "ollama" && ollamaModel) {
      models.push({
        id: `ollama/${ollamaModel}`,
        label: ollamaModel,
        provider: "ollama",
      });
    }
  }

  return models;
}

export function getDefaultModelString(): string {
  return toRouterString(env.MODEL);
}

// ---------------------------------------------------------------------------
// Embeddings — Mastra ModelRouterEmbeddingModel
// ---------------------------------------------------------------------------

function getEmbeddingModel() {
  const embeddingsProvider = env.EMBEDDINGS_PROVIDER;
  const modelId = env.EMBEDDING_MODEL || "text-embedding-3-small";

  // Ollama: use config object with custom URL
  if (embeddingsProvider === "ollama") {
    const ollamaUrl = env.OLLAMA_URL;
    if (!ollamaUrl) {
      throw new Error(
        "Ollama embeddings selected but OLLAMA_URL is not set. Set OLLAMA_URL or set EMBEDDINGS_PROVIDER=openai.",
      );
    }
    return new ModelRouterEmbeddingModel({
      providerId: "ollama",
      modelId,
      url: `${ollamaUrl.replace(/\/+$/, "")}/v1`,
      apiKey: "not-needed",
    });
  }

  // OpenAI proxy: use config object with custom URL
  if (env.OPENAI_BASE_URL) {
    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error(
        "OPENAI_BASE_URL is set but OPENAI_API_KEY is missing. Set OPENAI_API_KEY (any non-empty value for proxies).",
      );
    }
    return new ModelRouterEmbeddingModel({
      providerId: "openai",
      modelId,
      url: env.OPENAI_BASE_URL,
      apiKey: openaiKey,
    });
  }

  // All other providers: use router string
  const provider = embeddingsProvider === "google" ? "google" : "openai";
  return new ModelRouterEmbeddingModel(`${provider}/${modelId}` as any);
}

export async function getEmbedding(text: string) {
  const targetDimRaw = env.EMBEDDING_MODEL_SIZE;
  const targetDim =
    targetDimRaw && Number.isFinite(Number(targetDimRaw))
      ? Number(targetDimRaw)
      : undefined;
  const maxRetries = 3;
  let lastEmbedding: number[] = [];
  let textForEmbedding = (text ?? "").toString();

  const embeddingModel = getEmbeddingModel();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { embedding } = await embed({
        model: embeddingModel,
        value: textForEmbedding,
        ...(targetDim && env.EMBEDDINGS_PROVIDER === "google" && {
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
              `Embedding dimension mismatch: got ${lastEmbedding.length}, expected ${targetDim}. Padding with zeros; set EMBEDDING_MODEL_SIZE to ${lastEmbedding.length} and re-embed to fix permanently.`,
            );
            lastEmbedding = lastEmbedding.concat(
              new Array(targetDim - lastEmbedding.length).fill(0),
            );
          } else if (lastEmbedding.length > targetDim) {
            throw new Error(
              `Embedding dimension mismatch: got ${lastEmbedding.length}, expected ${targetDim}. Update EMBEDDING_MODEL_SIZE and re-embed/migrate vectors.`,
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
    `Failed to generate non-empty embedding after ${maxRetries} attempts (provider=${env.EMBEDDINGS_PROVIDER}, model=${env.EMBEDDING_MODEL || "text-embedding-3-small"}).`,
  );
}
