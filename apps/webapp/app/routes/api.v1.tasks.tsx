import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { z } from "zod";
import { searchTasks } from "~/services/task.server";

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

export { loader };
