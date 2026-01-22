import { z } from "zod";
import { KnowledgeGraphService } from "~/services/knowledgeGraph.server";
import { IngestionStatus } from "@core/database";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import { type AddEpisodeResult, EpisodeType } from "@core/types";
import { hasCredits } from "~/trigger/utils/utils";

import {
  shouldTriggerTopicAnalysis,
  updateLastTopicAnalysisTime,
} from "~/services/bertTopicAnalysis.server";

export const IngestBodyRequest = z.object({
  episodeBody: z.string(),
  originalEpisodeBody: z.string().optional(), // Full content (for semantic_diff where episodeBody is diff only)
  referenceTime: z.string(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  source: z.string(),
  labelIds: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  type: z
    .enum([EpisodeType.CONVERSATION, EpisodeType.DOCUMENT])
    .default(EpisodeType.CONVERSATION),
  title: z.string().optional(),
  delay: z.boolean().optional(),
  chunkIndex: z.number().optional(),
  totalChunks: z.number().optional(),
  version: z.number().optional(),
  contentHash: z.string().optional(),
  previousVersionSessionId: z.string().optional(),
  chunkHashes: z.array(z.string()).optional(),
  episodeUuid: z.string().optional(), // UUID of episode already saved in preprocessing
});

export interface IngestEpisodePayload {
  body: z.infer<typeof IngestBodyRequest>;
  userId: string;
  workspaceId: string;
  queueId: string;
}

export interface IngestEpisodeResult {
  success: boolean;
  episodeDetails?: any;
  error?: string;
}

/**
 * Core business logic for ingesting a single episode
 * This is shared between Trigger.dev and BullMQ implementations
 *
 * Note: This function should NOT call trigger functions directly.
 * Instead, return data that indicates follow-up jobs are needed,
 * and let the caller (Trigger task or BullMQ worker) handle job queueing.
 */
export async function processEpisodeIngestion(
  payload: IngestEpisodePayload,
  // Callback functions for enqueueing follow-up jobs
  enqueueLabelAssignment?: (params: {
    queueId: string;
    userId: string;
    workspaceId: string;
  }) => Promise<any>,
  enqueueTitleGeneration?: (params: {
    queueId: string;
    userId: string;
    workspaceId: string;
  }) => Promise<any>,
  enqueueSessionCompaction?: (params: {
    userId: string;
    sessionId: string;
    source: string;
    workspaceId: string;
  }) => Promise<any>,
  enqueueBertTopicAnalysis?: (params: {
    userId: string;
    workspaceId: string;
    minTopicSize?: number;
    nrTopics?: number;
  }) => Promise<any>,
  enqueuePersonaGeneration?: (params: {
    userId: string;
    workspaceId: string;
  }) => Promise<any>,
  enqueueGraphResolution?: (params: {
    episodeUuid: string;
    userId: string;
    episodeDetails: AddEpisodeResult;
    workspaceId: string;
    queueId?: string;
  }) => Promise<any>,
): Promise<IngestEpisodeResult> {
  try {
    logger.log(`Processing job for user ${payload.userId}`);

    // Check if workspace has sufficient credits before processing
    const hasSufficientCredits = await hasCredits(
      payload.workspaceId,
      "addEpisode",
    );

    if (!hasSufficientCredits) {
      logger.warn(`Insufficient credits for workspace ${payload.workspaceId}`);

      try {
        await prisma.ingestionQueue.update({
          where: { id: payload.queueId },
          data: {
            status: IngestionStatus.NO_CREDITS,
            error:
              "Insufficient credits. Please upgrade your plan or wait for your credits to reset.",
          },
        });
      } catch (error) {
        logger.warn(
          `Could not update ingestion queue ${payload.queueId} - may have been deleted`,
        );
      }

      return {
        success: false,
        error: "Insufficient credits",
      };
    }

    try {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          status: IngestionStatus.PROCESSING,
        },
      });
    } catch (error) {
      // Record may have been deleted - log and continue processing
      logger.warn(
        `Could not update ingestion queue ${payload.queueId} to PROCESSING - may have been deleted`,
      );
      // Continue processing anyway - the episode should still be added to the graph
    }

    const knowledgeGraphService = new KnowledgeGraphService();
    const episodeBody = payload.body as any;

    // Fetch user name for user-centric extraction
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, displayName: true },
    });
    const userName = user?.displayName || user?.name || undefined;

    let episodeDetails;
    try {
      episodeDetails = await knowledgeGraphService.addEpisode(
        {
          ...episodeBody,
          userId: payload.userId,
          userName, // Pass user name for user-centric extraction
          queueId: payload.queueId,
        },
        prisma,
      );
    } catch (error) {
      throw new Error(`Failed to add episode: ${error}`);
    }

    // Trigger async graph resolution if we skipped it during ingestion
    if (episodeDetails.episodeUuid && enqueueGraphResolution) {
      try {
        logger.info(
          `Triggering async graph resolution for episode ${episodeDetails.episodeUuid}`,
          {
            userId: payload.userId,
            triplesCount: episodeDetails.statementsCreated,
          },
        );

        await enqueueGraphResolution({
          episodeUuid: episodeDetails.episodeUuid,
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          queueId: payload.queueId,
          episodeDetails,
        });
      } catch (resolutionError) {
        // Don't fail the ingestion if resolution job fails to enqueue
        logger.warn(`Failed to trigger graph resolution after ingestion:`, {
          error: resolutionError,
          userId: payload.userId,
          episodeUuid: episodeDetails.episodeUuid,
        });
      }
    }

    // Simple output - preprocessing already handled chunking logic
    const currentStatus: IngestionStatus = episodeDetails.episodeUuid
      ? IngestionStatus.COMPLETED
      : IngestionStatus.FAILED;

    try {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          status: currentStatus,
        },
      });
    } catch (error) {
      logger.warn(
        `Could not update ingestion queue ${payload.queueId} status to ${currentStatus} - may have been deleted`,
      );
    }

    // Handle label assignment and title generation after successful ingestion
    try {
      if (currentStatus === IngestionStatus.COMPLETED) {
        // Only assign labels if not explicitly provided
        if (!episodeBody.labelIds || episodeBody.labelIds.length === 0) {
          if (enqueueLabelAssignment) {
            logger.info(
              `Triggering LLM label assignment after successful ingestion`,
              {
                userId: payload.userId,
                workspaceId: payload.workspaceId,
                queueId: payload.queueId,
              },
            );
            await enqueueLabelAssignment({
              queueId: payload.queueId,
              userId: payload.userId,
              workspaceId: payload.workspaceId,
            });
          }
        } else {
          logger.info(
            `Skipping LLM label assignment - labels explicitly provided: ${episodeBody.labelIds.join(", ")}`,
            {
              userId: payload.userId,
              queueId: payload.queueId,
            },
          );
        }

        // Trigger title generation for all completed episodes
        if (enqueueTitleGeneration) {
          logger.info(
            `Triggering title generation after successful ingestion`,
            {
              userId: payload.userId,
              workspaceId: payload.workspaceId,
              queueId: payload.queueId,
            },
          );
          await enqueueTitleGeneration({
            queueId: payload.queueId,
            userId: payload.userId,
            workspaceId: payload.workspaceId,
          });
        }
      }
    } catch (postIngestionError) {
      // Don't fail the ingestion if label/title jobs fail
      logger.warn(
        `Failed to trigger label assignment or title generation after ingestion:`,
        {
          error: postIngestionError,
          userId: payload.userId,
          queueId: payload.queueId,
        },
      );
    }

    // Auto-trigger BERT topic analysis if threshold met (20+ new episodes)
    try {
      if (
        currentStatus === IngestionStatus.COMPLETED &&
        enqueueBertTopicAnalysis
      ) {
        const shouldTrigger = await shouldTriggerTopicAnalysis(
          payload.userId,
          payload.workspaceId,
        );

        if (shouldTrigger) {
          logger.info(
            `Triggering BERT topic analysis after reaching 20+ new episodes`,
            {
              userId: payload.userId,
              workspaceId: payload.workspaceId,
            },
          );

          await enqueueBertTopicAnalysis({
            userId: payload.userId,
            workspaceId: payload.workspaceId,
            minTopicSize: 10,
          });

          // Update the last analysis timestamp
          await updateLastTopicAnalysisTime(payload.workspaceId);
        }
      }
    } catch (topicAnalysisError) {
      // Don't fail the ingestion if topic analysis fails
      logger.warn(`Failed to trigger topic analysis after ingestion:`, {
        error: topicAnalysisError,
        userId: payload.userId,
      });
    }

    // Trigger persona generation after successful episode creation
    // Threshold check happens inside the persona generation task
    try {
      if (
        currentStatus === IngestionStatus.COMPLETED &&
        enqueuePersonaGeneration
      ) {
        logger.info(`Triggering persona generation check after ingestion`, {
          userId: payload.userId,
          workspaceId: payload.workspaceId,
        });

        // Trigger persona generation task - threshold check happens within the task
        await enqueuePersonaGeneration({
          userId: payload.userId,
          workspaceId: payload.workspaceId,
        });
      }
    } catch (personaTriggerError) {
      // Don't fail the ingestion if persona trigger fails
      logger.warn(`Failed to trigger persona generation after ingestion:`, {
        error: personaTriggerError,
        userId: payload.userId,
      });
    }

    return { success: true, episodeDetails };
  } catch (err: any) {
    try {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          error: err.message,
          status: IngestionStatus.FAILED,
        },
      });
    } catch (updateError) {
      logger.warn(
        `Could not update ingestion queue ${payload.queueId} with error - may have been deleted`,
      );
    }

    logger.error(`Error processing job for user ${payload.userId}:`, err);
    return { success: false, error: err.message };
  }
}
