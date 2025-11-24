import { z } from "zod";
import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { deleteEpisodeWithRelatedNodes } from "~/services/graphModels/episode";
import {
  deleteIngestionQueue,
  getIngestionQueue,
} from "~/services/ingestionLogs.server";
import { findRunningJobs, cancelJob } from "~/services/jobManager.server";
import { deleteDocumentWithRelatedNodes } from "~/services/graphModels/document";

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

      let result: {
        deleted: boolean;
        documentsDeleted?: number;
        episodesDeleted: number;
        statementsDeleted: number;
        entitiesDeleted: number;
      } = {
        deleted: false,
        documentsDeleted: 0,
        episodesDeleted: 0,
        statementsDeleted: 0,
        entitiesDeleted: 0,
      };

      if (output?.episodeUuid) {
        result = await deleteEpisodeWithRelatedNodes({
          episodeUuid: output?.episodeUuid,
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
      } else if (output?.documentUuid) {
        result = await deleteDocumentWithRelatedNodes(
          output?.documentUuid,
          authentication.userId,
        );

        if (!result.deleted) {
          return json(
            {
              error: "Document not found or unauthorized",
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
          documentsDeleted: result.documentsDeleted,
          episodesDeleted: result.episodesDeleted,
          statementsDeleted: result.statementsDeleted,
          entitiesDeleted: result.entitiesDeleted,
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
