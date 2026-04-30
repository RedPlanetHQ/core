/**
 * TTS provider registry.
 *
 * Each provider declares its display metadata and capabilities. The
 * Voice settings UI iterates this list to render the provider toggle;
 * each id has a matching `<{Id}Picker />` component that renders its
 * specific voice picker / config UI.
 *
 * Adding a new provider:
 *   1. Add an entry here (id + display metadata).
 *   2. Drop a new picker file in this folder
 *      (e.g. `openai-picker.tsx` exporting `OpenAIPicker`).
 *   3. Register it in `voice-section.tsx`'s `PICKER_BY_PROVIDER` map.
 *   4. If it needs server-side proxying, add a route under
 *      /api/v1/voice-tts/{provider} (or extend the existing one to
 *      branch on the user's chosen provider).
 */

export type TTSProviderId = "apple" | "elevenlabs";

export interface TTSProviderSpec {
  id: TTSProviderId;
  label: string;
  /** Short tagline shown in the toggle dropdown. */
  tagline: string;
  /** Runs entirely in the local Tauri app — no server proxy or key needed. */
  isLocal: boolean;
  /** Workspace can store its own API key (BYOK) for this provider. */
  byokSupported: boolean;
}

export const TTS_PROVIDERS: readonly TTSProviderSpec[] = [
  {
    id: "apple",
    label: "Apple",
    tagline: "local, free, offline",
    isLocal: true,
    byokSupported: false,
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    tagline: "cloud, paid, natural",
    isLocal: false,
    byokSupported: true,
  },
] as const;

export function getProviderSpec(id: TTSProviderId): TTSProviderSpec {
  const spec = TTS_PROVIDERS.find((p) => p.id === id);
  if (!spec) throw new Error(`unknown TTS provider: ${id}`);
  return spec;
}
