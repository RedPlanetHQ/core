/**
 * internal executor — direct dispatcher for CORE-internal mutations the
 * widget IR knows how to call by name. No LLM, no agent loop. Reserved for
 * fire-and-forget actions where the call signature is fully known.
 *
 * Reads/aggregates do NOT go through here — they go through ai.text /
 * ai.structured (which spawn the Butler with all its tools). Adding an
 * action below is an explicit decision; the schema enum is the allowlist.
 *
 * Keep behavior identical to the equivalent Butler tool in
 * `task-tools.ts` so a widget call and a Butler call produce the same
 * effect on the task graph.
 */

import { evaluateValue } from "~/components/widgets/runtime/expression";
import {
  changeTaskStatus,
  createTask,
  deleteTask,
  getTaskById,
} from "~/services/task.server";
import { findOrCreateTaskPage } from "~/services/page.server";
import { setPageContentFromHtml } from "~/services/hocuspocus/content.server";
import { createEmptyConversation } from "~/services/conversation.server";
import { prisma } from "~/db.server";
import { UserTypeEnum } from "@core/types";
import { getTaskPhase } from "~/services/task.phase";
import type { TaskStatus } from "@prisma/client";
import type { Executor } from "./types";

interface InternalRequest {
  type: "internal";
  action: "create_task" | "delete_task" | "unblock_task";
  params?: Record<string, unknown>;
}

export const internalExecutor: Executor<InternalRequest> = async (
  request,
  ctx,
) => {
  try {
    const params = request.params
      ? (evaluateValue(request.params, ctx.scope) as Record<string, unknown>)
      : {};

    switch (request.action) {
      case "create_task":
        return createTaskAction(params, ctx);
      case "delete_task":
        return deleteTaskAction(params, ctx);
      case "unblock_task":
        return unblockTaskAction(params, ctx);
      default: {
        const exhaustive: never = request.action;
        void exhaustive;
        return {
          ok: false,
          error: `Unknown internal action "${request.action as string}"`,
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ─── create_task ────────────────────────────────────────────────────────────

async function createTaskAction(
  params: Record<string, unknown>,
  ctx: { workspaceId: string; userId: string },
) {
  const title = stringParam(params, "title");
  if (!title) return { ok: false as const, error: "title is required" };

  const description = stringParam(params, "description");
  const parentTaskId = stringParam(params, "parentTaskId") ?? undefined;
  const requestedStatus = stringParam(params, "status");
  const status =
    requestedStatus === "Todo" ||
    requestedStatus === "Waiting" ||
    requestedStatus === "Ready"
      ? (requestedStatus as TaskStatus)
      : ("Todo" as TaskStatus);

  const task = await createTask(ctx.workspaceId, ctx.userId, title, undefined, {
    actor: "agent",
    status,
    ...(parentTaskId && { parentTaskId }),
  });

  if (description) {
    const page = await findOrCreateTaskPage(
      ctx.workspaceId,
      ctx.userId,
      task.id,
    );
    await setPageContentFromHtml(page.id, description);
  }

  return {
    ok: true as const,
    value: { id: task.id, title: task.title, status: task.status },
  };
}

// ─── delete_task ────────────────────────────────────────────────────────────

async function deleteTaskAction(
  params: Record<string, unknown>,
  ctx: { workspaceId: string },
) {
  const taskId = stringParam(params, "taskId");
  if (!taskId) return { ok: false as const, error: "taskId is required" };
  await deleteTask(taskId, ctx.workspaceId);
  return { ok: true as const, value: { id: taskId, deleted: true } };
}

// ─── unblock_task ───────────────────────────────────────────────────────────
//
// Mirrors task-tools.ts unblock_task: appends `reason` as a User reply on
// the task's conversation (creates one if missing) and transitions the task
// from Waiting → Todo (prep phase, no waiting subtasks) or Waiting → Ready
// (otherwise). Behavior must match so a widget-driven approval is
// indistinguishable from a Butler-driven approval downstream.

async function unblockTaskAction(
  params: Record<string, unknown>,
  ctx: { workspaceId: string; userId: string },
) {
  const taskId = stringParam(params, "taskId");
  const reason = stringParam(params, "reason");
  if (!taskId) return { ok: false as const, error: "taskId is required" };
  if (!reason) return { ok: false as const, error: "reason is required" };

  const task = await getTaskById(taskId);
  if (!task) return { ok: false as const, error: `Task ${taskId} not found` };
  if (task.status !== "Waiting") {
    return {
      ok: false as const,
      error: `Task is not Waiting (status: ${task.status})`,
    };
  }

  let conversationId: string | null =
    task.conversationIds[task.conversationIds.length - 1] ?? null;

  if (conversationId) {
    const exists = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!exists) conversationId = null;
  }

  if (!conversationId) {
    const conv = await createEmptyConversation(
      ctx.workspaceId,
      ctx.userId,
      task.title,
      task.id,
    );
    conversationId = conv.id;
    await prisma.task.update({
      where: { id: task.id },
      data: { conversationIds: { push: conv.id } },
    });
  }

  await prisma.conversationHistory.create({
    data: {
      conversationId,
      userType: UserTypeEnum.User,
      message: reason,
      parts: [{ type: "text", text: reason }],
      ...(ctx.userId && { userId: ctx.userId }),
    },
  });

  const phase = getTaskPhase(task);
  const waitingSubtaskCount = await prisma.task.count({
    where: { parentTaskId: taskId, status: "Waiting" },
  });
  const targetStatus =
    phase === "prep" && waitingSubtaskCount === 0 ? "Todo" : "Ready";

  await changeTaskStatus(
    taskId,
    targetStatus as TaskStatus,
    ctx.workspaceId,
    ctx.userId,
    "user",
  );

  return {
    ok: true as const,
    value: { id: taskId, status: targetStatus },
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function stringParam(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = params[key];
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}
