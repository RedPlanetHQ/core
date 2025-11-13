import { prisma } from "~/db.server";

export async function getIngestionLogs(
  userId: string,
  page: number = 1,
  limit: number = 10,
) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      Workspace: true,
    },
  });

  const skip = (page - 1) * limit;

  const [ingestionLogs, total] = await Promise.all([
    prisma.ingestionQueue.findMany({
      where: {
        workspaceId: user?.Workspace?.id,
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.ingestionQueue.count({
      where: {
        workspaceId: user?.Workspace?.id,
      },
    }),
  ]);

  return {
    ingestionLogs,
    pagination: {
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      limit,
    },
  };
}

export const getIngestionQueue = async (id: string) => {
  return await prisma.ingestionQueue.findUnique({
    where: {
      id,
    },
  });
};

export const getIngestionQueueForFrontend = async (
  id: string,
  userId: string,
) => {
  // Fetch the specific log by logId
  let log = await prisma.ingestionQueue.findUnique({
    where: { id },
    select: {
      id: true,
      createdAt: true,
      processedAt: true,
      status: true,
      error: true,
      type: true,
      output: true,
      data: true,
      workspaceId: true,
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
  });

  // If not found by ID, try to find by episode UUID
  if (!log) {
    const logByEpisode = await getLogByEpisode(id);

    if (!logByEpisode) {
      throw new Response("Log not found", { status: 404 });
    }

    // Fetch the full log data using the found log's ID
    log = await prisma.ingestionQueue.findUnique({
      where: { id: logByEpisode.id },
      select: {
        id: true,
        createdAt: true,
        processedAt: true,
        status: true,
        error: true,
        type: true,
        output: true,
        data: true,
        workspaceId: true,
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
    });

    if (!log) {
      throw new Response("Log not found", { status: 404 });
    }
  }

  // Format the response
  const integrationDef =
    log.activity?.integrationAccount?.integrationDefinition;
  const logData = log.data as any;

  const formattedLog: any = {
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

  // Add sessionId and isSessionGroup flag
  formattedLog.sessionId = logData?.sessionId;
  formattedLog.isSessionGroup = !!logData?.sessionId;

  return formattedLog;
};

export const getLogByEpisode = async (episodeUuid: string) => {
  // Find logs where the episode UUID matches either:
  // 1. log.output.episodeUuid (single episode - CONVERSATION type)
  // 2. log.output.episodes array (multiple episodes - DOCUMENT type)
  const logs = await prisma.ingestionQueue.findMany({
    where: {
      OR: [
        {
          output: {
            path: ["episodeUuid"],
            equals: episodeUuid,
          },
        },
        {
          output: {
            path: ["episodes"],
            array_contains: episodeUuid,
          },
        },
      ],
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
  });

  return logs[0] || null;
};

export const deleteIngestionQueue = async (id: string) => {
  return await prisma.ingestionQueue.delete({
    where: {
      id,
    },
  });
};
