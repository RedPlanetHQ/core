/**
 * Mic button + inline recording UI for the chat composer.
 *
 * One toggle: click → start recording, click again → stop and insert
 * the transcript. While active, a small pill floats above the composer
 * (mirrors the look of the Tauri dictation overlay) showing the live
 * partial. If the chosen STT provider isn't configured, we surface a
 * toast with a link to the voice settings page.
 *
 * Decoupled from the textarea: the button just emits `onTranscript`
 * with the final string; the caller decides whether to insert into an
 * editor or auto-send.
 */

import { Loader2, Mic, Square } from "lucide-react";
import { Link } from "@remix-run/react";
import { Theme, useTheme } from "remix-themes";

import { Button } from "~/components/ui";
import { FlickeringGrid } from "~/components/ui/flickering-grid";
import { cn } from "~/lib/utils";
import { ToastAction } from "~/components/ui/toast";
import { useToast } from "~/hooks/use-toast";
import {
  useVoiceChat,
  type UseVoiceChatOptions,
} from "~/hooks/use-voice-chat";

import type { STTProviderId } from "./stt-providers";

interface VoiceMicButtonProps {
  /** Override the runtime default provider (apple in Tauri / elevenlabs in browser). */
  provider?: STTProviderId;
  /** Called with the transcript when recording finishes. */
  onTranscript: (text: string) => void;
  /** Disable the mic (e.g. while the agent is streaming). */
  disabled?: boolean;
  /** Hide the inline pill (e.g. when a host already renders its own UI). */
  hidePill?: boolean;
  className?: string;
}

const SETTINGS_PATH = "/settings/workspace/agent";

export function VoiceMicButton({
  provider,
  onTranscript,
  disabled = false,
  hidePill = false,
  className,
}: VoiceMicButtonProps) {
  const { toast } = useToast();
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;

  const voiceOpts: UseVoiceChatOptions = {
    provider,
    onResult: (text) => {
      if (text) onTranscript(text);
    },
    onError: (err) => {
      if (err.code === "needs-config") {
        toast({
          title: `Configure ${labelFor(err.provider)}`,
          description:
            "Add an API key in Voice settings to use voice chat in the browser.",
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
          description: "Allow microphone access in your browser to use voice.",
          variant: "destructive",
        });
        return;
      }
      if (err.code === "no-audio") {
        // Tap-too-short — don't bother the user.
        return;
      }
      toast({
        title: "Voice error",
        description: err.message,
        variant: "destructive",
      });
    },
  };

  const voice = useVoiceChat(voiceOpts);

  const isActive =
    voice.status === "starting" ||
    voice.status === "recording" ||
    voice.status === "transcribing";

  function handleClick() {
    if (disabled) return;
    if (voice.status === "recording") {
      void voice.stop();
      return;
    }
    if (voice.status === "starting" || voice.status === "transcribing") {
      return; // mid-transition, ignore
    }
    void voice.start();
  }

  const icon =
    voice.status === "recording" ? (
      <Square className="h-4 w-4 fill-current" />
    ) : voice.status === "starting" || voice.status === "transcribing" ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <Mic className="h-4 w-4" />
    );

  const label =
    voice.status === "recording"
      ? "Listening…"
      : voice.status === "starting"
        ? "Starting…"
        : voice.status === "transcribing"
          ? "Transcribing…"
          : null;

  const gridColor =
    voice.status === "recording"
      ? "rgb(var(--primary))"
      : isDark
        ? "oklch(85.8% 0 0)"
        : "oklch(30.87% 0 0)";

  return (
    <>
      <Button
        type="button"
        variant={isActive ? "default" : "ghost"}
        size="sm"
        onClick={handleClick}
        disabled={disabled}
        aria-pressed={voice.status === "recording"}
        aria-label={
          voice.status === "recording"
            ? "Stop voice chat"
            : "Start voice chat"
        }
        className={cn("h-8 w-8 p-0", className)}
        title={voice.status === "recording" ? "Stop voice" : "Voice chat"}
      >
        {icon}
      </Button>

      {!hidePill && isActive && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 flex-col items-center gap-1">
          <div className="border-border bg-background-3 text-muted-foreground pointer-events-auto flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium shadow-md">
            <div className="relative h-3.5 w-5 overflow-hidden rounded-sm">
              <FlickeringGrid
                width={20}
                height={14}
                squareSize={2}
                gridGap={2}
                flickerChance={voice.status === "recording" ? 0.8 : 0.3}
                maxOpacity={voice.status === "recording" ? 0.9 : 0.25}
                color={gridColor}
              />
            </div>
            {label}
          </div>
          {voice.partial.trim().length > 0 && (
            <div
              className="border-border bg-background-3 text-foreground max-w-[420px] rounded-lg border px-2.5 py-1.5 text-xs leading-snug shadow-md"
              aria-live="polite"
            >
              {voice.partial}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function labelFor(provider: STTProviderId): string {
  if (provider === "elevenlabs") return "ElevenLabs";
  if (provider === "apple") return "Apple";
  return provider;
}
