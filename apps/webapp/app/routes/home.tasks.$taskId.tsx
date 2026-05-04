import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import {
  Outlet,
  useNavigate,
  useFetcher,
  useLocation,
  useNavigation,
} from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle, Trash2, MessageSquare } from "lucide-react";
import {
  CodingActionsProvider,
  CodingActions,
} from "~/components/coding/coding-actions-context";
import { z } from "zod";
import type { TaskStatus } from "@core/database";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getTaskFull,
  createTask,
  updateTask,
  changeTaskStatus,
  deleteTask,
} from "~/services/task.server";
import { getTaskRuns } from "~/services/conversation.server";
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
import { hasCodingSessions } from "~/services/coding/coding-session.server";
import { getChannels } from "~/services/channel.server";
import {
  getWidgetOptions,
  getOrCreateWidgetPat,
} from "~/services/widgets.server";
import { getButlerName } from "~/models/workspace.server";
import { findOrCreateTaskPage } from "~/services/page.server";
import { generateCollabToken } from "~/services/collab-token.server";
import { PageHeader } from "~/components/common/page-header";
import { Button } from "~/components/ui/button";
import { DeleteTaskDialog } from "~/components/tasks/delete-task-dialog";
import { ScheduleDialog } from "~/components/tasks/schedule-dialog";
import { TaskChatPanel } from "~/components/tasks/task-chat-panel.client";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";
import React, { useState } from "react";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.task?.title;
  return [{ title: title ? `${title} | Tasks` : "Tasks" }];
};

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

  const [
    task,
    integrationAccounts,
    butlerName,
    runs,

    widgetOptions,
    widgetPat,
    channels,
  ] = await Promise.all([
    getTaskFull(taskId, workspaceId),
    getIntegrationAccounts(user.id, workspaceId),
    getButlerName(workspaceId),
    getTaskRuns(taskId, workspaceId),

    getWidgetOptions(user.id, workspaceId),
    getOrCreateWidgetPat(workspaceId, user.id),
    getChannels(workspaceId),
  ]);

  if (!task) return redirect("/home/tasks");

  const taskPage = await findOrCreateTaskPage(workspaceId, user.id, taskId);

  const integrationAccountMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
  }

  const integrationFrontendMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    if (acc.integrationDefinition.frontendUrl) {
      integrationFrontendMap[acc.id] = acc.integrationDefinition.frontendUrl;
    }
  }

  const defaultChannel =
    channels.find((c) => c.isDefault) ?? channels[0] ?? null;

  return typedjson({
    task,
    integrationAccountMap,
    integrationFrontendMap,
    butlerName,
    taskPageId: taskPage.id,
    collabToken: generateCollabToken(workspaceId, user.id),
    runs,

    widgetOptions,
    widgetPat,
    baseUrl: new URL(request.url).origin,
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      isDefault: c.isDefault,
    })),
    defaultChannelName: defaultChannel?.name ?? null,
  });
}

// ─── Action ───────────────────────────────────────────────────────────────────

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update"),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    channelId: z.string().optional(),
  }),
  z.object({
    intent: z.literal("update-status"),
    status: z.enum(["Todo", "Waiting", "Ready", "Working", "Review", "Done"]),
  }),
  z.object({
    intent: z.literal("delete"),
  }),
  z.object({
    intent: z.literal("create-subtask"),
    title: z.string().min(1),
    status: z
      .enum([
        "Backlog",
        "Planning",
        "Waiting",
        "Ready",
        "Working",
        "Review",
        "Done",
      ])
      .optional(),
  }),
  z.object({
    intent: z.literal("update-subtask-status"),
    subtaskId: z.string(),
    status: z.enum(["Todo", "Waiting", "Ready", "Working", "Review", "Done"]),
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
    channelId: formData.get("channelId") ?? undefined,
  });

  if (!parsed.success) return json({ error: "Invalid input" }, { status: 400 });

  if (parsed.data.intent === "update") {
    let resolvedChannel: { channel: string | null; channelId: string | null } | undefined;
    if (parsed.data.channelId !== undefined) {
      if (parsed.data.channelId === "") {
        resolvedChannel = { channel: null, channelId: null };
      } else {
        const channel = await prisma.channel.findFirst({
          where: { id: parsed.data.channelId, workspaceId, isActive: true },
        });
        if (!channel) {
          return json({ error: "Channel not found" }, { status: 404 });
        }
        resolvedChannel = { channel: channel.type, channelId: channel.id };
      }
    }

    const task = await updateTask(taskId, {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
      ...(resolvedChannel !== undefined && {
        channel: resolvedChannel.channel,
        channelId: resolvedChannel.channelId,
      }),
    });

    if (resolvedChannel !== undefined && task.isActive && task.nextRunAt) {
      await removeScheduledTask(taskId);
      await enqueueScheduledTask(
        {
          taskId,
          workspaceId,
          userId: user.id,
          channel: task.channel ?? "email",
        },
        task.nextRunAt,
      );
    }

    if (parsed.data.title) {
      detectAndApplyRecurrence(taskId, workspaceId, user.id, parsed.data.title);
    }
    return json({ task });
  }

  if (parsed.data.intent === "update-status") {
    const task = await changeTaskStatus(
      taskId,
      parsed.data.status as TaskStatus,
      workspaceId,
      user.id,
      "user",
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
        status: (parsed.data.status as TaskStatus) ?? "Todo",
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
      "user",
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
  const { task, hasCoding, runs, integrationAccountMap } =
    useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const fetcher = useFetcher<typeof action>();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [taskChatOpen, setTaskChatOpen] = useState(
    task.status === "Waiting" || task.status === "Review",
  );

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

  const activePath = navigation.location?.pathname ?? location.pathname;
  const isRunsTab = activePath.endsWith("/runs");
  const isCodingTab = /\/coding(\/|$)/.test(activePath);
  const isBrowserTab = /\/browser(\/|$)/.test(activePath);
  const isRecurring = !!task.schedule && (task.occurrenceCount ?? 0) > 1;

  const toggleTaskChat = () => setTaskChatOpen((v) => !v);

  React.useEffect(() => {
    if (isRunsTab && taskChatOpen) {
      setTaskChatOpen(false);
    }
  }, [isRunsTab]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setTaskChatOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CodingActionsProvider>
      <div className="h-page-xs flex flex-col">
        <PageHeader
          title={task.title || "Untitled"}
          breadcrumbs={breadcrumbs}
          tabs={[
            {
              label: "Info",
              value: "info",
              isActive: !isRunsTab && !isCodingTab && !isBrowserTab,
              onClick: () => navigate(`/home/tasks/${task.id}`),
            },

            {
              label: "Code",
              value: "coding",
              isActive: isCodingTab,
              onClick: () => navigate(`/home/tasks/${task.id}/coding`),
            },

            {
              label: "Browser",
              value: "browser",
              isActive: isBrowserTab,
              onClick: () => navigate(`/home/tasks/${task.id}/browser`),
            },

            ...(isRecurring
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
          showChatToggle={false}
          actionsNode={
            isCodingTab ? (
              <CodingActions />
            ) : (
              <>
                <Button
                  variant="ghost"
                  isActive={taskChatOpen}
                  className="gap-1.5 rounded"
                  onClick={toggleTaskChat}
                >
                  <MessageSquare size={14} />
                  <span className="hidden md:inline">Chat</span>
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive gap-2 rounded"
                  onClick={() => setDeleteOpen(true)}
                  disabled={fetcher.state !== "idle"}
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </>
            )
          }
        />

        <ResizablePanelGroup
          orientation="horizontal"
          className="flex-1 overflow-hidden"
        >
          <ResizablePanel
            id="task-detail"
            defaultSize={
              taskChatOpen && !isCodingTab && !isBrowserTab ? "50%" : "100%"
            }
            minSize="50%"
          >
            <div className="flex h-full overflow-hidden">
              <Outlet />
            </div>
          </ResizablePanel>
          {taskChatOpen && !isCodingTab && !isBrowserTab && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="task-chat"
                defaultSize="50%"
                minSize="25%"
                maxSize="50%"
              >
                <TaskChatPanel
                  runs={runs}
                  integrationAccountMap={integrationAccountMap}
                  onClose={() => setTaskChatOpen(false)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        <DeleteTaskDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={() =>
            fetcher.submit({ intent: "delete" }, { method: "POST" })
          }
        />

        {scheduleOpen && (
          <ScheduleDialog
            onClose={() => setScheduleOpen(false)}
            taskId={task.id}
          />
        )}
      </div>
    </CodingActionsProvider>
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
