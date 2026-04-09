import { useState } from "react";
import { Check, ListFilter, X } from "lucide-react";
import type { TaskStatus } from "@core/database";
import { Button } from "~/components/ui";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Badge } from "~/components/ui/badge";
import { TaskStatusIcons } from "~/components/icon-utils";
import { getTaskStatusColor } from "~/components/ui/color-utils";

export const ALL_STATUSES: TaskStatus[] = [
  "InProgress",
  "Blocked",
  "Todo",
  "Backlog",
  "Completed",
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  InProgress: "In Progress",
  Blocked: "Blocked",
  Todo: "Todo",
  Backlog: "Backlog",
  Completed: "Completed",
};

export function StatusFilterChip({
  status,
  onRemove,
}: {
  status: TaskStatus;
  onRemove: () => void;
}) {
  const Icon = TaskStatusIcons[status];
  const colors = getTaskStatusColor(status);

  return (
    <Badge
      variant="secondary"
      className="h-7 items-center gap-2 rounded px-2"
    >
      <Icon
        size={14}
        style={{ color: colors.color }}
      />
      <div className="mt-[1px]">{STATUS_LABELS[status]}</div>
      <X
        className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
        onClick={onRemove}
      />
    </Badge>
  );
}

export function TaskFilterButton({
  activeFilters,
  onChange,
}: {
  activeFilters: TaskStatus[];
  onChange: (filters: TaskStatus[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (status: TaskStatus) => {
    if (activeFilters.includes(status)) {
      onChange(activeFilters.filter((s) => s !== status));
    } else {
      onChange([...activeFilters, status]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" role="combobox" aria-expanded={open}>
          <ListFilter className="mr-2 h-4 w-4" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent className="w-[180px] p-2" align="start">
          <p className="text-muted-foreground mb-1 px-2 text-xs font-medium">
            Filter by status
          </p>
          {ALL_STATUSES.map((status) => {
            const Icon = TaskStatusIcons[status];
            const active = activeFilters.includes(status);
            return (
              <Button
                key={status}
                variant="ghost"
                className="w-full justify-start gap-2"
                onClick={() => toggle(status)}
              >
                <div className="flex h-4 w-4 items-center justify-center">
                  {active && <Check size={12} />}
                </div>
                <Icon size={14} />
                {STATUS_LABELS[status]}
              </Button>
            );
          })}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
