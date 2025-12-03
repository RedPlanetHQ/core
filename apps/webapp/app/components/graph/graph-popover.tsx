import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { NodePopupContent, EdgePopupContent } from "./type";
import { getNodeColor } from "./node-colors";

import { useMemo } from "react";

import { useTheme } from "remix-themes";

import dayjs from "dayjs";

/**
 * Format a date string into a readable format
 */
export function formatDate(
  dateString?: string | null,
  format: string = "MMM D, YYYY",
): string {
  if (!dateString) return "Unknown";

  try {
    return dayjs(dateString).format(format);
  } catch (error) {
    console.error("Error formatting date:", error);
    return "Invalid date";
  }
}

interface GraphPopoversProps {
  showNodePopup: boolean;
  showEdgePopup: boolean;
  nodePopupContent: NodePopupContent | null;
  edgePopupContent: EdgePopupContent | null;
  onOpenChange?: (open: boolean) => void;
  labelColorMap?: Map<string, number>;
}

export function GraphPopovers({
  showNodePopup,
  showEdgePopup,
  nodePopupContent,
  edgePopupContent,
  onOpenChange,
  labelColorMap,
}: GraphPopoversProps) {
  const [resolvedTheme] = useTheme();
  const isDarkMode = resolvedTheme === "dark";

  const primaryNodeLabel = useMemo((): string | null => {
    if (!nodePopupContent) {
      return null;
    }

    // Check if node has primaryLabel property (GraphNode)
    const nodeAny = nodePopupContent.node as any;

    if (
      nodeAny.attributes.nodeType &&
      typeof nodeAny.attributes.nodeType === "string"
    ) {
      return nodeAny.attributes.nodeType;
    }

    // Fall back to original logic with labels
    const primaryLabel = nodePopupContent.node.labels?.find(
      (label) => label !== "Entity",
    );
    return primaryLabel || "Entity";
  }, [nodePopupContent]);

  // Get the color for the primary label
  const labelColor = useMemo(() => {
    if (!primaryNodeLabel || !labelColorMap) return "";
    return getNodeColor(primaryNodeLabel, isDarkMode, labelColorMap);
  }, [primaryNodeLabel, isDarkMode, labelColorMap]);

  const attributesToDisplay = useMemo(() => {
    if (!nodePopupContent) {
      return [];
    }

    const entityProperties = Object.fromEntries(
      Object.entries(nodePopupContent.node.attributes || {}).filter(([key]) => {
        return key !== "labels" && !key.includes("Embedding");
      }),
    );

    return Object.entries(entityProperties)
      .map(([key, value]) => ({
        key,
        value,
      }))
      .filter(({ value }) => value);
  }, [nodePopupContent]);

  return (
    <div className="fixed right-4 bottom-4 z-50">
      {/* Node Popover */}
      <Popover open={showNodePopup} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <div className="pointer-events-none h-4 w-4" />
        </PopoverTrigger>
        <PopoverContent
          className="shadow-1 border-border bg-background-3 h-35 max-w-80 overflow-auto border-1"
          side="bottom"
          align="end"
          sideOffset={5}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="space-y-2">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="leading-none font-medium">Node Details</h4>
              {primaryNodeLabel && (
                <span
                  className="rounded-md px-2 py-1 text-sm font-medium text-white"
                  style={{ backgroundColor: labelColor }}
                >
                  {primaryNodeLabel}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {attributesToDisplay.length > 0 && (
                <div>
                  <div className="space-y-1.5">
                    {attributesToDisplay.map(({ key, value }) => (
                      <p key={key} className="text-sm">
                        <span className="font-medium text-black dark:text-white">
                          {key.charAt(0).toUpperCase() +
                            key.slice(1).toLowerCase()}
                          :
                        </span>{" "}
                        <span className="text-muted-foreground break-words">
                          {typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Edge Popover */}
      <Popover open={showEdgePopup} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <div className="pointer-events-none h-4 w-4" />
        </PopoverTrigger>
        <PopoverContent
          className="shadow-1 border-border bg-background-3 max-h-96 max-w-xl overflow-auto border-1"
          side="bottom"
          align="end"
          sideOffset={5}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {edgePopupContent && (
            <div className="space-y-3">
              <div className="mb-2">
                <h4 className="leading-none font-medium">Edge Details</h4>
              </div>

              {/* Edge Type */}
              <div>
                <span className="font-medium text-black dark:text-white">Type:</span>{" "}
                <span className="text-muted-foreground">{edgePopupContent.relation.type}</span>
              </div>

              {/* Edge Attributes */}
              {edgePopupContent.relation.attributes && (
                <div className="space-y-2">
                  <h5 className="text-sm font-medium">Shared Information:</h5>

                  {/* Total count */}
                  {edgePopupContent.relation.attributes.totalSharedEntities && (
                    <p className="text-sm">
                      <span className="font-medium text-black dark:text-white">Total Shared Entities:</span>{" "}
                      <span className="text-muted-foreground">
                        {edgePopupContent.relation.attributes.totalSharedEntities}
                      </span>
                    </p>
                  )}

                  {/* Subjects */}
                  {edgePopupContent.relation.attributes.subjects?.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium text-black dark:text-white">
                        Shared Subjects ({edgePopupContent.relation.attributes.subjectCount}):
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {edgePopupContent.relation.attributes.subjects.map((s: any, i: number) => (
                          <span key={i} className="rounded bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-xs">
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Predicates */}
                  {edgePopupContent.relation.attributes.predicates?.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium text-black dark:text-white">
                        Shared Predicates ({edgePopupContent.relation.attributes.predicateCount}):
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {edgePopupContent.relation.attributes.predicates.map((p: any, i: number) => (
                          <span key={i} className="rounded bg-purple-100 dark:bg-purple-900 px-2 py-0.5 text-xs">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Objects */}
                  {edgePopupContent.relation.attributes.objects?.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium text-black dark:text-white">
                        Shared Objects ({edgePopupContent.relation.attributes.objectCount}):
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {edgePopupContent.relation.attributes.objects.map((o: any, i: number) => (
                          <span key={i} className="rounded bg-green-100 dark:bg-green-900 px-2 py-0.5 text-xs">
                            {o.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Source and Target nodes */}
              <div className="border-t pt-2 text-sm">
                <div className="mb-1">
                  <span className="font-medium text-black dark:text-white">From:</span>{" "}
                  <span className="text-muted-foreground">{edgePopupContent.source.name}</span>
                </div>
                <div>
                  <span className="font-medium text-black dark:text-white">To:</span>{" "}
                  <span className="text-muted-foreground">{edgePopupContent.target.name}</span>
                </div>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
