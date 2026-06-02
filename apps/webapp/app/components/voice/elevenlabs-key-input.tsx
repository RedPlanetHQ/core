/**
 * Shared workspace ElevenLabs BYOK input.
 *
 * Mounted once by the Voice settings container so the user never sees
 * the same key field twice — even though both STT (Scribe) and TTS
 * (text-to-speech) use the same workspace key.
 *
 * POSTs to /api/v1/voice/byok which already handles set/clear and
 * persists encrypted on `Workspace.metadata.elevenLabsApiKey`.
 */

import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";

import { Button, Input } from "~/components/ui";

interface ElevenLabsKeyInputProps {
  workspaceHasOwnKey: boolean;
}

export function ElevenLabsKeyInput({
  workspaceHasOwnKey,
}: ElevenLabsKeyInputProps) {
  const keyFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [keyInput, setKeyInput] = useState("");

  const keyBusy = keyFetcher.state !== "idle";

  useEffect(() => {
    if (keyFetcher.state === "idle" && keyFetcher.data?.ok) {
      setKeyInput("");
      revalidator.revalidate();
    }
  }, [keyFetcher.state, keyFetcher.data, revalidator]);

  function saveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    keyFetcher.submit(JSON.stringify({ apiKey: trimmed }), {
      method: "POST",
      action: "/api/v1/voice/byok",
      encType: "application/json",
    });
  }

  function removeKey() {
    keyFetcher.submit(null, {
      method: "DELETE",
      action: "/api/v1/voice/byok",
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="font-medium">ElevenLabs API key</div>
      <p className="text-muted-foreground text-xs">
        Stored encrypted on this workspace. One key powers both ElevenLabs
        STT (Scribe) and TTS — overrides any server-wide
        <code className="mx-1">ELEVENLABS_API_KEY</code>.
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
  );
}
