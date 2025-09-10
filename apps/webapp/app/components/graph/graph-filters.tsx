import { useState, useMemo } from "react";
import { ListFilter, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Badge } from "~/components/ui/badge";
import type { RawTriplet } from "./type";
import { type ClusterData } from "./graph-clustering";
import { nodeColorPalette } from "./node-colors";
import { useTheme } from "remix-themes";

interface GraphFiltersProps {
  clusters: ClusterData[];
  selectedCluster?: string | null;
  selectedEntityType?: string;
  onClusterChange: (cluster?: string) => void;
}

type FilterStep = "main" | "cluster" | "nodeType" | "entityType";

export function GraphFilters({
  clusters,
  selectedCluster,

  selectedEntityType,
  onClusterChange,
}: GraphFiltersProps) {
  const [themeMode] = useTheme();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [step, setStep] = useState<FilterStep>("main");

  // Get display labels
  const selectedClusterLabel = clusters.find(
    (c) => c.id === selectedCluster,
  )?.name;

  const hasFilters = selectedCluster || selectedEntityType;

  return (
    <div className="mb-2 flex w-full items-center justify-start gap-2 px-2">
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
          <PopoverContent
            className="h-full w-[180px] overflow-hidden p-0"
            align="start"
          >
            <div className="flex h-full max-h-52 flex-col overflow-auto">
              {step === "main" && (
                <div className="flex flex-col gap-1 p-2">
                  <Button
                    variant="ghost"
                    className="justify-start"
                    onClick={() => setStep("cluster")}
                  >
                    Cluster
                  </Button>
                </div>
              )}

              {step === "cluster" && (
                <div className="flex flex-col gap-1 p-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onClusterChange(undefined);
                      setPopoverOpen(false);
                      setStep("main");
                    }}
                  >
                    All Clusters
                  </Button>
                  {clusters.map((cluster, index) => {
                    const palette =
                      themeMode === "dark"
                        ? nodeColorPalette.dark
                        : nodeColorPalette.light;
                    const clusterColor = palette[index % palette.length];

                    return (
                      <Button
                        key={cluster.name}
                        variant="ghost"
                        className="w-full justify-start gap-2"
                        onClick={() => {
                          onClusterChange(
                            cluster.id === selectedCluster
                              ? undefined
                              : cluster.id,
                          );
                          setPopoverOpen(false);
                          setStep("main");
                        }}
                      >
                        <div
                          className="h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: clusterColor }}
                        />
                        {cluster.name}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      {/* Active Filters */}
      {hasFilters && (
        <div className="flex items-center gap-2">
          {selectedCluster && (
            <Badge variant="secondary" className="h-7 gap-1 rounded px-2">
              {selectedClusterLabel}
              <X
                className="hover:text-destructive h-3.5 w-3.5 cursor-pointer"
                onClick={() => onClusterChange(undefined)}
              />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
