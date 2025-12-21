import { json } from "@remix-run/node";
import { z } from "zod";
import {
  getIngestionQueue,
  deleteSession,
} from "~/services/ingestionLogs.server";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { deleteDocument, getDocument, updateDocument } from "~/services/document.server";

// Schema for space ID parameter
const DocumentParamsSchema = z.object({
  documentId: z.string(),
});

export const LogUpdateBody = z.object({
  labels: z.array(z.string()).optional(),
  title: z.string().optional(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: DocumentParamsSchema,
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ params, authentication }) => {
    const workspace = await getWorkspaceByUser(authentication.userId);

    const document = await getDocument(
      params.documentId,
      workspace?.id as string,
    );

    return json({ document });
  },
);

const { action } = createHybridActionApiRoute(
  {
    params: DocumentParamsSchema,
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
        const ingestionQueue = await getIngestionQueue(params.documentId);

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
        const updatedQueue = await updateDocument(params.documentId, {
          labelIds: labels,
          title,
        });

        return json({
          success: true,
          message: "Labels updated successfully",
          labels: updatedQueue.labelIds,
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
      const workspace = await getWorkspaceByUser(authentication.userId);

      const document = await getDocument(
        params.documentId,
        workspace?.id as string,
      );

      if (!document) {
        return json(
          {
            error: "Document not found or unauthorized",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      // If deleteSession param is true and log has a sessionId, delete entire session
      const result = await deleteSession(
        document.id as string,
        authentication.userId,
      );

      await deleteDocument(document.id as string);
      return json({
        success: true,
        message: "Session deleted successfully",
        logsDeleted: result.logsDeleted,
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
