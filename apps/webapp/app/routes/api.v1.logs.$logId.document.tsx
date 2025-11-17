import { json } from "@remix-run/node";
import { z } from "zod";
import { getIngestionQueue } from "~/services/ingestionLogs.server";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { addToQueue } from "~/lib/ingest.server";

// Schema for log ID parameter
const LogParamsSchema = z.object({
  logId: z.string(),
});

// Schema for document update body
const DocumentUpdateBody = z.object({
  content: z.string(),
});

const { action } = createHybridActionApiRoute(
  {
    params: LogParamsSchema,
    body: DocumentUpdateBody,
    allowJWT: true,
    authorization: {
      action: "update",
    },
    corsStrategy: "all",
  },
  async ({ params, authentication, body }) => {
    try {
      // Get the original ingestion queue entry
      const originalLog = await getIngestionQueue(params.logId);

      if (!originalLog) {
        return json(
          {
            error: "Log not found",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      const { content } = body;

      // Get sessionId from the original log
      const logData = originalLog.data as any;
      const sessionId = logData?.sessionId || originalLog.sessionId;

      if (!sessionId) {
        return json(
          {
            error: "Log does not have a sessionId",
            code: "bad_request",
          },
          { status: 400 },
        );
      }

      // Find the latest document-type log for this session
      const latestDocumentLog = await prisma.ingestionQueue.findFirst({
        where: {
          sessionId,
          type: "DOCUMENT",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000);

      // Check if we should update existing or create new
      const shouldUpdate =
        latestDocumentLog &&
        latestDocumentLog.status === "PENDING" &&
        latestDocumentLog.createdAt > fourMinutesAgo;

      if (shouldUpdate && latestDocumentLog) {
        // Update existing document log
        const existingData = latestDocumentLog.data as any;
        const updatedData = {
          ...existingData,
          episodeBody: content,
        };

        await prisma.ingestionQueue.update({
          where: { id: latestDocumentLog.id },
          data: { data: updatedData },
        });

        return json({
          success: true,
          message: "Document updated successfully",
          logId: latestDocumentLog.id,
          action: "updated",
        });
      } else {
        // Create new document log
        const newLogData = {
          type: "DOCUMENT",
          episodeBody: content,
          sessionId,
          source: originalLog.source ?? "core",
          referenceTime: new Date().toISOString(),
          delay: true,
        };

        const newLog = await addToQueue(newLogData, authentication.userId);

        return json({
          success: true,
          message: "Document created successfully",
          logId: newLog.id,
          action: "created",
        });
      }
    } catch (error) {
      console.error("Error updating document:", error);
      return json(
        {
          error: "Failed to update document",
          code: "internal_error",
        },
        { status: 500 },
      );
    }
  },
);

export { action };
