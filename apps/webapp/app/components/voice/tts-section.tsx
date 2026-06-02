/**
 * TTS sub-section of the Voice settings panel.
 *
 * Routes between provider-specific pickers based on the user's chosen
 * `ttsProvider`. Designed to grow: adding a new provider is a matter of
 * (1) declaring it in providers.ts, (2) writing a `<{Id}Picker />`
 * component, and (3) registering it in PICKER_BY_PROVIDER below.
 *
 * Renders in both browser and Tauri. Runtime-incompatible providers
 * (e.g. Apple, which needs the local Swift helper) are filtered out of
 * the picker — and if the user's saved choice is one of those, we
 * display the first compatible alternative until they switch.
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

interface TTSSectionProps {
  ttsProvider: TTSProviderId;
  elevenLabsVoiceId: string;
}

const PICKER_BY_PROVIDER: Record<TTSProviderId, React.ComponentType<any>> = {
  apple: ApplePicker,
  elevenlabs: ElevenLabsPicker,
};

export function TTSSection({
  ttsProvider,
  elevenLabsVoiceId,
}: TTSSectionProps) {
  const providerFetcher = useFetcher();
  const tauri = isTauri();

  const persistedProvider =
    (providerFetcher.formData?.get("ttsProvider")?.toString() as
      | TTSProviderId
      | undefined) ?? ttsProvider;

  const availableProviders = TTS_PROVIDERS.filter(
    (p) => !p.requiresTauri || tauri,
  );

  // If the saved choice isn't runnable in this runtime (e.g. "apple" while
  // in the browser), display the first compatible provider for now. We
  // don't write that back — the user's preference is preserved for when
  // they open the desktop app again.
  const currentProvider: TTSProviderId =
    availableProviders.find((p) => p.id === persistedProvider)?.id ??
    availableProviders[0]?.id ??
    "elevenlabs";

  function handleProviderChange(next: TTSProviderId) {
    providerFetcher.submit(
      { intent: "updateTtsProvider", ttsProvider: next },
      { method: "POST" },
    );
  }

  const Picker = PICKER_BY_PROVIDER[currentProvider];
  const pickerProps =
    currentProvider === "elevenlabs" ? { voiceId: elevenLabsVoiceId } : {};

  return (
    <div>
      <h3 className="text-sm font-medium">Voice output</h3>
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
            {availableProviders.map((p) => (
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
