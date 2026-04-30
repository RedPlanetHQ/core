/**
 * Voice TTS BYOK helpers.
 *
 * The ElevenLabs API key can come from two places:
 *   1. ELEVENLABS_API_KEY env var (server-wide, set by operator)
 *   2. Per-workspace key, stored encrypted on `Workspace.metadata.elevenLabsApiKey`
 *
 * The per-workspace key wins when both are set, so workspaces can use
 * their own billing without operator involvement.
 */

import { prisma } from "~/db.server";
import {
  encryptSecret,
  decryptSecret,
  EncryptedSecretSchema,
} from "~/lib/encryption.server";
import { env } from "~/env.server";

const META_KEY = "elevenLabsApiKey";

interface WorkspaceMeta {
  [k: string]: unknown;
  [META_KEY]?: unknown;
}

async function loadMeta(workspaceId: string): Promise<WorkspaceMeta> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { metadata: true },
  });
  return ((ws?.metadata as WorkspaceMeta | null) ?? {}) as WorkspaceMeta;
}

async function saveMeta(workspaceId: string, meta: WorkspaceMeta) {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { metadata: meta as any },
  });
}

/** Decrypt the workspace-scoped key if one is stored. Returns null otherwise. */
export async function getWorkspaceElevenLabsKey(
  workspaceId: string,
): Promise<string | null> {
  const meta = await loadMeta(workspaceId);
  const raw = meta[META_KEY];
  if (!raw) return null;
  const parsed = EncryptedSecretSchema.safeParse(raw);
  if (!parsed.success) return null;
  try {
    return decryptSecret(parsed.data);
  } catch {
    return null;
  }
}

export async function setWorkspaceElevenLabsKey(
  workspaceId: string,
  apiKey: string,
): Promise<void> {
  const meta = await loadMeta(workspaceId);
  meta[META_KEY] = encryptSecret(apiKey);
  await saveMeta(workspaceId, meta);
}

export async function clearWorkspaceElevenLabsKey(
  workspaceId: string,
): Promise<void> {
  const meta = await loadMeta(workspaceId);
  if (META_KEY in meta) {
    delete meta[META_KEY];
    await saveMeta(workspaceId, meta);
  }
}

export async function hasWorkspaceElevenLabsKey(
  workspaceId: string,
): Promise<boolean> {
  const meta = await loadMeta(workspaceId);
  return Boolean(meta[META_KEY]);
}

/**
 * Resolve the ElevenLabs API key to use for this workspace.
 * Workspace-scoped key wins, server env var is the fallback.
 */
export async function resolveElevenLabsKey(
  workspaceId: string,
): Promise<string | null> {
  const workspaceKey = await getWorkspaceElevenLabsKey(workspaceId);
  if (workspaceKey) return workspaceKey;
  return env.ELEVENLABS_API_KEY ?? null;
}

export async function isElevenLabsAvailable(
  workspaceId: string,
): Promise<boolean> {
  if (env.ELEVENLABS_API_KEY) return true;
  return hasWorkspaceElevenLabsKey(workspaceId);
}
