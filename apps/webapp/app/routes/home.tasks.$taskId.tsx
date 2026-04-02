import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate, useFetcher } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
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
  getConversationAndHistory,
  readConversation,
} from "~/services/conversation.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getButlerName } from "~/models/workspace.server";
import { findOrCreateTaskPage } from "~/services/page.server";
import { generateCollabToken } from "~/services/collab-token.server";
import { TaskDetailFull } from "~/components/tasks/task-detail-full.client";

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

  let taskConversations: Awaited<ReturnType<typeof getConversationAndHistory>>[] =
    [];
  if (task.conversationIds?.length) {
    const results = await Promise.all(
      task.conversationIds.map((id) =>
        getConversationAndHistory(id, user.id),
      ),
    );
    taskConversations = results.filter(Boolean) as typeof taskConversations;
    await Promise.all(
      taskConversations
        .filter((c) => c?.unread)
        .map((c) => readConversation(c!.id)),
    );
  }

  const integrationAccountMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
  }

  return json({
    task,
    taskConversations,
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
    status: z.enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"]).optional(),
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
    const subtask = await createTask(workspaceId, user.id, parsed.data.title, undefined, {
      status: (parsed.data.status as TaskStatus) ?? "Todo",
      parentTaskId: taskId,
    });
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

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const { task, taskConversations, integrationAccountMap, butlerName, taskPageId, collabToken } =
    useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();

  const handleSave = (title: string) => {
    fetcher.submit(
      { intent: "update", title },
      { method: "POST" },
    );
  };

  const handleStatusChange = (status: string) => {
    fetcher.submit(
      { intent: "update-status", status },
      { method: "POST" },
    );
  };

  const handleDelete = () => {
    fetcher.submit({ intent: "delete" }, { method: "POST" });
  };

  const handleCreateSubtask = (title: string, status: string) => {
    fetcher.submit(
      { intent: "create-subtask", title, status },
      { method: "POST" },
    );
  };

  const handleSubtaskStatusChange = (subtaskId: string, status: string) => {
    fetcher.submit(
      { intent: "update-subtask-status", subtaskId, status },
      { method: "POST" },
    );
  };

  const handleSubtaskDelete = (subtaskId: string) => {
    fetcher.submit(
      { intent: "delete-subtask", subtaskId },
      { method: "POST" },
    );
  };

  if (typeof window === "undefined") return null;

  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      {() => (
        <TaskDetailFull
          task={task}
          conversations={taskConversations}
          integrationAccountMap={integrationAccountMap}
          butlerName={butlerName}
          taskPageId={taskPageId}
          collabToken={collabToken}
          isSubmitting={fetcher.state !== "idle"}
          onSave={handleSave}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
          onCreateSubtask={handleCreateSubtask}
          onSubtaskStatusChange={handleSubtaskStatusChange}
          onSubtaskDelete={handleSubtaskDelete}
          onSubtaskClick={(id) => navigate(`/home/tasks/${id}`)}
        />
      )}
    </ClientOnly>
  );
}
