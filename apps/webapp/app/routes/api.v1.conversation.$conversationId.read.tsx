import { json } from "@remix-run/node";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { getWorkspaceByUser } from "~/models/workspace.server";
import { readConversation } from "~/services/conversation.server";
import { z } from "zod";

export const ConversationIdSchema = z.object({
  conversationId: z.string(),
});

const { action, loader } = createActionApiRoute(
  {
    params: ConversationIdSchema,
    allowJWT: true,
    authorization: {
      action: "oauth",
    },
    corsStrategy: "all",
  },
  async ({ authentication, params }) => {
    const workspace = await getWorkspaceByUser(authentication.userId);

    if (!workspace) {
      throw new Error("No workspace found");
    }

    // Call the service to get the redirect URL
    const read = await readConversation(params.conversationId);

    return json(read);
  },
);

export { action, loader };
