import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { createCodingSession } from "~/services/coding/coding-session.server";

const CreateCodingSessionSchema = z.object({
  taskId: z.string().optional(),
  conversationId: z.string().optional(),
  gatewayId: z.string().optional(),
  agent: z.string().min(1),
  prompt: z.string().optional(),
  dir: z.string().optional(),
  externalSessionId: z.string().optional(),
  worktreePath: z.string().optional(),
  worktreeBranch: z.string().optional(),
});

const { action } = createHybridActionApiRoute(
  {
    body: CreateCodingSessionSchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const workspaceId = authentication.workspaceId as string;
    const userId = authentication.userId;

    const session = await createCodingSession({
      workspaceId,
      userId,
      ...body,
    });

    return json(session, { status: 201 });
  },
);

export { action };
