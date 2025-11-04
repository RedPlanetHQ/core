import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { type LogItem } from "~/hooks/use-logs";

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

    // Fetch paginated logs directly from database
    const [allLogs, totalCount] = await Promise.all([
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
          // title: true,
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
        skip: skip,
        take: limit,
      }),
      prisma.ingestionQueue.count({
        where: whereClause,
      }),
    ]);

    // Get unique session IDs from logs
    const sessionIds = [
      ...new Set(
        allLogs
          .map((log: LogItem) => (log.data as any)?.sessionId)
          .filter((id: string) => id != null),
      ),
    ] as string[];

    // Fetch episode counts for each session
    const sessionEpisodeCounts: Record<string, number> = {};
    if (sessionIds.length > 0) {
      const counts = await Promise.all(
        sessionIds.map(async (sessionId: string) => {
          const count = await prisma.ingestionQueue.count({
            where: {
              data: {
                path: ["sessionId"],
                equals: sessionId,
              },
            },
          });
          return { sessionId: sessionId as string, count: count as number };
        }),
      );

      counts.forEach(({ sessionId, count }) => {
        sessionEpisodeCounts[sessionId] = count;
      });
    }

    // Format logs
    const formattedLogs = allLogs.map((log: any) => {
      const integrationDef =
        log.activity?.integrationAccount?.integrationDefinition;
      const logData = log.data as any;
      const episodeUUID = (log.output as any)?.episodeUuid;
      const type = logData?.type || "CONVERSATION";
      const sessionId = logData?.sessionId;

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
        title: log.title || "Untitled",
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
        sessionId,
        type,
        episodes,
        isSessionGroup: !!sessionId,
        sessionEpisodeCount: sessionId
          ? sessionEpisodeCounts[sessionId]
          : undefined,
      };
    });

    return json({
      logs: formattedLogs,
      totalCount,
      page,
      limit,
      hasMore: skip + formattedLogs.length < totalCount,
    });
  },
);
