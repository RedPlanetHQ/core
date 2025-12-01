import * as React from "react";
import { useFetcher } from "@remix-run/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverPortal,
} from "../ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../ui/command";
import { Button } from "../ui";
import { Checkbox } from "../ui/checkbox";
import { Tag } from "lucide-react";

export interface Label {
  id: string;
  name: string;
  description: string | null;
  color: string;
  workspaceId: string;
}

interface LabelDropdownProps {
  logId?: string;
  value: string[]; // Array of selected label IDs
  labels: Label[];
  onChange?: (labelIds: string[]) => void;
  short?: boolean;
}

export function LabelDropdown({
  logId,
  value: defaultValue,
  labels,
  onChange,
  short = false,
}: LabelDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [labelSearch, setLabelSearch] = React.useState("");
  const fetcher = useFetcher();
  const [value, setValue] = React.useState(defaultValue);

  const handleLabelToggle = (labelId: string) => {
    const newValue = value.includes(labelId)
      ? value.filter((id) => id !== labelId)
      : [...value, labelId];

    if (logId) {
      // Update via API
      fetcher.submit(
        { labels: newValue },
        {
          method: "PATCH",
          action: `/api/v1/logs/${logId}`,
          encType: "application/json",
        },
      );
    }

    setValue(newValue);
    // Call onChange callback if provided
    onChange?.(newValue);
  };

  const selectedLabels = labels.filter((label) => value.includes(label.id));

  const labelTitle = () => {
    if (value.length === 0) {
      return (
        <span className="text-muted-foreground flex items-center gap-1">
          <Tag size={16} />
          {!short && "Add label..."}
        </span>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <div className="flex items-center -space-x-1">
          {selectedLabels.slice(0, 3).map((label) => (
            <div
              key={label.id}
              className="border-background mb-[1px] h-3 w-3 rounded-[0.3rem] border"
              style={{ backgroundColor: label.color }}
            />
          ))}
        </div>
        <span className="text-foreground">
          {value.length} {value.length === 1 ? "label" : "labels"}
        </span>
      </div>
    );
  };

  const filteredLabels = labels.filter((label) =>
    label.name.toLowerCase().includes(labelSearch.toLowerCase()),
  );

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="flex items-center justify-between font-normal"
          >
            {labelTitle()}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent className="w-72 p-0" align="end">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search label..."
                onValueChange={(searchValue: string) =>
                  setLabelSearch(searchValue)
                }
                autoFocus
              />
              <CommandList>
                <CommandEmpty>No labels found.</CommandEmpty>
                <CommandGroup>
                  {filteredLabels.map((label) => {
                    const isSelected = value.includes(label.id);
                    return (
                      <CommandItem
                        key={label.id}
                        onSelect={() => handleLabelToggle(label.id)}
                        className="flex items-center gap-2"
                      >
                        <Checkbox checked={isSelected} />
                        <div
                          className="h-3 w-3 rounded-[0.3rem]"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="flex-1">{label.name}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}
