import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";

import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";

// Schema for skills search parameters
const SkillsSearchParams = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// Schema for creating a skill
const CreateSkillBody = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  source: z.string().default("manual"),
  labelIds: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional(),
});

// GET - List all skills (documents with type=skill)
export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: SkillsSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const limit = parseInt(searchParams.limit || "50");
    const cursor = searchParams.cursor;

    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Build where clause for filtering skills
    const whereClause: {
      workspaceId: string;
      type: string;
      deleted?: null;
      createdAt?: { lt: Date };
    } = {
      workspaceId: authentication.workspaceId,
      type: "skill",
      deleted: null,
    };

    // Add cursor condition for pagination
    if (cursor) {
      whereClause.createdAt = {
        lt: new Date(cursor),
      };
    }

    // Fetch skills with pagination
    const [skills, totalCount] = await Promise.all([
      prisma.document.findMany({
        where: whereClause,
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      }),
      prisma.document.count({
        where: {
          workspaceId: authentication.workspaceId,
          type: "skill",
          deleted: null,
        },
      }),
    ]);

    // Check if there are more results
    const hasMore = skills.length === limit && totalCount > skills.length;

    // Get the cursor for the next page
    const nextCursor =
      skills.length > 0
        ? skills[skills.length - 1].createdAt.toISOString()
        : null;

    return json({
      skills,
      hasMore,
      nextCursor,
      totalCount,
    });
  },
);

// POST - Create a new skill
export const action = createHybridActionApiRoute(
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

    const skill = await prisma.document.create({
      data: {
        title: validatedData.title,
        content: validatedData.content,
        source: validatedData.source,
        type: "skill",
        labelIds: validatedData.labelIds,
        metadata: validatedData.metadata ?? {} as any,
        editedBy: authentication.userId,
        workspaceId: authentication.workspaceId,
      },
    });

    return json({ skill }, { status: 201 });
  },
);
