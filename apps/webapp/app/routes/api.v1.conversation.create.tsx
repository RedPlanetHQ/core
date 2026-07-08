import { json } from "@remix-run/node";
import { z } from "zod";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { createConversation } from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { hasCredits } from "~/trigger/utils/utils";
import { isWorkspaceBYOK } from "~/services/byok.server";
import { logger } from "~/services/logger.service";

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
    const workspaceId = authentication.workspaceId as string;

    // Pre-flight credit check. BYOK workspaces bypass — they pay their own
    // provider bills. Otherwise refuse to create a conversation that will
    // trigger a model call the workspace can't afford. Mirrors the gate in
    // `noStreamProcess` and `api.v1.conversation._index` so callers get the
    // same 402 regardless of which entry point they hit.
    if (workspaceId) {
      const workspaceHasBYOK = await isWorkspaceBYOK(workspaceId);
      if (!workspaceHasBYOK) {
        const ok = await hasCredits(
          workspaceId,
          authentication.userId,
          "chatMessage",
        );
        if (!ok) {
          logger.warn(
            `[conversation.create] Insufficient credits for ${authentication.userId}; refusing`,
          );
          return json(
            {
              error:
                "You're out of credits. Upgrade your plan or add a top-up to keep chatting.",
              code: "no_credits",
            },
            { status: 402 },
          );
        }
      }
    }

    const result = await createConversation(
      workspaceId,
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
        workspaceId,
      ).catch((err) => console.error("[daily] Agent processing failed", err));
    }

    return json(result);
  },
);

export { loader, action };
