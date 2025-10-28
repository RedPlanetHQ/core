import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { discoverThematicSpaces } from "~/services/clustering.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

// Schema for logs search parameters
const LogsSearchParams = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  sessionId: z.string().optional(),
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: LogsSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const page = parseInt(searchParams.page || "1");
    const limit = parseInt(searchParams.limit || "100");
    const source = searchParams.source;
    const status = searchParams.status;
    const type = searchParams.type;
    const sessionId = searchParams.sessionId;
    const skip = (page - 1) * limit;

    // Simple - just pass userId
    const result = await discoverThematicSpaces({
      userId: "cmc1w8xke000xo51vffqcn2mt",
    });

    // Access the results
    console.log(result.proposals); // Space proposals from LLM
    console.log(result.stats); // Overall statistics

    // Get user and workspace in one query
    const user = await prisma.user.findUnique({
      where: { id: authentication.userId },
      select: { Workspace: { select: { id: true } } },
    });

    if (!user?.Workspace) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Build where clause for filtering
    const whereClause: any = {
      workspaceId: user.Workspace.id,
    };

    if (status) {
      whereClause.status = status;
    }

    if (type) {
      whereClause.data = {
        path: ["type"],
        equals: type,
      };
    }

    if (sessionId) {
      whereClause.data = {
        path: ["sessionId"],
        equals: sessionId,
      };
    }

    // If source filter is provided, filter by integration source
    if (source) {
      whereClause.activity = {
        integrationAccount: {
          integrationDefinition: {
            slug: source,
          },
        },
      };
    }

    // Use select to fetch only required fields for logs
    const [logs, totalCount, availableSources] = await Promise.all([
      prisma.ingestionQueue.findMany({
        where: whereClause,
        select: {
          id: true,
          createdAt: true,
          processedAt: true,
          status: true,
          error: true,
          type: true,
          output: true,
          data: true,
          activity: {
            select: {
              text: true,
              sourceURL: true,
              integrationAccount: {
                select: {
                  integrationDefinition: {
                    select: {
                      name: true,
                      slug: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),

      prisma.ingestionQueue.count({
        where: whereClause,
      }),

      prisma.integrationDefinitionV2.findMany({
        where: {
          IntegrationAccount: {
            some: {
              workspaceId: user.Workspace.id,
            },
          },
        },
        select: {
          name: true,
          slug: true,
        },
      }),
    ]);

    // Format the response
    const formattedLogs = logs.map((log) => {
      const integrationDef =
        log.activity?.integrationAccount?.integrationDefinition;
      const logData = log.data as any;

      return {
        id: log.id,
        source: integrationDef?.name || logData?.source || "Unknown",
        ingestText:
          log.activity?.text ||
          logData?.episodeBody ||
          logData?.text ||
          "No content",
        time: log.createdAt,
        processedAt: log.processedAt,
        episodeUUID: (log.output as any)?.episodeUuid,
        status: log.status,
        error: log.error,
        sourceURL: log.activity?.sourceURL,
        integrationSlug: integrationDef?.slug,
        data: log.data,
      };
    });

    return json({
      logs: formattedLogs,
      totalCount,
      page,
      limit,
      hasMore: skip + logs.length < totalCount,
      availableSources,
    });
  },
);
