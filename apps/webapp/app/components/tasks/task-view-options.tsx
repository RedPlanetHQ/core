import { useState } from "react";
import { SlidersHorizontal, Check } from "lucide-react";
import type { TaskStatus } from "@core/database";
import { Button } from "~/components/ui";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "~/components/ui/popover";
import { TaskStatusIcons } from "~/components/icon-utils";

export const ALL_STATUSES: TaskStatus[] = [
  "InProgress",
  "Blocked",
  "Todo",
  "Backlog",
  "Completed",
];

export const DEFAULT_VISIBLE: TaskStatus[] = [
  "InProgress",
  "Blocked",
  "Todo",
  "Backlog",
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  InProgress: "In Progress",
  Blocked: "Blocked",
  Todo: "Todo",
  Backlog: "Backlog",
  Completed: "Completed",
};

export function TaskViewOptions({
  visibleStatuses,
  onChange,
}: {
  visibleStatuses: TaskStatus[];
  onChange: (statuses: TaskStatus[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (status: TaskStatus) => {
    if (visibleStatuses.includes(status)) {
      onChange(visibleStatuses.filter((s) => s !== status));
    } else {
      onChange([...visibleStatuses, status]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="gap-2 rounded">
          <SlidersHorizontal size={14} />
          View
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent className="w-[180px] p-2" align="end">
          <p className="text-muted-foreground mb-1 px-2 text-xs font-medium">
            Show statuses
          </p>
          {ALL_STATUSES.map((status) => {
            const Icon = TaskStatusIcons[status];
            const checked = visibleStatuses.includes(status);
            return (
              <button
                key={status}
                onClick={() => toggle(status)}
                className="hover:bg-grayAlpha-100 flex w-full items-center gap-1 rounded px-2 py-1.5 text-sm"
              >
                <div className="flex h-4 w-4 items-center justify-center">
                  {checked && <Check size={12} />}
                </div>
                <Icon size={16} />
                {STATUS_LABELS[status]}
              </button>
            );
          })}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
