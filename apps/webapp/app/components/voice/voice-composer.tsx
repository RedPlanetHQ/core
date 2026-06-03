/**
 * Voice composer — drop-in replacement for the chat textarea while
 * voice mode is on.
 *
 * Uses `useVoiceVad` so the user never has to push a button: as soon
 * as we hear speech we start recording, and as soon as we hear a
 * sustained pause we transcribe and send. The transcript is handed to
 * `onTranscript`, which the host wires up to the same "send a chat
 * message" path the typed editor uses.
 *
 * Visualization:
 *   - Centered FlickeringGrid. Color flips to primary while the user
 *     is speaking (input) or while the assistant is replying (output).
 *   - Status label sits under the grid.
 *   - A close X in the top-right calls `onClose` to switch back to text.
 */

import { Loader2, X } from "lucide-react";
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Theme, useTheme } from "remix-themes";

import { Button } from "~/components/ui";
import { FlickeringGrid } from "~/components/ui/flickering-grid";
import { ToastAction } from "~/components/ui/toast";
import { useToast } from "~/hooks/use-toast";
import {
  useVoiceVad,
  type VoiceVadStatus,
  type VoiceVadTurnResult,
} from "~/hooks/use-voice-vad";
import { cn } from "~/lib/utils";

import type { STTProviderId } from "./stt-providers";

const SETTINGS_PATH = "/settings/workspace/agent";

interface VoiceComposerProps {
  /** When true, mic stays open and VAD runs. Toggle off to release. */
  enabled: boolean;
  /** Final transcript text — host sends it as a user message. */
  onTranscript: (text: string) => void;
  /** Switch back to the typed editor. */
  onClose: () => void;
  /**
   * True while the assistant is generating a reply. Drives the
   * "Butler is replying…" state and tints the grid primary so the
   * user gets visual feedback even before audio playback lands.
   */
  isAssistantReplying?: boolean;
  /**
   * Fires the moment VAD detects audio crossing the speech threshold —
   * before we know whether it's real speech or noise. Host should use
   * this to duck any active TTS playback for instant barge-in feedback.
   */
  onSpeechOnset?: () => void;
  /**
   * Fires once per finished turn. Host uses this to decide whether to
   * restore ducked TTS (events-only / empty) or flush it (real speech
   * — a new assistant turn is about to replace the current one).
   */
  onTurnResult?: (result: VoiceVadTurnResult) => void;
  /** Override the runtime default STT provider. */
  provider?: STTProviderId;
  className?: string;
}

export function VoiceComposer({
  enabled,
  onTranscript,
  onClose,
  isAssistantReplying = false,
  onSpeechOnset,
  onTurnResult,
  provider,
  className,
}: VoiceComposerProps) {
  const { toast } = useToast();
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;
  const [needsConfig, setNeedsConfig] = useState(false);

  const vad = useVoiceVad({
    enabled,
    provider,
    onTranscript,
    onSpeechOnset,
    onTurnResult,
    onError: (err) => {
      if (err.code === "needs-config") {
        setNeedsConfig(true);
        toast({
          title: `Configure ${labelFor(err.provider)}`,
          description:
            "Add an API key in Voice settings to use voice mode in the browser.",
          action: (
            <ToastAction altText="Open voice settings" asChild>
              <Link to={SETTINGS_PATH}>Open settings</Link>
            </ToastAction>
          ),
        });
        return;
      }
      if (err.code === "no-permission") {
        toast({
          title: "Microphone blocked",
          description:
            "Allow microphone access in your browser to use voice mode.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Voice error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Reset the needs-config banner whenever the user toggles voice off/on
  // — gives them a chance to try again after configuring their key.
  useEffect(() => {
    if (enabled) setNeedsConfig(false);
  }, [enabled]);

  const userSpeaking = vad.status === "recording";
  const isActive = userSpeaking || isAssistantReplying;

  const gridColor = isActive
    ? "rgb(var(--primary))"
    : isDark
      ? "oklch(85.8% 0 0)"
      : "oklch(30.87% 0 0)";

  return (
    <div
      className={cn(
        "relative flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-xl p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        {vad.status === "transcribing" && (
          <Loader2 size={14} className="text-muted-foreground animate-spin" />
        )}
        <span
          className={cn(
            "font-medium",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          {labelForStatus(vad.status, {
            assistantReplying: isAssistantReplying,
            needsConfig,
          })}
        </span>
      </div>
      <div
        className={cn(
          "relative h-20 w-40 overflow-hidden border-none transition-shadow",
        )}
      >
        <FlickeringGrid
          className="absolute inset-0"
          squareSize={6}
          gridGap={3}
          flickerChance={
            userSpeaking
              ? Math.min(1, 0.5 + vad.level * 12)
              : isAssistantReplying
                ? 0.85
                : 0.25
          }
          maxOpacity={isActive ? 0.9 : 0.35}
          color={gridColor}
        />
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        aria-label="Close voice mode"
        title="Close voice mode"
      >
        End
      </Button>
    </div>
  );
}

function labelForStatus(
  status: VoiceVadStatus,
  ctx: { assistantReplying: boolean; needsConfig: boolean },
): string {
  if (ctx.needsConfig) return "Configure your STT provider";
  if (status === "error") return "Voice error — close and retry";
  if (status === "starting") return "Opening mic…";
  if (status === "recording") return "Listening…";
  if (status === "transcribing") return "Transcribing…";
  if (ctx.assistantReplying) return "Butler is replying…";
  if (status === "waiting") return "Speak when ready";
  return "Voice mode off";
}

function labelFor(provider: STTProviderId): string {
  if (provider === "elevenlabs") return "ElevenLabs";
  if (provider === "apple") return "Apple";
  return provider;
}
