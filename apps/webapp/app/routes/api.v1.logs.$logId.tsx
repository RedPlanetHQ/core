import { json } from "@remix-run/node";
import { z } from "zod";
import { deleteEpisodeWithRelatedNodes } from "~/services/graphModels/episode";
import {
  deleteIngestionQueue,
  getIngestionQueue,
  getIngestionQueueForFrontend,
} from "~/services/ingestionLogs.server";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { findRunningJobs, cancelJob } from "~/services/jobManager.server";

// Schema for space ID parameter
const LogParamsSchema = z.object({
  logId: z.string(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: LogParamsSchema,
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ params, authentication }) => {
    const formattedLog = await getIngestionQueueForFrontend(
      params.logId,
      authentication.userId,
    );

    return json({ log: formattedLog });
  },
);

const { action } = createHybridActionApiRoute(
  {
    params: LogParamsSchema,
    allowJWT: true,
    method: "DELETE",
    authorization: {
      action: "delete",
    },
    corsStrategy: "all",
  },
  async ({ params, authentication }) => {
    try {
      const ingestionQueue = await getIngestionQueue(params.logId);

      if (!ingestionQueue) {
        return json(
          {
            error: "Episode not found or unauthorized",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      const output = ingestionQueue.output as any;
      const runningTasks = await findRunningJobs({
        tags: [authentication.userId, ingestionQueue.id],
        taskIdentifier: "ingest-episode",
      });

      const latestTask = runningTasks[0];

      if (latestTask && !latestTask.isCompleted) {
        await cancelJob(latestTask.id);
      }

      let result;

      if (output?.episodeUuid) {
        result = await deleteEpisodeWithRelatedNodes({
          episodeUuid: output?.episodeUuid,
          userId: authentication.userId,
        });

        if (!result.episodeDeleted) {
          return json(
            {
              error: "Episode not found or unauthorized",
              code: "not_found",
            },
            { status: 404 },
          );
        }
      }

      await deleteIngestionQueue(ingestionQueue.id);

      return json({
        success: true,
        message: "Episode deleted successfully",
        deleted: {
          episode: result?.episodeDeleted,
          statements: result?.statementsDeleted,
          entities: result?.entitiesDeleted,
          facts: result?.factsDeleted,
        },
      });
    } catch (error) {
      console.error("Error deleting episode:", error);
      return json(
        {
          error: "Failed to delete episode",
          code: "internal_error",
        },
        { status: 500 },
      );
    }
  },
);

export { action, loader };
