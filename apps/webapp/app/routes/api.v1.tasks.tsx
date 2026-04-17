import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import {
  searchTasks,
  getTasks,
  createTask,
  createScheduledTask,
} from "~/services/task.server";
import { findOrCreateTaskPage } from "~/services/page.server";
import { setPageContentFromHtml } from "~/services/hocuspocus/content.server";
import { detectAndApplyRecurrence } from "~/services/tasks/recurrence.server";
import type { TaskStatus } from "@prisma/client";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    searchParams: z.object({
      search: z.string().optional(),
      status: z
        .enum(["Todo", "Waiting", "Ready", "Working", "Review", "Done"])
        .optional(),
    }),
  },
  async ({ authentication, searchParams }) => {
    const workspaceId = authentication.workspaceId as string;

    if (searchParams?.search) {
      const tasks = await searchTasks(workspaceId, searchParams.search);
      return json(tasks);
    }

    const tasks = await getTasks(workspaceId, {
      status: searchParams?.status as TaskStatus | undefined,
    });
    return json(tasks);
  },
);

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.string().default("manual"),
  status: z
    .enum(["Todo", "Waiting", "Ready", "Working", "Review", "Done"])
    .default("Todo"),
  parentTaskId: z.string().optional(),
  // Scheduling: pass schedule (RRule) for recurring/relative reminders, or
  // nextRunAt (ISO string) for a specific point-in-time reminder
  schedule: z.string().optional(),
  nextRunAt: z.string().optional(),
  maxOccurrences: z.number().optional(),
});

const { action } = createHybridActionApiRoute(
  {
    body: CreateTaskSchema,
    allowJWT: true,
    authorization: { action: "tasks" },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const workspaceId = authentication.workspaceId as string;
    const userId = authentication.userId;

    // If schedule or nextRunAt is provided, create a scheduled task
    if (body.schedule || body.nextRunAt) {
      const task = await createScheduledTask(workspaceId, userId, {
        title: body.title,
        description: body.description,
        source: body.source,
        parentTaskId: body.parentTaskId,
        ...(body.schedule && { schedule: body.schedule }),
        ...(body.nextRunAt && { nextRunAt: new Date(body.nextRunAt) }),
        maxOccurrences: body.maxOccurrences ?? 1,
      });
      return json(task);
    }

    const task = await createTask(
      workspaceId,
      userId,
      body.title,
      undefined,
      {
        source: body.source,
        status: body.status,
        parentTaskId: body.parentTaskId,
      },
    );

    if (body.description) {
      const page = await findOrCreateTaskPage(workspaceId, userId, task.id);
      await setPageContentFromHtml(page.id, body.description);
    }

    // Feature 2: auto-detect schedule from title in background
    detectAndApplyRecurrence(task.id, workspaceId, userId, task.title);

    return json(task);
  },
);

export { loader, action };
