import { json } from "@remix-run/node";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { getTaskById, updateTask } from "~/services/task.server";
import type { TaskStatus } from "@prisma/client";
import z from "zod";

// Schema for space ID parameter
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

    return json({ id: task.id, status: task.status });
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

    const body = (await request.json()) as {
      status?: TaskStatus;
      title?: string;
    };
    if (!body.status && !body.title) {
      return json({ error: "Missing fields" }, { status: 400 });
    }

    const updated = await updateTask(taskId, {
      ...(body.status && { status: body.status }),
      ...(body.title !== undefined && { title: body.title }),
    });
    return json({
      id: updated.id,
      status: updated.status,
      title: updated.title,
    });
  },
);

export { loader, action };
