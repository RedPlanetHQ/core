import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import {
  CreatedAtCursor,
  encodeCreatedAtCursor,
} from "~/services/created-at-cursor";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

const ActivitiesSearchParams = z.object({
  limit: z.string().optional(),
  source: z.string().optional(),
  cursor: CreatedAtCursor.optional(),
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: ActivitiesSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const limit = parseInt(searchParams.limit || "25");
    const source = searchParams.source;
    const cursor = searchParams.cursor;

    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Get available sources from integration accounts that have activities
    const integrationAccounts = await prisma.integrationAccount.findMany({
      where: {
        workspaceId: authentication.workspaceId,
        Activity: { some: { deleted: null } },
      },
      select: {
        integrationDefinition: {
          select: { name: true, slug: true, icon: true },
        },
      },
      distinct: ["integrationDefinitionId"],
    });

    const availableSources = integrationAccounts
      .filter((a) => a.integrationDefinition)
      .map((a) => ({
        name: a.integrationDefinition.name,
        slug: a.integrationDefinition.slug,
        icon: a.integrationDefinition.icon,
      }));

    // Build where clause
    const whereClause: Record<string, unknown> = {
      workspaceId: authentication.workspaceId,
      deleted: null,
    };

    if (source) {
      whereClause.integrationAccount = {
        integrationDefinition: { slug: source },
      };
    }

    if (cursor?.id) {
      whereClause.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    } else if (cursor) {
      whereClause.createdAt = { lt: cursor.createdAt };
    }

    const activities = await prisma.activity.findMany({
      where: whereClause as any,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: {
        integrationAccount: {
          select: {
            integrationDefinition: {
              select: { name: true, slug: true, icon: true },
            },
          },
        },
      },
    });

    const hasMore = activities.length === limit;
    const lastActivity = activities[activities.length - 1];
    const nextCursor = lastActivity
      ? encodeCreatedAtCursor(lastActivity)
      : null;

    return json({ activities, hasMore, nextCursor, availableSources });
  },
);
