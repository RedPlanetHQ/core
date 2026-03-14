import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import React, { useRef, useCallback, useEffect } from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  type Index,
  type ListRowProps,
} from "react-virtualized";
import { ResizablePanelGroup, ResizablePanel } from "~/components/ui/resizable";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getTasks,
  createTask,
  updateTaskStatus,
  deleteTask,
  updateTaskConversationIds,
} from "~/services/task.server";
import {
  createEmptyConversation,
  getConversationAndHistory,
} from "~/services/conversation.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
import { Button } from "~/components/ui";
import { PageHeader } from "~/components/common/page-header";
import { NewTaskDialog } from "~/components/tasks/new-task-dialog.client";
import { TaskDetail } from "~/components/tasks/task-detail";
import { cn } from "~/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Plus } from "lucide-react";
import { useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import type { TaskStatus } from "@core/database";
import { TaskStatusIcons } from "~/components/icon-utils";
import { getTaskStatusColor } from "~/components/ui/color-utils";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import { prisma } from "~/db.server";
import { Task } from "~/components/icons/task";

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskRow =
  | { type: "header"; status: TaskStatus; count: number }
  | { type: "item"; task: Awaited<ReturnType<typeof getTasks>>[number] };

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

// ─── Loader / Action ──────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const url = new URL(request.url);
  const selectedTaskId = url.searchParams.get("taskId");

  const [tasks, integrationAccounts] = await Promise.all([
    getTasks(workspaceId),
    getIntegrationAccounts(user.id, workspaceId),
  ]);

  let selectedTask: (typeof tasks)[number] | null = null;
  let conversation: Awaited<
    ReturnType<typeof getConversationAndHistory>
  > | null = null;

  if (selectedTaskId) {
    selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
    if (selectedTask?.conversationIds?.[0]) {
      conversation = await getConversationAndHistory(
        selectedTask.conversationIds[0],
        user.id,
      );
    }
  }

  const integrationAccountMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
  }

  return { tasks, selectedTask, conversation, integrationAccountMap };
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  z.object({
    intent: z.literal("update"),
    taskId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  z.object({
    intent: z.literal("update-status"),
    taskId: z.string(),
    status: z.enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"]),
  }),
  z.object({
    intent: z.literal("delete"),
    taskId: z.string(),
  }),
  z.object({
    intent: z.literal("create-conversation"),
    taskId: z.string(),
  }),
]);

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const formData = await request.formData();
  const parsed = ActionSchema.safeParse({
    intent: formData.get("intent"),
    title: formData.get("title") ?? undefined,
    description: formData.get("description") ?? undefined,
    taskId: formData.get("taskId") ?? undefined,
    status: formData.get("status") ?? undefined,
  });

  if (!parsed.success) return json({ error: "Invalid input" }, { status: 400 });

  if (parsed.data.intent === "create") {
    const task = await createTask(
      workspaceId,
      user.id,
      parsed.data.title,
      parsed.data.description,
    );
    await enqueueTask({ taskId: task.id, workspaceId, userId: user.id });
    return json({ task });
  }

  if (parsed.data.intent === "update") {
    const task = await prisma.task.update({
      where: { id: parsed.data.taskId },
      data: {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      },
    });
    return json({ task });
  }

  if (parsed.data.intent === "update-status") {
    const task = await updateTaskStatus(
      parsed.data.taskId,
      parsed.data.status as TaskStatus,
    );
    return json({ task });
  }

  if (parsed.data.intent === "delete") {
    await deleteTask(parsed.data.taskId, workspaceId);
    return json({ deleted: true });
  }

  if (parsed.data.intent === "create-conversation") {
    const task = await prisma.task.findFirst({
      where: { id: parsed.data.taskId, workspaceId },
    });
    if (!task) return json({ error: "Task not found" }, { status: 404 });

    const conversation = await createEmptyConversation(
      workspaceId,
      user.id,
      task.title,
      task.id,
    );

    await updateTaskConversationIds(task.id, [
      ...(task.conversationIds ?? []),
      conversation.id,
    ]);

    return json({ conversationId: conversation.id });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Task list helpers ────────────────────────────────────────────────────────

function buildRows(tasks: Awaited<ReturnType<typeof getTasks>>): TaskRow[] {
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
        "text-accent-foreground my-2 ml-3 flex w-fit cursor-default items-center rounded-2xl",
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
  task: Awaited<ReturnType<typeof getTasks>>[number];
  selected: boolean;
  onClick: () => void;
  onStatusChange: (status: string) => void;
}) {
  return (
    <a
      onClick={onClick}
      className={cn("group flex cursor-default gap-2 pl-1 pr-2")}
    >
      <div className="flex w-full items-center">
        <div
          className={cn(
            "group-hover:bg-grayAlpha-100 ml-4 flex min-w-[0px] shrink grow items-start gap-2 rounded-xl pl-2 pr-4",
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
                <div className="text-muted-foreground truncate text-left text-sm">
                  {task.description}
                </div>
              </div>
              <div className="flex shrink-0 items-center pr-1">
                <span className="text-muted-foreground text-xs">
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

function TaskListPanel({
  tasks,
  selectedTaskId,
  onSelect,
  onNew,
  onStatusChange,
}: {
  tasks: Awaited<ReturnType<typeof getTasks>>;
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
        <Task className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground text-sm">No tasks yet</p>
        <Button
          size="sm"
          variant="secondary"
          className="rounded"
          onClick={onNew}
        >
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksIndex() {
  const { tasks, selectedTask, conversation, integrationAccountMap } =
    useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [newConversation, setNewConversation] = React.useState(false);

  const selectedTaskId = searchParams.get("taskId");
  const isCreating =
    fetcher.state !== "idle" &&
    (fetcher.formData?.get("intent") as string) === "create";

  const handleSelect = (id: string) => {
    navigate(`?taskId=${id}`, { replace: true });
  };

  const handleCreate = (title: string, description: string) => {
    fetcher.submit(
      { intent: "create", title, description },
      { method: "POST" },
    );
    setDialogOpen(false);
  };

  const handleSave = (title: string, description: string) => {
    if (!selectedTask) return;
    fetcher.submit(
      { intent: "update", taskId: selectedTask.id, title, description },
      { method: "POST" },
    );
  };

  const handleDelete = (taskId: string) => {
    fetcher.submit({ intent: "delete", taskId }, { method: "POST" });
    navigate("?", { replace: true });
  };

  const handleStatusChange = (taskId: string, status: string) => {
    fetcher.submit(
      { intent: "update-status", taskId, status },
      { method: "POST" },
    );
  };

  const handleCreateConversation = () => {
    if (!selectedTask) return;
    fetcher.submit(
      { intent: "create-conversation", taskId: selectedTask.id },
      { method: "POST" },
    );
  };

  // Navigate to newly created task; track new conversation
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      const data = fetcher.data as any;
      if (data.task?.id) {
        navigate(`?taskId=${data.task.id}`, { replace: true });
      }
      if (data.conversationId) {
        setNewConversation(true);
      }
    }
  }, [fetcher.state, fetcher.data]);

  if (typeof window === "undefined") return null;

  return (
    <div className="flex h-[calc(100vh-16px)] flex-col">
      <PageHeader
        title="Tasks"
        actionsNode={
          <Button
            variant="secondary"
            className="gap-2 rounded"
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={16} /> Add task
          </Button>
        }
      />

      <NewTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreate}
        isSubmitting={isCreating}
      />

      {selectedTask ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="w-full flex-1 overflow-hidden"
        >
          <ResizablePanel defaultSize={50} minSize={50} maxSize={50}>
            <div className="h-full overflow-hidden">
              <TaskListPanel
                tasks={tasks}
                selectedTaskId={selectedTaskId}
                onSelect={handleSelect}
                onNew={() => setDialogOpen(true)}
                onStatusChange={handleStatusChange}
              />
            </div>
          </ResizablePanel>

          <ResizablePanel
            defaultSize={50}
            minSize={30}
            maxSize={50}
            className="border-l border-gray-300"
          >
            <TaskDetail
              task={selectedTask}
              conversation={conversation}
              integrationAccountMap={integrationAccountMap}
              onSave={handleSave}
              onDelete={() => handleDelete(selectedTask.id)}
              onCreateConversation={handleCreateConversation}
              onClose={() => navigate("?", { replace: true })}
              isSubmitting={fetcher.state !== "idle"}
              newConversation={newConversation}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-full shrink-0 overflow-hidden border-r">
            <TaskListPanel
              tasks={tasks}
              selectedTaskId={null}
              onSelect={handleSelect}
              onNew={() => setDialogOpen(true)}
              onStatusChange={handleStatusChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
