import React from "react";
import { BellOff, MoonStar, Play } from "lucide-react";
import { useFetcher } from "@remix-run/react";
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

function formatPauseCopy(data: ButlerActivitySummary | undefined) {
  if (!data || data.pausedIndefinitely || !data.snoozedUntil)
    return "Automatic page watching is paused";
  const date = new Date(data.snoozedUntil);
  if (Number.isNaN(date.getTime())) return "Automatic page watching is paused";
  return `Paused until ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function ButlerStatusPill() {
  const fetcher = useFetcher<ButlerActivitySummary>();
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [open, setOpen] = React.useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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

  const data = fetcher.data;
  const state = data?.state ?? "idle";
  const isActive = ACTIVE_STATES.includes(state);
  const stateLabel = data?.stateLabel ?? "Idle";
  const sentence = data?.sentence ?? "Watching for page edits";

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
            isActive
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-background-3 text-muted-foreground dark:bg-muted",
          )}
        >
          <div className="relative h-3.5 w-5 overflow-hidden rounded-sm">
            <FlickeringGrid
              width={20}
              height={14}
              squareSize={2}
              gridGap={2}
              flickerChance={isActive ? 0.8 : 0.3}
              maxOpacity={isActive ? 0.7 : 0.25}
              color={isActive ? "rgb(var(--primary))" : "currentColor"}
            />
          </div>
          {stateLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[260px] p-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
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
      </PopoverContent>
    </Popover>
  );
}
