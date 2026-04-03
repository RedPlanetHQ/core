import React from "react";
import { BellOff, MoonStar, Play } from "lucide-react";
import { useFetcher } from "@remix-run/react";
import { cn } from "~/lib/utils";
import type {
  ButlerActivityState,
  ButlerActivitySummary,
} from "~/services/butler-activity.server";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors",
          isActive
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
            flickerChance={isActive ? 0.4 : 0.05}
            maxOpacity={isActive ? 0.7 : 0.25}
            color={isActive ? "rgb(var(--primary))" : "currentColor"}
          />
        </div>
        {stateLabel}
      </button>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[260px] p-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="p-3">
          <div className="font-medium">{stateLabel}</div>
          <div className="text-muted-foreground mt-0.5 text-sm">{sentence}</div>
        </div>
        <DropdownMenuSeparator />
        {data?.state === "paused" ? (
          <>
            <DropdownMenuItem
              className="flex gap-2 rounded"
              onClick={() => submitControl("resume")}
            >
              <Play size={14} />
              Resume automatic watching
            </DropdownMenuItem>
            <div className="text-muted-foreground px-2 py-1 text-xs">
              {formatPauseCopy(data)}
            </div>
          </>
        ) : (
          <>
            <DropdownMenuItem
              className="flex gap-2 rounded"
              onClick={() => submitControl("snooze", "30m")}
            >
              <MoonStar size={14} />
              Snooze for 30 minutes
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex gap-2 rounded"
              onClick={() => submitControl("snooze", "1h")}
            >
              <MoonStar size={14} />
              Snooze for 1 hour
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex gap-2 rounded"
              onClick={() => submitControl("snooze", "tomorrow")}
            >
              <MoonStar size={14} />
              Snooze until tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex gap-2 rounded"
              onClick={() => submitControl("snooze", "indefinite")}
            >
              <BellOff size={14} />
              Pause until resumed
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
