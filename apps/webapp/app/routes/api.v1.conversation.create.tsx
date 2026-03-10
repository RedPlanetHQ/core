import { json } from "@remix-run/node";
import { z } from "zod";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { createConversation } from "~/services/conversation.server";

const CreateConversationRequestSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  source: z.string().default("cli"),
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
    console.log(body);
    const result = await createConversation(
      authentication.workspaceId as string,
      authentication.userId,
      {
        message: body.message,
        title: body.title,
        source: body.source,
        parts: [{ text: body.message, type: "text" }],
      },
    );

    return json(result);
  },
);

export { loader, action };
