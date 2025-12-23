import { useState } from "react";
import {
  Check,
  LayoutGrid,
  ListFilter,
  File,
  MessageSquare,
  Tag,
  X,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Badge, BadgeColor } from "~/components/ui/badge";
import { getStatusColor } from "./utils";
import { getIconForAuthorise } from "../icon-utils";

interface Label {
  id: string;
  name: string;
  description: string | null;
  color: string;
  workspaceId: string;
}

interface LogsFiltersProps {
  availableSources: Array<{ name: string; slug: string }>;
  selectedSource?: string;
  selectedStatus?: string;

  selectedLabel?: string;
  labels: Label[];
  onSourceChange: (source?: string) => void;
  onStatusChange: (status?: string) => void;

  onLabelChange: (label?: string) => void;
}

const statusOptions = [
  { value: "ERROR", label: "Error" },
  { value: "PENDING", label: "Pending" },
  { value: "PROCESSING", label: "Processing" },
  { value: "COMPLETED", label: "Completed" },
];

type FilterStep = "main" | "source" | "status" | "label";

export function LogsFilters({
  availableSources = [],
  selectedSource,
  selectedStatus,
  selectedLabel,
  labels = [],
  onSourceChange,
  onStatusChange,
  onLabelChange,
}: LogsFiltersProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [step, setStep] = useState<FilterStep>("main");

  const selectedSourceName = availableSources.find(
    (s) => s.slug === selectedSource,
  )?.name;
  const selectedStatusLabel = statusOptions.find(
    (s) => s.value === selectedStatus,
  )?.label;

  const selectedLabelObj = labels.find((l) => l.id === selectedLabel);

  const hasFilters = selectedSource || selectedStatus || selectedLabel;

  const getIngestType = (type: string) => {
    return {
      label: type === "Conversation" ? "Conversation" : "Document",
      icon:
        type === "Conversation" ? (
          <MessageSquare size={14} />
        ) : (
          <File size={14} />
        ),
    };
  };

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
                  className="justify-start gap-2"
                  onClick={() => setStep("source")}
                >
                  <LayoutGrid size={14} />
                  Source
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-2"
                  onClick={() => setStep("status")}
                >
                  <Check size={14} />
                  Status
                </Button>

                <Button
                  variant="ghost"
                  className="justify-start gap-2"
                  onClick={() => setStep("label")}
                >
                  <Tag size={14} />
                  Label
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
                    className="w-full justify-start gap-2"
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
                    {getIconForAuthorise(
                      source.name.toLowerCase(),
                      14,
                      undefined,
                    )}
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
                    className="w-full justify-start gap-2"
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
                    <BadgeColor
                      className="h-3 w-3"
                      style={{
                        backgroundColor: getStatusColor(
                          status.label.toLocaleUpperCase(),
                        ),
                      }}
                    />
                    {status.label}
                  </Button>
                ))}
              </div>
            )}

            {step === "label" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onLabelChange(undefined);
                    setPopoverOpen(false);
                    setStep("main");
                  }}
                >
                  All labels
                </Button>
                {labels.map((label) => (
                  <Button
                    key={label.id}
                    variant="ghost"
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      onLabelChange(
                        label.id === selectedLabel ? undefined : label.id,
                      );
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
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
            <Badge
              variant="secondary"
              className="h-7 items-center gap-2 rounded px-2"
            >
              {getIconForAuthorise(
                (selectedSourceName as string).toLowerCase(),
                14,
                undefined,
              )}
              <div className="mt-[1px]"> {selectedSourceName}</div>

              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onSourceChange(undefined)}
              />
            </Badge>
          )}
          {selectedStatus && (
            <Badge variant="secondary" className="h-7 gap-2 rounded px-2">
              <BadgeColor
                className="h-3 w-3"
                style={{
                  backgroundColor: getStatusColor(
                    selectedStatusLabel?.toLocaleUpperCase() as string,
                  ),
                }}
              />
              <div className="mt-[1px]">{selectedStatusLabel}</div>

              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onStatusChange(undefined)}
              />
            </Badge>
          )}

          {selectedLabel && selectedLabelObj && (
            <Badge
              variant="secondary"
              className="flex h-7 items-center gap-2 rounded px-2"
            >
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: selectedLabelObj.color }}
              />
              <div className="mt-[1px]">{selectedLabelObj.name}</div>
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onLabelChange(undefined)}
              />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
