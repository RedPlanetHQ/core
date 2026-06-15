import { useState, useEffect } from "react";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getTasks,
  changeTaskStatus,
  deleteTask,
  createTask,
  createScheduledTask,
} from "~/services/task.server";
import { Button } from "~/components/ui";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { PageHeader } from "~/components/common/page-header";
import { TaskListPanel } from "~/components/tasks/task-list-panel";
import {
  TaskFilterButton,
  StatusFilterChip,
  RecurringFilterChip,
  ViewOptionsButton,
} from "~/components/tasks/task-view-options";
import { Plus, Calendar, Clock, LoaderCircle } from "lucide-react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { z } from "zod";
import type { TaskStatus } from "@core/database";
import {
  getLibraryTasks,
  groupTasksByCategory,
  type LibraryTask,
} from "~/lib/tasks-library";

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
  const libraryTasks = await getLibraryTasks();

  return typedjson({ tasks, libraryTasks });
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
  const intent = formData.get("intent");

  if (intent === "install-library-task") {
    const slug = formData.get("slug") as string;
    const libraryTasks = await getLibraryTasks();
    const task = libraryTasks.find((t) => t.slug === slug);
    if (!task) return json({ error: "Task not found" }, { status: 404 });

    if (task.schedule) {
      await createScheduledTask(workspaceId, user.id, {
        title: task.title,
        description: task.description,
        schedule: task.schedule,
        source: "library",
      });
    } else {
      await createTask(workspaceId, user.id, task.title, task.description, {
        source: "library",
        status: "Ready",
      });
    }
    return json({ success: true });
  }

  const parsed = ActionSchema.safeParse({
    intent,
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
  const { tasks, libraryTasks } = useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const libraryFetcher = useFetcher<{ success: boolean }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"my-tasks" | "library">(
    "my-tasks",
  );
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
  const [pendingDuplicate, setPendingDuplicate] = useState<string | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);

  useEffect(() => {
    if (libraryFetcher.state === "idle" && libraryFetcher.data?.success) {
      setPendingDuplicate(null);
      setPreviewSlug(null);
    }
  }, [libraryFetcher.state, libraryFetcher.data]);

  const handleLibraryDuplicate = (slug: string) => {
    setPendingDuplicate(slug);
    libraryFetcher.submit(
      { intent: "install-library-task", slug },
      { method: "POST" },
    );
  };

  const previewTask = libraryTasks.find((t) => t.slug === previewSlug) ?? null;

  const tabs = [
    {
      label: "My Tasks",
      value: "my-tasks",
      isActive: activeTab === "my-tasks",
      onClick: () => setActiveTab("my-tasks"),
    },
    {
      label: "Library",
      value: "library",
      isActive: activeTab === "library",
      onClick: () => setActiveTab("library"),
    },
  ];

  const libraryByCategory = groupTasksByCategory(libraryTasks);

  const filteredTasks = tasks.filter((t) => {
    if (!showDone && t.status === "Done") return false;
    if (recurringFilter && !t.schedule) return false;
    if (
      activeFilters.length > 0 &&
      !activeFilters.includes(t.status as TaskStatus)
    )
      return false;
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
    <div className="h-page-xs flex flex-col">
      <PageHeader
        title="Tasks"
        tabs={tabs}
        actionsNode={
          activeTab === "my-tasks" ? (
            <Button
              variant="secondary"
              className="gap-2 rounded"
              onClick={() =>
                navigate("/home/conversation?msg=Create+a+new+task")
              }
            >
              <Plus size={16} /> Add task
            </Button>
          ) : undefined
        }
      />

      {activeTab === "my-tasks" && (
        <>
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
                <RecurringFilterChip
                  onRemove={() => setRecurringFilter(false)}
                />
              )}
            </div>
            <ViewOptionsButton
              showDone={showDone}
              onShowDoneChange={setShowDone}
            />
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="w-full overflow-hidden">
              <TaskListPanel
                tasks={filteredTasks}
                selectedTaskId={null}
                onSelect={handleSelect}
                onNew={() =>
                  navigate("/home/conversation?msg=Create+a+new+task")
                }
                onStatusChange={handleStatusChange}
              />
            </div>
          </div>
        </>
      )}

      {activeTab === "library" && (
        <div className="flex flex-1 overflow-y-auto">
          <div className="w-full pb-8">
            {libraryTasks.length === 0 ? (
              <Card className="bg-background-2 mx-3 mt-3 w-auto">
                <CardContent className="flex justify-center py-16">
                  <div className="text-center">
                    <LoaderCircle className="text-primary mx-auto mb-3 h-5 w-5 animate-spin" />
                    <p className="text-muted-foreground text-sm">
                      Loading task library…
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              Object.entries(libraryByCategory).map(
                ([category, tasksInCat]) => (
                  <div key={category}>
                    <Button
                      className="text-accent-foreground bg-grayAlpha-100 my-2 ml-2 mt-3 flex w-fit cursor-default items-center rounded-2xl"
                      size="lg"
                      variant="ghost"
                    >
                      <Clock size={16} className="h-4 w-4" />
                      <h3 className="pl-2">{category}</h3>
                    </Button>
                    {tasksInCat.map((task) => (
                      <LibraryTaskRow
                        key={task.slug}
                        task={task}
                        isPending={pendingDuplicate === task.slug}
                        onDuplicate={() => handleLibraryDuplicate(task.slug)}
                        onPreview={() => setPreviewSlug(task.slug)}
                      />
                    ))}
                  </div>
                ),
              )
            )}
          </div>
        </div>
      )}

      <LibraryTaskPreviewDialog
        task={previewTask}
        open={!!previewTask}
        onOpenChange={(open) => !open && setPreviewSlug(null)}
        isPending={previewTask ? pendingDuplicate === previewTask.slug : false}
        onDuplicate={() =>
          previewTask && handleLibraryDuplicate(previewTask.slug)
        }
      />
    </div>
  );
}

const RRULE_DAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

function formatScheduleLabel(rrule?: string): string {
  if (!rrule) return "One-shot";
  const body = rrule.replace(/^RRULE:/, "");
  const parts: Record<string, string> = {};
  for (const seg of body.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v) parts[k] = v;
  }

  const freq = parts.FREQ;
  const days = parts.BYDAY
    ? parts.BYDAY.split(",")
        .map((d) => RRULE_DAY_LABELS[d] ?? d)
        .join("/")
    : null;

  let time: string | null = null;
  if (parts.BYHOUR) {
    const h = parseInt(parts.BYHOUR, 10);
    const m = parts.BYMINUTE ? parseInt(parts.BYMINUTE, 10) : 0;
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = ((h + 11) % 12) + 1;
    time =
      m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
  }

  const freqLabel =
    freq === "DAILY"
      ? "Daily"
      : freq === "WEEKLY"
        ? days
          ? days
          : "Weekly"
        : freq === "MONTHLY"
          ? "Monthly"
          : freq
            ? freq.charAt(0) + freq.slice(1).toLowerCase()
            : null;

  return [freqLabel, time].filter(Boolean).join(" · ") || "Scheduled";
}

function LibraryTaskRow({
  task,
  isPending,
  onDuplicate,
  onPreview,
}: {
  task: LibraryTask;
  isPending: boolean;
  onDuplicate: () => void;
  onPreview: () => void;
}) {
  const isScheduled = !!task.schedule;
  const scheduleLabel = formatScheduleLabel(task.schedule);

  return (
    <div className="group flex cursor-pointer gap-2 pr-4" onClick={onPreview}>
      <div className="flex w-full items-center">
        <div className="group-hover:bg-grayAlpha-100 ml-4 flex min-w-[0px] shrink grow items-start gap-2 rounded-xl pl-2 pr-2">
          <div className="text-muted-foreground shrink-0 pt-3">
            {isScheduled ? <Clock size={16} /> : <Calendar size={16} />}
          </div>

          <div
            className={cn(
              "border-border flex w-full min-w-[0px] shrink flex-col border-b py-2",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <div className="inline-flex min-w-[0px] shrink items-center justify-start gap-2">
                <div className="truncate text-left">{task.title}</div>
                <Badge
                  variant="secondary"
                  className="shrink-0 gap-1 rounded text-xs font-normal"
                >
                  {scheduleLabel}
                </Badge>
              </div>

              <div
                className="ml-auto flex shrink-0 items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded text-xs"
                  onClick={onDuplicate}
                  disabled={isPending}
                >
                  {isPending ? "Copying..." : "Copy"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryTaskPreviewDialog({
  task,
  open,
  onOpenChange,
  isPending,
  onDuplicate,
}: {
  task: LibraryTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onDuplicate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl md:min-w-[640px]">
        {task && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 pr-8">
                <DialogTitle className="text-lg">{task.title}</DialogTitle>
                <Badge
                  variant="secondary"
                  className="shrink-0 gap-1 rounded text-xs font-normal"
                >
                  {formatScheduleLabel(task.schedule)}
                </Badge>
              </div>
            </DialogHeader>

            <div
              className="prose prose-sm max-h-[60vh] max-w-none overflow-y-auto dark:prose-invert"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: task.description }}
            />

            <DialogFooter>
              <Button
                variant="secondary"
                className="rounded"
                onClick={onDuplicate}
                disabled={isPending}
              >
                {isPending ? "Copying..." : "Copy to my tasks"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
