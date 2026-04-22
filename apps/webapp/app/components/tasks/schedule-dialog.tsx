import React from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  endOfDay,
  addDays,
  addHours,
  endOfWeek,
  addWeeks,
  formatISO,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from "date-fns";
import { Ban, Clock, LoaderCircle, RefreshCw } from "lucide-react";
import { useFetcher } from "@remix-run/react";

interface ScheduleDialogProps {
  onClose: () => void;
  taskId: string;
}

interface ScheduleSample {
  text: string;
  isRecurring: boolean;
  /** Pre-computed startTime for quick picks — skips LLM call */
  startTime?: string;
}

function atHour(base: Date, hour: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(base, hour), 0), 0), 0);
}

function buildSamples(): ScheduleSample[] {
  const now = new Date();
  const tomorrow = addDays(now, 1);
  return [
    { text: "Remove schedule", isRecurring: false },
    {
      text: "In 1 hour",
      isRecurring: false,
      startTime: addHours(now, 1).toISOString(),
    },
    {
      text: "In 3 hours",
      isRecurring: false,
      startTime: addHours(now, 3).toISOString(),
    },
    {
      text: "In 5 hours",
      isRecurring: false,
      startTime: addHours(now, 5).toISOString(),
    },
    {
      text: "End of day",
      isRecurring: false,
      startTime: endOfDay(now).toISOString(),
    },
    {
      text: "Tomorrow morning",
      isRecurring: false,
      startTime: atHour(tomorrow, 9).toISOString(),
    },
    {
      text: "Tomorrow evening",
      isRecurring: false,
      startTime: endOfDay(tomorrow).toISOString(),
    },
    {
      text: "End of this week",
      isRecurring: false,
      startTime: endOfWeek(now).toISOString(),
    },
    {
      text: "In one week",
      isRecurring: false,
      startTime: endOfDay(addWeeks(now, 1)).toISOString(),
    },
    { text: "Daily at 9 AM", isRecurring: true },
    { text: "Every weekday at 9 AM", isRecurring: true },
    { text: "Every Monday at 9 AM", isRecurring: true },
    { text: "Every first Monday of the month at 10 AM", isRecurring: true },
    { text: "Every weekend at 5 PM", isRecurring: true },
  ];
}

export function ScheduleDialog({ onClose, taskId }: ScheduleDialogProps) {
  const [value, setValue] = React.useState("");
  const fetcher = useFetcher();
  const samples = React.useMemo(() => buildSamples(), []);
  const currentTime = formatISO(new Date(), { representation: "complete" });
  const action = `/home/tasks/${taskId}`;
  const isSubmitting = fetcher.state !== "idle";
  const hasSubmittedRef = React.useRef(false);

  React.useEffect(() => {
    if (hasSubmittedRef.current && fetcher.state === "idle") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  const submit = (sample: ScheduleSample) => {
    if (isSubmitting) return;
    hasSubmittedRef.current = true;
    if (sample.text === "Remove schedule") {
      fetcher.submit({ intent: "remove-schedule" }, { method: "POST", action });
    } else if (sample.startTime) {
      fetcher.submit(
        { intent: "update-schedule", startTime: sample.startTime },
        { method: "POST", action },
      );
    } else {
      fetcher.submit(
        { intent: "update-schedule", text: sample.text, currentTime },
        { method: "POST", action },
      );
    }
  };

  const filtered = samples.filter((s) =>
    s.text.toLowerCase().includes(value.toLowerCase()),
  );

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
      title="Set schedule"
      description="Choose when this task should run"
    >
      {isSubmitting ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle size={14} className="animate-spin" />
          <span>Updating schedule…</span>
        </div>
      ) : (
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Every day at 9 | work tomorrow..."
            value={value}
            onValueChange={setValue}
          />
          <CommandList className="max-h-[300px] p-1">
            <CommandEmpty>
              Type a schedule — we'll take care of the rest
            </CommandEmpty>
            {filtered.map((sample, i) => (
              <CommandItem
                key={i}
                onSelect={() => submit(sample)}
                className="flex items-center gap-2 py-2"
              >
                {sample.text === "Remove schedule" ? (
                  <Ban size={14} className="text-destructive shrink-0" />
                ) : (
                  <Clock size={14} className="text-muted-foreground shrink-0" />
                )}
                <span className="flex-1 truncate">{sample.text}</span>
                {sample.isRecurring && (
                  <RefreshCw
                    size={12}
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </CommandItem>
            ))}
            {filtered.length === 0 && value && (
              <CommandItem
                onSelect={() => submit({ text: value, isRecurring: false })}
                className="flex items-center gap-2 py-2"
              >
                <Clock size={14} className="text-muted-foreground shrink-0" />
                <span>Schedule: {value}</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      )}
    </CommandDialog>
  );
}
