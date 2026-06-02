/**
 * Speech-to-text provider registry.
 *
 * Pendant to the TTS registry in `providers.ts`. The voice mode picker
 * iterates this list to render the provider toggle; the in-page voice
 * chat hook (`useVoiceChat`) reads it to decide whether to record via
 * the Tauri Swift helper (`apple`) or via browser MediaRecorder + the
 * /api/v1/voice/stt cloud route (everything else).
 *
 * Adding a new STT provider:
 *   1. Add an entry here with its display metadata.
 *   2. If it needs server-side credentials, register a transcribe
 *      implementation in `voice-stt.server.ts`.
 *   3. If it shares its credential with another provider (like
 *      ElevenLabs key shared between STT + TTS), reuse the existing
 *      BYOK route. Otherwise add a new one under
 *      /api/v1/voice/stt/{provider}/byok.
 */

export type STTProviderId = "apple" | "elevenlabs";

export interface STTProviderSpec {
  id: STTProviderId;
  label: string;
  tagline: string;
  /** Runs entirely in the local Tauri app — never POSTs to /api/v1/voice/stt. */
  isLocal: boolean;
  /** Workspace can store its own API key (BYOK) for this provider. */
  byokSupported: boolean;
  /** Only available inside the Tauri desktop app (relies on a native helper). */
  requiresTauri: boolean;
}

export const STT_PROVIDERS: readonly STTProviderSpec[] = [
  {
    id: "apple",
    label: "Apple",
    tagline: "local, free, mac only",
    isLocal: true,
    byokSupported: false,
    requiresTauri: true,
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    tagline: "cloud, byok, scribe v1",
    isLocal: false,
    byokSupported: true,
    requiresTauri: false,
  },
] as const;

export function getSTTProviderSpec(id: STTProviderId): STTProviderSpec {
  const spec = STT_PROVIDERS.find((p) => p.id === id);
  if (!spec) throw new Error(`unknown STT provider: ${id}`);
  return spec;
}

/**
 * Pick a sensible default given the runtime. Inside Tauri prefer the
 * free local Apple recognizer; in the browser the only option is
 * ElevenLabs (assuming the workspace has a key configured).
 */
export function defaultSTTProvider(opts: { isTauri: boolean }): STTProviderId {
  return opts.isTauri ? "apple" : "elevenlabs";
}
