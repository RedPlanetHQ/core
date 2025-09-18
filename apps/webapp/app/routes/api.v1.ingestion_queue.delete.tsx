import { z } from "zod";
import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { deleteEpisodeWithRelatedNodes } from "~/services/graphModels/episode";
import {
  deleteIngestionQueue,
  getIngestionQueue,
} from "~/services/ingestionLogs.server";
import { runs, tasks } from "@trigger.dev/sdk";

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
      const runningTasks = await runs.list({
        tag: [authentication.userId, ingestionQueue.id],
        taskIdentifier: "ingest-episode",
      });

      const latestTask = runningTasks.data.find(
        (task) =>
          task.tags.includes(authentication.userId) &&
          task.tags.includes(ingestionQueue.id),
      );

      if (latestTask && !latestTask?.isCompleted) {
        runs.cancel(latestTask?.id as string);
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
