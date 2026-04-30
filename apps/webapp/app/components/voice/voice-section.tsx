/**
 * Voice settings section.
 *
 * Routes between provider-specific pickers based on the user's chosen
 * `ttsProvider`. Designed to grow: adding a new provider is a matter of
 * (1) declaring it in providers.ts, (2) writing a `<{Id}Picker />`
 * component, and (3) registering it in PICKER_BY_PROVIDER below.
 *
 * Tauri-only: returns null in the regular webapp because Apple TTS
 * runs through the local Swift helper.
 */

import { useFetcher } from "@remix-run/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { isTauri } from "~/lib/tauri.client";

import { ApplePicker } from "./apple-picker";
import { ElevenLabsPicker } from "./elevenlabs-picker";
import { TTS_PROVIDERS, type TTSProviderId } from "./providers";

interface VoiceSectionProps {
  ttsProvider: TTSProviderId;
  elevenLabsVoiceId: string;
  /** True when ELEVENLABS_API_KEY is set on the server OR the workspace BYOK is set. */
  hasElevenLabs: boolean;
  /** True when the workspace has its own (BYOK) ElevenLabs key. */
  workspaceHasOwnKey: boolean;
}

const PICKER_BY_PROVIDER: Record<TTSProviderId, React.ComponentType<any>> = {
  apple: ApplePicker,
  elevenlabs: ElevenLabsPicker,
};

export function VoiceSection({
  ttsProvider,
  elevenLabsVoiceId,
  hasElevenLabs,
  workspaceHasOwnKey,
}: VoiceSectionProps) {
  const providerFetcher = useFetcher();

  // Voice features are local-helper-backed (Apple) and/or downstream of
  // a Tauri webview lifecycle (mic, AX context). The page is hidden in
  // the plain webapp.
  if (!isTauri()) return null;

  const persistedProvider =
    (providerFetcher.formData?.get("ttsProvider")?.toString() as
      | TTSProviderId
      | undefined) ?? ttsProvider;

  // Always offer every registered provider. A provider that isn't yet
  // configured (e.g. ElevenLabs with no key) renders its own setup UI
  // — that's how the user gets *to* configuration in the first place.
  const currentProvider: TTSProviderId = persistedProvider;

  function handleProviderChange(next: TTSProviderId) {
    providerFetcher.submit(
      { intent: "updateTtsProvider", ttsProvider: next },
      { method: "POST" },
    );
  }

  const Picker = PICKER_BY_PROVIDER[currentProvider];
  const pickerProps =
    currentProvider === "elevenlabs"
      ? { voiceId: elevenLabsVoiceId, workspaceHasOwnKey }
      : {};

  return (
    <div className="mb-8">
      <h2 className="text-md flex items-center gap-2">Voice</h2>
      <p className="text-muted-foreground mb-3 text-sm">
        How butler sounds when speaking your replies aloud.
      </p>

      <div className="flex max-w-md flex-col gap-3">
        <Select
          value={currentProvider}
          onValueChange={(v) => handleProviderChange(v as TTSProviderId)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTS_PROVIDERS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}{" "}
                <span className="text-muted-foreground">— {p.tagline}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Picker {...pickerProps} />
      </div>
    </div>
  );
}
