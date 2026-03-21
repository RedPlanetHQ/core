import { useRef, useCallback, useEffect } from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Task, TaskStatus } from "@core/database";
import { Button } from "~/components/ui";
import { cn } from "~/lib/utils";
import { TaskStatusIcons } from "~/components/icon-utils";
import { getTaskStatusColor } from "~/components/ui/color-utils";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import { Task as TaskIcon } from "~/components/icons/task";

const STATUS_ORDER: TaskStatus[] = [
  "InProgress",
  "Blocked",
  "Todo",
  "Backlog",
  "Completed",
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  InProgress: "In Progress",
  Blocked: "Blocked",
  Todo: "Todo",
  Backlog: "Backlog",
  Completed: "Completed",
};

type TaskRow =
  | { type: "header"; status: TaskStatus; count: number }
  | { type: "item"; task: Task };

function buildRows(tasks: Task[]): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const status of STATUS_ORDER) {
    const group = tasks.filter((t) => t.status === status);
    if (group.length === 0) continue;
    rows.push({ type: "header", status, count: group.length });
    for (const task of group) rows.push({ type: "item", task });
  }
  return rows;
}

function HeaderRow({
  status,
  index,
}: {
  status: TaskStatus;
  count: number;
  index: number;
}) {
  const Icon = TaskStatusIcons[status];
  return (
    <Button
      className={cn(
        "text-accent-foreground my-2 ml-2 mt-3 flex w-fit cursor-default items-center rounded-2xl",
        index === 0 && "mt-4",
      )}
      size="lg"
      style={{ backgroundColor: getTaskStatusColor(status).background }}
      variant="ghost"
    >
      <Icon size={20} className="h-5 w-5" />
      <h3 className="pl-2">{STATUS_LABELS[status]}</h3>
    </Button>
  );
}

function TaskRowItem({
  task,
  selected,
  onClick,
  onStatusChange,
}: {
  task: Task;
  selected: boolean;
  onClick: () => void;
  onStatusChange: (status: string) => void;
}) {
  return (
    <a onClick={onClick} className={cn("group flex cursor-default gap-2 pr-4")}>
      <div className="flex w-full items-center">
        <div
          className={cn(
            "group-hover:bg-grayAlpha-100 ml-4 flex min-w-[0px] shrink grow items-start gap-2 rounded-xl pl-2 pr-2",
            selected && "bg-grayAlpha-100",
          )}
        >
          <div className="shrink-0 pt-2">
            <TaskStatusDropdown
              value={task.status}
              onChange={onStatusChange}
              variant={TaskStatusDropdownVariant.NO_BACKGROUND}
            />
          </div>

          <div
            className={cn(
              "border-border flex w-full min-w-[0px] shrink flex-col border-b py-2.5",
            )}
          >
            <div className="flex w-full gap-4">
              <div className="inline-flex min-w-[0px] shrink items-center justify-start">
                <div className="truncate text-left">{task.title}</div>
              </div>
              <div className="inline-flex min-w-[0px] flex-1 shrink items-center justify-start">
                <div className="text-muted-foreground/80 truncate text-left">
                  {task.description}
                </div>
              </div>
              <div className="flex shrink-0 items-center pr-1">
                <span className="text-muted-foreground text-sm">
                  {formatDistanceToNow(new Date(task.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </a>
  );
}

export function TaskListPanel({
  tasks,
  selectedTaskId,
  onSelect,
  onNew,
  onStatusChange,
}: {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onStatusChange: (taskId: string, status: string) => void;
}) {
  const rows = buildRows(tasks);

  const cacheRef = useRef(
    new CellMeasurerCache({ defaultHeight: 41, fixedWidth: true }),
  );
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [rows.length]);

  const rowHeight = ({ index }: Index) =>
    Math.max(
      cache.getHeight(index, 0),
      rows[index]?.type === "header" ? 32 : 41,
    );

  const rowRenderer = useCallback(
    ({ index, key, style, parent }: ListRowProps) => {
      const row = rows[index];
      if (!row) return null;

      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={parent}
          rowIndex={index}
        >
          <div style={style} key={key}>
            {row.type === "header" ? (
              <HeaderRow status={row.status} count={row.count} index={index} />
            ) : (
              <TaskRowItem
                task={row.task}
                selected={row.task.id === selectedTaskId}
                onClick={() => onSelect(row.task.id)}
                onStatusChange={(status) => onStatusChange(row.task.id, status)}
              />
            )}
          </div>
        </CellMeasurer>
      );
    },
    [rows, selectedTaskId, onSelect, onStatusChange, cache],
  );

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <TaskIcon className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground text-sm">No tasks yet</p>
        <Button variant="secondary" className="rounded" onClick={onNew}>
          <Plus size={14} className="mr-1" /> New task
        </Button>
      </div>
    );
  }

  return (
    <AutoSizer className="h-full">
      {({ width, height }) => (
        <List
          height={height}
          width={width}
          rowCount={rows.length}
          rowHeight={rowHeight}
          rowRenderer={rowRenderer}
          deferredMeasurementCache={cache}
          overscanRowCount={8}
        />
      )}
    </AutoSizer>
  );
}
