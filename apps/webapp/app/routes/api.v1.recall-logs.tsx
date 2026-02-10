import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

// Schema for recall logs search parameters
const RecallLogsSearchParams = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  query: z.string().optional(),
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: RecallLogsSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const page = parseInt(searchParams.page || "1");
    const limit = parseInt(searchParams.limit || "100");
    const query = searchParams.query;
    const skip = (page - 1) * limit;


    if (!authentication.userId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Build where clause for filtering
    const whereClause: any = {
      workspaceId: authentication.workspaceId,
      deleted: null,
    };

    if (query) {
      whereClause.query = {
        contains: query,
        mode: "insensitive",
      };
    }

    const [recallLogs, totalCount] = await Promise.all([
      prisma.recallLog.findMany({
        where: whereClause,
        select: {
          id: true,
          createdAt: true,
          accessType: true,
          query: true,
          targetType: true,
          targetId: true,
          searchMethod: true,
          resultCount: true,
          similarityScore: true,
          source: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),

      prisma.recallLog.count({
        where: whereClause,
      }),
    ]);

    return json({
      recallLogs,
      totalCount,
      page,
      limit,
      hasMore: skip + recallLogs.length < totalCount,
    });
  },
);
