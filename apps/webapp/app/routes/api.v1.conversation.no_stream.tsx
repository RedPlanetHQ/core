import { z } from "zod";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { noStreamProcess } from "~/services/agent/no-stream-process";

export const ChatRequestSchema = z.object({
  message: z
    .object({
      id: z.string().optional(),
      parts: z.array(z.any()),
      role: z.string(),
    })
    .optional(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        parts: z.array(z.any()),
        role: z.string(),
      }),
    )
    .optional(),
  id: z.string(),
  needsApproval: z.boolean().optional(),

  source: z.string().default("core"),
});

const { loader, action } = createHybridActionApiRoute(
  {
    body: ChatRequestSchema,
    allowJWT: true,
    authorization: {
      action: "conversation",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    
    const assistantMessage = await noStreamProcess(body, authentication.userId, authentication.workspaceId as string);
    // Return simple JSON response
    return Response.json({
      message: assistantMessage,
      conversationId: body.id,
    });
  },
);

export { loader, action };
