import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";

import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";

// Schema for skill ID params
const SkillParamsSchema = z.object({
  skillId: z.string(),
});

// Schema for updating a skill
const UpdateSkillBody = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
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

// PATCH/DELETE - Update or delete a skill
export const action = createHybridActionApiRoute(
  {
    allowJWT: true,
    params: SkillParamsSchema,
    corsStrategy: "all",
  },
  async ({ authentication, request, params }) => {
    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Find the skill first
    const existingSkill = await prisma.document.findFirst({
      where: {
        id: params.skillId,
        workspaceId: authentication.workspaceId,
        type: "skill",
        deleted: null,
      },
    });

    if (!existingSkill) {
      throw new Response("Skill not found", { status: 404 });
    }

    if (request.method === "DELETE") {
      await prisma.document.update({
        where: { id: params.skillId },
        data: { deleted: new Date() },
      });

      return json({ success: true });
    }

    if (request.method === "PATCH") {
      const body = await request.json();
      const validatedData = UpdateSkillBody.parse(body);

      const skill = await prisma.document.update({
        where: { id: params.skillId },
        data: {
          ...(validatedData.title && { title: validatedData.title }),
          ...(validatedData.content && { content: validatedData.content }),
          ...(validatedData.metadata && {
            metadata: {
              ...(existingSkill.metadata as Record<string, unknown> ?? {}),
              ...validatedData.metadata,
            },
          }),
          editedBy: authentication.userId,
        },
      });

      return json({ skill });
    }

    throw new Response("Method not allowed", { status: 405 });
  },
);
