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
    const uniqueDataSources = await prisma.$queryRaw<
      Array<{ source: string }>
    >`
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
      whereClause.labels = {
        has: label,
      };
    }

    // Add cursor condition for pagination
    if (cursor) {
      whereClause.createdAt = {
        lt: new Date(cursor),
      };
    }

    // Fetch logs with over-fetching to handle deduplication
    // We fetch more than needed and deduplicate until we have enough unique items
    const fetchLimit = limit * 3; // Over-fetch to account for duplicates

    const allLogs = await prisma.ingestionQueue.findMany({
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
      take: fetchLimit,
    });

    // Deduplicate by sessionId - keep only the first (latest) log per session
    const seenSessions = new Set<string>();
    const uniqueLogs: typeof allLogs = [];

    for (const log of allLogs) {
      const logSessionId = log.sessionId || (log.data as any)?.sessionId;

      if (!logSessionId) {
        // No sessionId, always include
        uniqueLogs.push(log);
      } else if (!seenSessions.has(logSessionId)) {
        // First time seeing this sessionId
        seenSessions.add(logSessionId);
        uniqueLogs.push(log);
      }
      // else: skip duplicate session

      // Stop once we have enough unique logs
      if (uniqueLogs.length >= limit) {
        break;
      }
    }

    // Get only the requested page size
    const paginatedLogs = uniqueLogs.slice(0, limit);

    // Determine if there are more results
    const hasMore =
      uniqueLogs.length === limit && allLogs.length === fetchLimit;

    // Get unique session IDs from paginated logs
    const sessionIds = [
      ...new Set(allLogs.map((log) => log.sessionId).filter(Boolean)),
    ] as string[];

    // Fetch episode counts for each session
    const sessionEpisodeCounts: Record<string, number> = {};

    if (sessionIds.length > 0) {
      const sessionData = await Promise.all(
        sessionIds.map(async (sessionId: string) => {
          const count = await prisma.ingestionQueue.count({
            where: { sessionId },
          });

          return {
            sessionId: sessionId as string,
            count: count as number,
          };
        }),
      );

      sessionData.forEach(({ sessionId, count }) => {
        sessionEpisodeCounts[sessionId] = count;
      });
    }

    // Format logs
    const formattedLogs = paginatedLogs.map((log: any) => {
      const integrationDef =
        log.activity?.integrationAccount?.integrationDefinition;
      const logData = log.data as any;
      const episodeUUID = (log.output as any)?.episodeUuid;
      const type = logData?.type || "CONVERSATION";
      const sessionIdValue = log.sessionId;

      // Since we fetched the latest log per session, use its data directly
      const title = log.title;
      const labels = log.labels || [];

      // Build episodes array based on type
      let episodes: string[] = [];
      if (type === "DOCUMENT") {
        // DOCUMENT type: use episodes array from output
        const outputEpisodes = (log.output as any)?.episodes || [];
        episodes = outputEpisodes.map((e: any) => e.episodeUuid);
      } else {
        // CONVERSATION type: use episodeUuid if exists
        if (episodeUUID) {
          episodes = [episodeUUID];
        }
      }

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
        episodes,
        isSessionGroup: !!sessionIdValue,
        sessionEpisodeCount: sessionIdValue
          ? sessionEpisodeCounts[sessionIdValue]
          : undefined,
      };
    });

    // Get the cursor for the next page (last item's createdAt)
    const nextCursor =
      paginatedLogs.length > 0
        ? paginatedLogs[paginatedLogs.length - 1].createdAt.toISOString()
        : null;

    return json({
      logs: formattedLogs,
      page,
      limit,
      hasMore,
      nextCursor, // Client uses this for next page instead of page number
      availableSources,
    });
  },
);
