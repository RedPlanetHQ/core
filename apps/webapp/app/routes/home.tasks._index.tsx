import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import React from "react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getTasks,
  createTask,
  changeTaskStatus,
  deleteTask,
} from "~/services/task.server";
import { Button } from "~/components/ui";
import { PageHeader } from "~/components/common/page-header";
import { NewTaskDialog } from "~/components/tasks/new-task-dialog.client";
import { TaskListPanel } from "~/components/tasks/task-list-panel";
import {
  TaskViewOptions,
  DEFAULT_VISIBLE,
} from "~/components/tasks/task-view-options";
import { Plus } from "lucide-react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { z } from "zod";
import type { TaskStatus } from "@core/database";
import { ClientOnly } from "remix-utils/client-only";

// ─── Loader / Action ──────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const tasks = await getTasks(workspaceId, { isScheduled: false });
  return typedjson({ tasks });
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(["Backlog", "Todo", "Completed"]).optional(),
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
      { status: parsed.data.status as TaskStatus | undefined },
    );
    return json({ task });
  }

  if (parsed.data.intent === "update-status") {
    const task = await changeTaskStatus(
      parsed.data.taskId,
      parsed.data.status as TaskStatus,
      workspaceId,
      user.id,
    );
    return json({ task });
  }

  if (parsed.data.intent === "delete") {
    await deleteTask(parsed.data.taskId, workspaceId);
    return json({ deleted: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksIndex() {
  const { tasks } = useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [visibleStatuses, setVisibleStatuses] = useLocalCommonState<
    TaskStatus[]
  >("task-view-filter", DEFAULT_VISIBLE);

  const filteredTasks = tasks.filter((t) =>
    visibleStatuses.includes(t.status as TaskStatus),
  );

  const isCreating =
    fetcher.state !== "idle" &&
    (fetcher.formData?.get("intent") as string) === "create";

  const handleSelect = (id: string) => {
    navigate(`/home/tasks/${id}`);
  };

  const handleCreate = (title: string, description: string, status: string) => {
    fetcher.submit(
      { intent: "create", title, description, status },
      { method: "POST" },
    );
    setDialogOpen(false);
  };

  const handleStatusChange = (taskId: string, status: string) => {
    fetcher.submit(
      { intent: "update-status", taskId, status },
      { method: "POST" },
    );
  };

  if (typeof window === "undefined") return null;

  return (
    <div className="flex h-[calc(100vh-16px)] flex-col">
      <PageHeader
        title="Tasks"
        tabs={[
          {
            label: "Tasks",
            value: "tasks",
            isActive: true,
            onClick: () => navigate("/home/tasks"),
          },
          {
            label: "Scheduled",
            value: "scheduled",
            isActive: false,
            onClick: () => navigate("/home/tasks/scheduled"),
          },
        ]}
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

      <ClientOnly fallback={null}>
        {() => (
          <NewTaskDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSubmit={handleCreate}
            isSubmitting={isCreating}
          />
        )}
      </ClientOnly>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-full overflow-hidden">
          <TaskListPanel
            tasks={filteredTasks}
            selectedTaskId={null}
            onSelect={handleSelect}
            onNew={() => setDialogOpen(true)}
            onStatusChange={handleStatusChange}
          />
        </div>
      </div>
    </div>
  );
}
