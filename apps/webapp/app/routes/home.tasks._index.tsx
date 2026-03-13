import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useParams,
  Link,
} from "@remix-run/react";
import { useState } from "react";
import { Plus, ListTodo, CheckSquare2, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getTasks, createTask } from "~/services/task.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
import { updateTaskStatus } from "~/services/task.server";
import { Button } from "~/components/ui";
import { PageHeader } from "~/components/common/page-header";
import { cn } from "~/lib/utils";
import type { TaskStatus } from "@prisma/client";
import { z } from "zod";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  );
  const tasks = await getTasks(workspaceId as string);
  return json({ tasks });
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  z.object({
    intent: z.literal("update-status"),
    taskId: z.string(),
    status: z.enum(["Backlog", "Todo", "InProcess", "Review", "Completed"]),
  }),
]);

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  );

  const formData = await request.formData();
  const raw = {
    intent: formData.get("intent"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    taskId: formData.get("taskId"),
    status: formData.get("status"),
  };

  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Invalid input" }, { status: 400 });
  }

  const data = parsed.data;

  if (data.intent === "create") {
    const task = await createTask(
      workspaceId as string,
      user.id,
      data.title,
      data.description,
    );
    await enqueueTask({
      taskId: task.id,
      workspaceId: workspaceId as string,
      userId: user.id,
    });
    return json({ task });
  }

  if (data.intent === "update-status") {
    const task = await updateTaskStatus(data.taskId, data.status as TaskStatus);
    return json({ task });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

const STATUS_ORDER: TaskStatus[] = [
  "InProcess",
  "Review",
  "Todo",
  "Backlog",
  "Completed",
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  InProcess: "In Process",
  Review: "Review",
  Todo: "Todo",
  Backlog: "Backlog",
  Completed: "Completed",
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const colors: Record<TaskStatus, string> = {
    InProcess: "bg-blue-100 text-blue-700",
    Review: "bg-yellow-100 text-yellow-700",
    Todo: "bg-purple-100 text-purple-700",
    Backlog: "bg-gray-100 text-gray-600",
    Completed: "bg-green-100 text-green-700",
  };
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs font-medium",
        colors[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function TasksIndex() {
  const { tasks } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const params = useParams();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const isCreating = fetcher.state !== "idle";

  const grouped = STATUS_ORDER.reduce(
    (acc, status) => {
      acc[status] = tasks.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TaskStatus, typeof tasks>,
  );

  const handleCreate = () => {
    if (!title.trim()) return;
    fetcher.submit(
      { intent: "create", title: title.trim(), description },
      { method: "POST" },
    );
    setTitle("");
    setDescription("");
    setShowForm(false);
  };

  return (
    <div className="flex h-full">
      {/* Left panel — task list */}
      <div className="flex w-80 shrink-0 flex-col border-r">
        <PageHeader title="Tasks">
          <Button
            variant="ghost"
            size="sm"
            className="rounded"
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus size={16} />
          </Button>
        </PageHeader>

        {showForm && (
          <div className="border-b p-3">
            <input
              autoFocus
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <textarea
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              placeholder="Description (optional)"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                className="rounded"
                onClick={handleCreate}
                disabled={!title.trim() || isCreating}
              >
                {isCreating ? <Loader2 size={14} className="animate-spin" /> : "Create"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 && !showForm ? (
            <div className="mt-20 flex flex-col items-center gap-2 px-4 text-center">
              <ListTodo className="text-muted-foreground h-8 w-8" />
              <p className="text-muted-foreground text-sm">No tasks yet</p>
              <Button
                size="sm"
                variant="secondary"
                className="rounded"
                onClick={() => setShowForm(true)}
              >
                <Plus size={14} className="mr-1" /> New task
              </Button>
            </div>
          ) : (
            STATUS_ORDER.map((status) => {
              const group = grouped[status];
              if (group.length === 0) return null;
              return (
                <div key={status}>
                  <div className="text-muted-foreground sticky top-0 bg-background px-3 py-1 text-xs font-medium uppercase tracking-wide">
                    {STATUS_LABELS[status]} ({group.length})
                  </div>
                  {group.map((task) => (
                    <Link
                      key={task.id}
                      to={`/home/tasks/${task.id}`}
                      className={cn(
                        "flex flex-col gap-1 border-b px-3 py-2 text-sm hover:bg-accent",
                        params.taskId === task.id && "bg-accent",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{task.title}</span>
                        <StatusBadge status={task.status as TaskStatus} />
                      </div>
                      {task.description && (
                        <span className="text-muted-foreground line-clamp-1 text-xs">
                          {task.description}
                        </span>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {formatDistanceToNow(new Date(task.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — empty state */}
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckSquare2 className="text-muted-foreground h-10 w-10" />
          <p className="text-muted-foreground text-sm">Select a task to view its conversation</p>
        </div>
      </div>
    </div>
  );
}
