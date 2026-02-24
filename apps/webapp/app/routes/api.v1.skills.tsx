import { json } from "@remix-run/node";
import { z } from "zod";

import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { listSkills, createSkill } from "~/services/skills.server";

const SkillsSearchParams = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

const CreateSkillBody = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  source: z.string().default("manual"),
  labelIds: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: SkillsSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    const limit = parseInt(searchParams.limit || "50");
    const result = await listSkills(authentication.workspaceId, {
      limit,
      cursor: searchParams.cursor,
    });

    return json(result);
  },
);

const { action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ authentication, request }) => {
    if (request.method !== "POST") {
      throw new Response("Method not allowed", { status: 405 });
    }

    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    const body = await request.json();
    const validatedData = CreateSkillBody.parse(body);

    const skill = await createSkill(
      authentication.workspaceId,
      authentication.userId,
      validatedData,
    );

    return json({ skill }, { status: 201 });
  },
);

export { action };
