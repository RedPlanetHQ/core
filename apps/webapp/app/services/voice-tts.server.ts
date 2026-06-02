/**
 * Voice TTS BYOK helpers + modular provider registry.
 *
 * Two responsibilities:
 *
 *   1. BYOK key plumbing for ElevenLabs (load / save / clear / resolve).
 *      Per-workspace key wins over the operator-wide ELEVENLABS_API_KEY
 *      env var so workspaces can pay their own bills.
 *
 *   2. Pluggable cloud TTS provider registry. Each cloud provider
 *      implements `{ id, isAvailable, synthesize }`; the route at
 *      `/api/v1/voice/tts` dispatches through this registry. Local
 *      providers (Apple via Tauri Swift) are NOT registered here —
 *      the client never POSTs for those.
 *
 * Adding a new cloud TTS provider:
 *   1. Implement the `TTSProvider` interface and register below.
 *   2. Add a matching client entry in `components/voice/providers.ts`.
 *   3. If it needs new credentials, mirror the elevenLabsApiKey BYOK
 *      pattern with its own metadata field + helpers.
 */

import { prisma } from "~/db.server";
import {
  encryptSecret,
  decryptSecret,
  EncryptedSecretSchema,
} from "~/lib/encryption.server";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";

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

// ---------------------------------------------------------------------------
// Modular TTS provider registry
// ---------------------------------------------------------------------------

export type TTSProviderId = "elevenlabs";

export interface TTSStream {
  /** Audio bytes — pipe straight through to the HTTP response. */
  body: ReadableStream<Uint8Array> | null;
  /** Content-Type the client should consume. */
  contentType: string;
}

export interface TTSVoice {
  id: string;
  name: string;
  /** Optional short description shown alongside the name in the picker. */
  description?: string | null;
  /** "premade", "cloned", "professional", etc — provider's own label. */
  category?: string | null;
  /** Direct URL the client can `<audio>` for a sample (skip synthesis). */
  previewUrl?: string | null;
  /** Free-form labels — accent, gender, use case, etc. */
  labels?: Record<string, string> | null;
}

export interface TTSProvider {
  id: TTSProviderId;
  isAvailable(workspaceId: string): Promise<boolean>;
  synthesize(input: {
    workspaceId: string;
    text: string;
    /** User-scoped preferences (voiceId, etc) pulled from `user.metadata`. */
    userMetadata: Record<string, unknown>;
  }): Promise<TTSStream>;
  /**
   * Catalog of voices available to this workspace on this provider.
   * Optional: a provider without a remote catalog (e.g. a local synth)
   * can simply omit it and the picker will fall back to a static list.
   */
  listVoices?(workspaceId: string): Promise<TTSVoice[]>;
}

export class TTSError extends Error {
  constructor(
    public code: "needs-config" | "upstream" | "invalid-input",
    message: string,
  ) {
    super(message);
    this.name = "TTSError";
  }
}

const ELEVENLABS_DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // "George"
const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

const elevenLabsProvider: TTSProvider = {
  id: "elevenlabs",
  async isAvailable(workspaceId) {
    const key = await resolveElevenLabsKey(workspaceId);
    return Boolean(key);
  },
  async listVoices(workspaceId) {
    const apiKey = await resolveElevenLabsKey(workspaceId);
    if (!apiKey) {
      throw new TTSError("needs-config", "ElevenLabs key not configured");
    }

    // /v2/voices returns paginated results; `/v1/voices` returns the
    // flat catalog the account has access to (premade + cloned +
    // professional). Use v1 since we don't need pagination here.
    const upstream = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: { "xi-api-key": apiKey, Accept: "application/json" },
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "(no body)");
      logger.error("[voice-tts] ElevenLabs listVoices error", {
        status: upstream.status,
        body: body.slice(0, 500),
      });
      throw new TTSError("upstream", `ElevenLabs ${upstream.status}`);
    }

    const data = (await upstream.json().catch(() => null)) as {
      voices?: Array<{
        voice_id?: string;
        name?: string;
        description?: string | null;
        category?: string | null;
        preview_url?: string | null;
        labels?: Record<string, string> | null;
      }>;
    } | null;

    const raw = data?.voices ?? [];
    return raw
      .filter((v): v is { voice_id: string; name: string } & typeof v =>
        Boolean(v.voice_id && v.name),
      )
      .map<TTSVoice>((v) => ({
        id: v.voice_id,
        name: v.name,
        description: v.description ?? null,
        category: v.category ?? null,
        previewUrl: v.preview_url ?? null,
        labels: v.labels ?? null,
      }));
  },
  async synthesize({ workspaceId, text, userMetadata }) {
    const apiKey = await resolveElevenLabsKey(workspaceId);
    if (!apiKey) {
      throw new TTSError("needs-config", "ElevenLabs key not configured");
    }

    const voiceId =
      (userMetadata.elevenLabsVoiceId as string | undefined) ||
      ELEVENLABS_DEFAULT_VOICE_ID;

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "(no body)");
      logger.error("[voice-tts] ElevenLabs upstream error", {
        status: upstream.status,
        body: body.slice(0, 500),
      });
      throw new TTSError("upstream", `ElevenLabs ${upstream.status}`);
    }

    return { body: upstream.body, contentType: "audio/mpeg" };
  },
};

const TTS_REGISTRY: Record<TTSProviderId, TTSProvider> = {
  elevenlabs: elevenLabsProvider,
};

export function getTTSProvider(id: string): TTSProvider | null {
  if (id in TTS_REGISTRY) return TTS_REGISTRY[id as TTSProviderId];
  return null;
}

/** Local providers — synthesized client-side, never dispatched server-side.
 *  Listed here so the picker can prefer cloud providers when the caller
 *  can't run a local synth (browser without the Tauri Swift helper). */
const LOCAL_PROVIDER_IDS = new Set<string>(["apple"]);

export interface ResolveTTSOptions {
  workspaceId: string;
  userMetadata: Record<string, unknown>;
  /** Explicit `?provider=` override from the request URL. */
  explicitProviderId?: string | null;
  /** True when the caller has no local synth available, e.g. the
   *  in-page voice mode running in a plain browser. Drives the
   *  cloud-fallback path. */
  needsCloud?: boolean;
}

export type TTSResolution =
  /** Use this provider server-side. */
  | { kind: "cloud"; providerId: string; provider: TTSProvider }
  /** Local synth — server returns 204 and the client speaks it. */
  | { kind: "local"; providerId: string }
  /** No cloud provider has credentials and the caller can't go local. */
  | { kind: "unavailable" };

/**
 * Decide which TTS provider should serve this request.
 *
 *   1. Explicit `?provider=` always wins (so power users can pin one).
 *   2. If user's saved provider is cloud → use it.
 *   3. If user's saved provider is local AND caller has a local
 *      synth → return "local" (route 204s, client speaks).
 *   4. If user's saved provider is local AND caller needs cloud →
 *      walk the registry and pick the first cloud provider with
 *      credentials for this workspace.
 *   5. Nothing usable → "unavailable".
 */
export async function resolveTTSProvider(
  opts: ResolveTTSOptions,
): Promise<TTSResolution> {
  if (opts.explicitProviderId) {
    if (LOCAL_PROVIDER_IDS.has(opts.explicitProviderId)) {
      return { kind: "local", providerId: opts.explicitProviderId };
    }
    const explicit = getTTSProvider(opts.explicitProviderId);
    if (explicit) {
      return {
        kind: "cloud",
        providerId: opts.explicitProviderId,
        provider: explicit,
      };
    }
    // Explicit but unknown — fall through to the regular search.
  }

  const saved =
    (opts.userMetadata.ttsProvider as string | undefined) ?? "apple";

  if (!LOCAL_PROVIDER_IDS.has(saved)) {
    const provider = getTTSProvider(saved);
    if (provider) {
      return { kind: "cloud", providerId: saved, provider };
    }
  } else if (!opts.needsCloud) {
    return { kind: "local", providerId: saved };
  }

  // Local-only saved choice but the caller can't fall back to local —
  // pick the first cloud provider with credentials configured.
  for (const [id, provider] of Object.entries(TTS_REGISTRY)) {
    if (await provider.isAvailable(opts.workspaceId)) {
      return { kind: "cloud", providerId: id, provider };
    }
  }

  return { kind: "unavailable" };
}
