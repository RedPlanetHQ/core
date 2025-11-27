import { z } from "zod";
import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { deleteEpisodeWithRelatedNodes } from "~/services/graphModels/episode";
import {
  deleteIngestionQueue,
  getIngestionQueue,
} from "~/services/ingestionLogs.server";
import { findRunningJobs, cancelJob } from "~/services/jobManager.server";

export const DeleteEpisodeBodyRequest = z.object({
  id: z.string(),
});

const { action, loader } = createHybridActionApiRoute(
  {
    body: DeleteEpisodeBodyRequest,
    allowJWT: true,
    method: "DELETE",
    authorization: {
      action: "delete",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    try {
      const ingestionQueue = await getIngestionQueue(body.id);

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

      if (ingestionQueue.graphIds?.length > 0) {
        const graphIds = ingestionQueue.graphIds;
        for (const graphId of graphIds) {
          const result = await deleteEpisodeWithRelatedNodes({
            episodeUuid: graphId,
            userId: authentication.userId,
          });
          if (!result.deleted) {
            return json(
              {
                error: "Episode not found or unauthorized",
                code: "not_found",
              },
              { status: 404 },
            );
          }

          finalResult = {
            deleted: true,
            episodesDeleted: finalResult.episodesDeleted + Number(result.episodesDeleted),
            statementsDeleted: finalResult.statementsDeleted + Number(result.statementsDeleted),
            entitiesDeleted: finalResult.entitiesDeleted + Number(result.entitiesDeleted),
          };
        }
      }

      await deleteIngestionQueue(body.id);

      return json({
        success: true,
        message: "Episode deleted successfully",
        deleted: finalResult,
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
