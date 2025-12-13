import { prisma } from "~/db.server";
import {
  deleteEpisodeWithRelatedNodes,
  updateEpisodeLabels,
} from "./graphModels/episode";
import { cancelJob, findRunningJobs } from "./jobManager.server";
import { batchDeleteEntityEmbeddings, batchDeleteEpisodeEmbeddings, batchDeleteStatementEmbeddings, getEpisodeByQueueId } from "./vectorStorage.server";

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
  workspaceId: string,
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
      labels: true,
      title: true,
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
    const logByEpisode = await getLogByEpisode(id, workspaceId);

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
        labels: true,
        type: true,
        title: true,
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
  const sessionId = logData?.sessionId;

  // If there's a sessionId, fetch title and labels from the latest log in the session
  let title = log.title;
  let labels = log.labels;
  let status = log.status;

  if (sessionId) {
    const latestLog = await prisma.ingestionQueue.findFirst({
      where: {
        sessionId,
      },
      select: {
        title: true,
        labels: true,
        status: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (latestLog) {
      title = latestLog.title;
      labels = latestLog.labels;
      status = latestLog.status;
    }
  }

  const formattedLog: any = {
    id: log.id,
    title,
    labels,
    source: integrationDef?.name || logData?.source || "Unknown",
    ingestText:
      log.activity?.text ||
      logData?.episodeBody ||
      logData?.text ||
      "No content",
    time: log.createdAt,
    processedAt: log.processedAt,
    episodeUUID: (log.output as any)?.episodeUuid,
    status,
    error: log.error,
    sourceURL: log.activity?.sourceURL,
    integrationSlug: integrationDef?.slug,
    data: log.data,
  };

  // Add sessionId and isSessionGroup flag
  formattedLog.sessionId = sessionId;
  formattedLog.isSessionGroup = !!sessionId;

  return formattedLog;
};

export const getLogByEpisode = async (
  episodeUuid: string,
  workspaceId: string,
) => {
  // Find logs where the episode UUID matches either:
  // 1. log.output.episodeUuid (single episode - CONVERSATION type)
  // 2. log.output.episodes array (multiple episodes - DOCUMENT type)
  const logs = await prisma.ingestionQueue.findMany({
    where: {
      workspaceId,
      OR: [
        {
          graphIds: {
            has: episodeUuid,
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

export const getPersonaForUser = async (workspaceId: string) => {
  const log = await prisma.ingestionQueue.findFirst({
    where: {
      title: "Persona",
      workspaceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return log?.id;
};

export const deleteIngestionQueue = async (id: string) => {
  return await prisma.ingestionQueue.delete({
    where: {
      id,
    },
  });
};

// Delete a single log with its episode and related nodes
export const deleteLog = async (logId: string, userId: string) => {
  const ingestionQueue = await getIngestionQueue(logId);

  if (!ingestionQueue) {
    return {
      success: false,
      error: "Log not found",
    };
  }

  // Cancel any running jobs
  const runningTasks = await findRunningJobs({
    tags: [userId, ingestionQueue.id],
    taskIdentifier: "ingest-episode",
  });

  const latestTask = runningTasks[0];
  if (latestTask && !latestTask.isCompleted) {
    await cancelJob(latestTask.id);
  }

  let graphResult;
  let finalResult: {
    deleted: boolean;
    episodesDeleted: number;
    statementsDeleted: number;
    entitiesDeleted: number;
  } = {
    deleted: false,
    episodesDeleted: 0,
    statementsDeleted: 0,
    entitiesDeleted: 0,
  };


  const episodes = await getEpisodeByQueueId(logId);
  // Delete episode from graph if it exists
  if (episodes?.length > 0) {
    for (const episode of episodes) {
      const result = await deleteEpisodeWithRelatedNodes({
        episodeUuid: episode.id,
        userId,
      });

      if (result.episodesDeleted === 0) {
        return {
          success: false,
          error: "Episode not found or unauthorized",
        };
      }

      finalResult = {
        deleted: true,
        episodesDeleted: finalResult.episodesDeleted + Number(result.episodesDeleted),
        statementsDeleted: finalResult.statementsDeleted + Number(result.statementsDeleted),
        entitiesDeleted: finalResult.entitiesDeleted + Number(result.entitiesDeleted),
      };
    }
  }

  await deleteIngestionQueue(logId);

  return {
    success: true,
    deleted: finalResult,
  };
};

// Delete all logs in a session
export const deleteSession = async (sessionId: string, userId: string) => {
  // Get all ingestion queues for this session
  const logs = await prisma.ingestionQueue.findMany({
    where: {
      data: {
        path: ["sessionId"],
        equals: sessionId,
      },
    },
  });

  let totalEpisodesDeleted = 0;
  let totalStatementsDeleted = 0;
  let totalEntitiesDeleted = 0;

  // Delete each log in the session
  for (const log of logs) {
    const result = await deleteLog(log.id, userId);
    if (result.success && result.deleted) {
      totalEpisodesDeleted += result.deleted.episodesDeleted;
      totalStatementsDeleted += result.deleted.statementsDeleted;
      totalEntitiesDeleted += result.deleted.entitiesDeleted;
    }
  }

  return {
    success: true,
    logsDeleted: logs.length,
    deleted: {
      episodes: totalEpisodesDeleted,
      statements: totalStatementsDeleted,
      entities: totalEntitiesDeleted,
    },
  };
};

export const updateIngestionQueue = async (
  id: string,
  data: { labels?: string[]; title?: string },
  userId: string,
) => {
  // First, get the log to check for sessionId
  const log = await prisma.ingestionQueue.findUnique({
    where: { id },
    select: {
      id: true,
      data: true,
      graphIds: true,
      workspaceId: true,
    },
  });

  if (!log) {
    throw new Error(`Ingestion queue ${id} not found`);
  }

  const logData = log.data as any;
  const sessionId = logData?.sessionId;

  // Filter out invalid labels if labelIds are provided
  let validatedLabelIds: string[] = [];
  if (data.labels && data.labels.length > 0) {
    // Get only the valid labels for this workspace
    const validLabels = await prisma.label.findMany({
      where: {
        id: {
          in: data.labels,
        },
        workspaceId: log.workspaceId,
      },
      select: {
        id: true,
      },
    });

    validatedLabelIds = validLabels.map((label) => label.id);
  }

  // If there's a sessionId, find the latest log for that session
  if (sessionId) {
    const allSessionLogs = await prisma.ingestionQueue.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (validatedLabelIds && sessionId) {
      await updateEpisodeLabels(
        sessionId,
        validatedLabelIds,
        userId,
      );
    }
    const latestLog = allSessionLogs[0];

    if (latestLog) {
      // Update the latest log in the session
      return await prisma.ingestionQueue.update({
        where: {
          id: latestLog.id,
        },
        data: {
          ...data,
          labels: validatedLabelIds,
        },
      });
    }
  }

  // If no sessionId or no latest log found, update the original log
  return await prisma.ingestionQueue.update({
    where: {
      id,
    },
    data: {
      ...data,
      labels: validatedLabelIds,
    },
  });
};

export const getUserDocuments = async (workspaceId: string, limit: number) => {
  const documents = await prisma.ingestionQueue.findMany({
    where: {
      type: "DOCUMENT",
      workspaceId,
      status: "COMPLETED",
    },
    orderBy: {
      createdAt: "desc",
    },
    distinct: ["sessionId"],
    take: limit,
  });

  return documents;
};

export const getDocument = async (id: string, workspaceId: string) => {
  return await prisma.ingestionQueue.findUnique({
    where: {
      id,
      workspaceId,
    },
  });
};
