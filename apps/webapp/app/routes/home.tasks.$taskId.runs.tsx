import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate, useRouteLoaderData } from "@remix-run/react";
import {
  typedjson,
  useTypedLoaderData,
  useTypedRouteLoaderData,
} from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  AutoSizer,
  List,
  CellMeasurer,
  CellMeasurerCache,
  type ListRowProps,
  type Index,
} from "react-virtualized";
import { format } from "date-fns";
import { ExternalLink, PlayCircle } from "lucide-react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getTaskRuns } from "~/services/conversation.server";
import type { TaskRun } from "~/services/conversation.server";
import type { loader as parentLoader } from "~/routes/home.tasks.$taskId";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { taskId } = params;
  if (!taskId) return redirect("/home/tasks");

  const runs = await getTaskRuns(taskId);
  return typedjson({ runs });
}

// ─── Run list ─────────────────────────────────────────────────────────────────

function RunListItem({
  run,
  selected,
  onClick,
}: {
  run: TaskRun;
  selected: boolean;
  onClick: () => void;
}) {
  const statusColor: Record<string, string> = {
    completed: "bg-green-500/20 text-green-600",
    running: "bg-blue-500/20 text-blue-600",
    failed: "bg-red-500/20 text-red-600",
    pending: "bg-gray-500/20 text-gray-600",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "border-border hover:bg-grayAlpha-100 flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors",
        selected && "bg-grayAlpha-100",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {format(new Date(run.createdAt), "MMM d, yyyy")}
        </span>
        <Badge
          variant="secondary"
          className={cn("text-xs capitalize", statusColor[run.status] ?? "")}
        >
          {run.status}
        </Badge>
      </div>
      <span className="text-muted-foreground text-xs">
        {format(new Date(run.createdAt), "h:mm a")}
      </span>
    </button>
  );
}

// ─── Run detail ───────────────────────────────────────────────────────────────

function RunDetail({
  run,
  taskTitle,
  onOpenChat,
}: {
  run: TaskRun;
  taskTitle: string;
  onOpenChat: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">
            {format(new Date(run.createdAt), "EEEE, MMMM d, yyyy · h:mm a")}
          </p>
          <h2 className="text-lg font-semibold">{taskTitle}</h2>
        </div>
        <Button
          variant="secondary"
          className="shrink-0 gap-1.5 rounded"
          onClick={onOpenChat}
        >
          <ExternalLink size={14} />
          Open chat
        </Button>
      </div>

      <div className="bg-grayAlpha-50 flex-1 rounded-lg p-4">
        {run.lastMessage ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {run.lastMessage.text}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">No messages yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function RunsPage() {
  const { runs } = useTypedLoaderData<typeof loader>();
  const parent = useRouteLoaderData<typeof parentLoader>(
    "routes/home.tasks.$taskId",
  );
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(
    runs[0]?.id ?? null,
  );

  const selectedRun = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  const cacheRef = useRef(
    new CellMeasurerCache({ defaultHeight: 64, fixedWidth: true }),
  );
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [runs.length]);

  const rowHeight = ({ index }: Index) =>
    Math.max(cache.getHeight(index, 0), 64);

  const rowRenderer = useCallback(
    ({ index, key, style, parent: listParent }: ListRowProps) => {
      const run = runs[index];
      if (!run) return null;
      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={listParent}
          rowIndex={index}
        >
          <div style={style}>
            <RunListItem
              run={run}
              selected={run.id === selectedId}
              onClick={() => setSelectedId(run.id)}
            />
          </div>
        </CellMeasurer>
      );
    },
    [runs, selectedId, cache],
  );

  if (runs.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <PlayCircle className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground text-sm">No runs yet</p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
      <ResizablePanel defaultSize="35%" minSize="20%" maxSize="50%">
        <div className="flex h-full flex-col">
          <div className="border-border border-b px-4 py-2">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              {runs.length} run{runs.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex-1 overflow-hidden">
            <AutoSizer>
              {({ width, height }) => (
                <List
                  height={height}
                  width={width}
                  rowCount={runs.length}
                  rowHeight={rowHeight}
                  rowRenderer={rowRenderer}
                  deferredMeasurementCache={cache}
                  overscanRowCount={8}
                />
              )}
            </AutoSizer>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize="65" minSize="50%">
        {selectedRun ? (
          <RunDetail
            run={selectedRun}
            taskTitle={parent?.task.title ?? ""}
            onOpenChat={() => navigate(`/home/conversation/${selectedRun.id}`)}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Select a run
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export default function TaskRunsPage() {
  if (typeof window === "undefined") return null;
  return <ClientOnly fallback={null}>{() => <RunsPage />}</ClientOnly>;
}
