import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { LabelService } from "~/services/label.server";


// This route handles the OAuth redirect URL generation, similar to the NestJS controller
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    const labelService = new LabelService();


    const labels = await labelService.getWorkspaceLabels(
      authentication.workspaceId as string,
    );

    return json(labels);
  },
);

export { loader };
