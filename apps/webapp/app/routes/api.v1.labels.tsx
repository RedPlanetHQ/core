import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { z } from "zod";

import { LabelService } from "~/services/label.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    searchParams: z.object({ search: z.string().optional() }),
  },
  async ({ authentication, searchParams }) => {
    const labelService = new LabelService();

    const labels = await labelService.getWorkspaceLabels(
      authentication.workspaceId as string,
      searchParams?.search,
    );

    return json(labels);
  },
);

export { loader };
