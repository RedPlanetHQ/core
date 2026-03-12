import {
  embed,
  generateText,
  generateObject,
  streamText,
  type ModelMessage,
} from "ai";
import { type z } from "zod";
import {
  createOpenAI,
  openai,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";

import { createOllama } from "ollama-ai-provider-v2";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { env } from "~/env.server";

export type ModelComplexity = "high" | "low";

function shouldUseOllamaForEmbeddings(
  embeddingsProvider?: "openai" | "ollama",
): boolean {
  return embeddingsProvider === "ollama";
}

/**
 * Get the appropriate model for a given complexity level.
 * HIGH complexity uses the configured MODEL.
 * LOW complexity automatically downgrades to cheaper variants if possible.
 */
export function getModelForTask(complexity: ModelComplexity = "high"): string {
  const baseModel = env.MODEL;

  // HIGH complexity - always use the configured model
  if (complexity === "high") {
    return baseModel;
  }

  // LOW complexity - automatically downgrade expensive models to cheaper variants
  // If already using a cheap model, keep it
  const downgrades: Record<string, string> = {
    // OpenAI downgrades
    "gpt-5.2-2025-12-11": "gpt-5-mini-2025-08-07",
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

/**
 * Get the model to use for batch API calls.
 * Some models (e.g. gpt-5.2) don't work well with batch API,
 * so we downgrade to a known-working variant.
 */
export function getModelForBatch(): string {
  const baseModel = env.MODEL;

  const batchDowngrades: Record<string, string> = {
    "gpt-5.2-2025-12-11": "gpt-5-2025-08-07",
    "gpt-5.1-2025-11-13": "gpt-5-2025-08-07",
  };

  return batchDowngrades[baseModel] || baseModel;
}

export const getModel = (takeModel?: string) => {
  let model = takeModel;

  const anthropicKey = env.ANTHROPIC_API_KEY;
  const googleKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  const openaiBaseUrl = env.OPENAI_BASE_URL;
  const ollamaUrl = env.OLLAMA_URL;
  const chatProvider = env.CHAT_PROVIDER;
  const openaiApiMode = env.OPENAI_API_MODE === "chat" ? "chat_completions" : env.OPENAI_API_MODE;
  model = model || env.MODEL;

  let modelInstance;
  let modelTemperature = env.MODEL_TEMPERATURE;

  switch (chatProvider) {
    case "ollama": {
      if (!ollamaUrl) {
        throw new Error(
          "CHAT_PROVIDER is set to ollama but OLLAMA_URL is not set",
        );
      }
      if (!model) {
        throw new Error("No chat model configured for Ollama. Set MODEL.");
      }
      const ollama = createOllama({ baseURL: ollamaUrl });
      modelInstance = ollama(model);
      break;
    }
    case "anthropic": {
      if (!anthropicKey) {
        throw new Error("No Anthropic API key found. Set ANTHROPIC_API_KEY");
      }
      modelInstance = anthropic(model);
      modelTemperature = 0.5;
      break;
    }
    case "google": {
      if (!googleKey) {
        throw new Error(
          "No Google API key found. Set GOOGLE_GENERATIVE_AI_API_KEY",
        );
      }
      modelInstance = google(model);
      break;
    }
    case "openai":
    default: {
      if (!openaiKey && !openaiBaseUrl) {
        throw new Error("No OpenAI API key found. Set OPENAI_API_KEY");
      }
      if (openaiBaseUrl && !openaiKey) {
        throw new Error(
          "OPENAI_BASE_URL is set but OPENAI_API_KEY is missing. Set OPENAI_API_KEY (any non-empty value for proxies).",
        );
      }
      const openaiClient = openaiBaseUrl
        ? createOpenAI({
            baseURL: openaiBaseUrl,
            apiKey: openaiKey,
          })
        : openai;
      modelInstance = openaiApiMode === "chat_completions"
        ? openaiClient.chat(model)
        : openaiClient.responses(model);
      break;
    }
  }

  return modelInstance;
};

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export async function makeModelCall(
  stream: boolean,
  messages: ModelMessage[],
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

  const openaiApiMode = env.OPENAI_API_MODE === "chat" ? "chat_completions" : env.OPENAI_API_MODE;

  // Add OpenAI provider options for prompt caching (Responses API only).
  if (
    env.CHAT_PROVIDER === "openai" &&
    openaiApiMode === "responses"
  ) {
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
 * Make a model call that returns structured data using a Zod schema.
 * Uses AI SDK's generateObject for guaranteed structured output.
 */
export async function makeStructuredModelCall<T extends z.ZodType>(
  schema: T,
  messages: ModelMessage[],
  complexity: ModelComplexity = "high",
  cacheKey?: string,
  temperature?: number,
): Promise<{ object: z.infer<T>; usage: TokenUsage | undefined }> {
  const chatProvider = env.CHAT_PROVIDER;
  const openaiApiMode = env.OPENAI_API_MODE === "chat" ? "chat_completions" : env.OPENAI_API_MODE;
  const useOllamaForChat = chatProvider === "ollama";

  // Default upstream behavior expects `generateObject()` to parse strict JSON output.
  //
  // Some OpenAI-compatible proxies / self-hosted models occasionally wrap JSON in Markdown fences
  // (e.g. ```json ... ```). This is valid human formatting but breaks strict JSON parsing.
  //
  // To preserve upstream defaults, we only apply tolerant repair when explicitly opted in
  // (LLM_TOLERANT_OUTPUT) or when running in proxy/self-hosted chat modes.
  // Note: anthropic and google have native structured output support, so they don't need this.
  const tolerantOverride = (env.LLM_TOLERANT_OUTPUT || "")
    .trim()
    .toLowerCase();
  // Proxy/self-hosted modes only (preserves upstream defaults):
  // - OPENAI_API_MODE=chat_completions + OPENAI_BASE_URL indicates an OpenAI-compatible proxy
  // - CHAT_PROVIDER=ollama indicates a self-hosted chat model
  const isProxyChatMode =
    openaiApiMode === "chat_completions" && !!env.OPENAI_BASE_URL;
  const isOllamaChatProvider = useOllamaForChat;

  const tolerantOutput =
    tolerantOverride.length > 0
      ? tolerantOverride === "true" ||
        tolerantOverride === "1" ||
        tolerantOverride === "yes"
      : isProxyChatMode || isOllamaChatProvider;

  const tryParseJsonFromText = (raw: string): unknown | undefined => {
    const trimmed = (raw ?? "").toString().trim();
    if (!trimmed) return undefined;

    const unfenced = trimmed
      // Remove common Markdown fences anywhere in the output.
      .replace(/```(?:json)?/gi, "")
      .trim();

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
  };

  const model = getModelForTask(complexity);
  logger.info(`[Structured] complexity: ${complexity}, model: ${model}`);

  const modelInstance = getModel(model);
  const generateObjectOptions: any = {};

  if (temperature !== undefined) {
    generateObjectOptions.temperature = temperature;
  }

  // Add OpenAI provider options for prompt caching
  if (
    chatProvider === "openai" &&
    openaiApiMode === "responses"
  ) {
    const openaiOptions: OpenAIResponsesProviderOptions = {
      promptCacheKey: cacheKey || `structured-${complexity}`,
      strictJsonSchema: false,
    };

    if (model.startsWith("gpt-5")) {
      if (model.includes("mini")) {
        openaiOptions.reasoningEffort = "low";
      } else {
        openaiOptions.promptCacheRetention = "24h";
        openaiOptions.reasoningEffort = "none";
      }
    }

    generateObjectOptions.providerOptions = {
      openai: openaiOptions,
    };
  }

  if (!modelInstance) {
    throw new Error(`Unsupported model type: ${model}`);
  }

  type ModelUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
  };

  const getTextFromError = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    return typeof record.text === "string" ? record.text : undefined;
  };

  const getCause = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    return record.cause;
  };

  const isModelUsage = (value: unknown): value is ModelUsage => {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
      (record.inputTokens === undefined ||
        typeof record.inputTokens === "number") &&
      (record.outputTokens === undefined ||
        typeof record.outputTokens === "number") &&
      (record.totalTokens === undefined ||
        typeof record.totalTokens === "number") &&
      (record.cachedInputTokens === undefined ||
        typeof record.cachedInputTokens === "number")
    );
  };

  let object: z.infer<T> | undefined;
  let usage: ModelUsage | undefined;
  try {
    if (isProxyChatMode || useOllamaForChat) {
      // OpenAI-compatible proxies (and some self-hosted models) don't reliably support OpenAI's
      // JSON Schema structured output in chat-completions mode.
      //
      // Instead, we explicitly ask for strict JSON and parse it ourselves. This preserves the
      // default upstream path (Responses API + structured outputs) while making proxy/self-hosted
      // deployments work without needing upstream-only capabilities.
      const jsonOnlyPreamble: ModelMessage = {
        role: "system",
        content:
          "Return ONLY a single valid JSON object that matches the requested schema. " +
          "Do not wrap it in Markdown fences. Do not include extra text. " +
          "Include every required key; use null for nullable fields; use [] for empty arrays.",
      };

      const textResult = await generateText({
        model: modelInstance,
        messages: [jsonOnlyPreamble, ...messages],
        temperature: generateObjectOptions.temperature,
      });

      const parsed = tryParseJsonFromText(textResult.text);
      const validated = parsed ? schema.safeParse(parsed) : undefined;
      if (!validated?.success) {
        // Some proxies/self-hosted models ignore the "JSON only" constraint sporadically. When that
        // happens, a targeted repair prompt is usually enough to convert the output into valid JSON
        // without changing upstream defaults (this branch only runs in proxy/self-hosted chat modes).
        const repairResult = await generateText({
          model: modelInstance,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You are a JSON repair assistant. Convert the user's content into a single valid JSON object. " +
                "Return ONLY the JSON object, with no Markdown fences and no extra text.",
            },
            {
              role: "user",
              content: textResult.text,
            },
          ],
        });

        const repairedParsed = tryParseJsonFromText(repairResult.text);
        const repairedValidated = repairedParsed
          ? schema.safeParse(repairedParsed)
          : undefined;
        if (!repairedValidated?.success) {
          const err = new Error(
            "No object generated: could not parse/validate JSON from proxy/self-hosted model output.",
          ) as Error & { text?: string; repairText?: string };
          err.text = textResult.text;
          err.repairText = repairResult.text;
          throw err;
        }

        object = repairedValidated.data;
        usage = repairResult.usage ?? textResult.usage;
      } else {
        object = validated.data;
        usage = textResult.usage;
      }
    } else {
      const result = await generateObject({
        model: modelInstance,
        schema,
        messages,
        ...generateObjectOptions,
      });
      object = result.object;
      usage = result.usage;
    }
  } catch (error) {
    if (!tolerantOutput) {
      throw error;
    }

    const directText = getTextFromError(error);
    const cause = getCause(error);
    const causeText = getTextFromError(cause);
    const nestedCauseText = getTextFromError(getCause(cause));
    const rawText =
      directText ||
      causeText ||
      nestedCauseText ||
      "";

    const parsed = rawText ? tryParseJsonFromText(rawText) : undefined;
    const validated = parsed ? schema.safeParse(parsed) : undefined;
    if (validated?.success) {
      logger.warn(
        "[Structured] Tolerant output repair: recovered JSON from non-strict model output.",
        {
          model,
          complexity,
        },
      );
      object = validated.data;
      if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        usage = isModelUsage(record.usage) ? record.usage : undefined;
      }
    } else {
      throw error;
    }
  }

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
      `[Structured/${complexity.toUpperCase()}] ${model} - Tokens: ${tokenUsage.totalTokens} (prompt: ${tokenUsage.promptTokens}, completion: ${tokenUsage.completionTokens}, cached: ${tokenUsage.cachedInputTokens})`,
    );
  }

  if (object === undefined) {
    throw new Error("No object generated from structured model call.");
  }

  return { object, usage: tokenUsage };
}

/**
 * Determines if a given model is proprietary (OpenAI, Anthropic, Google, Grok)
 * or open source (accessed via Bedrock, Ollama, etc.)
 */
export function isProprietaryModel(
  modelName?: string,
  complexity: ModelComplexity = "high",
): boolean {
  const chatProvider = env.CHAT_PROVIDER;
  // ollama is always self-hosted/open-source
  if (chatProvider === "ollama") return false;
  // openai, anthropic, google are proprietary providers
  if (chatProvider === "anthropic" || chatProvider === "google") return true;

  // For openai provider, check model name (could be proxying an open-source model)
  const model = modelName || getModelForTask(complexity);
  if (!model) return false;

  const proprietaryPatterns = [
    /^gpt-/, // OpenAI models
    /^claude-/, // Anthropic models
    /^gemini-/, // Google models
    /^grok-/, // xAI models
  ];

  return proprietaryPatterns.some((pattern) => pattern.test(model));
}

export async function getEmbedding(text: string) {
  const ollamaUrl = env.OLLAMA_URL;
  const model = env.EMBEDDING_MODEL;
  const openaiBaseUrl = env.OPENAI_BASE_URL;
  const openaiKey = env.OPENAI_API_KEY;
  const embeddingsProvider = env.EMBEDDINGS_PROVIDER;
  const targetDimRaw = env.EMBEDDING_MODEL_SIZE;
  const targetDim =
    targetDimRaw && Number.isFinite(Number(targetDimRaw))
      ? Number(targetDimRaw)
      : undefined;
  const maxRetries = 3;
  let lastEmbedding: number[] = [];
  let textForEmbedding = (text ?? "").toString();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const embeddingModel = model || "text-embedding-3-small";

      const useOllamaEmbeddings = shouldUseOllamaForEmbeddings(embeddingsProvider);

      if (useOllamaEmbeddings) {
        if (!ollamaUrl) {
          throw new Error(
            "Ollama embeddings selected but OLLAMA_URL is not set. Set OLLAMA_URL or set EMBEDDINGS_PROVIDER=openai.",
          );
        }
        // Ollama's stable embeddings endpoint is /api/embeddings (not always available on /v1/embeddings).
        const baseUrl = ollamaUrl.replace(/\/+$/, "");
        const response = await fetch(`${baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: embeddingModel,
            prompt: textForEmbedding,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Ollama embeddings request failed (${response.status}): ${await response.text()}`,
          );
        }

        const data = (await response.json()) as { embedding?: number[] };
        lastEmbedding = data.embedding ?? [];
      } else {
        if (!openaiKey && !openaiBaseUrl) {
          throw new Error(
            "No OpenAI API key found. Set OPENAI_API_KEY (or set OPENAI_BASE_URL for a proxy).",
          );
        }
        if (openaiBaseUrl && !openaiKey) {
          throw new Error(
            "OPENAI_BASE_URL is set but OPENAI_API_KEY is missing. Set OPENAI_API_KEY (any non-empty value for proxies).",
          );
        }
        const embeddingClient = openaiBaseUrl
          ? createOpenAI({
              baseURL: openaiBaseUrl,
              apiKey: openaiKey,
            })
          : openai;

        const { embedding } = await embed({
          model: embeddingClient.embedding(embeddingModel),
          value: textForEmbedding,
        });
        lastEmbedding = embedding;
      }

      // If embedding is not empty, return it immediately
      if (lastEmbedding.length > 0) {
        // Ollama / open-source embedding models may have dimensions that don't match CORE defaults.
        // Why: pgvector columns are created with a fixed dimension (e.g. 1536). If we store a vector
        // with a different dimension, inserts will fail.
        //
        // Prefer setting EMBEDDING_MODEL_SIZE to the model's native dimension
        // (e.g. `mxbai-embed-large` → 1024) so vectors are stored without modification.
        //
        // Padding is a pragmatic compatibility bridge:
        // - When switching embedding models, it's easy to forget updating EMBEDDING_MODEL_SIZE.
        // - Without padding, vector inserts will start failing immediately.
        // - Padding with trailing zeros avoids silent information loss (unlike truncation),
        //   and makes the mismatch visible in logs so it can be fixed properly (re-embed/migrate).
        if (targetDim && targetDim > 0) {
          if (lastEmbedding.length < targetDim) {
            logger.warn(
              `Embedding dimension mismatch: got ${lastEmbedding.length}, expected ${targetDim}. Padding with zeros; set EMBEDDING_MODEL_SIZE to ${lastEmbedding.length} and re-embed to fix permanently.`,
            );
            lastEmbedding = lastEmbedding.concat(
              new Array(targetDim - lastEmbedding.length).fill(0),
            );
          } else if (lastEmbedding.length > targetDim) {
            // Truncation would silently discard signal. Fail with an actionable error instead.
            throw new Error(
              `Embedding dimension mismatch: got ${lastEmbedding.length}, expected ${targetDim}. Update EMBEDDING_MODEL_SIZE and re-embed/migrate vectors.`,
            );
          }
        }
        return lastEmbedding;
      }

      // If empty, log and retry (unless it's the last attempt)
      if (attempt < maxRetries) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries}: Got empty embedding, retrying...`,
        );
      }
    } catch (error) {
      const errorString = error instanceof Error ? error.message : String(error);
      const isContextLengthError =
        /context length/i.test(errorString) ||
        /exceeds the context length/i.test(errorString);

      // TODO: Persona/docs can grow unbounded over time; embedding the full text will eventually
      // hit provider context limits and/or dilute retrieval signal. Long-term fix: chunk and/or
      // summarize before embedding, and store per-chunk vectors rather than truncating.
      // Ollama can reject long inputs for embeddings. Retry with a shorter prompt.
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

      logger.error(`Embedding attempt ${attempt}/${maxRetries} failed: ${error}`);
    }
  }

  throw new Error(
    `Failed to generate non-empty embedding after ${maxRetries} attempts (provider=${embeddingsProvider}, model=${model || "text-embedding-3-small"}).`,
  );
}
