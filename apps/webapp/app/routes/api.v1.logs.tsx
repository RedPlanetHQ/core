import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";

import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

// Schema for logs search parameters
const LogsSearchParams = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  sessionId: z.string().optional(),
  label: z.string().optional(),
  cursor: z.string().optional(), // cursor for pagination (createdAt timestamp)
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
    const limit = parseInt(searchParams.limit || "50");
    const source = searchParams.source;
    const status = searchParams.status;
    const type = searchParams.type;
    const sessionId = searchParams.sessionId;
    const label = searchParams.label;
    const cursor = searchParams.cursor; // Cursor is a createdAt timestamp

    // Get user and workspace in one query
    const user = await prisma.user.findUnique({
      where: { id: authentication.userId },
      select: { Workspace: { select: { id: true } } },
    });

    if (!user?.Workspace) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Get all unique sources from integration accounts
    const integrationAccounts = await prisma.integrationAccount.findMany({
      where: {
        workspaceId: user.Workspace.id,
      },
      select: {
        integrationDefinition: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      distinct: ["integrationDefinitionId"],
    });

    // Get unique sources from ingestion logs data field using raw SQL
    const uniqueDataSources = await prisma.$queryRaw<Array<{ source: string }>>`
      SELECT DISTINCT (data->>'source')::text as source
      FROM "IngestionQueue"
      WHERE "workspaceId" = ${user.Workspace.id}
      AND (data->>'source')::text IS NOT NULL
    `;

    // Combine both sources
    const sourcesMap = new Map<string, { name: string; slug: string }>();

    // Add integration account sources
    integrationAccounts.forEach((account) => {
      if (account.integrationDefinition) {
        const { name, slug } = account.integrationDefinition;
        if (name && slug) {
          sourcesMap.set(slug, { name, slug });
        }
      }
    });

    // Add data field sources
    uniqueDataSources.forEach(({ source }) => {
      if (source) {
        const slug = source.toLowerCase().replace(/\s+/g, "-");
        if (!sourcesMap.has(slug)) {
          sourcesMap.set(slug, { name: source, slug });
        }
      }
    });

    const availableSources = Array.from(sourcesMap.values());

    // Build where clause for filtering
    const whereClause: any = {
      workspaceId: user.Workspace.id,
    };

    if (sessionId) {
      whereClause.sessionId = sessionId;
    }

    if (source) {
      whereClause.source = source;
    }

    if (status) {
      whereClause.status = status;
    }

    if (type) {
      whereClause.type = type;
    }

    if (label) {
      if (label === "no_label") {
        whereClause.labels = {
          isEmpty: true,
        };
      } else {
        whereClause.labels = {
          has: label,
        };
      }
    }

    // Add cursor condition for pagination
    if (cursor) {
      whereClause.createdAt = {
        lt: new Date(cursor),
      };
    }

    // Fetch logs with simple pagination - no deduplication
    const [logs, totalCount] = await Promise.all([
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
          title: true,
          labels: true,
          data: true,
          sessionId: true,
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
        take: limit,
        distinct: "sessionId",
      }),
      prisma.ingestionQueue.count({
        where: whereClause,
      }),
    ]);

    // Get session counts for all sessionIds in the result
    const sessionIds = logs
      .map((log) => log.sessionId)
      .filter((id): id is string => id !== null);

    const sessionCounts =
      sessionIds.length > 0
        ? await prisma.ingestionQueue.groupBy({
            by: ["sessionId"],
            where: {
              workspaceId: user.Workspace.id,
              sessionId: {
                in: sessionIds,
              },
            },
            _count: {
              sessionId: true,
            },
          })
        : [];

    // Create a map for quick lookup
    const sessionCountMap = new Map(
      sessionCounts.map((sc) => [sc.sessionId, sc._count.sessionId]),
    );

    // Check if there are more results for hasMore flag
    const hasMore = logs.length === limit && totalCount > limit;

    // Format logs
    const formattedLogs = logs.map((log: any) => {
      const integrationDef =
        log.activity?.integrationAccount?.integrationDefinition;
      const logData = log.data as any;
      const episodeUUID = (log.output as any)?.episodeUuid;
      const type = logData?.type || "CONVERSATION";
      const sessionIdValue = log.sessionId;

      const title = log.title;
      const labels = log.labels || [];

      const sessionCount = sessionIdValue
        ? sessionCountMap.get(sessionIdValue) || 0
        : 0;

      return {
        id: log.id,
        source: integrationDef?.name || logData?.source || "Unknown",
        title,
        labels,
        ingestText:
          log.activity?.text ||
          logData?.episodeBody ||
          logData?.text ||
          "No content",
        time: log.createdAt,
        processedAt: log.processedAt,
        episodeUUID,
        status: log.status,
        error: log.error,
        sourceURL: log.activity?.sourceURL,
        integrationSlug: integrationDef?.slug,
        data: log.data,
        sessionId: sessionIdValue,
        type,
        episodes: log.graphIds,
        isSessionGroup: !!sessionIdValue,
        sessionEpisodeCount: sessionIdValue ? sessionCount : undefined,
      };
    });

    // Get the cursor for the next page (last item's createdAt)
    const nextCursor =
      logs.length > 0 ? logs[logs.length - 1].createdAt.toISOString() : null;

    return json({
      logs: formattedLogs,
      page,
      limit,
      hasMore,
      nextCursor, // Client uses this for next page instead of page number
      availableSources,
      totalCount,
    });
  },
);
