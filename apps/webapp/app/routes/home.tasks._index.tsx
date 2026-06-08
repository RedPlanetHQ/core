import { useState, useEffect } from "react";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import { prisma } from "~/db.server";
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
import { PageHeader } from "~/components/common/page-header";
import { TaskListPanel } from "~/components/tasks/task-list-panel";
import {
  TaskFilterButton,
  StatusFilterChip,
  RecurringFilterChip,
  ViewOptionsButton,
} from "~/components/tasks/task-view-options";
import { Plus, Calendar, Clock, Check, LoaderCircle } from "lucide-react";
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

  // Map librarySlug → taskId so the Library tab can show "Installed" badges
  // without a per-card lookup.
  const installs = await prisma.task.findMany({
    where: { workspaceId, source: "library" },
    select: { id: true, metadata: true },
  });
  const installedLibrarySlugs: Record<string, string> = {};
  for (const t of installs) {
    const meta = t.metadata as { librarySlug?: string } | null;
    if (meta?.librarySlug) installedLibrarySlugs[meta.librarySlug] = t.id;
  }

  return typedjson({ tasks, libraryTasks, installedLibrarySlugs });
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

  // Library-tab intents are handled before the discriminated-union parse
  // so they can stay loosely typed (their form bodies differ from the
  // task-management intents). Returns `{ success: true }` on success to
  // match the skills-library install/uninstall response shape.
  if (intent === "install-library-task") {
    const slug = formData.get("slug") as string;
    const libraryTasks = await getLibraryTasks();
    const task = libraryTasks.find((t) => t.slug === slug);
    if (!task) return json({ error: "Task not found" }, { status: 404 });

    // tasks.json descriptions are already authored as HTML — pass them
    // straight through to setPageContentFromHtml. No wrap or escape.
    if (task.schedule) {
      await createScheduledTask(workspaceId, user.id, {
        title: task.title,
        description: task.description,
        schedule: task.schedule,
        source: "library",
        metadata: { librarySlug: slug },
      });
    } else {
      const created = await createTask(
        workspaceId,
        user.id,
        task.title,
        task.description,
        { source: "library", status: "Ready" },
      );
      // createTask doesn't accept metadata; backfill so the loader can mark
      // this slug as installed on next render.
      await prisma.task.update({
        where: { id: created.id },
        data: { metadata: { librarySlug: slug } },
      });
    }
    return json({ success: true });
  }

  if (intent === "uninstall-library-task") {
    const taskId = formData.get("taskId") as string;
    await deleteTask(taskId, workspaceId);
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
  const { tasks, libraryTasks, installedLibrarySlugs } =
    useTypedLoaderData<typeof loader>();
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
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  useEffect(() => {
    if (
      libraryFetcher.state === "idle" &&
      libraryFetcher.data?.success
    ) {
      setPendingInstall(null);
      setPendingRemove(null);
    }
  }, [libraryFetcher.state, libraryFetcher.data]);

  const handleLibraryInstall = (slug: string) => {
    setPendingInstall(slug);
    libraryFetcher.submit(
      { intent: "install-library-task", slug },
      { method: "POST" },
    );
  };

  const handleLibraryUninstall = (taskId: string, slug: string) => {
    setPendingRemove(slug);
    libraryFetcher.submit(
      { intent: "uninstall-library-task", taskId },
      { method: "POST" },
    );
  };

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
        <div className="flex flex-1 justify-center overflow-y-auto px-5 pt-3">
          <div className="w-full max-w-3xl space-y-5 pb-8">
            {libraryTasks.length === 0 ? (
              <Card className="bg-background-2 w-full">
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
              Object.entries(libraryByCategory).map(([category, tasksInCat]) => (
                <div key={category} className="space-y-2">
                  <h3 className="text-muted-foreground/80 text-sm font-medium">
                    {category}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {tasksInCat.map((task) => (
                      <LibraryTaskCard
                        key={task.slug}
                        task={task}
                        installedTaskId={installedLibrarySlugs[task.slug]}
                        isInstalling={pendingInstall === task.slug}
                        isRemoving={pendingRemove === task.slug}
                        onInstall={() => handleLibraryInstall(task.slug)}
                        onUninstall={() =>
                          handleLibraryUninstall(
                            installedLibrarySlugs[task.slug],
                            task.slug,
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LibraryTaskCard({
  task,
  installedTaskId,
  isInstalling,
  isRemoving,
  onInstall,
  onUninstall,
}: {
  task: LibraryTask;
  installedTaskId?: string;
  isInstalling: boolean;
  isRemoving: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const isInstalled = !!installedTaskId;
  const isScheduled = !!task.schedule;

  return (
    <Card className="hover:border-primary/50 flex flex-col transition-all">
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <Badge
            variant="secondary"
            className="flex items-center gap-1 rounded text-xs"
          >
            {isScheduled ? <Clock size={10} /> : <Calendar size={10} />}
            {isScheduled ? "Scheduled" : "One-shot"}
          </Badge>
          {isInstalled && (
            <Badge className="text-success rounded bg-green-100 text-xs">
              <Check size={10} />
              Installed
            </Badge>
          )}
        </div>

        <div className="text-md font-medium">{task.title}</div>
        <p className="text-muted-foreground line-clamp-4 flex-1 text-sm">
          {task.description}
        </p>

        <div className="mt-auto flex justify-end pt-2">
          {isInstalled ? (
            <Button
              variant="destructive"
              className="rounded"
              onClick={onUninstall}
              disabled={isRemoving}
            >
              {isRemoving ? "Removing..." : "Remove"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="rounded"
              onClick={onInstall}
              disabled={isInstalling}
            >
              {isInstalling ? "Installing..." : "Install"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
