import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";
import seedData from "~/config/llm-models.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeedModel {
  modelId: string;
  label: string;
  complexity: string;
  supportsBatch?: boolean;
  isDeprecated?: boolean;
  capabilities: string[];
  dimensions?: number;
}

interface SeedProvider {
  name: string;
  envKey: string;
  models: SeedModel[];
}

export interface EmbeddingInfo {
  modelId: string;
  providerId: string;
  providerType: string;
  dimensions: number;
}

interface ProviderConfig {
  baseUrl?: string;
  apiMode?: string;
}

export type UseCase = "chat" | "memory" | "search";
export type ModelComplexity = "low" | "medium" | "high";
const BURST_SAFE_BACKGROUND_DELAY_MS = 15_000;
const BURST_SAFE_CONVERSATION_INGEST_DELAY_MS = 45_000;

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

function buildProviderConfig(providerType: string): Record<string, unknown> {
  switch (providerType) {
    case "openai":
      return {
        ...(env.OPENAI_BASE_URL && { baseUrl: env.OPENAI_BASE_URL }),
        ...(env.OPENAI_API_MODE && {
          apiMode:
            env.OPENAI_API_MODE === "chat"
              ? "chat_completions"
              : env.OPENAI_API_MODE,
        }),
      };
    case "ollama":
      return {
        ...(env.OLLAMA_URL && { baseUrl: env.OLLAMA_URL }),
      };
    case "azure":
      return {
        ...(env.AZURE_BASE_URL && { baseUrl: env.AZURE_BASE_URL }),
      };
    default:
      return {};
  }
}

/**
 * Idempotent seeder — ensures all providers and models from llm-models.json
 * exist in the DB. Safe to call on every startup / workspace creation.
 */
export async function ensureDefaultProviders(): Promise<void> {
  const catalog = seedData as Record<string, SeedProvider>;
  const protectedCustomModelIds = new Set(
    [env.MODEL, env.EMBEDDING_MODEL].filter(Boolean) as string[],
  );

  for (const [providerType, providerData] of Object.entries(catalog)) {
    let provider = await prisma.lLMProvider.findFirst({
      where: { type: providerType, workspaceId: null },
    });
    const config = buildProviderConfig(providerType) as any;

    if (!provider) {
      provider = await prisma.lLMProvider.create({
        data: {
          name: providerData.name,
          type: providerType,
          isActive: true,
          config,
        },
      });
      logger.info(`[LLM] Created provider: ${providerData.name}`);
    } else if (Object.keys(config).length > 0) {
      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: { config },
      });
    }

    const existingModels = await prisma.lLMModel.findMany({
      where: { providerId: provider.id },
    });
    const existingModelIds = new Set(existingModels.map((m) => m.modelId));
    const seedModelIds = new Set(providerData.models.map((m) => m.modelId));

    for (const seedModel of providerData.models) {
      if (!existingModelIds.has(seedModel.modelId)) {
        await prisma.lLMModel.create({
          data: {
            providerId: provider.id,
            modelId: seedModel.modelId,
            label: seedModel.label,
            complexity: seedModel.complexity,
            supportsBatch: seedModel.supportsBatch ?? true,
            isDeprecated: seedModel.isDeprecated ?? false,
            capabilities: seedModel.capabilities,
            dimensions: seedModel.dimensions ?? null,
          },
        });
        logger.info(
          `[LLM] Added model: ${seedModel.label} (${seedModel.modelId})`,
        );
      } else {
        const existing = existingModels.find(
          (m) => m.modelId === seedModel.modelId,
        )!;
        await prisma.lLMModel.update({
          where: { id: existing.id },
          data: {
            label: seedModel.label,
            capabilities: seedModel.capabilities,
            dimensions: seedModel.dimensions ?? null,
          },
        });
      }
    }

    for (const existing of existingModels) {
      if (
        !seedModelIds.has(existing.modelId) &&
        !protectedCustomModelIds.has(existing.modelId) &&
        !existing.isDeprecated
      ) {
        await prisma.lLMModel.update({
          where: { id: existing.id },
          data: { isDeprecated: true },
        });
        logger.info(`[LLM] Deprecated model: ${existing.modelId}`);
      }
    }
  }

  // Dynamic model creation for env-specified models not in seed

  if (env.MODEL) {
    const targetProvider = await prisma.lLMProvider.findFirst({
      where: { type: env.CHAT_PROVIDER, workspaceId: null },
    });
    if (targetProvider) {
      const chatModel = await prisma.lLMModel.findFirst({
        where: {
          providerId: targetProvider.id,
          modelId: env.MODEL,
          capabilities: { has: "chat" },
        },
      });

      if (!chatModel) {
        await prisma.lLMModel.create({
          data: {
            providerId: targetProvider.id,
            modelId: env.MODEL,
            label: env.MODEL,
            complexity: "medium",
            supportsBatch: false,
            capabilities: ["chat"],
          },
        });
        logger.info(
          `[LLM] Added custom chat model: ${env.MODEL} under ${env.CHAT_PROVIDER}`,
        );
      } else if (chatModel.isDeprecated) {
        await prisma.lLMModel.update({
          where: { id: chatModel.id },
          data: {
            label: env.MODEL,
            complexity: chatModel.complexity,
            supportsBatch: false,
            capabilities: ["chat"],
            isDeprecated: false,
            isEnabled: true,
          },
        });
        logger.info(
          `[LLM] Restored custom chat model: ${env.MODEL} under ${env.CHAT_PROVIDER}`,
        );
      }
    }
  }

  const embeddingProvider = env.EMBEDDINGS_PROVIDER ?? "openai";
  const embeddingModelId = env.EMBEDDING_MODEL || "text-embedding-3-small";
  const targetProvider = await prisma.lLMProvider.findFirst({
    where: { type: embeddingProvider, workspaceId: null },
  });
  if (targetProvider) {
    const embeddingModel = await prisma.lLMModel.findFirst({
      where: {
        providerId: targetProvider.id,
        modelId: embeddingModelId,
        capabilities: { has: "embedding" },
      },
    });
    const dims = parseInt(env.EMBEDDING_MODEL_SIZE || "1024", 10);
    if (!embeddingModel) {
      await prisma.lLMModel.create({
        data: {
          providerId: targetProvider.id,
          modelId: embeddingModelId,
          label: embeddingModelId,
          complexity: "medium",
          supportsBatch: false,
          capabilities: ["embedding"],
          dimensions: dims,
        },
      });
        logger.info(
          `[LLM] Added custom embedding model: ${embeddingModelId} under ${embeddingProvider}`,
        );
    } else if (embeddingModel.isDeprecated) {
      await prisma.lLMModel.update({
        where: { id: embeddingModel.id },
        data: {
          label: embeddingModelId,
          complexity: embeddingModel.complexity,
          supportsBatch: false,
          capabilities: ["embedding"],
          dimensions: dims,
          isDeprecated: false,
          isEnabled: true,
        },
      });
      logger.info(
        `[LLM] Restored custom embedding model: ${embeddingModelId} under ${embeddingProvider}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Accessors — direct from env (no cache)
// ---------------------------------------------------------------------------

export function getDefaultChatProviderType(): string {
  return env.CHAT_PROVIDER;
}

export function getDefaultChatModelId(): string {
  return env.MODEL;
}

export function getProviderConfig(providerType: string): ProviderConfig {
  if (providerType === "openai") {
    return {
      baseUrl: env.OPENAI_BASE_URL,
      apiMode:
        env.OPENAI_API_MODE === "chat"
          ? "chat_completions"
          : env.OPENAI_API_MODE,
    };
  }
  if (providerType === "ollama") {
    return { baseUrl: env.OLLAMA_URL };
  }
  if (providerType === "azure") {
    return { baseUrl: env.AZURE_BASE_URL };
  }
  return {};
}

async function resolveProviderBaseUrl(
  providerType: string,
  workspaceId?: string | null,
): Promise<string | undefined> {
  if (
    providerType !== "azure" &&
    providerType !== "openai" &&
    providerType !== "ollama"
  ) {
    return undefined;
  }

  const byokBaseUrl = workspaceId
    ? await resolveWorkspaceProviderBaseUrl(workspaceId, providerType)
    : null;

  const envBaseUrl =
    providerType === "azure"
      ? env.AZURE_BASE_URL
      : providerType === "openai"
        ? env.OPENAI_BASE_URL
        : env.OLLAMA_URL;

  return byokBaseUrl ?? envBaseUrl;
}

export function isBurstSensitiveChatProvider(): boolean {
  return (
    env.CHAT_PROVIDER === "ollama" ||
    (env.CHAT_PROVIDER === "openai" && !!env.OPENAI_BASE_URL)
  );
}

export function getBurstSafeBackgroundDelayMs(): number {
  return isBurstSensitiveChatProvider() ? BURST_SAFE_BACKGROUND_DELAY_MS : 0;
}

export function getBurstSafeConversationIngestDelayMs(): number {
  return isBurstSensitiveChatProvider()
    ? BURST_SAFE_CONVERSATION_INGEST_DELAY_MS
    : 0;
}

export function getBurstSafeBullmqConcurrency(
  envKey: string,
  defaultConcurrency: number,
): number {
  if (process.env[envKey]) {
    return defaultConcurrency;
  }

  if (!isBurstSensitiveChatProvider()) {
    return defaultConcurrency;
  }

  return Math.min(defaultConcurrency, 1);
}

export async function getDefaultEmbeddingInfo(): Promise<EmbeddingInfo | null> {
  const embeddingModelId = env.EMBEDDING_MODEL || "text-embedding-3-small";
  const model = await prisma.lLMModel.findFirst({
    where: { modelId: embeddingModelId, capabilities: { has: "embedding" } },
    include: { provider: true },
  });
  if (!model) return null;
  return {
    modelId: model.modelId,
    providerId: model.providerId,
    providerType: model.provider.type,
    dimensions: model.dimensions ?? 1024,
  };
}

export async function getEmbeddingDimensions(): Promise<number> {
  const info = await getDefaultEmbeddingInfo();
  return info?.dimensions ?? parseInt(env.EMBEDDING_MODEL_SIZE || "1024", 10);
}

// ---------------------------------------------------------------------------
// Use-case model resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the model ID for a given use case + complexity.
 *
 * Resolution order:
 *   1. workspace.metadata.modelConfig[useCase].modelId  (explicit workspace override)
 *   2. env.MODEL                                        (server-level default)
 *   3. LLMModel with env.CHAT_PROVIDER + complexity     (DB complexity routing fallback)
 */
export async function getModelForUseCase(
  useCase: UseCase,
  workspaceId: string | null | undefined,
  complexity: ModelComplexity = "medium",
): Promise<string> {
  // 1. Workspace override — always check when workspace has explicit model config.
  // This ensures BYOK workspaces use their chosen model at every complexity tier.
  if (workspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const meta = (workspace?.metadata ?? {}) as Record<string, any>;
    const modelConfig = meta.modelConfig as
      | Record<string, { modelId: string }>
      | undefined;
    const modelId = modelConfig?.[useCase]?.modelId;
    if (modelId) return modelId;
  }

  // 2. Server-level default model
  if (env.MODEL) return env.MODEL;

  // 3. DB complexity routing via env.CHAT_PROVIDER
  const provider = await prisma.lLMProvider.findFirst({
    where: { type: env.CHAT_PROVIDER, workspaceId: null },
  });
  if (provider) {
    const model = await prisma.lLMModel.findFirst({
      where: {
        providerId: provider.id,
        complexity,
        capabilities: { has: "chat" },
        isEnabled: true,
        isDeprecated: false,
      },
    });
    if (model) return model.modelId;
  }

  // 4. env fallback
  return env.MODEL;
}

// ---------------------------------------------------------------------------
// Provider / model queries
// ---------------------------------------------------------------------------

const ENV_KEY_MAP: Record<string, string | undefined> = {
  openai: env.OPENAI_API_KEY,
  anthropic: env.ANTHROPIC_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
  openrouter: env.OPENROUTER_API_KEY,
  deepseek: env.DEEPSEEK_API_KEY,
  vercel: env.AI_GATEWAY_API_KEY,
  groq: env.GROQ_API_KEY,
  mistral: env.MISTRAL_API_KEY,
  xai: env.XAI_API_KEY,
  ollama: env.OLLAMA_URL,
  azure: env.AZURE_API_KEY,
};

export async function getProviders(workspaceId?: string) {
  const globalProviders = await prisma.lLMProvider.findMany({
    where: { workspaceId: null, isActive: true },
    include: { models: true },
  });

  const available = globalProviders.filter((p) => !!ENV_KEY_MAP[p.type]);

  if (workspaceId) {
    const workspaceProviders = await prisma.lLMProvider.findMany({
      where: { workspaceId, isActive: true },
      include: { models: true },
    });
    for (const wp of workspaceProviders) {
      if (!available.some((p) => p.type === wp.type)) {
        const globalForType = globalProviders.find((p) => p.type === wp.type);
        if (globalForType) available.push(globalForType);
      }
    }
  }

  return available;
}

/**
 * Returns enabled, non-deprecated chat models from active providers.
 * Used by the settings UI to populate model selectors.
 */
export async function getChatModels(workspaceId?: string) {
  const providers = await getProviders(workspaceId);
  return prisma.lLMModel.findMany({
    where: {
      providerId: { in: providers.map((p) => p.id) },
      capabilities: { has: "chat" },
      isEnabled: true,
      isDeprecated: false,
    },
    include: { provider: true },
    orderBy: [{ provider: { type: "asc" } }, { label: "asc" }],
  });
}

export async function getAvailableModels(workspaceId?: string) {
  const defaultModelId = workspaceId
    ? await getModelForUseCase("chat", workspaceId, "medium")
    : getDefaultChatModelId();

  const providers = await getProviders(workspaceId);
  const providerIds = providers.map((p) => p.id);

  if (workspaceId) {
    const workspaceProviders = await prisma.lLMProvider.findMany({
      where: { workspaceId, isActive: true },
      include: { models: { where: { isEnabled: true, isDeprecated: false } } },
    });

    const typesWithCustomModels = new Set<string>();
    const customModels: any[] = [];
    for (const wp of workspaceProviders) {
      if (wp.models.length > 0) {
        typesWithCustomModels.add(wp.type);
        customModels.push(...wp.models.map((m) => ({ ...m, provider: wp })));
      }
    }

    const filteredIds = providers
      .filter((p) => !typesWithCustomModels.has(p.type))
      .map((p) => p.id);

    const globalModels = await prisma.lLMModel.findMany({
      where: {
        providerId: { in: filteredIds },
        isEnabled: true,
        isDeprecated: false,
      },
      include: { provider: true },
    });

    return [...globalModels, ...customModels].map((model) => ({
      ...model,
      isDefault: model.modelId === defaultModelId,
    }));
  }

  const models = await prisma.lLMModel.findMany({
    where: {
      providerId: { in: providerIds },
      isEnabled: true,
      isDeprecated: false,
    },
    include: { provider: true },
  });

  return models.map((model) => ({
    ...model,
    isDefault: model.modelId === defaultModelId,
  }));
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

export function resolveApiKey(providerType: string): string | undefined {
  return ENV_KEY_MAP[providerType];
}

import {
  resolveWorkspaceApiKey,
  resolveWorkspaceProviderBaseUrl,
} from "~/services/byok.server";

export interface ResolvedKey {
  apiKey: string | undefined;
  isBYOK: boolean;
}

export async function resolveApiKeyForWorkspace(
  workspaceId: string | null | undefined,
  providerType: string,
): Promise<ResolvedKey> {
  if (workspaceId) {
    const byokKey = await resolveWorkspaceApiKey(workspaceId, providerType);
    if (byokKey) return { apiKey: byokKey, isBYOK: true };
  }
  return { apiKey: ENV_KEY_MAP[providerType], isBYOK: false };
}

/**
 * Infer provider type from model ID.
 * Duplicated from model.server.ts to avoid circular imports.
 */
function inferProviderFromModelId(modelId: string): string {
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  )
    return "openai";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("us.amazon") || modelId.startsWith("us.meta"))
    return "bedrock";
  if (modelId.startsWith("openrouter/")) return "openrouter";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (
    modelId.startsWith("mistral-") ||
    modelId.startsWith("open-mistral-") ||
    modelId.startsWith("open-mixtral-")
  )
    return "mistral";
  if (modelId.startsWith("grok-")) return "xai";
  if (modelId.startsWith("groq/")) return "groq";
  if (modelId.startsWith("vercel/")) return "vercel";
  if (modelId.startsWith("azure/")) return "azure";
  return env.CHAT_PROVIDER;
}

/**
 * Resolve model + API key for a workspace, use case and complexity.
 * Model: workspace.metadata.modelConfig[useCase] → DB complexity → env.MODEL
 * Key:   workspace BYOK → env key
 */
export async function resolveModelForWorkspace(
  workspaceId: string | null | undefined,
  useCase: UseCase = "chat",
  complexity: ModelComplexity = "medium",
): Promise<{
  modelId: string;
  apiKey: string | undefined;
  isBYOK: boolean;
  baseUrl?: string;
}> {
  const modelId = await getModelForUseCase(useCase, workspaceId, complexity);
  const providerType = inferProviderFromModelId(modelId);
  const { apiKey, isBYOK } = await resolveApiKeyForWorkspace(
    workspaceId,
    providerType,
  );

  // Providers with custom endpoints can resolve a workspace-scoped base URL.
  if (
    providerType === "azure" ||
    providerType === "openai" ||
    providerType === "ollama"
  ) {
    const baseUrl = await resolveProviderBaseUrl(providerType, workspaceId);
    return { modelId, apiKey, isBYOK, baseUrl };
  }

  return { modelId, apiKey, isBYOK };
}

export type OpenAICompatibleConfig = {
  id: `${string}/${string}`;
  apiKey?: string;
  url?: string;
  headers?: Record<string, string>;
};

export type ModelConfig = string | OpenAICompatibleConfig | object;

export interface ResolvedModelConfig {
  modelConfig: ModelConfig;
  isBYOK: boolean;
}

export async function resolveModelConfig(
  modelString: string,
  workspaceId: string | null | undefined,
): Promise<ResolvedModelConfig> {
  const { toRouterString, getProvider, getDirectModelInstance, shouldBypassMastraAgent } = await import(
    "~/lib/model.server"
  );

  const providerType = getProvider(modelString);
  const { apiKey, isBYOK } = await resolveApiKeyForWorkspace(
    workspaceId,
    providerType,
  );
  const baseUrl = await resolveProviderBaseUrl(providerType, workspaceId);
  const routerString = toRouterString(modelString) as `${string}/${string}`;

  if (shouldBypassMastraAgent(modelString, baseUrl)) {
    return {
      modelConfig: getDirectModelInstance(modelString, {
        ...(apiKey && { apiKey }),
        ...(baseUrl && { baseUrl }),
      }) as object,
      isBYOK,
    };
  }

  if (isBYOK && apiKey) {
    return { modelConfig: { id: routerString, apiKey }, isBYOK: true };
  }

  return { modelConfig: routerString, isBYOK: false };
}
