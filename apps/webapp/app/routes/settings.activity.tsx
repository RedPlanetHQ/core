import { type LoaderFunctionArgs } from "@remix-run/node";
import { useState, useRef, useCallback } from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  InfiniteLoader,
  type ListRowProps,
} from "react-virtualized";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { useActivities, type ActivityItem } from "~/hooks/use-activities";
import { getIconForAuthorise } from "~/components/icon-utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";
import { ScrollManagedList } from "~/components/virtualized-list";
import { ExternalLink, Clock, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireUser(request);
  await requireWorkpace(request);
  return null;
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function ActivityRow({
  activity,
  isSelected,
  onClick,
}: {
  activity: ActivityItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const definition = activity.integrationAccount?.integrationDefinition;
  const icon = definition
    ? getIconForAuthorise(definition.slug, 16, definition.icon)
    : null;
  const plainText = activity.text.replace(/[#*_`[\]()]/g, "").trim();

  return (
    <div className="group mx-2 flex cursor-default gap-2">
      <div
        className={cn(
          "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow items-start gap-2 rounded-md px-2",
          isSelected && "bg-grayAlpha-200",
        )}
        onClick={onClick}
      >
        <div className="border-border flex w-full min-w-[0px] shrink flex-col gap-1 border-b py-2">
          <div className={cn("flex w-full min-w-[0px] shrink flex-col")}>
            <div className="flex w-full items-center gap-4">
              <div className="inline-flex min-h-[24px] min-w-[0px] shrink items-center justify-start gap-2">
                {icon}

                <div className={cn("truncate text-left")}>{plainText}</div>
              </div>
              <div className="flex grow gap-1"></div>
              <div className="text-muted-foreground flex shrink-0 items-center justify-center gap-2 text-sm">
                <div className="text-muted-foreground text-sm">
                  {formatRelativeTime(activity.createdAt)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityDetail({
  activity,
  onClose,
}: {
  activity: ActivityItem;
  onClose: () => void;
}) {
  const definition = activity.integrationAccount?.integrationDefinition;
  const icon = definition
    ? getIconForAuthorise(definition.slug, 20, definition.icon)
    : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{definition?.name ?? "Unknown"}</span>
        </div>
        <Button variant="ghost" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {activity.text}
      </p>

      <div className="text-muted-foreground mt-auto flex flex-col gap-2 text-xs">
        {activity.sourceURL && (
          <a
            href={activity.sourceURL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:underline"
          >
            <ExternalLink size={12} />
            Source
          </a>
        )}
        <div className="flex items-center gap-1">
          <Clock size={12} />
          {new Date(activity.createdAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default function ActivitySettings() {
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    null,
  );
  const [selectedSource, setSelectedSource] = useState<string | undefined>();

  const { activities, hasMore, loadMore, availableSources, isLoading } =
    useActivities({
      endpoint: "/api/v1/activities",
      source: selectedSource,
    });

  const selectedActivity = activities.find((a) => a.id === selectedActivityId);

  const cacheRef = useRef<CellMeasurerCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new CellMeasurerCache({
      defaultHeight: 48,
      fixedWidth: true,
    });
  }
  const cache = cacheRef.current;

  const isRowLoaded = useCallback(
    ({ index }: { index: number }) => !!activities[index],
    [activities],
  );

  const loadMoreRows = useCallback(async () => {
    if (hasMore) loadMore();
  }, [hasMore, loadMore]);

  const rowRenderer = useCallback(
    (props: ListRowProps) => {
      const { index, key, style, parent } = props;
      const activity = activities[index];

      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={parent}
          rowIndex={index}
        >
          <div style={style}>
            {activity ? (
              <ActivityRow
                activity={activity}
                isSelected={selectedActivityId === activity.id}
                onClick={() => setSelectedActivityId(activity.id)}
              />
            ) : (
              <div className="h-12 animate-pulse px-3 py-2">
                <div className="bg-muted h-4 rounded" />
              </div>
            )}
          </div>
        </CellMeasurer>
      );
    },
    [activities, cache, selectedActivityId],
  );

  const itemCount = hasMore ? activities.length + 1 : activities.length;

  return (
    <div className="flex h-full w-full flex-col items-center space-y-6">
      <div className="flex h-full w-full space-y-4 pb-2">
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          <ResizablePanel defaultSize={55} minSize={35}>
            <div className="h-full overflow-hidden pt-3">
              {availableSources.length > 0 && (
                <div className="mb-2 px-3">
                  <Select
                    value={selectedSource ?? "all"}
                    onValueChange={(v) =>
                      setSelectedSource(v === "all" ? undefined : v)
                    }
                  >
                    <SelectTrigger className="w-40" showIcon={false}>
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {availableSources.map((s) => (
                        <SelectItem key={s.slug} value={s.slug}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {activities.length === 0 && !isLoading ? (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  No activities found
                </div>
              ) : (
                <AutoSizer className="h-[calc(100vh-56px)]">
                  {({ width, height }) => (
                    <InfiniteLoader
                      isRowLoaded={isRowLoaded}
                      loadMoreRows={loadMoreRows}
                      rowCount={itemCount}
                      threshold={5}
                    >
                      {({ onRowsRendered, registerChild }) => (
                        <ScrollManagedList
                          ref={registerChild}
                          height={height}
                          width={width}
                          rowCount={itemCount}
                          rowHeight={({ index }: { index: number }) =>
                            cache.getHeight(index, 0)
                          }
                          onRowsRendered={onRowsRendered}
                          rowRenderer={rowRenderer}
                          deferredMeasurementCache={cache}
                          overscanRowCount={10}
                        />
                      )}
                    </InfiniteLoader>
                  )}
                </AutoSizer>
              )}
            </div>
          </ResizablePanel>

          {selectedActivity && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                defaultSize={45}
                minSize={25}
                collapsible
                collapsedSize={0}
              >
                <ActivityDetail
                  activity={selectedActivity}
                  onClose={() => setSelectedActivityId(null)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
