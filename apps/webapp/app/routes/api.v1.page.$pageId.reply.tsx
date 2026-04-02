import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";

const ParamsSchema = z.object({ pageId: z.string() });

const { loader, action } = createHybridActionApiRoute(
  {
    body: z.object({
      conversationId: z.string(),
      message: z.string(),
    }),
    allowJWT: true,
    corsStrategy: "all",
    params: ParamsSchema,
  },
  async ({ body, authentication, params }) => {
    noStreamProcess(
      {
        id: body.conversationId,
        message: { parts: [{ text: body.message, type: "text" }], role: "user" },
        source: "daily",
        scratchpadPageId: params.pageId,
      },
      authentication.userId,
      authentication.workspaceId as string,
    ).catch((err) => console.error("[daily-reply] Agent processing failed", err));

    return json({ ok: true });
  },
);

export { loader, action };
