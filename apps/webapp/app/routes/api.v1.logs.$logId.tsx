import { json } from "@remix-run/node";
import { z } from "zod";
import {
  getIngestionQueue,
  getIngestionQueueForFrontend,
  updateIngestionQueue,
  deleteLog,
  deleteSession,
} from "~/services/ingestionLogs.server";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
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

        let { labels, title } = validationResult.data;

        if (ingestionQueue.title === "Persona" || title === "Persona") {
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
      const url = new URL(request.url);
      const deleteSessionParam = url.searchParams.get("deleteSession");

      const ingestionQueue = await getIngestionQueue(params.logId);

      if (!ingestionQueue) {
        return json(
          {
            error: "Log not found or unauthorized",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      const logData = ingestionQueue.data as any;
      const sessionId = logData?.sessionId;

      // If deleteSession param is true and log has a sessionId, delete entire session
      if (deleteSessionParam === "true" && sessionId) {
        const result = await deleteSession(sessionId, authentication.userId);

        return json({
          success: true,
          message: "Session deleted successfully",
          logsDeleted: result.logsDeleted,
          deleted: result.deleted,
        });
      }

      // Otherwise, delete only this single log
      const result = await deleteLog(params.logId, authentication.userId);

      if (!result.success) {
        return json(
          {
            error: result.error || "Failed to delete log",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      return json({
        success: true,
        message: "Log deleted successfully",
        deleted: result.deleted,
      });
    } catch (error) {
      console.error("Error deleting log:", error);
      return json(
        {
          error: "Failed to delete log",
          code: "internal_error",
        },
        { status: 500 },
      );
    }
  },
);

export { action, loader };
