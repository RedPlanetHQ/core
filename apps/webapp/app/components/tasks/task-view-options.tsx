import { useState } from "react";
import { Check, ListFilter, RefreshCw, Settings2, X } from "lucide-react";
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
  "Todo",
  "Waiting",
  "Ready",
  "Working",
  "Review",
  "Done",
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  Todo: "Todo",
  Waiting: "Waiting",
  Ready: "Ready",
  Working: "Working",
  Review: "Review",
  Done: "Done",
  Recurring: "Recurring",
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
    <Badge variant="secondary" className="h-7 items-center gap-2 rounded px-2">
      <Icon size={14} style={{ color: colors.color }} />
      <div className="mt-[1px]">{STATUS_LABELS[status]}</div>
      <X
        className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
        onClick={onRemove}
      />
    </Badge>
  );
}

export function RecurringFilterChip({ onRemove }: { onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="h-7 items-center gap-2 rounded px-2">
      <RefreshCw size={14} className="text-muted-foreground" />
      <div className="mt-[1px]">Recurring</div>
      <X
        className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
        onClick={onRemove}
      />
    </Badge>
  );
}

export function TaskFilterButton({
  activeFilters,
  recurringFilter,
  onChange,
  onRecurringChange,
}: {
  activeFilters: TaskStatus[];
  recurringFilter: boolean;
  onChange: (filters: TaskStatus[]) => void;
  onRecurringChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (status: TaskStatus) => {
    if (activeFilters.includes(status)) {
      onChange(activeFilters.filter((s) => s !== status));
    } else {
      onChange([...activeFilters, status]);
    }
  };

  const totalActive = activeFilters.length + (recurringFilter ? 1 : 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" role="combobox" aria-expanded={open}>
          <ListFilter className="mr-2 h-4 w-4" />
          Filter
          {totalActive > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-4 min-w-4 rounded-full px-1 text-xs"
            >
              {totalActive}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent className="w-[200px] p-2" align="start">
          {/* Status section */}
          <p className="text-muted-foreground mb-1 px-2 text-xs font-medium uppercase tracking-wider">
            Status
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

          {/* Schedule section */}
          <div className="border-border my-2 border-t" />
          <p className="text-muted-foreground mb-1 px-2 text-xs font-medium uppercase tracking-wider">
            Schedule
          </p>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => onRecurringChange(!recurringFilter)}
          >
            <div className="flex h-4 w-4 items-center justify-center">
              {recurringFilter && <Check size={12} />}
            </div>
            <RefreshCw size={14} />
            Recurring
          </Button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

export function ViewOptionsButton({
  showDone,
  onShowDoneChange,
}: {
  showDone: boolean;
  onShowDoneChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" role="combobox" aria-expanded={open}>
          <Settings2 className="mr-2 h-4 w-4" />
          View
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent className="w-[180px] p-2" align="end">
          <p className="text-muted-foreground mb-1 px-2 text-xs font-medium uppercase tracking-wider">
            View options
          </p>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => onShowDoneChange(!showDone)}
          >
            <div className="flex h-4 w-4 items-center justify-center">
              {showDone && <Check size={12} />}
            </div>
            Show done
          </Button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
