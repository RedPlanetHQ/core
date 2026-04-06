import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useNavigate, useFetcher, useLocation } from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle, Trash2 } from "lucide-react";
import { z } from "zod";
import type { TaskStatus } from "@core/database";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getTaskFull,
  createTask,
  changeTaskStatus,
  deleteTask,
} from "~/services/task.server";
import { prisma } from "~/db.server";
import {
  removeScheduledTask,
  enqueueScheduledTask,
} from "~/lib/queue-adapter.server";
import {
  extractScheduleFromText,
  applyScheduleToTask,
  detectAndApplyRecurrence,
} from "~/services/tasks/recurrence.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getButlerName } from "~/models/workspace.server";
import { findOrCreateTaskPage } from "~/services/page.server";
import { generateCollabToken } from "~/services/collab-token.server";
import { PageHeader } from "~/components/common/page-header";
import { Button } from "~/components/ui/button";
import { DeleteTaskDialog } from "~/components/tasks/delete-task-dialog";
import { ScheduleDialog } from "~/components/tasks/schedule-dialog";
import React from "react";

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

  const [task, integrationAccounts, butlerName] = await Promise.all([
    getTaskFull(taskId, workspaceId),
    getIntegrationAccounts(user.id, workspaceId),
    getButlerName(workspaceId),
  ]);

  if (!task) return redirect("/home/tasks");

  const taskPage = await findOrCreateTaskPage(workspaceId, user.id, taskId);

  const integrationAccountMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
  }

  return typedjson({
    task,
    integrationAccountMap,
    butlerName,
    taskPageId: taskPage.id,
    collabToken: generateCollabToken(workspaceId, user.id),
  });
}

// ─── Action ───────────────────────────────────────────────────────────────────

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update"),
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  z.object({
    intent: z.literal("update-status"),
    status: z.enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"]),
  }),
  z.object({
    intent: z.literal("delete"),
  }),
  z.object({
    intent: z.literal("create-subtask"),
    title: z.string().min(1),
    status: z
      .enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"])
      .optional(),
  }),
  z.object({
    intent: z.literal("update-subtask-status"),
    subtaskId: z.string(),
    status: z.enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"]),
  }),
  z.object({
    intent: z.literal("delete-subtask"),
    subtaskId: z.string(),
  }),
  z.object({
    intent: z.literal("update-schedule"),
    text: z.string().optional(),
    startTime: z.string().optional(),
    currentTime: z.string().optional(),
  }),
  z.object({
    intent: z.literal("remove-schedule"),
  }),
]);

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { taskId } = params;
  if (!taskId) return json({ error: "Missing taskId" }, { status: 400 });

  const formData = await request.formData();
  const parsed = ActionSchema.safeParse({
    intent: formData.get("intent"),
    title: formData.get("title") ?? undefined,
    description: formData.get("description") ?? undefined,
    status: formData.get("status") ?? undefined,
    subtaskId: formData.get("subtaskId") ?? undefined,
    text: formData.get("text") ?? undefined,
    startTime: formData.get("startTime") ?? undefined,
    currentTime: formData.get("currentTime") ?? undefined,
  });

  if (!parsed.success) return json({ error: "Invalid input" }, { status: 400 });

  if (parsed.data.intent === "update") {
    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      },
    });
    detectAndApplyRecurrence(taskId, workspaceId, user.id, parsed.data.title);
    return json({ task });
  }

  if (parsed.data.intent === "update-status") {
    const task = await changeTaskStatus(
      taskId,
      parsed.data.status as TaskStatus,
      workspaceId,
      user.id,
    );
    return json({ task });
  }

  if (parsed.data.intent === "delete") {
    await deleteTask(taskId, workspaceId);
    return redirect("/home/tasks");
  }

  if (parsed.data.intent === "create-subtask") {
    const subtask = await createTask(
      workspaceId,
      user.id,
      parsed.data.title,
      undefined,
      {
        status: (parsed.data.status as TaskStatus) ?? "Backlog",
        parentTaskId: taskId,
      },
    );
    return json({ subtask });
  }

  if (parsed.data.intent === "update-subtask-status") {
    const task = await changeTaskStatus(
      parsed.data.subtaskId,
      parsed.data.status as TaskStatus,
      workspaceId,
      user.id,
    );
    return json({ task });
  }

  if (parsed.data.intent === "delete-subtask") {
    await deleteTask(parsed.data.subtaskId, workspaceId);
    return json({ deleted: true });
  }

  if (parsed.data.intent === "update-schedule") {
    const { text, startTime, currentTime } = parsed.data;

    if (startTime) {
      const nextRunAt = new Date(startTime);
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      await prisma.task.update({
        where: { id: taskId },
        data: { schedule: null, nextRunAt, isActive: true, maxOccurrences: 1 },
      });
      await removeScheduledTask(taskId);
      await enqueueScheduledTask(
        {
          taskId,
          workspaceId,
          userId: user.id,
          channel: task?.channel ?? "email",
        },
        nextRunAt,
      );
    } else if (text) {
      const time = currentTime ?? new Date().toISOString();
      const result = await extractScheduleFromText(text, time, workspaceId);
      if (result) {
        await applyScheduleToTask(taskId, workspaceId, user.id, result);
      }
    }

    return json({ success: true });
  }

  if (parsed.data.intent === "remove-schedule") {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        schedule: null,
        nextRunAt: null,
        isActive: false,
        startDate: null,
        maxOccurrences: null,
      },
    });
    await removeScheduledTask(taskId);
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function TaskDetailLayout() {
  const { task } = useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher<typeof action>();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  const truncate = (s: string, max = 24) =>
    s.length > max ? s.slice(0, max) + "…" : s;

  const breadcrumbs = [
    { label: "Tasks", href: "/home/tasks" },
    ...(task.parentTask
      ? [
          {
            label: truncate(task.parentTask.title),
            href: `/home/tasks/${task.parentTask.id}`,
          },
        ]
      : []),
    { label: truncate(task.title || "Untitled") },
  ];

  const isRunsTab = location.pathname.endsWith("/runs");
  const isScheduled = task.isActive && (task.schedule || task.nextRunAt);

  return (
    <div className="flex h-[calc(100vh-16px)] flex-col">
      <PageHeader
        title={task.title || "Untitled"}
        breadcrumbs={breadcrumbs}
        tabs={[
          {
            label: "Info",
            value: "info",
            isActive: !isRunsTab,
            onClick: () => navigate(`/home/tasks/${task.id}`),
          },
          ...(isScheduled
            ? [
                {
                  label: "Runs",
                  value: "runs",
                  isActive: isRunsTab,
                  onClick: () => navigate(`/home/tasks/${task.id}/runs`),
                },
              ]
            : []),
        ]}
        actionsNode={
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive gap-2 rounded"
            onClick={() => setDeleteOpen(true)}
            disabled={fetcher.state !== "idle"}
          >
            <Trash2 size={14} /> Delete
          </Button>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>

      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() =>
          fetcher.submit({ intent: "delete" }, { method: "POST" })
        }
      />

      {scheduleOpen && (
        <ScheduleDialog onClose={() => setScheduleOpen(false)} taskId={task.id} />
      )}
    </div>
  );
}

export default function TaskDetailPage() {
  if (typeof window === "undefined") return null;

  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      {() => <TaskDetailLayout />}
    </ClientOnly>
  );
}
