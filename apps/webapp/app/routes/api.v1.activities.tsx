import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

const ActivitiesSearchParams = z.object({
  limit: z.string().optional(),
  source: z.string().optional(),
  cursor: z.string().optional(), // ISO date for cursor-based pagination
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

    if (cursor) {
      whereClause.createdAt = { lt: new Date(cursor) };
    }

    const activities = await prisma.activity.findMany({
      where: whereClause as any,
      orderBy: { createdAt: "desc" },
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
    const nextCursor =
      activities.length > 0
        ? activities[activities.length - 1].createdAt.toISOString()
        : null;

    return json({ activities, hasMore, nextCursor, availableSources });
  },
);
