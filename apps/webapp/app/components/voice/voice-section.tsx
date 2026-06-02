/**
 * Voice settings — single section that hosts both Voice input (STT)
 * and Voice output (TTS) sub-blocks.
 *
 * Both sub-blocks render in browser and Tauri. Each one filters its
 * own provider list to whatever can actually run in the current
 * runtime (Apple needs the Swift helper, ElevenLabs needs a BYOK key).
 *
 * Adding a new provider doesn't touch this file — drop it into the
 * STT or TTS registry (providers.ts / stt-providers.ts) and register
 * its picker in the relevant sub-section.
 */

import { ElevenLabsKeyInput } from "./elevenlabs-key-input";
import { STTSection } from "./stt-section";
import { TTSSection } from "./tts-section";
import type { STTProviderId } from "./stt-providers";
import type { TTSProviderId } from "./providers";

interface VoiceSectionProps {
  sttProvider: STTProviderId;
  sttLanguage: string;
  ttsProvider: TTSProviderId;
  elevenLabsVoiceId: string;
  /** True when the workspace has its own (BYOK) ElevenLabs key. */
  workspaceHasOwnKey: boolean;
}

export function VoiceSection({
  sttProvider,
  sttLanguage,
  ttsProvider,
  elevenLabsVoiceId,
  workspaceHasOwnKey,
}: VoiceSectionProps) {
  // The single workspace ElevenLabs key powers both STT (Scribe) and
  // TTS — render the input once at the bottom whenever either provider
  // is ElevenLabs. Hidden entirely when neither uses it.
  const needsElevenLabsKey =
    sttProvider === "elevenlabs" || ttsProvider === "elevenlabs";

  return (
    <div className="mb-8">
      <h2 className="text-md flex items-center gap-2">Voice</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Configure how butler listens and how it speaks back.
      </p>

      <div className="flex max-w-md flex-col gap-6">
        <STTSection sttProvider={sttProvider} sttLanguage={sttLanguage} />

        <TTSSection
          ttsProvider={ttsProvider}
          elevenLabsVoiceId={elevenLabsVoiceId}
        />

        {needsElevenLabsKey && (
          <div className="border-border border-t pt-4">
            <ElevenLabsKeyInput workspaceHasOwnKey={workspaceHasOwnKey} />
          </div>
        )}
      </div>
    </div>
  );
}
