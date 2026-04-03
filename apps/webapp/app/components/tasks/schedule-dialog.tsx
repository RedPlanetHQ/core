import React from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { endOfDay, addDays, endOfWeek, addWeeks, formatISO } from "date-fns";
import { Ban, Clock, RefreshCw } from "lucide-react";
import { useFetcher } from "@remix-run/react";

interface ScheduleDialogProps {
  onClose: () => void;
}

interface ScheduleSample {
  text: string;
  isRecurring: boolean;
  /** Pre-computed startTime for quick picks — skips LLM call */
  startTime?: string;
}

function buildSamples(): ScheduleSample[] {
  const now = new Date();
  return [
    { text: "Remove schedule", isRecurring: false },
    {
      text: "Today",
      isRecurring: false,
      startTime: endOfDay(now).toISOString(),
    },
    {
      text: "Tomorrow",
      isRecurring: false,
      startTime: endOfDay(addDays(now, 1)).toISOString(),
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
    { text: "Tomorrow at 10 AM", isRecurring: false },
    { text: "Every Monday at 9 AM", isRecurring: true },
    { text: "Next Friday at 3 PM", isRecurring: false },
    { text: "Daily at 8 AM", isRecurring: true },
    { text: "Every weekday at 6 PM", isRecurring: true },
    { text: "Every first Monday of the month at 10 AM", isRecurring: true },
    { text: "Every weekend at 5 PM", isRecurring: true },
    { text: "Every year on July 4 at noon", isRecurring: true },
  ];
}

export function ScheduleDialog({ onClose }: ScheduleDialogProps) {
  const [value, setValue] = React.useState("");
  const fetcher = useFetcher();
  const samples = React.useMemo(() => buildSamples(), []);
  const currentTime = formatISO(new Date(), { representation: "complete" });

  const submit = (sample: ScheduleSample) => {
    if (sample.text === "Remove schedule") {
      fetcher.submit({ intent: "remove-schedule" }, { method: "POST" });
    } else if (sample.startTime) {
      fetcher.submit(
        { intent: "update-schedule", startTime: sample.startTime },
        { method: "POST" },
      );
    } else {
      fetcher.submit(
        { intent: "update-schedule", text: sample.text, currentTime },
        { method: "POST" },
      );
    }
    onClose();
  };

  const filtered = samples.filter((s) =>
    s.text.toLowerCase().includes(value.toLowerCase()),
  );

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Set schedule"
      description="Choose when this task should run"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Every day at 9 | work tomorrow..."
          value={value}
          onValueChange={setValue}
        />
        <CommandList className="p-1 max-h-[300px]">
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
                <Ban size={14} className="shrink-0 text-destructive" />
              ) : (
                <Clock size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">{sample.text}</span>
              {sample.isRecurring && (
                <RefreshCw
                  size={12}
                  className="shrink-0 text-muted-foreground"
                />
              )}
            </CommandItem>
          ))}
          {filtered.length === 0 && value && (
            <CommandItem
              onSelect={() => submit({ text: value, isRecurring: false })}
              className="flex items-center gap-2 py-2"
            >
              <Clock size={14} className="shrink-0 text-muted-foreground" />
              <span>Schedule: {value}</span>
            </CommandItem>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
