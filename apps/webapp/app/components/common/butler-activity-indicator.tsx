import React from "react";
import {
  BellOff,
  LoaderCircle,
  MoonStar,
  Pause,
  Play,
  Radar,
} from "lucide-react";
import { useFetcher } from "@remix-run/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import type {
  ButlerActivityState,
  ButlerActivitySummary,
} from "~/services/butler-activity.server";

const STATE_STYLES: Record<
  ButlerActivityState,
  { dot: string; ring: string; icon: React.ReactNode }
> = {
  idle: {
    dot: "bg-muted-foreground/60",
    ring: "bg-muted-foreground/15",
    icon: <Radar className="h-3.5 w-3.5" />,
  },
  watching: {
    dot: "bg-primary",
    ring: "bg-primary/18",
    icon: <Radar className="h-3.5 w-3.5" />,
  },
  thinking: {
    dot: "bg-primary",
    ring: "bg-primary/18",
    icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
  },
  acting: {
    dot: "bg-primary",
    ring: "bg-primary/18",
    icon: <Play className="h-3.5 w-3.5" />,
  },
  paused: {
    dot: "bg-muted-foreground/70",
    ring: "bg-muted-foreground/15",
    icon: <Pause className="h-3.5 w-3.5" />,
  },
};

function formatPauseCopy(data: ButlerActivitySummary | undefined) {
  if (!data) return "Automatic page watching is paused";
  if (data.pausedIndefinitely) return "Automatic page watching is paused";
  if (!data.snoozedUntil) return "Automatic page watching is paused";

  const date = new Date(data.snoozedUntil);
  if (Number.isNaN(date.getTime())) return "Automatic page watching is paused";

  return `Paused until ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function ButlerActivityIndicator({
  workspaceName,
}: {
  workspaceName: string;
}) {
  const fetcher = useFetcher<ButlerActivitySummary>();
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

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
  const styles = STATE_STYLES[state];
  const sentence = data?.sentence ?? "Watching for page edits";

  const submitControl = (intent: "resume" | "snooze", duration?: string) => {
    const formData = new FormData();
    formData.set("intent", intent);
    if (duration) formData.set("duration", duration);

    fetcher.submit(formData, {
      action: "/api/v1/butler-status",
      method: "POST",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "bg-background-3 hover:bg-accent/50 flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors",
            "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
          )}
          aria-live="polite"
        >
          <div className="bg-background relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <span
              className={cn(
                "absolute h-6 w-6 rounded-full",
                styles.ring,
                state !== "paused" && state !== "idle" && "animate-pulse",
              )}
            />
            <span className="text-muted-foreground">{styles.icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {data?.stateLabel ?? "Idle"}
              </span>
            </div>
            <div className="truncate text-sm leading-5">{sentence}</div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px]">
        <DropdownMenuLabel>{workspaceName}</DropdownMenuLabel>
        <div className="px-2 py-1.5">
          <div className="text-xs font-medium">
            {data?.stateLabel ?? "Idle"}
          </div>
          <div className="text-muted-foreground text-xs">{sentence}</div>
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
