import { json } from "@remix-run/node";

import {
  getConversationsList,
  GetConversationsListSchema,
} from "~/services/conversation.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

const loader = createHybridLoaderApiRoute(
  {
    searchParams: GetConversationsListSchema,
    allowJWT: true,
    findResource: async () => 1,

    corsStrategy: "all",
  },
  async ({ authentication, searchParams }) => {
    if (!authentication.workspaceId) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    const result = await getConversationsList(
      authentication.workspaceId,
      authentication.userId,
      searchParams ?? {},
    );

    return json(result);
  },
);

export { loader };
