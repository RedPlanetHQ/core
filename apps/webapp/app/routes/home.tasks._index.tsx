import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getTasks, changeTaskStatus, deleteTask } from "~/services/task.server";
import { Button } from "~/components/ui";
import { PageHeader } from "~/components/common/page-header";
import { TaskListPanel } from "~/components/tasks/task-list-panel";
import {
  TaskFilterButton,
  StatusFilterChip,
  RecurringFilterChip,
  ViewOptionsButton,
} from "~/components/tasks/task-view-options";
import { Plus } from "lucide-react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { z } from "zod";
import type { TaskStatus } from "@core/database";

// ─── Loader / Action ──────────────────────────────────────────────────────────

export const meta = () => [{ title: "Tasks" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const tasks = await getTasks(workspaceId);
  return typedjson({ tasks });
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update-status"),
    taskId: z.string(),
    status: z.enum(["Todo", "Waiting", "Ready", "Working", "Review", "Done"]),
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
    taskId: formData.get("taskId") ?? undefined,
    status: formData.get("status") ?? undefined,
  });

  if (!parsed.success) return json({ error: "Invalid input" }, { status: 400 });

  if (parsed.data.intent === "update-status") {
    const task = await changeTaskStatus(
      parsed.data.taskId,
      parsed.data.status as TaskStatus,
      workspaceId,
      user.id,
      "user",
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
  const [activeFilters, setActiveFilters] = useLocalCommonState<TaskStatus[]>(
    "task-status-filters",
    [],
  );
  const [recurringFilter, setRecurringFilter] = useLocalCommonState<boolean>(
    "task-recurring-filter",
    false,
  );
  const [showDone, setShowDone] = useLocalCommonState<boolean>(
    "task-show-done",
    true,
  );

  const filteredTasks = tasks.filter((t) => {
    if (!showDone && t.status === "Done") return false;
    if (recurringFilter && !t.schedule) return false;
    if (activeFilters.length > 0 && !activeFilters.includes(t.status as TaskStatus)) return false;
    return true;
  });

  const handleSelect = (id: string) => {
    navigate(`/home/tasks/${id}`);
  };

  const handleStatusChange = (taskId: string, status: string) => {
    fetcher.submit(
      { intent: "update-status", taskId, status },
      { method: "POST" },
    );
  };

  if (typeof window === "undefined") return null;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <PageHeader
        title="Tasks"
        actionsNode={
          <Button
            variant="secondary"
            className="gap-2 rounded"
            onClick={() => navigate("/home/conversation?msg=Create+a+new+task")}
          >
            <Plus size={16} /> Add task
          </Button>
        }
      />

      <div className="mb-1 flex w-full items-center justify-between gap-2 px-3 pt-3">
        <div className="flex items-center gap-2">
          <TaskFilterButton
            activeFilters={activeFilters}
            recurringFilter={recurringFilter}
            onChange={setActiveFilters}
            onRecurringChange={setRecurringFilter}
          />
          {activeFilters.map((status) => (
            <StatusFilterChip
              key={status}
              status={status}
              onRemove={() =>
                setActiveFilters(activeFilters.filter((s) => s !== status))
              }
            />
          ))}
          {recurringFilter && (
            <RecurringFilterChip onRemove={() => setRecurringFilter(false)} />
          )}
        </div>
        <ViewOptionsButton showDone={showDone} onShowDoneChange={setShowDone} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-full overflow-hidden">
          <TaskListPanel
            tasks={filteredTasks}
            selectedTaskId={null}
            onSelect={handleSelect}
            onNew={() => navigate("/home/conversation?msg=Create+a+new+task")}
            onStatusChange={handleStatusChange}
          />
        </div>
      </div>
    </div>
  );
}
