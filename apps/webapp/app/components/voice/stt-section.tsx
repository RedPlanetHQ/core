/**
 * STT settings section.
 *
 * Provider picker only — the ElevenLabs BYOK input is owned by the
 * parent `VoiceSection` so it isn't rendered twice when both STT and
 * TTS are on ElevenLabs.
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

import { STT_LANGUAGES, STT_LANGUAGE_AUTO } from "./stt-languages";
import { STT_PROVIDERS, type STTProviderId } from "./stt-providers";

interface STTSectionProps {
  sttProvider: STTProviderId;
  sttLanguage: string;
}

export function STTSection({ sttProvider, sttLanguage }: STTSectionProps) {
  const providerFetcher = useFetcher();
  const languageFetcher = useFetcher();
  const tauri = isTauri();

  const persistedProvider =
    (providerFetcher.formData?.get("sttProvider")?.toString() as
      | STTProviderId
      | undefined) ?? sttProvider;
  // Empty string from older saved metadata means auto-detect — surface
  // it as the sentinel so Radix Select is happy.
  const rawLanguage =
    languageFetcher.formData?.get("sttLanguage")?.toString() ?? sttLanguage;
  const persistedLanguage = rawLanguage === "" ? STT_LANGUAGE_AUTO : rawLanguage;

  // Filter providers by runtime — Apple needs Tauri.
  const availableProviders = STT_PROVIDERS.filter(
    (p) => !p.requiresTauri || tauri,
  );

  // If the persisted provider isn't available in this runtime (e.g. user
  // set "apple" in the desktop app and is now on the web), fall back to
  // the first available one for display. We don't write that back —
  // they'll just see the right default until they actively change it.
  const currentProvider: STTProviderId =
    availableProviders.find((p) => p.id === persistedProvider)?.id ??
    availableProviders[0]?.id ??
    "elevenlabs";

  function handleProviderChange(next: STTProviderId) {
    providerFetcher.submit(
      { intent: "updateSttProvider", sttProvider: next },
      { method: "POST" },
    );
  }

  function handleLanguageChange(next: string) {
    languageFetcher.submit(
      { intent: "updateSttLanguage", sttLanguage: next },
      { method: "POST" },
    );
  }

  return (
    <div>
      <h3 className="text-sm font-medium">Voice input</h3>
      <p className="text-muted-foreground mb-3 text-sm">
        How butler hears you. Used by the in-page mic and the desktop
        push-to-talk widget.
      </p>

      <div className="flex max-w-md flex-col gap-3">
        <Select
          value={currentProvider}
          onValueChange={(v) => handleProviderChange(v as STTProviderId)}
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

        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs">
            Language
          </label>
          <Select
            value={persistedLanguage}
            onValueChange={handleLanguageChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STT_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.label}
                  {l.code !== STT_LANGUAGE_AUTO && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({l.code})
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
