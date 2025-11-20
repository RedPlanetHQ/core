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

interface McpSessionsFiltersProps {
  availableSources: Array<{ name: string; slug: string; count: number }>;
  selectedSource?: string;
  onSourceChange: (source?: string) => void;
}

type FilterStep = "main" | "source";

export function McpSessionsFilters({
  availableSources,
  selectedSource,
  onSourceChange,
}: McpSessionsFiltersProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [step, setStep] = useState<FilterStep>("main");

  // Only show first few sources, or "All sources" if none
  const limitedSources = availableSources.slice(0, 5);

  const selectedSourceName = availableSources.find(
    (s) => s.slug === selectedSource,
  )?.name;

  const hasFilters = selectedSource;

  return (
    <div className="mb-2 flex w-full items-center justify-start gap-2">
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
          <PopoverContent className="w-[220px] p-0" align="start">
            {step === "main" && (
              <div className="flex flex-col gap-1 p-2">
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setStep("source")}
                >
                  Source
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
                {limitedSources.map((source) => (
                  <Button
                    key={source.slug}
                    variant="ghost"
                    className="w-full justify-between"
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
                    <span>{source.name}</span>
                    <Badge variant="outline" className="text-sm">
                      {source.count}
                    </Badge>
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
        </div>
      )}
    </div>
  );
}
