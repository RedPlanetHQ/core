import { Button } from "../ui/button";
import { Command, CommandInput } from "../ui/command";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "../ui/popover";

import * as React from "react";

import { TaskStatusIcons } from "../icon-utils";
import { type TaskStatus } from "@core/database";
import { getTaskStatusColor } from "../ui/color-utils";
import { TaskStatusDropdownContent } from "./task-status-dropdown-content";

export enum TaskStatusDropdownVariant {
  NO_BACKGROUND = "NO_BACKGROUND",
  DEFAULT = "DEFAULT",
  LINK = "LINK",
}

interface TaskStatusProps {
  value?: TaskStatus;
  onChange?: (newStatus: string) => void;
  variant?: TaskStatusDropdownVariant;
}

export const TaskStatusDropdown = ({
  value,
  onChange,
  variant = TaskStatusDropdownVariant.DEFAULT,
}: TaskStatusProps) => {
  const [open, setOpen] = React.useState(false);

  if (!value) {
    return null;
  }

  const CategoryIcon = TaskStatusIcons[value];

  function getTrigger() {
    if (variant === TaskStatusDropdownVariant.NO_BACKGROUND) {
      return (
        <Button
          variant="outline"
          role="combobox"
          size="sm"
          aria-expanded={open}
          className="focus-visible:border-primary flex items-center justify-between border-0 !bg-transparent p-0 shadow-none hover:bg-transparent focus-visible:ring-1"
        >
          <CategoryIcon
            size={20}
            color={getTaskStatusColor(value as any).color}
          />
        </Button>
      );
    }

    if (variant === TaskStatusDropdownVariant.LINK) {
      return (
        <Button
          variant="link"
          role="combobox"
          aria-expanded={open}
          className="focus-visible:border-primary flex items-center justify-between px-0 shadow-none focus-visible:ring-1"
        >
          <CategoryIcon
            size={20}
            className="text-muted-foreground mr-2"
            color={getTaskStatusColor(value as any).color}
          />
          {value}
        </Button>
      );
    }

    return (
      <Button
        variant="link"
        role="combobox"
        aria-expanded={open}
        className="focus-visible:border-primary flex items-center justify-between gap-2 shadow-none focus-visible:ring-1"
      >
        <CategoryIcon
          size={18}
          color={getTaskStatusColor(value as any).color}
        />
        {status}
      </Button>
    );
  }

  return (
    <div
      onClick={(e) => {
        console.log(e);
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{getTrigger()}</PopoverTrigger>
        <PopoverPortal>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Set status..." autoFocus />
              <TaskStatusDropdownContent
                onChange={onChange as any}
                onClose={() => setOpen(false)}
                value={value}
              />
            </Command>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
};

TaskStatusDropdown.displayName = "TaskStatusDropdown";
