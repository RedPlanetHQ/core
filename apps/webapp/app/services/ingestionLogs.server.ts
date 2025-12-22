import { prisma } from "~/db.server";
import { deleteEpisodeWithRelatedNodes } from "./graphModels/episode";
import { cancelJob, findRunningJobs } from "./jobManager.server";
import { getEpisodeByQueueId } from "./vectorStorage.server";

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
        episodesDeleted:
          finalResult.episodesDeleted + Number(result.episodesDeleted),
        statementsDeleted:
          finalResult.statementsDeleted + Number(result.statementsDeleted),
        entitiesDeleted:
          finalResult.entitiesDeleted + Number(result.entitiesDeleted),
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
      sessionId,
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
