import { prisma } from "~/db.server";
import {
  encryptSecret,
  decryptSecret,
  EncryptedSecretSchema,
} from "~/lib/encryption.server";
import { logger } from "./logger.service";

// ---------------------------------------------------------------------------
// In-memory cache for decrypted BYOK keys (avoids DB + decrypt per request)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  key: string;
  expiry: number;
}

const keyCache = new Map<string, CacheEntry>();

function cacheKey(workspaceId: string, providerType: string): string {
  return `${workspaceId}:${providerType}`;
}

function getCached(workspaceId: string, providerType: string): string | null {
  const entry = keyCache.get(cacheKey(workspaceId, providerType));
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    keyCache.delete(cacheKey(workspaceId, providerType));
    return null;
  }
  return entry.key;
}

function setCache(workspaceId: string, providerType: string, key: string) {
  keyCache.set(cacheKey(workspaceId, providerType), {
    key,
    expiry: Date.now() + CACHE_TTL_MS,
  });
}

function invalidateCache(workspaceId: string, providerType: string) {
  keyCache.delete(cacheKey(workspaceId, providerType));
}

// ---------------------------------------------------------------------------
// BYOK key management
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
  "vercel",
  "groq",
  "mistral",
  "xai",
  "ollama",
] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(type: string): type is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(type);
}

/**
 * Store (or update) a workspace-scoped API key for a provider.
 * The key is encrypted at rest using AES-256-GCM.
 */
export async function setWorkspaceApiKey(
  workspaceId: string,
  providerType: SupportedProvider,
  apiKey: string,
  baseUrl?: string,
) {
  const encryptedApiKey = encryptSecret(apiKey);

  const config: any = { encryptedApiKey };
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }

  // Find the global provider to copy its name
  const globalProvider = await prisma.lLMProvider.findFirst({
    where: { type: providerType, workspaceId: null },
  });

  const name = globalProvider?.name ?? providerType;

  // Upsert workspace-scoped provider
  const existing = await prisma.lLMProvider.findFirst({
    where: { workspaceId, type: providerType },
  });

  if (existing) {
    await prisma.lLMProvider.update({
      where: { id: existing.id },
      data: { config, isActive: true },
    });
  } else {
    await prisma.lLMProvider.create({
      data: {
        workspaceId,
        name,
        type: providerType,
        config,
        isActive: true,
      },
    });
  }

  invalidateCache(workspaceId, providerType);
  logger.info(
    `BYOK: set key for workspace=${workspaceId} provider=${providerType}`,
  );
}

/**
 * Remove the workspace-scoped provider (and its BYOK key).
 */
export async function deleteWorkspaceApiKey(
  workspaceId: string,
  providerType: SupportedProvider,
) {
  const existing = await prisma.lLMProvider.findFirst({
    where: { workspaceId, type: providerType },
  });

  if (existing) {
    await prisma.lLMProvider.delete({ where: { id: existing.id } });
  }

  invalidateCache(workspaceId, providerType);
  logger.info(
    `BYOK: deleted key for workspace=${workspaceId} provider=${providerType}`,
  );
}

/**
 * Returns the BYOK key status per provider for a workspace.
 * Never returns the actual key — only whether one exists.
 */
export async function getWorkspaceKeyStatus(workspaceId: string) {
  const workspaceProviders = await prisma.lLMProvider.findMany({
    where: { workspaceId, isActive: true },
    select: { type: true, createdAt: true, updatedAt: true },
  });

  return workspaceProviders.map((p) => ({
    providerType: p.type,
    hasKey: true,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

/**
 * Decrypt and return the workspace API key for a provider.
 * Returns null if no BYOK key exists.
 * Internal use only — never expose the raw key via API.
 */
export async function resolveWorkspaceApiKey(
  workspaceId: string,
  providerType: string,
): Promise<string | null> {
  // Check cache first
  const cached = getCached(workspaceId, providerType);
  if (cached) return cached;

  const provider = await prisma.lLMProvider.findFirst({
    where: { workspaceId, type: providerType, isActive: true },
  });

  if (!provider) return null;

  const config = provider.config as Record<string, unknown> | null;
  if (!config?.encryptedApiKey) return null;

  const parsed = EncryptedSecretSchema.safeParse(config.encryptedApiKey);
  if (!parsed.success) {
    logger.error(
      `BYOK: failed to parse encrypted key for workspace=${workspaceId} provider=${providerType}`,
    );
    return null;
  }

  const decrypted = decryptSecret(parsed.data);
  setCache(workspaceId, providerType, decrypted);
  return decrypted;
}

/**
 * Check if a workspace has any (or a specific) BYOK key.
 */
export async function isWorkspaceBYOK(
  workspaceId: string,
  providerType?: string,
): Promise<boolean> {
  const where: Record<string, unknown> = { workspaceId, isActive: true };
  if (providerType) {
    where.type = providerType;
  }

  const count = await prisma.lLMProvider.count({ where });
  return count > 0;
}
