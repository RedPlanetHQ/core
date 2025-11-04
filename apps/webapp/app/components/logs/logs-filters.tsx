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

interface LogsFiltersProps {
  availableSources: Array<{ name: string; slug: string }>;
  selectedSource?: string;
  selectedStatus?: string;
  selectedType?: string;
  onSourceChange: (source?: string) => void;
  onStatusChange: (status?: string) => void;
  onTypeChange: (type?: string) => void;
}

const statusOptions = [
  { value: "PENDING", label: "Pending" },
  { value: "PROCESSING", label: "Processing" },
  { value: "COMPLETED", label: "Completed" },
];

const typeOptions = [
  { value: "CONVERSATION", label: "Conversation" },
  { value: "DOCUMENT", label: "Document" },
];

type FilterStep = "main" | "source" | "status" | "type";

export function LogsFilters({
  availableSources = [],
  selectedSource,
  selectedStatus,
  selectedType,
  onSourceChange,
  onStatusChange,
  onTypeChange,
}: LogsFiltersProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [step, setStep] = useState<FilterStep>("main");

  const selectedSourceName = availableSources.find(
    (s) => s.slug === selectedSource,
  )?.name;
  const selectedStatusLabel = statusOptions.find(
    (s) => s.value === selectedStatus,
  )?.label;
  const selectedTypeLabel = typeOptions.find(
    (s) => s.value === selectedType,
  )?.label;

  const hasFilters = selectedSource || selectedStatus || selectedType;

  return (
    <div className="mb-2 flex w-full items-center justify-start gap-2 px-3">
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
                  onClick={() => setStep("source")}
                >
                  Source
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setStep("status")}
                >
                  Status
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setStep("type")}
                >
                  Type
                </Button>
              </div>
            )}

            {step === "source" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onSourceChange(undefined);
                    setPopoverOpen(false);
                    setStep("main");
                  }}
                >
                  All sources
                </Button>
                {availableSources.map((source) => (
                  <Button
                    key={source.slug}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onSourceChange(
                        source.slug === selectedSource
                          ? undefined
                          : source.slug,
                      );
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    {source.name}
                  </Button>
                ))}
              </div>
            )}

            {step === "status" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onStatusChange(undefined);
                    setPopoverOpen(false);
                    setStep("main");
                  }}
                >
                  All statuses
                </Button>
                {statusOptions.map((status) => (
                  <Button
                    key={status.value}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onStatusChange(
                        status.value === selectedStatus
                          ? undefined
                          : status.value,
                      );
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    {status.label}
                  </Button>
                ))}
              </div>
            )}

            {step === "type" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onTypeChange(undefined);
                    setPopoverOpen(false);
                    setStep("main");
                  }}
                >
                  All types
                </Button>
                {typeOptions.map((type) => (
                  <Button
                    key={type.value}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onTypeChange(
                        type.value === selectedType ? undefined : type.value,
                      );
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    {type.label}
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
          {selectedSource && (
            <Badge variant="secondary" className="h-7 gap-1 rounded px-2">
              {selectedSourceName}
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onSourceChange(undefined)}
              />
            </Badge>
          )}
          {selectedStatus && (
            <Badge variant="secondary" className="h-7 gap-1 rounded px-2">
              {selectedStatusLabel}
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onStatusChange(undefined)}
              />
            </Badge>
          )}
          {selectedType && (
            <Badge variant="secondary" className="h-7 gap-1 rounded px-2">
              {selectedTypeLabel}
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onTypeChange(undefined)}
              />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
