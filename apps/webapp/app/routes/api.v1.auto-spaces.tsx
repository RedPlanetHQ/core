import { json } from "@remix-run/node";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { enqueueBertTopicAnalysis } from "~/lib/queue-adapter.server";
import { getWorkspaceByUser } from "~/models/workspace.server";

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
    const workspace = await getWorkspaceByUser(authentication.userId);

    if (!workspace) {
      return json({ error: true });
    }

    const response = await enqueueBertTopicAnalysis({
      userId: authentication.userId,
      workspaceId: workspace.id,
    });

    return json(response);
  },
);

export { action, loader };
