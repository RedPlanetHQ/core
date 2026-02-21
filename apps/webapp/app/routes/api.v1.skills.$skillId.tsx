import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";

import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

// Schema for skill ID params
const SkillParamsSchema = z.object({
  skillId: z.string(),
});

// GET - Get a single skill by ID
export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    params: SkillParamsSchema,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, params }) => {
    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    const skill = await prisma.document.findFirst({
      where: {
        id: params.skillId,
        workspaceId: authentication.workspaceId,
        type: "skill",
        deleted: null,
      },
    });

    if (!skill) {
      throw new Response("Skill not found", { status: 404 });
    }

    return json({ skill });
  },
);
