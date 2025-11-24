import { json } from "@remix-run/node";
import { z } from "zod";
import { deleteEpisodeWithRelatedNodes } from "~/services/graphModels/episode";
import {
  deleteIngestionQueue,
  getIngestionQueue,
  getIngestionQueueForFrontend,
  updateIngestionQueue,
} from "~/services/ingestionLogs.server";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { findRunningJobs, cancelJob } from "~/services/jobManager.server";
import { LabelService } from "~/services/label.server";
import { getWorkspaceByUser } from "~/models/workspace.server";

// Schema for space ID parameter
const LogParamsSchema = z.object({
  logId: z.string(),
});

export const LogUpdateBody = z.object({
  labels: z.array(z.string()).optional(),
  title: z.string().optional(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: LogParamsSchema,
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ params, authentication }) => {
    const workspace = await getWorkspaceByUser(authentication.userId);

    const formattedLog = await getIngestionQueueForFrontend(
      params.logId,
      workspace?.id as string,
    );

    return json({ log: formattedLog });
  },
);

const { action } = createHybridActionApiRoute(
  {
    params: LogParamsSchema,
    allowJWT: true,
    authorization: {
      action: "update",
    },
    corsStrategy: "all",
  },
  async ({ params, authentication, request }) => {
    // Handle PATCH requests for updating labels
    if (request.method === "PATCH") {
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

        const body = await request.json();
        const validationResult = LogUpdateBody.safeParse(body);

        if (!validationResult.success) {
          return json(
            {
              error: "Invalid request body",
              code: "validation_error",
              details: validationResult.error.errors,
            },
            { status: 400 },
          );
        }

        const { labels, title } = validationResult.data;

        if (
          ingestionQueue.title === "Persona" ||
          title === "Persona" ||
          body.labels
        ) {
          return json(
            {
              error:
                "Cannot edit the persona title or labels, also cannot name any document as Persona",
              code: "validation_error",
            },
            { status: 400 },
          );
        }

        // Update the ingestion queue with new labels
        const updatedQueue = await updateIngestionQueue(
          params.logId,
          {
            labels,
            title,
          },
          authentication.userId,
        );

        return json({
          success: true,
          message: "Labels updated successfully",
          labels: updatedQueue.labels,
        });
      } catch (error) {
        console.error("Error updating labels:", error);
        return json(
          {
            error: "Failed to update labels",
            code: "internal_error",
          },
          { status: 500 },
        );
      }
    }

    // Handle DELETE requests
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
