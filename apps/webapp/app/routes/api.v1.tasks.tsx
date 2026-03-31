import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute, createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { searchTasks, createTask } from "~/services/task.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    searchParams: z.object({ search: z.string().optional() }),
  },
  async ({ authentication, searchParams }) => {
    if (!searchParams?.search) return json([]);

    const tasks = await searchTasks(
      authentication.workspaceId as string,
      searchParams.search,
    );

    return json(tasks);
  },
);

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  pageId: z.string().optional(),
  source: z.string().default("manual"),
  status: z.enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"]).default("Backlog"),
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
      { pageId: body.pageId, source: body.source, status: body.status },
    );

    return json(task);
  },
);

export { loader, action };
