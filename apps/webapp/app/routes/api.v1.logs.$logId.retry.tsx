import { json } from "@remix-run/node";
import { z } from "zod";
import { IngestionStatus } from "@core/database";
import { getIngestionQueue } from "~/services/ingestionLogs.server";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { addToQueue } from "~/lib/ingest.server";

// Schema for log ID parameter
const LogParamsSchema = z.object({
  logId: z.string(),
});

const { action } = createHybridActionApiRoute(
  {
    params: LogParamsSchema,
    allowJWT: true,
    method: "POST",
    authorization: {
      action: "update",
    },
    corsStrategy: "all",
  },
  async ({ params, authentication }) => {
    try {
      const ingestionQueue = await getIngestionQueue(params.logId);

      if (!ingestionQueue) {
        return json(
          {
            error: "Ingestion log not found",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      // Only allow retry for FAILED status
      if (ingestionQueue.status !== IngestionStatus.FAILED) {
        return json(
          {
            error: "Only failed ingestion logs can be retried",
            code: "invalid_status",
          },
          { status: 400 },
        );
      }

      // Get the original ingestion data
      const originalData = ingestionQueue.data as any;

      // Re-enqueue the job with the existing queue ID (will upsert)
      await addToQueue(
        originalData,
        authentication.userId,
        ingestionQueue.activityId || undefined,
        ingestionQueue.id, // Pass the existing queue ID for upsert
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
