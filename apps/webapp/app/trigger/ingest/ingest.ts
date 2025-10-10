import { queue, task } from "@trigger.dev/sdk";
import { z } from "zod";
import { KnowledgeGraphService } from "~/services/knowledgeGraph.server";
import { linkEpisodeToDocument } from "~/services/graphModels/document";

import { IngestionStatus } from "@core/database";
import { logger } from "~/services/logger.service";
import { triggerSpaceAssignment } from "../spaces/space-assignment";
import { prisma } from "../utils/prisma";
import { EpisodeType } from "@core/types";
import { deductCredits, hasCredits } from "../utils/utils";
import { assignEpisodesToSpace } from "~/services/graphModels/space";
import type {
  DocumentIngestionOutput,
  IngestionQueueOutput,
} from "./types";

export const IngestBodyRequest = z.object({
  episodeBody: z.string(),
  referenceTime: z.string(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  source: z.string(),
  spaceIds: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  type: z
    .enum([EpisodeType.CONVERSATION, EpisodeType.DOCUMENT])
    .default(EpisodeType.CONVERSATION),
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

      // Check if workspace has sufficient credits before processing
      const hasSufficientCredits = await hasCredits(
        payload.workspaceId,
        "addEpisode",
      );

      if (!hasSufficientCredits) {
        logger.warn(
          `Insufficient credits for workspace ${payload.workspaceId}`,
        );

        await prisma.ingestionQueue.update({
          where: { id: payload.queueId },
          data: {
            status: IngestionStatus.NO_CREDITS,
            error:
              "Insufficient credits. Please upgrade your plan or wait for your credits to reset.",
          },
        });

        return {
          success: false,
          error: "Insufficient credits",
        };
      }

      const ingestionQueue = await prisma.ingestionQueue.update({
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

      // Link episode to document if it's a document chunk
      if (
        episodeBody.type === EpisodeType.DOCUMENT &&
        episodeBody.metadata.documentUuid &&
        episodeDetails.episodeUuid
      ) {
        try {
          await linkEpisodeToDocument(
            episodeDetails.episodeUuid,
            episodeBody.metadata.documentUuid,
            episodeBody.metadata.chunkIndex || 0,
          );
          logger.log(
            `Linked episode ${episodeDetails.episodeUuid} to document ${episodeBody.metadata.documentUuid} at chunk ${episodeBody.metadata.chunkIndex || 0}`,
          );
        } catch (error) {
          logger.error(`Failed to link episode to document:`, {
            error,
            episodeUuid: episodeDetails.episodeUuid,
            documentUuid: episodeBody.metadata.documentUuid,
          });
        }
      }

      let finalOutput: IngestionQueueOutput = episodeDetails;
      let episodeUuids: string[] = episodeDetails.episodeUuid
        ? [episodeDetails.episodeUuid]
        : [];
      let currentStatus: IngestionStatus = IngestionStatus.COMPLETED;

      if (episodeBody.type === EpisodeType.DOCUMENT) {
        // Get current output and ensure it has the document structure
        const documentOutput = ingestionQueue.output as DocumentIngestionOutput | null;
        if (documentOutput) {
          // Add current episode to episodes array
          documentOutput?.episodes.push(episodeDetails);

          // Collect all episode UUIDs
          episodeUuids = documentOutput.episodes
            .map((episode) => episode.episodeUuid)
            .filter((uuid): uuid is string => uuid !== undefined);

          finalOutput = documentOutput;

          // Check if all chunks have been processed
          if (documentOutput.episodes.length !== documentOutput.totalChunks) {
            currentStatus = IngestionStatus.PROCESSING;
          }
        }
      }

      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          output: finalOutput as any,
          status: currentStatus,
        },
      });

      // Deduct credits for episode creation
      if (episodeDetails.statementsCreated > 0) {
        logger.info(`Deducting credits for episode creation`, {
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          statementsCreated: episodeDetails.statementsCreated,
        });

        await deductCredits(
          payload.workspaceId,
          "addEpisode",
          episodeDetails.statementsCreated,
        );
      }

      // Handle space assignment after successful ingestion
      try {
        // If spaceIds were explicitly provided, immediately assign the episode to those spaces
        if (episodeBody.spaceIds && episodeBody.spaceIds.length > 0 && episodeDetails.episodeUuid) {
          logger.info(`Assigning episode to explicitly provided spaces`, {
            userId: payload.userId,
            episodeId: episodeDetails.episodeUuid,
            spaceIds: episodeBody.spaceIds,
          });

          // Assign episode to each space
          for (const spaceId of episodeBody.spaceIds) {
            await assignEpisodesToSpace(
              [episodeDetails.episodeUuid],
              spaceId,
              payload.userId,
            );
          }

          logger.info(
            `Skipping LLM space assignment - episode explicitly assigned to ${episodeBody.spaceIds.length} space(s)`,
          );
        } else {
          // Only trigger automatic LLM space assignment if no explicit spaceIds were provided
          logger.info(
            `Triggering LLM space assignment after successful ingestion`,
            {
              userId: payload.userId,
              workspaceId: payload.workspaceId,
              episodeId: episodeDetails?.episodeUuid,
            },
          );
          if (
            episodeDetails.episodeUuid &&
            currentStatus === IngestionStatus.COMPLETED
          ) {
            await triggerSpaceAssignment({
              userId: payload.userId,
              workspaceId: payload.workspaceId,
              mode: "episode",
              episodeIds: episodeUuids,
            });
          }
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
