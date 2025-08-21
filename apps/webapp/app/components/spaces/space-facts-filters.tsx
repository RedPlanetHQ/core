import { useState } from "react";
import { ListFilter, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Badge } from "~/components/ui/badge";

interface SpaceFactsFiltersProps {
  selectedValidDate?: string;
  selectedSpaceFilter?: string;
  onValidDateChange: (date?: string) => void;
  onSpaceFilterChange: (filter?: string) => void;
}

const validDateOptions = [
  { value: "last_week", label: "Last Week" },
  { value: "last_month", label: "Last Month" },
  { value: "last_6_months", label: "Last 6 Months" },
];

const spaceFilterOptions = [
  { value: "active", label: "Active Facts" },
  { value: "archived", label: "Archived Facts" },
  { value: "all", label: "All Facts" },
];

type FilterStep = "main" | "validDate" | "spaceFilter";

export function SpaceFactsFilters({
  selectedValidDate,
  selectedSpaceFilter,
  onValidDateChange,
  onSpaceFilterChange,
}: SpaceFactsFiltersProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [step, setStep] = useState<FilterStep>("main");

  const selectedValidDateLabel = validDateOptions.find(
    (d) => d.value === selectedValidDate,
  )?.label;
  const selectedSpaceFilterLabel = spaceFilterOptions.find(
    (f) => f.value === selectedSpaceFilter,
  )?.label;

  const hasFilters = selectedValidDate || selectedSpaceFilter;

  return (
    <div className="mb-2 flex w-full items-center justify-start gap-2 px-5">
      <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open);
          if (!open) setStep("main");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            role="combobox"
            aria-expanded={popoverOpen}
            className="justify-between"
          >
            <ListFilter className="mr-2 h-4 w-4" />
            Filter
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent className="w-[180px] p-0" align="start">
            {step === "main" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setStep("validDate")}
                >
                  Valid Date
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setStep("spaceFilter")}
                >
                  Status
                </Button>
              </div>
            )}

            {step === "validDate" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onValidDateChange(undefined);
                    setPopoverOpen(false);
                    setStep("main");
                  }}
                >
                  All Dates
                </Button>
                {validDateOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onValidDateChange(
                        option.value === selectedValidDate
                          ? undefined
                          : option.value,
                      );
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}

            {step === "spaceFilter" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onSpaceFilterChange(undefined);
                    setPopoverOpen(false);
                    setStep("main");
                  }}
                >
                  All Facts
                </Button>
                {spaceFilterOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onSpaceFilterChange(
                        option.value === selectedSpaceFilter
                          ? undefined
                          : option.value,
                      );
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      {/* Active Filters */}
      {hasFilters && (
        <div className="flex items-center gap-2">
          {selectedValidDate && (
            <Badge variant="secondary" className="h-7 gap-1 rounded px-2">
              {selectedValidDateLabel}
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onValidDateChange(undefined)}
              />
            </Badge>
          )}
          {selectedSpaceFilter && (
            <Badge variant="secondary" className="h-7 gap-1 rounded px-2">
              {selectedSpaceFilterLabel}
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onSpaceFilterChange(undefined)}
              />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
