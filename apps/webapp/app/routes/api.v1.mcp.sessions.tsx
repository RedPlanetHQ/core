import { z } from "zod";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";


const SearchParamsSchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  source: z.string().optional(),
});

const loader = createHybridLoaderApiRoute(
  {
    searchParams: SearchParamsSchema,
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ searchParams, authentication }) => {
    const page = parseInt(searchParams.page);
    const limit = parseInt(searchParams.limit);
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: authentication.userId,
      ...(searchParams.source && { source: searchParams.source }),
    };

    const [sessions, totalCount, sourcesResult, activeSources] =
      await Promise.all([
        prisma.mCPSession.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.mCPSession.count({ where }),
        prisma.mCPSession.groupBy({
          by: ["source"],
          where: { workspaceId: authentication.userId },
          _count: { source: true },
          orderBy: { _count: { source: "desc" } },
        }),
        // Get distinct active sources (where deleted is null)
        prisma.mCPSession.findMany({
          where: { deleted: null, workspaceId: authentication.userId },
          select: { source: true },
          distinct: ["source"],
        }),
      ]);

    const hasMore = skip + sessions.length < totalCount;

    const availableSources = sourcesResult.map((item) => ({
      name: item.source,
      slug: item.source,
      count: item._count.source,
    }));

    const activeSourceNames = activeSources.map((item) => item.source);

    return json({
      sessions: sessions.map((session) => ({
        id: session.id,
        source: session.source,
        integrations: session.integrations,
        createdAt: session.createdAt.toISOString(),
        deleted: session.deleted?.toISOString(),
      })),
      totalCount,
      page,
      limit,
      hasMore,
      availableSources,
      activeSources: activeSourceNames,
    });
  },
);

export { loader };
