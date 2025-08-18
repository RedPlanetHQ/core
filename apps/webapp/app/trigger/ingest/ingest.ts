import { queue, task } from "@trigger.dev/sdk";
import { z } from "zod";
import { KnowledgeGraphService } from "~/services/knowledgeGraph.server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

import { IngestionStatus } from "@core/database";
import { logger } from "~/services/logger.service";
import { triggerSpaceAssignment } from "../spaces/space-assignment";

export const IngestBodyRequest = z.object({
  episodeBody: z.string(),
  referenceTime: z.string(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  source: z.string(),
  spaceId: z.string().optional(),
  sessionId: z.string().optional(),
});

const ingestionQueue = queue({
  name: "ingestion-queue",
  concurrencyLimit: 1,
});

// Register the Trigger.dev task
export const ingestTask = task({
  id: "ingest-episode",
  queue: ingestionQueue,
  machine: "medium-2x",
  run: async (payload: {
    body: z.infer<typeof IngestBodyRequest>;
    userId: string;
    workspaceId: string;
    queueId: string;
  }) => {
    try {
      logger.log(`Processing job for user ${payload.userId}`);

      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          status: IngestionStatus.PROCESSING,
        },
      });

      const knowledgeGraphService = new KnowledgeGraphService();

      const episodeBody = payload.body as any;

      const episodeDetails = await knowledgeGraphService.addEpisode(
        {
          ...episodeBody,
          userId: payload.userId,
        },
        prisma,
      );

      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          output: episodeDetails,
          status: IngestionStatus.COMPLETED,
        },
      });

      // Trigger space assignment after successful ingestion
      try {
        logger.info(`Triggering space assignment after successful ingestion`, {
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          episodeId: episodeDetails?.episodeUuid,
        });
        if (episodeDetails.episodeUuid) {
          await triggerSpaceAssignment({
            userId: payload.userId,
            workspaceId: payload.workspaceId,
            mode: "episode",
            episodeId: episodeDetails.episodeUuid,
          });
        }
      } catch (assignmentError) {
        // Don't fail the ingestion if assignment fails
        logger.warn(`Failed to trigger space assignment after ingestion:`, {
          error: assignmentError,
          userId: payload.userId,
          episodeId: episodeDetails?.episodeUuid,
        });
      }

      return { success: true, episodeDetails };
    } catch (err: any) {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          error: err.message,
          status: IngestionStatus.FAILED,
        },
      });

      logger.error(`Error processing job for user ${payload.userId}:`, err);
      return { success: false, error: err.message };
    }
  },
});
