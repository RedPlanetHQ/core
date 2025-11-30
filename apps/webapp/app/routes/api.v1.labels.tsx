import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { LabelService } from "~/services/label.server";
import { getWorkspaceByUser } from "~/models/workspace.server";

// This route handles the OAuth redirect URL generation, similar to the NestJS controller
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    const labelService = new LabelService();
    const workspace = await getWorkspaceByUser(authentication.userId);

    const labels = await labelService.getWorkspaceLabels(
      workspace?.id as string,
    );

    return json(labels);
  },
);

export { loader };
