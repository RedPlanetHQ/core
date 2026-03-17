import { json } from "@remix-run/node";
import {
  createActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";

import { readConversation } from "~/services/conversation.server";
import { z } from "zod";

export const ConversationIdSchema = z.object({
  conversationId: z.string(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: ConversationIdSchema,
    allowJWT: true,
    findResource: async () => 1,

    corsStrategy: "all",
  },
  async ({ authentication, params }) => {
    if (!authentication.workspaceId) {
      throw new Error("No workspace found");
    }

    // Call the service to get the redirect URL
    const read = await readConversation(params.conversationId);

    return json(read);
  },
);

export { loader };
