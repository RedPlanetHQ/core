import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";
import seedData from "~/config/llm-models.json";
import { JSONValue } from "ai";

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

interface CachedChatModelInfo {
  modelId: string;
  providerId: string;
  providerType: string;
  complexity: string;
  supportsBatch: boolean;
}

interface CachedEmbeddingInfo {
  modelId: string;
  providerId: string;
  providerType: string;
  dimensions: number;
}

interface CachedProviderConfig {
  baseUrl?: string;
  apiMode?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache for sync access
// ---------------------------------------------------------------------------

let cachedDefaultChatModel: CachedChatModelInfo | null = null;
let cachedDefaultEmbeddingModel: CachedEmbeddingInfo | null = null;
let cachedLowModel: string | null = null;
let cachedBatchModel: string | null = null;
let cachedProviderConfigs: Map<string, CachedProviderConfig> = new Map();
let cacheLoaded = false;

async function loadCache(): Promise<void> {
  // Load default chat model (isDefault + has "chat" capability)
  const chatModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, capabilities: { has: "chat" } },
    include: { provider: true },
  });

  if (chatModel) {
    cachedDefaultChatModel = {
      modelId: chatModel.modelId,
      providerId: chatModel.providerId,
      providerType: chatModel.provider.type,
      complexity: chatModel.complexity,
      supportsBatch: chatModel.supportsBatch,
    };

    // Cache the low-complexity chat model from the same provider
    const lowModel = await prisma.lLMModel.findFirst({
      where: {
        providerId: chatModel.providerId,
        complexity: "low",
        capabilities: { has: "chat" },
        isEnabled: true,
        isDeprecated: false,
      },
    });
    cachedLowModel = lowModel?.modelId ?? chatModel.modelId;

    // Cache the batch model from the same provider
    if (chatModel.supportsBatch) {
      cachedBatchModel = chatModel.modelId;
    } else {
      const batchModel = await prisma.lLMModel.findFirst({
        where: {
          providerId: chatModel.providerId,
          supportsBatch: true,
          capabilities: { has: "chat" },
          isEnabled: true,
          isDeprecated: false,
        },
      });
      cachedBatchModel = batchModel?.modelId ?? chatModel.modelId;
    }
  }

  // Load default embedding model (isDefault + has "embedding" capability)
  const embeddingModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, capabilities: { has: "embedding" } },
    include: { provider: true },
  });

  if (embeddingModel) {
    cachedDefaultEmbeddingModel = {
      modelId: embeddingModel.modelId,
      providerId: embeddingModel.providerId,
      providerType: embeddingModel.provider.type,
      dimensions: embeddingModel.dimensions ?? 1024,
    };
  }

  // Load provider configs
  const providers = await prisma.lLMProvider.findMany({
    where: { workspaceId: null },
  });
  cachedProviderConfigs.clear();
  for (const p of providers) {
    const config = (p.config as Record<string, unknown>) || {};
    cachedProviderConfigs.set(p.type, {
      baseUrl: config.baseUrl as string | undefined,
      apiMode: config.apiMode as string | undefined,
    });
  }

  cacheLoaded = true;
}

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

/**
 * Build provider config from env vars.
 * Only called at seed time — env vars are the bootstrap input.
 */
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
    default:
      return {};
  }
}

/**
 * Idempotent seeder — ensures all providers and models from llm-models.json
 * exist in the DB. Safe to call on every startup / workspace creation.
 *
 * - Preseeds all providers and models regardless of env vars.
 * - Seeds provider config (baseUrl, apiMode) from env vars.
 * - If MODEL/EMBEDDING_MODEL not found in seed, creates them dynamically.
 * - Marks defaults using isDefault + capabilities.
 * - Populates the in-memory cache for sync access.
 */
export async function ensureDefaultProviders(): Promise<void> {
  const catalog = seedData as Record<string, SeedProvider>;

  for (const [providerType, providerData] of Object.entries(catalog)) {
    // Upsert provider
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
    } else {
      if (Object.keys(config).length > 0) {
        await prisma.lLMProvider.update({
          where: { id: provider.id },
          data: { config },
        });
      }
    }

    // Upsert models
    const existingModels = await prisma.lLMModel.findMany({
      where: { providerId: provider.id },
    });
    const existingModelIds = new Set(existingModels.map((m) => m.modelId));
    const seedModelIds = new Set(providerData.models.map((m) => m.modelId));

    // Upsert models from seed (create new, update capabilities/label on existing)
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
        // Update label, capabilities, and dimensions from seed (keeps DB in sync with config)
        const existing = existingModels.find((m) => m.modelId === seedModel.modelId)!;
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

    // Mark removed models as deprecated
    for (const existing of existingModels) {
      if (!seedModelIds.has(existing.modelId) && !existing.isDeprecated) {
        await prisma.lLMModel.update({
          where: { id: existing.id },
          data: { isDeprecated: true },
        });
        logger.info(`[LLM] Deprecated model: ${existing.modelId}`);
      }
    }
  }

  // --- Dynamic model creation for env-specified models not in seed ---

  // Chat model: if MODEL env not found in any provider, create under CHAT_PROVIDER
  if (env.MODEL) {
    const chatModelExists = await prisma.lLMModel.findFirst({
      where: { modelId: env.MODEL },
    });
    if (!chatModelExists) {
      const targetProvider = await prisma.lLMProvider.findFirst({
        where: { type: env.CHAT_PROVIDER, workspaceId: null },
      });
      if (targetProvider) {
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
      }
    }
  }

  // Embedding model: if EMBEDDING_MODEL env not found, create under EMBEDDINGS_PROVIDER
  const embeddingProvider = env.EMBEDDINGS_PROVIDER ?? "openai";
  const embeddingModelId = env.EMBEDDING_MODEL || "text-embedding-3-small";
  const embeddingModelExists = await prisma.lLMModel.findFirst({
    where: { modelId: embeddingModelId, capabilities: { has: "embedding" } },
  });
  if (!embeddingModelExists) {
    const targetProvider = await prisma.lLMProvider.findFirst({
      where: { type: embeddingProvider, workspaceId: null },
    });
    if (targetProvider) {
      const dims = parseInt(env.EMBEDDING_MODEL_SIZE || "1024", 10);
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
    }
  }

  // --- Mark defaults ---

  // Clear existing chat defaults
  await prisma.lLMModel.updateMany({
    where: { isDefault: true, capabilities: { has: "chat" } },
    data: { isDefault: false },
  });

  // Set chat default from MODEL env
  if (env.MODEL) {
    const chatDefault = await prisma.lLMModel.findFirst({
      where: { modelId: env.MODEL, capabilities: { has: "chat" } },
    });
    if (chatDefault) {
      await prisma.lLMModel.update({
        where: { id: chatDefault.id },
        data: { isDefault: true },
      });
      logger.info(`[LLM] Default chat model set to: ${env.MODEL}`);
    }
  }

  // Clear existing embedding defaults
  await prisma.lLMModel.updateMany({
    where: { isDefault: true, capabilities: { has: "embedding" } },
    data: { isDefault: false },
  });

  // Set embedding default from EMBEDDING_MODEL env
  const embeddingDefault = await prisma.lLMModel.findFirst({
    where: {
      modelId: embeddingModelId,
      capabilities: { has: "embedding" },
    },
  });
  if (embeddingDefault) {
    await prisma.lLMModel.update({
      where: { id: embeddingDefault.id },
      data: { isDefault: true },
    });
    logger.info(
      `[LLM] Default embedding model set to: ${embeddingModelId}`,
    );
  }

  // Populate cache
  await loadCache();
}

// ---------------------------------------------------------------------------
// Sync accessors — read from in-memory cache, fall back to env vars
// ---------------------------------------------------------------------------

export function getModelForTaskSync(
  complexity: "high" | "medium" | "low" = "medium",
): string {
  if (!cacheLoaded || !cachedDefaultChatModel) return env.MODEL;
  return complexity === "low"
    ? cachedLowModel ?? cachedDefaultChatModel.modelId
    : cachedDefaultChatModel.modelId;
}

export function getModelForBatchSync(): string {
  if (!cacheLoaded || !cachedDefaultChatModel) return env.MODEL;
  return cachedBatchModel ?? cachedDefaultChatModel.modelId;
}

export function getDefaultChatProviderType(): string {
  if (!cacheLoaded || !cachedDefaultChatModel) return env.CHAT_PROVIDER;
  return cachedDefaultChatModel.providerType;
}

export function getDefaultChatModelId(): string {
  if (!cacheLoaded || !cachedDefaultChatModel) return env.MODEL;
  return cachedDefaultChatModel.modelId;
}

export function getDefaultEmbeddingInfo(): CachedEmbeddingInfo | null {
  if (!cacheLoaded) return null;
  return cachedDefaultEmbeddingModel;
}

export function getProviderConfig(
  providerType: string,
): CachedProviderConfig {
  if (!cacheLoaded) {
    // Fallback to env vars before cache is loaded
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
    return {};
  }
  return cachedProviderConfigs.get(providerType) ?? {};
}

export function getEmbeddingDimensions(): number {
  if (!cacheLoaded || !cachedDefaultEmbeddingModel) {
    return parseInt(env.EMBEDDING_MODEL_SIZE || "1024", 10);
  }
  return cachedDefaultEmbeddingModel.dimensions;
}

// ---------------------------------------------------------------------------
// Async query functions
// ---------------------------------------------------------------------------

const ENV_KEY_MAP: Record<string, string | undefined> = {
  openai: env.OPENAI_API_KEY,
  anthropic: env.ANTHROPIC_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
  ollama: env.OLLAMA_URL,
};

/**
 * List active global providers (that have env keys configured).
 */
export async function getProviders() {
  const providers = await prisma.lLMProvider.findMany({
    where: { workspaceId: null, isActive: true },
    include: { models: true },
  });

  return providers.filter((p) => !!ENV_KEY_MAP[p.type]);
}

/**
 * Returns enabled, non-deprecated models from active providers.
 */
export async function getAvailableModels() {
  const providers = await getProviders();
  const providerIds = providers.map((p) => p.id);

  return prisma.lLMModel.findMany({
    where: {
      providerId: { in: providerIds },
      isEnabled: true,
      isDeprecated: false,
    },
    include: { provider: true },
  });
}

/**
 * Returns the default chat model.
 */
export async function getDefaultModel() {
  return prisma.lLMModel.findFirst({
    where: { isDefault: true, capabilities: { has: "chat" } },
    include: { provider: true },
  });
}

/**
 * Async version — get model for a given task complexity.
 */
export async function getModelForTask(
  complexity: "high" | "low" = "high",
): Promise<string> {
  const defaultModel = await getDefaultModel();
  if (!defaultModel) return env.MODEL;

  if (complexity === "high") return defaultModel.modelId;

  const lowModel = await prisma.lLMModel.findFirst({
    where: {
      providerId: defaultModel.providerId,
      complexity: "low",
      capabilities: { has: "chat" },
      isEnabled: true,
      isDeprecated: false,
    },
  });

  return lowModel?.modelId ?? defaultModel.modelId;
}

/**
 * Async version — get a batch-compatible model from the default provider.
 */
export async function getModelForBatch(): Promise<string> {
  const defaultModel = await getDefaultModel();
  if (!defaultModel) return env.MODEL;

  if (defaultModel.supportsBatch) return defaultModel.modelId;

  const batchModel = await prisma.lLMModel.findFirst({
    where: {
      providerId: defaultModel.providerId,
      supportsBatch: true,
      capabilities: { has: "chat" },
      isEnabled: true,
      isDeprecated: false,
    },
  });

  return batchModel?.modelId ?? defaultModel.modelId;
}

/**
 * Resolve API key for a provider type from env vars.
 */
export function resolveApiKey(providerType: string): string | undefined {
  return ENV_KEY_MAP[providerType];
}
