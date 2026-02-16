import { json } from "@remix-run/node";
import { z } from "zod";
import { IngestionStatus } from "@core/database";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { addToQueue } from "~/lib/ingest.server";
import { getDocument } from "~/services/document.server";

import { prisma } from "~/db.server";

// Schema for log ID parameter
const DocumentParamsSchema = z.object({
  documentId: z.string(),
});

const { action } = createHybridActionApiRoute(
  {
    params: DocumentParamsSchema,
    allowJWT: true,
    method: "POST",
    authorization: {
      action: "update",
    },
    corsStrategy: "all",
  },
  async ({ params, authentication }) => {
    if (!authentication.workspaceId) {
      return json(
        {
          error: "No workspace found",
          code: "not_found",
        },
        { status: 500 },
      );
    }

    try {

      const document = await getDocument(
        params.documentId,
        authentication.workspaceId,
      );

      if (!document) {
        return json(
          {
            error: "Ingestion log not found",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      const latestIngestionLog = await prisma.ingestionQueue.findFirst({
        where: {
          sessionId: document?.sessionId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Only allow retry for FAILED status
      if (latestIngestionLog?.status !== IngestionStatus.FAILED) {
        return json(
          {
            error: "Only failed ingestion logs can be retried",
            code: "invalid_status",
          },
          { status: 400 },
        );
      }

      // Get the original ingestion data
      const originalData = latestIngestionLog.data as any;

      // Re-enqueue the job with the existing queue ID (will upsert)
      await addToQueue(
        originalData,
        authentication.userId,
        authentication.workspaceId,
        latestIngestionLog.activityId || undefined,
        latestIngestionLog.id, // Pass the existing queue ID for upsert
      );

      return json({
        success: true,
        message: "Ingestion retry initiated successfully",
      });
    } catch (error) {
      console.error("Error retrying ingestion:", error);

      // Handle specific error cases
      if (error instanceof Error && error.message === "no credits") {
        return json(
          {
            error: "Insufficient credits to retry ingestion",
            code: "no_credits",
          },
          { status: 402 },
        );
      }

      return json(
        {
          error: "Failed to retry ingestion",
          code: "internal_error",
        },
        { status: 500 },
      );
    }
  },
);

export { action };
