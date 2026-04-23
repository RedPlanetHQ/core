import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import {
  clearActiveStreamId,
  updateConversationStatus,
} from "~/services/conversation.server";
import { stopStream } from "~/services/agent/stream-registry.server";
import { logger } from "~/services/logger.service";

const ParamsSchema = z.object({
  conversationId: z.string(),
});

const { action, loader } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ params, authentication }) => {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: params.conversationId,
        userId: authentication.userId,
        deleted: null,
      },
      select: { activeStreamId: true, status: true },
    });

    if (!conversation) {
      return json({ ok: false, reason: "not_found" }, { status: 404 });
    }

    if (!conversation.activeStreamId) {
      return json({ ok: true, reason: "no_active_stream" });
    }

    logger.info("[conversation] stop requested", {
      conversationId: params.conversationId,
      streamId: conversation.activeStreamId,
    });

    await stopStream(conversation.activeStreamId, "user_stopped");
    await updateConversationStatus(params.conversationId, "cancelled");
    await clearActiveStreamId(params.conversationId);

    return json({ ok: true });
  },
);

export { action, loader };
