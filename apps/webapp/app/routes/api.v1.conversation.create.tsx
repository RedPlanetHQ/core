import { json } from "@remix-run/node";
import { z } from "zod";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { createConversation } from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";

const CreateConversationRequestSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  source: z.string().default("cli"),
  incognito: z.boolean().default(false),
  pageId: z.string().optional(),
});

const { loader, action } = createHybridActionApiRoute(
  {
    body: CreateConversationRequestSchema,
    allowJWT: true,
    authorization: {
      action: "conversation",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const result = await createConversation(
      authentication.workspaceId as string,
      authentication.userId,
      {
        message: body.message,
        title: body.title,
        source: body.source,
        incognito: body.incognito,
        parts: [{ text: body.message, type: "text" }],
      },
    );

    if (body.source === "daily" && body.pageId) {
      noStreamProcess(
        {
          id: result.conversationId,
          message: { parts: [{ text: body.message, type: "text" }], role: "user" },
          source: "daily",
          scratchpadPageId: body.pageId,
        },
        authentication.userId,
        authentication.workspaceId as string,
      ).catch((err) => console.error("[daily] Agent processing failed", err));
    }

    return json(result);
  },
);

export { loader, action };
