import React from "react";
import {
  BellOff,
  Inbox,
  Loader2,
  MoonStar,
  Play,
  Square,
} from "lucide-react";
import { useFetcher } from "@remix-run/react";
import { Theme, useTheme } from "remix-themes";
import { cn } from "~/lib/utils";
import type {
  ButlerActivityState,
  ButlerActivitySummary,
} from "~/services/butler-activity.server";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Button } from "~/components/ui";
import { FlickeringGrid } from "~/components/ui/flickering-grid";

const ACTIVE_STATES: ButlerActivityState[] = ["watching", "thinking", "acting"];
// How often we poll /api/v1/inbox for the badge count. The Mac inbox
// pill has its own Rust-side poller; this is the in-app sidebar copy
// and it's a plain webview fetch.
const INBOX_POLL_INTERVAL_MS = 20_000;

interface InboxResponse {
  count: number;
  items: Array<{ id: string; message: string }>;
}

interface SummariseResponse {
  summary: string;
  count: number;
}

type CatchupStatus =
  | "ready"
  | "summarising"
  | "speaking"
  | "stopped"
  | "error";

function formatPauseCopy(data: ButlerActivitySummary | undefined) {
  if (!data || data.pausedIndefinitely || !data.snoozedUntil)
    return "Automatic page watching is paused";
  const date = new Date(data.snoozedUntil);
  if (Number.isNaN(date.getTime())) return "Automatic page watching is paused";
  return `Paused until ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function ButlerStatusPill() {
  const fetcher = useFetcher<ButlerActivitySummary>();
  const inboxFetcher = useFetcher<InboxResponse>();
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const inboxIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const [open, setOpen] = React.useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Catchup popover state
  const [catchupStatus, setCatchupStatus] =
    React.useState<CatchupStatus>("ready");
  const [catchupText, setCatchupText] = React.useState<string>("");
  const [catchupError, setCatchupError] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 150);
  };

  React.useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/api/v1/butler-status");
    }
  }, [fetcher]);

  React.useEffect(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      if (fetcher.state === "idle") {
        fetcher.load("/api/v1/butler-status");
      }
    }, 5000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetcher]);

  // Inbox polling — same pattern as butler. We only use the count;
  // the summarise call refetches and deletes on its own.
  React.useEffect(() => {
    if (inboxFetcher.state === "idle" && !inboxFetcher.data) {
      inboxFetcher.load("/api/v1/inbox?limit=1");
    }
  }, [inboxFetcher]);

  React.useEffect(() => {
    if (inboxIntervalRef.current) return;
    inboxIntervalRef.current = setInterval(() => {
      if (inboxFetcher.state === "idle") {
        inboxFetcher.load("/api/v1/inbox?limit=1");
      }
    }, INBOX_POLL_INTERVAL_MS);
    return () => {
      if (inboxIntervalRef.current) {
        clearInterval(inboxIntervalRef.current);
        inboxIntervalRef.current = null;
      }
    };
  }, [inboxFetcher]);

  // Tear down any playing audio if the component unmounts.
  React.useEffect(() => () => stopPlayback(), []);

  function stopPlayback() {
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        // ignore
      }
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  async function playSummaryAudio(text: string) {
    try {
      const res = await fetch("/api/v1/voice/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Force cloud since the in-app sidebar has no local synth
          // to fall back to. If ElevenLabs isn't configured the
          // server returns 412 and we silently skip playback.
          "X-Voice-Context": "browser",
        },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      if (res.status === 412 || res.status === 204) {
        // No cloud TTS configured — text-only popover is still useful.
        setCatchupStatus("stopped");
        return;
      }
      if (!res.ok) {
        setCatchupStatus("stopped");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", () => {
        stopPlayback();
        setCatchupStatus("stopped");
      });
      audio.addEventListener("error", () => {
        stopPlayback();
        setCatchupStatus("stopped");
      });
      await audio.play();
    } catch {
      stopPlayback();
      setCatchupStatus("stopped");
    }
  }

  async function handleSummarise() {
    if (catchupStatus === "summarising" || catchupStatus === "speaking") return;
    setCatchupStatus("summarising");
    setCatchupError(null);
    setCatchupText("");
    try {
      const res = await fetch("/api/v1/inbox/summarise", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "voice" }),
      });
      if (!res.ok) throw new Error(`summarise ${res.status}`);
      const data = (await res.json()) as SummariseResponse;
      const summary = (data.summary ?? "").trim();
      if (!summary) {
        setCatchupText("Inbox cleared — nothing to summarise.");
        setCatchupStatus("stopped");
        // Refresh badge.
        inboxFetcher.load("/api/v1/inbox?limit=1");
        return;
      }
      setCatchupText(summary);
      setCatchupStatus("speaking");
      // The server deleted the rows; refresh badge so the pill flips
      // back to butler mode after.
      inboxFetcher.load("/api/v1/inbox?limit=1");
      await playSummaryAudio(summary);
    } catch (err) {
      setCatchupError(err instanceof Error ? err.message : String(err));
      setCatchupStatus("error");
    }
  }

  function handleStop() {
    stopPlayback();
    setCatchupStatus("stopped");
  }

  // When the popover closes and we're past the playback flow, reset
  // so the next open shows the fresh "Summarise" CTA.
  React.useEffect(() => {
    if (open) return;
    if (catchupStatus === "speaking") {
      stopPlayback();
    }
    if (catchupStatus === "stopped" || catchupStatus === "error") {
      setCatchupStatus("ready");
      setCatchupText("");
      setCatchupError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const data = fetcher.data;
  const state = data?.state ?? "idle";
  const isButlerActive = ACTIVE_STATES.includes(state);
  const stateLabel = data?.stateLabel ?? "Idle";
  const sentence = data?.sentence ?? "Watching for page edits";

  const inboxCount = inboxFetcher.data?.count ?? 0;
  // Inbox mode wins only when butler is genuinely idle — any acting,
  // thinking, or watching takes priority on the pill.
  const mode: "butler-active" | "inbox" | "butler-idle" = isButlerActive
    ? "butler-active"
    : inboxCount > 0
      ? "inbox"
      : "butler-idle";

  const isInbox = mode === "inbox";
  const isPillActive = isButlerActive || isInbox;

  const pillLabel = (() => {
    if (mode === "inbox") {
      return inboxCount === 1 ? "1 message" : `${inboxCount} messages`;
    }
    return stateLabel;
  })();

  const submitControl = (intent: "resume" | "snooze", duration?: string) => {
    const formData = new FormData();
    formData.set("intent", intent);
    if (duration) formData.set("duration", duration);
    fetcher.submit(formData, {
      action: "/api/v1/butler-status",
      method: "POST",
    });
    setOpen(false);
  };

  return (
    <Popover open={open}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors",
            isPillActive
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-background-3 text-muted-foreground",
          )}
        >
          <div className="relative h-3.5 w-5 overflow-hidden rounded-sm">
            <FlickeringGrid
              width={20}
              height={14}
              squareSize={2}
              gridGap={2}
              flickerChance={isPillActive ? 0.8 : 0.3}
              maxOpacity={isPillActive ? 0.9 : 0.25}
              color={
                isPillActive
                  ? "rgb(var(--primary))"
                  : isDark
                    ? "oklch(85.8% 0 0)"
                    : "oklch(30.87% 0 0)"
              }
            />
          </div>
          {pillLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[280px] p-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {isInbox ? (
          <InboxCatchupContent
            count={inboxCount}
            status={catchupStatus}
            text={catchupText}
            error={catchupError}
            onSummarise={handleSummarise}
            onStop={handleStop}
          />
        ) : (
          <ButlerStatusContent
            state={state}
            sentence={sentence}
            stateLabel={stateLabel}
            data={data}
            submitControl={submitControl}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ButlerStatusContent({
  state,
  sentence,
  stateLabel,
  data,
  submitControl,
}: {
  state: ButlerActivityState;
  sentence: string;
  stateLabel: string;
  data: ButlerActivitySummary | undefined;
  submitControl: (intent: "resume" | "snooze", duration?: string) => void;
}) {
  return (
    <>
      <div className="p-3">
        {state === "idle" ? (
          <>
            <div className="font-medium">Butler is chillin' 🛋️</div>
            <div className="text-muted-foreground mt-0.5 text-sm">
              No pages to watch. Living the dream.
            </div>
          </>
        ) : (
          <>
            <div className="font-medium">{stateLabel}</div>
            <div className="text-muted-foreground mt-0.5 text-sm">
              {sentence}
            </div>
          </>
        )}
      </div>
      <div className="border-t px-1 py-1">
        {data?.state === "paused" ? (
          <>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => submitControl("resume")}
            >
              <Play size={14} /> Resume automatic watching
            </Button>
            <p className="text-muted-foreground px-2 py-1 text-xs">
              {formatPauseCopy(data)}
            </p>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => submitControl("snooze", "30m")}
            >
              <MoonStar size={14} /> Snooze for 30 minutes
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => submitControl("snooze", "1h")}
            >
              <MoonStar size={14} /> Snooze for 1 hour
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => submitControl("snooze", "tomorrow")}
            >
              <MoonStar size={14} /> Snooze until tomorrow
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => submitControl("snooze", "indefinite")}
            >
              <BellOff size={14} /> Pause until resumed
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function InboxCatchupContent({
  count,
  status,
  text,
  error,
  onSummarise,
  onStop,
}: {
  count: number;
  status: CatchupStatus;
  text: string;
  error: string | null;
  onSummarise: () => void;
  onStop: () => void;
}) {
  return (
    <>
      <div className="p-3">
        <div className="flex items-center gap-2 font-medium">
          <Inbox size={14} className="text-primary shrink-0" />
          {count === 1 ? "1 message waiting" : `${count} messages waiting`}
        </div>
        <div className="text-muted-foreground mt-0.5 text-sm">
          {status === "speaking"
            ? "Butler is reading the catchup aloud."
            : status === "summarising"
              ? "Preparing your catchup…"
              : status === "error"
                ? (error ?? "Something went wrong.")
                : "Ask for a quick verbal catchup."}
        </div>
        {(status === "speaking" || status === "stopped") && text && (
          <div className="border-border bg-background-3 text-foreground mt-2 max-h-[160px] overflow-y-auto rounded-md border px-2.5 py-1.5 text-xs leading-snug">
            {text}
          </div>
        )}
      </div>
      <div className="border-t px-1 py-1">
        {status === "speaking" ? (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={onStop}
          >
            <Square size={12} className="fill-current" /> Stop
          </Button>
        ) : status === "summarising" ? (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            disabled
          >
            <Loader2 size={14} className="animate-spin" /> Summarising…
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={onSummarise}
          >
            <Play size={14} /> Summarise
          </Button>
        )}
      </div>
    </>
  );
}
