import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute, createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { searchTasks, getTasks, createTask } from "~/services/task.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    searchParams: z.object({ search: z.string().optional() }),
  },
  async ({ authentication, searchParams }) => {
    const workspaceId = authentication.workspaceId as string;

    if (!searchParams?.search) {
      const tasks = await getTasks(workspaceId);
      return json(tasks);
    }

    const tasks = await searchTasks(workspaceId, searchParams.search);
    return json(tasks);
  },
);

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  pageId: z.string().optional(),
  source: z.string().default("manual"),
  status: z.enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"]).default("Backlog"),
  parentTaskId: z.string().optional(),
});

const { action } = createHybridActionApiRoute(
  {
    body: CreateTaskSchema,
    allowJWT: true,
    authorization: { action: "tasks" },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const task = await createTask(
      authentication.workspaceId as string,
      authentication.userId,
      body.title,
      undefined,
      {
        pageId: body.pageId,
        source: body.source,
        status: body.status,
        parentTaskId: body.parentTaskId,
      },
    );

    return json(task);
  },
);

export { loader, action };
