import { json } from "@remix-run/node";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { enqueueBertTopicAnalysis } from "~/lib/queue-adapter.server";


const { action, loader } = createHybridActionApiRoute(
  {
    allowJWT: true,
    method: "POST",
    authorization: {
      action: "auto-spaces",
    },
    corsStrategy: "all",
  },
  async ({ authentication }) => {


    if (!authentication.workspaceId) {
      return json({ error: true });
    }

    const response = await enqueueBertTopicAnalysis({
      userId: authentication.userId,
      workspaceId: authentication.workspaceId,
    });

    return json(response);
  },
);

export { action, loader };
