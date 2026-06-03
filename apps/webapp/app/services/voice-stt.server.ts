/**
 * Voice STT provider registry + dispatch.
 *
 * Mirrors the shape of voice-tts.server.ts. Each cloud STT provider is
 * declared here as a small object: `{ id, transcribe, resolveCredential,
 * isAvailable }`. The HTTP route at /api/v1/voice/stt picks the user's
 * chosen provider (from `user.metadata.sttProvider`) and dispatches.
 *
 * Local (Tauri-only) providers like Apple Swift recognizer are NOT
 * registered here — the client never POSTs for those because the
 * transcript is produced locally.
 *
 * Adding a new cloud provider:
 *   1. Implement `{ id, transcribe, isAvailable }` and register below.
 *   2. Add a matching entry in `components/voice/stt-providers.ts` so
 *      the UI knows it exists.
 *   3. If it needs a new credential, store it on `Workspace.metadata`
 *      encrypted (same pattern as elevenLabsApiKey).
 */

import { logger } from "~/services/logger.service";
import { resolveElevenLabsKey } from "~/services/voice-tts.server";

export type STTProviderId = "elevenlabs";

export interface STTResult {
  text: string;
  /** ISO 639-1 language code if the provider returned one. */
  language?: string | null;
  /**
   * True if the provider returned non-speech audio-event tags (e.g.
   * `(background music)`, `(wind)`) that we stripped from `text`.
   * Lets callers distinguish "user said nothing, just noise" from
   * "user said nothing at all" so they can suppress false barge-ins.
   */
  containedEvents?: boolean;
}

/**
 * ElevenLabs Scribe inlines non-speech audio events as `(music)`,
 * `(wind)`, `(background music)`, `(applause)`, etc. when
 * `tag_audio_events` is on (the default). They aren't speech, so we
 * strip them before returning — otherwise the LLM sees the user
 * "saying" `(background music)`.
 */
function stripAudioEventTags(raw: string): {
  text: string;
  containedEvents: boolean;
} {
  if (!raw) return { text: "", containedEvents: false };
  const stripped = raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return { text: stripped, containedEvents: stripped !== raw.trim() };
}

export interface STTProvider {
  id: STTProviderId;
  /**
   * True when the provider has the credentials it needs for this
   * workspace (server env var OR workspace BYOK). The route uses this
   * to 412 with a "needs-config" hint before charging the user.
   */
  isAvailable(workspaceId: string): Promise<boolean>;
  /** Transcribe the uploaded audio. Throws on upstream failure. */
  transcribe(input: {
    workspaceId: string;
    audio: Blob;
    /** Optional MIME-aware filename ("recording.webm"). Some providers
     *  require an extension to sniff format. */
    filename?: string;
    /** ISO 639-1 hint. Empty / null means auto-detect. */
    language?: string | null;
  }): Promise<STTResult>;
}

const ELEVENLABS_STT_MODEL = "scribe_v1";

const elevenLabsProvider: STTProvider = {
  id: "elevenlabs",
  async isAvailable(workspaceId) {
    const key = await resolveElevenLabsKey(workspaceId);
    return Boolean(key);
  },
  async transcribe({ workspaceId, audio, filename, language }) {
    const apiKey = await resolveElevenLabsKey(workspaceId);
    if (!apiKey) {
      throw new STTError("needs-config", "ElevenLabs key not configured");
    }

    const form = new FormData();
    form.append("model_id", ELEVENLABS_STT_MODEL);
    form.append("file", audio, filename || "recording.webm");
    if (language) {
      form.append("language_code", language);
    }

    const upstream = await fetch(
      "https://api.elevenlabs.io/v1/speech-to-text",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      },
    );

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "(no body)");
      logger.error("[voice-stt] ElevenLabs upstream error", {
        status: upstream.status,
        body: body.slice(0, 500),
      });
      throw new STTError("upstream", `ElevenLabs ${upstream.status}`);
    }

    const data = (await upstream.json().catch(() => null)) as {
      text?: string;
      language_code?: string;
    } | null;

    const raw = data?.text ?? "";
    const { text, containedEvents } = stripAudioEventTags(raw);
    return {
      text,
      language: data?.language_code ?? null,
      containedEvents,
    };
  },
};

const REGISTRY: Record<STTProviderId, STTProvider> = {
  elevenlabs: elevenLabsProvider,
};

export function getSTTProvider(id: string): STTProvider | null {
  if (id in REGISTRY) return REGISTRY[id as STTProviderId];
  return null;
}

export class STTError extends Error {
  constructor(
    public code: "needs-config" | "upstream" | "invalid-input",
    message: string,
  ) {
    super(message);
    this.name = "STTError";
  }
}
