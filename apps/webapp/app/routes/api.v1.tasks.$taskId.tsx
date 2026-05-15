import { json } from "@remix-run/node";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { getTaskById, updateTask, deleteTask } from "~/services/task.server";
import { detectAndApplyRecurrence } from "~/services/tasks/recurrence.server";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";
import {
  enqueueScheduledTask,
  removeScheduledTask,
} from "~/lib/queue-adapter.server";
import { prisma } from "~/db.server";
import type { TaskStatus } from "@prisma/client";
import z from "zod";

const TaskParamsSchema = z.object({
  taskId: z.string(),
});

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    params: TaskParamsSchema,
  },
  async ({ authentication, params }) => {
    const taskId = params?.taskId as string;
    if (!taskId) return json({ error: "Missing taskId" }, { status: 400 });

    const task = await getTaskById(taskId);
    if (!task || task.workspaceId !== authentication.workspaceId) {
      return json({ error: "Not found" }, { status: 404 });
    }

    let description: string | null = null;
    if (task.pageId) {
      description = await getPageContentAsHtml(task.pageId);
    }

    return json({
      id: task.id,
      status: task.status,
      title: task.title,
      displayId: task.displayId,
      nextRunAt: task.nextRunAt,
      schedule: task.schedule,
      maxOccurrences: task.maxOccurrences,
      occurrenceCount: task.occurrenceCount,
      description,
      subtaskCount: task.subtasks?.length ?? 0,
    });
  },
);

const { action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    params: TaskParamsSchema,
  },
  async ({ authentication, params, request }) => {
    const taskId = params?.taskId as string;
    if (!taskId) return json({ error: "Missing taskId" }, { status: 400 });

    const task = await getTaskById(taskId);
    if (!task || task.workspaceId !== authentication.workspaceId) {
      return json({ error: "Not found" }, { status: 404 });
    }

    if (request.method === "DELETE") {
      await deleteTask(taskId, authentication.workspaceId as string);
      return json({ ok: true });
    }

    const body = (await request.json()) as {
      status?: TaskStatus;
      title?: string;
      description?: string;
      sourcePageId?: string;
      /// ISO timestamp. When passed, replaces the task's wake-up time:
      /// cancels any pending scheduled-task job, updates `nextRunAt` +
      /// `isActive`, and enqueues a fresh job for the new time. Used by
      /// the coding-session "Watch" button to wake core back up in N
      /// minutes against the existing task.
      nextRunAt?: string | null;
    };
    if (
      !body.status &&
      !body.title &&
      body.description === undefined &&
      body.nextRunAt === undefined
    ) {
      return json({ error: "Missing fields" }, { status: 400 });
    }

    const updated = await updateTask(taskId, {
      ...(body.status && { status: body.status }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.sourcePageId && { sourcePageId: body.sourcePageId }),
    });

    // Reschedule side-effect: same shape `createScheduledTask` uses for new
    // tasks — cancel any existing wake-up, set `nextRunAt`, then enqueue.
    if (body.nextRunAt !== undefined) {
      const parsedNextRunAt =
        body.nextRunAt === null ? null : new Date(body.nextRunAt);
      if (
        parsedNextRunAt !== null &&
        Number.isNaN(parsedNextRunAt.getTime())
      ) {
        return json({ error: "Invalid nextRunAt" }, { status: 400 });
      }

      await removeScheduledTask(taskId);
      await prisma.task.update({
        where: { id: taskId },
        data: {
          nextRunAt: parsedNextRunAt,
          ...(parsedNextRunAt !== null && { isActive: true }),
        },
      });
      if (parsedNextRunAt !== null) {
        await enqueueScheduledTask(
          {
            taskId,
            workspaceId: authentication.workspaceId as string,
            userId: task.userId,
            channel: task.channel ?? "email",
          },
          parsedNextRunAt,
        );
      }
    }

    // Feature 2: auto-detect schedule from updated title in background
    // if (body.title !== undefined) {
    //   detectAndApplyRecurrence(
    //     taskId,
    //     authentication.workspaceId as string,
    //     task.userId,
    //     body.title,
    //   );
    // }

    return json({
      id: updated.id,
      status: updated.status,
      title: updated.title,
    });
  },
);

export { loader, action };
