/**
 * ElevenLabs voice picker + BYOK input.
 *
 * Voice selection persists to user.metadata via the parent route's
 * action ("updateElevenLabsVoice" intent). API key persists to
 * workspace metadata (encrypted) via /api/v1/voice-tts/byok.
 *
 * Both writes go through Remix `useFetcher` so the rest of the app
 * gets the standard "pending → idle → revalidate" lifecycle.
 */

import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";

import { Button, Input } from "~/components/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export const DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

const ELEVENLABS_VOICES: { id: string; name: string; description: string }[] = [
  {
    id: "JBFqnCBsd6RMkjVDRZzb",
    name: "George",
    description: "calm British male",
  },
  {
    id: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    description: "warm American female",
  },
  {
    id: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    description: "soft American female",
  },
  {
    id: "IKne3meq5aSn9XLyUdCD",
    name: "Charlie",
    description: "casual Australian male",
  },
  {
    id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    description: "deep American male",
  },
  {
    id: "nPczCjzI2devNBz1zQrb",
    name: "Brian",
    description: "deep narrator male",
  },
];

interface ElevenLabsPickerProps {
  voiceId: string;
  workspaceHasOwnKey: boolean;
}

export function ElevenLabsPicker({
  voiceId,
  workspaceHasOwnKey,
}: ElevenLabsPickerProps) {
  const voiceFetcher = useFetcher();
  const keyFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();

  const [keyInput, setKeyInput] = useState("");

  const currentVoiceId =
    voiceFetcher.formData?.get("elevenLabsVoiceId")?.toString() ??
    voiceId ??
    DEFAULT_ELEVENLABS_VOICE_ID;

  const keyBusy = keyFetcher.state !== "idle";

  // Refresh loader after BYOK mutation lands so workspaceHasOwnKey
  // flips to its new value and the UI updates.
  useEffect(() => {
    if (keyFetcher.state === "idle" && keyFetcher.data?.ok) {
      setKeyInput("");
      revalidator.revalidate();
    }
  }, [keyFetcher.state, keyFetcher.data, revalidator]);

  function handleVoiceChange(nextVoiceId: string) {
    voiceFetcher.submit(
      { intent: "updateElevenLabsVoice", elevenLabsVoiceId: nextVoiceId },
      { method: "POST" },
    );
  }

  async function preview() {
    try {
      const res = await fetch("/api/v1/voice-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: "Hi, this is butler. How does this voice sound?",
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.play();
    } catch {
      // ignore — preview is best-effort
    }
  }

  function saveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    keyFetcher.submit(JSON.stringify({ apiKey: trimmed }), {
      method: "POST",
      action: "/api/v1/voice-tts/byok",
      encType: "application/json",
    });
  }

  function removeKey() {
    keyFetcher.submit(null, {
      method: "DELETE",
      action: "/api/v1/voice-tts/byok",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={currentVoiceId} onValueChange={handleVoiceChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Pick a voice" />
          </SelectTrigger>
          <SelectContent>
            {ELEVENLABS_VOICES.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}{" "}
                <span className="text-muted-foreground text-xs">
                  — {v.description}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="secondary" onClick={preview}>
          Preview
        </Button>
      </div>

      <div className="border-border flex flex-col gap-2 border-t pt-3">
        <div className="font-medium">Workspace API key</div>
        <p className="text-muted-foreground text-xs">
          Stored encrypted, scoped to this workspace. A workspace key overrides
          any server-wide <code>ELEVENLABS_API_KEY</code>.
        </p>

        {workspaceHasOwnKey ? (
          <div className="flex items-center gap-2">
            <span className="text-success text-sm">Key configured ✓</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeKey}
              disabled={keyBusy}
            >
              Remove
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="paste your ElevenLabs api key"
              disabled={keyBusy}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={saveKey}
              disabled={!keyInput.trim() || keyBusy}
            >
              Save
            </Button>
          </div>
        )}

        {keyFetcher.data?.error && (
          <p className="text-destructive text-xs">{keyFetcher.data.error}</p>
        )}
      </div>
    </div>
  );
}
