import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useNavigate, useRevalidator, useSearchParams } from "@remix-run/react";
import React, { useEffect, useRef } from "react";
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
  readConversation,
} from "~/services/conversation.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
import { Button } from "~/components/ui";
import { PageHeader } from "~/components/common/page-header";
import { NewTaskDialog } from "~/components/tasks/new-task-dialog.client";
import { TaskDetail } from "~/components/tasks/task-detail";
import { TaskListPanel } from "~/components/tasks/task-list-panel";
import {
  TaskViewOptions,
  DEFAULT_VISIBLE,
} from "~/components/tasks/task-view-options";
import { Plus } from "lucide-react";
import { useTypedLoaderData } from "remix-typedjson";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { z } from "zod";
import type { TaskStatus } from "@core/database";
import { prisma } from "~/db.server";

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
      if (conversation?.unread) {
        await readConversation(conversation.id);
      }
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
    // When moved to Todo, enqueue the task for the agent to pick up
    if (parsed.data.status === "Todo") {
      await enqueueTask({ taskId: task.id, workspaceId, userId: user.id });
    }
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksIndex() {
  const { tasks, selectedTask, conversation, integrationAccountMap } =
    useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [newConversation, setNewConversation] = React.useState(false);
  const [visibleStatuses, setVisibleStatuses] = useLocalCommonState<TaskStatus[]>(
    "task-view-filter",
    DEFAULT_VISIBLE,
  );

  const filteredTasks = tasks.filter((t) =>
    visibleStatuses.includes(t.status as TaskStatus),
  );

  const selectedTaskId = searchParams.get("taskId");

  // Poll loader every 3s while selected task is InProgress
  const { revalidate } = useRevalidator();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (selectedTask?.status === "InProgress") {
      pollRef.current = setInterval(() => revalidate(), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedTask?.id, selectedTask?.status]);

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
          <div className="flex items-center gap-2">
            <TaskViewOptions
              visibleStatuses={visibleStatuses}
              onChange={setVisibleStatuses}
            />
            <Button
              variant="secondary"
              className="gap-2 rounded"
              onClick={() => setDialogOpen(true)}
            >
              <Plus size={16} /> Add task
            </Button>
          </div>
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
                tasks={filteredTasks}
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
              tasks={filteredTasks}
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
