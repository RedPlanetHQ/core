import { useRef, useCallback, useEffect } from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { RefreshCw, Plus, Clock } from "lucide-react";
import { Button } from "~/components/ui";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import type { TaskWithRelations } from "~/services/task.server";
import { ButlerRunBadge } from "~/components/tasks/butler-run-badge";

function ScheduledTaskRow({
  task,
  selected,
  onClick,
}: {
  task: TaskWithRelations;
  selected: boolean;
  onClick: () => void;
}) {
  const isRecurring = !!task.schedule;
  const scheduleText =
    (task.metadata as Record<string, string> | null)?.scheduleText ?? null;

  return (
    <a onClick={onClick} className={cn("group flex cursor-default gap-2 pr-4")}>
      <div className="flex w-full items-center">
        <div
          className={cn(
            "group-hover:bg-grayAlpha-100 ml-2 flex min-w-[0px] shrink grow items-center gap-2 rounded-xl pl-2 pr-2",
            selected && "bg-grayAlpha-100",
          )}
        >
          <div className="text-muted-foreground flex shrink-0 items-center">
            {isRecurring ? <RefreshCw size={16} /> : <Clock size={16} />}
          </div>

          <div
            className={cn(
              "border-border flex w-full min-w-[0px] shrink flex-col border-b py-2.5",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <div className="inline-flex min-w-[0px] shrink items-center justify-start">
                <div className="truncate text-left">{task.title}</div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="secondary" className="gap-1 text-xs">
                  {isRecurring ? (
                    <span className="text-muted-foreground">
                      {scheduleText ?? "Recurring"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">One-time</span>
                  )}
                </Badge>

                {task.nextRunAt && (
                  <ButlerRunBadge
                    nextRunAt={task.nextRunAt as unknown as string}
                    isRecurring={!!task.schedule}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </a>
  );
}

export function ScheduledTaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onNew,
}: {
  tasks: TaskWithRelations[];
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const cacheRef = useRef(
    new CellMeasurerCache({ defaultHeight: 41, fixedWidth: true }),
  );
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [tasks.length]);

  const rowHeight = ({ index }: Index) =>
    Math.max(cache.getHeight(index, 0), 41);

  const rowRenderer = useCallback(
    ({ index, key, style, parent }: ListRowProps) => {
      const task = tasks[index];
      if (!task) return null;

      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={parent}
          rowIndex={index}
        >
          <div style={style} key={key}>
            <ScheduledTaskRow
              task={task}
              selected={task.id === selectedTaskId}
              onClick={() => onSelect(task.id)}
            />
          </div>
        </CellMeasurer>
      );
    },
    [tasks, selectedTaskId, onSelect, cache],
  );

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Clock className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground text-sm">No scheduled tasks</p>
        <Button variant="secondary" className="rounded" onClick={onNew}>
          <Plus size={14} className="mr-1" /> New task
        </Button>
      </div>
    );
  }

  return (
    <AutoSizer className="mt-2 h-full">
      {({ width, height }) => (
        <List
          height={height}
          width={width}
          rowCount={tasks.length}
          rowHeight={rowHeight}
          rowRenderer={rowRenderer}
          deferredMeasurementCache={cache}
          overscanRowCount={8}
        />
      )}
    </AutoSizer>
  );
}
