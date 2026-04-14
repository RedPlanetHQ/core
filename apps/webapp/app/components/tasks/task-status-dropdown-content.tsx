import { Check } from "lucide-react";
import { TaskStatusIcons } from "../icon-utils";
import { Checkbox } from "../ui/checkbox";
import { getTaskStatusColor } from "../ui/color-utils";
import { CommandGroup, CommandItem } from "../ui/command";

import { type TaskStatus } from "@core/database";
const STATUS_ORDER: TaskStatus[] = [
  "Todo",
  "Waiting",
  "Ready",
  "Working",
  "Review",
  "Done",
];

interface TaskStatusDropdownContentProps {
  onChange?: (id: string | string[]) => void;
  onClose: () => void;
  multiple?: boolean;
  value: string | string[];
}

interface DropdownItemProps {
  id: string | number;
  value: string;
  onSelect: (value: string) => void;
  index: number;
  children: React.ReactElement;
}

export function DropdownItem({
  id,
  value,
  onSelect,
  children,
}: DropdownItemProps) {
  return (
    <CommandItem key={id} value={value} onSelect={() => onSelect(id as string)}>
      <div className="flex w-full">
        <div className="grow">{children}</div>
      </div>
    </CommandItem>
  );
}

export function TaskStatusDropdownContent({
  onChange,
  onClose,
  multiple = false,
  value,
}: TaskStatusDropdownContentProps) {
  const onValueChange = (checked: boolean, id: string) => {
    if (checked && !value.includes(id)) {
      onChange && onChange([...value, id]);
    }

    if (!checked && value.includes(id)) {
      const newIds = [...value];
      const indexToDelete = newIds.indexOf(id);

      newIds.splice(indexToDelete, 1);
      onChange && onChange(newIds);
    }
  };

  return (
    <CommandGroup>
      {STATUS_ORDER.map((status, index) => {
        const CategoryIcon = TaskStatusIcons[status];

        return (
          <DropdownItem
            key={status}
            id={status}
            value={status}
            index={index + 1}
            onSelect={(currentValue: string) => {
              if (!multiple) {
                onChange && onChange(currentValue);
                onClose();
              } else {
                onValueChange(!value.includes(currentValue), status);
              }
            }}
          >
            <div className="flex items-center gap-2">
              {multiple && (
                <Checkbox
                  id={status}
                  checked={value.includes(status)}
                  onCheckedChange={(value: boolean) => {
                    onValueChange(value, status);
                  }}
                />
              )}
              <label className="flex grow items-center" htmlFor={status}>
                <CategoryIcon
                  size={20}
                  className="mr-2 !h-5 !w-5"
                  color={getTaskStatusColor(status).color}
                />
                {status}
              </label>
              {!multiple && value === status && (
                <Check size={14} className="text-primary ml-auto" />
              )}
            </div>
          </DropdownItem>
        );
      })}
    </CommandGroup>
  );
}
