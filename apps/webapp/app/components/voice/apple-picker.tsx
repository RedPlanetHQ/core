/**
 * Apple TTS picker — lists installed AVSpeechSynthesisVoice voices via
 * the Tauri Swift helper, lets the user pick + preview one. Persists
 * the choice locally in `~/.corebrain/config.json` (handled by the
 * Rust side, not Remix metadata).
 *
 * Tauri-only: caller (`<VoiceSection>`) gates rendering on `isTauri()`.
 */

import { useEffect, useState } from "react";

import { Button } from "~/components/ui";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { tauriInvoke, tauriListen } from "~/lib/tauri.client";

interface AppleVoice {
  identifier: string;
  name: string;
  language: string;
  quality: "default" | "enhanced" | "premium";
}

const QUALITY_ORDER: Array<"premium" | "enhanced" | "default"> = [
  "premium",
  "enhanced",
  "default",
];

export function ApplePicker() {
  const [voices, setVoices] = useState<AppleVoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      const persisted = await tauriInvoke<string | null>("voice_get_voice");
      if (persisted) setSelected(persisted);

      unsub = await tauriListen<{ voices: AppleVoice[] }>(
        "voice:voices",
        (event) => {
          setVoices(event.payload?.voices ?? []);
          setLoading(false);
        },
      );

      await tauriInvoke("voice_list_voices");
    })();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  async function handleChange(identifier: string) {
    setSelected(identifier);
    await tauriInvoke("voice_set_voice", { identifier });
  }

  async function preview() {
    await tauriInvoke("voice_cancel_speech");
    await tauriInvoke("voice_speak", {
      text: "Hi, this is butler. How does this voice sound?",
    });
  }

  const grouped: Record<"premium" | "enhanced" | "default", AppleVoice[]> = {
    premium: [],
    enhanced: [],
    default: [],
  };
  for (const v of voices) grouped[v.quality]?.push(v);

  return (
    <div className="flex items-center gap-2">
      {loading ? (
        <div className="text-muted-foreground text-sm">Loading voices…</div>
      ) : voices.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No voices available.
        </div>
      ) : (
        <Select value={selected ?? ""} onValueChange={(v) => handleChange(v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Pick a voice" />
          </SelectTrigger>
          <SelectContent>
            {QUALITY_ORDER.filter((q) => grouped[q].length > 0).map((q) => (
              <SelectGroup key={q}>
                <SelectLabel className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  {q}
                </SelectLabel>
                {grouped[q].map((v) => (
                  <SelectItem key={v.identifier} value={v.identifier}>
                    {v.name}{" "}
                    <span className="text-muted-foreground text-xs">
                      ({v.language})
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      )}

      <Button
        type="button"
        variant="secondary"
        disabled={!selected}
        onClick={preview}
      >
        Preview
      </Button>
    </div>
  );
}
