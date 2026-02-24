import { json } from "@remix-run/node";
import { z } from "zod";

import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { getSkill, updateSkill, deleteSkill } from "~/services/skills.server";

const SkillParamsSchema = z.object({
  skillId: z.string(),
});

const UpdateSkillBody = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

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

    const skill = await getSkill(params.skillId, authentication.workspaceId);

    if (!skill) {
      throw new Response("Skill not found", { status: 404 });
    }

    return json({ skill });
  },
);

const { action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    params: SkillParamsSchema,
    corsStrategy: "all",
  },
  async ({ authentication, request, params }) => {
    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    if (request.method === "DELETE") {
      const result = await deleteSkill(
        params.skillId,
        authentication.workspaceId,
      );

      if (!result) {
        throw new Response("Skill not found", { status: 404 });
      }

      return json({ success: true });
    }

    if (request.method === "PATCH") {
      const body = await request.json();
      const validatedData = UpdateSkillBody.parse(body);

      const skill = await updateSkill(
        params.skillId,
        authentication.workspaceId,
        authentication.userId,
        validatedData,
      );

      if (!skill) {
        throw new Response("Skill not found", { status: 404 });
      }

      return json({ skill });
    }

    throw new Response("Method not allowed", { status: 405 });
  },
);

export { action };
