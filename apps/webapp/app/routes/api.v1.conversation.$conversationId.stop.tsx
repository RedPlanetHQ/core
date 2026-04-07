import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getConversation,
  updateConversationStatus,
} from "~/services/conversation.server";
import { logger } from "~/services/logger.service";

const ParamsSchema = z.object({
  conversationId: z.string(),
});

const { loader, action } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    authorization: { action: "conversation" },
    corsStrategy: "all",
    method: "POST",
  },
  async ({ params, authentication }) => {
    const conversation = await getConversation(
      params.conversationId,
      authentication.userId,
    );

    if (!conversation) {
      return json({ error: "Conversation not found" }, { status: 404 });
    }

    if (conversation.status === "running") {
      await updateConversationStatus(params.conversationId, "completed");
      logger.info(
        `[conversation] stopped by user, conversationId=${params.conversationId}`,
      );
    }

    return json({ ok: true, status: "completed" });
  },
);

export { loader, action };
