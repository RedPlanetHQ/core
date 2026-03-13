import { json } from "@remix-run/node";
import { z } from "zod";

import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getConversationAndHistory } from "~/services/conversation.server";

const ParamsSchema = z.object({
  conversationId: z.string(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, params }) => {
    const conversation = await getConversationAndHistory(
      params.conversationId,
      authentication.userId,
    );

    if (!conversation) {
      return json({ error: "Conversation not found" }, { status: 404 });
    }

    return json({
      id: conversation.id,
      title: conversation.title,
      incognito: conversation.incognito,
      ConversationHistory: conversation.ConversationHistory.map((h) => ({
        id: h.id,
        role:
          (h as any).role ?? (h.userType === "Agent" ? "assistant" : "user"),
        parts: h.parts ?? [{ type: "text", text: h.message }],
        createdAt: h.createdAt,
      })),
    });
  },
);

export { loader };
