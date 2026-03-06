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
import { ExternalLink, Clock } from "lucide-react";

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

  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-muted" : ""
      }`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
        {activity.text}
      </p>
      <span className="text-muted-foreground flex-shrink-0 text-xs">
        {formatRelativeTime(activity.createdAt)}
      </span>
    </div>
  );
}

function ActivityDetail({ activity }: { activity: ActivityItem }) {
  const definition = activity.integrationAccount?.integrationDefinition;
  const icon = definition
    ? getIconForAuthorise(definition.slug, 20, definition.icon)
    : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{definition?.name ?? "Unknown"}</span>
      </div>

      <p className="text-sm leading-relaxed whitespace-pre-wrap">{activity.text}</p>

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
  const [sourceFilter, setSourceFilter] = useState<string>("");

  const { activities, hasMore, loadMore, availableSources, isLoading } =
    useActivities({
      endpoint: "/api/v1/activities",
      source: sourceFilter || undefined,
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
                <div className="h-4 rounded bg-muted" />
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
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-medium">Activity</h1>
          {availableSources.length > 0 && (
            <select
              className="bg-background border-input h-8 rounded-md border px-2 text-xs"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">All sources</option>
              {availableSources.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={55} minSize={35}>
            <div className="h-full overflow-hidden">
              {activities.length === 0 && !isLoading ? (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  No activities found
                </div>
              ) : (
                <AutoSizer className="h-full">
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
                          rowHeight={({ index }) => cache.getHeight(index, 0)}
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
                <ActivityDetail activity={selectedActivity} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
