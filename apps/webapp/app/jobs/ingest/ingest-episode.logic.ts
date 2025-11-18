import { z } from "zod";
import { KnowledgeGraphService } from "~/services/knowledgeGraph.server";
import { linkEpisodeToDocument } from "~/services/graphModels/document";
import { IngestionStatus } from "@core/database";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import { EpisodeType } from "@core/types";
import { deductCredits, hasCredits } from "~/trigger/utils/utils";

import {
  shouldTriggerTopicAnalysis,
  updateLastTopicAnalysisTime,
} from "~/services/bertTopicAnalysis.server";
import { checkAndTriggerPersonaUpdate } from "../spaces/persona-trigger.logic";

export const IngestBodyRequest = z.object({
  episodeBody: z.string(),
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
    labelId: string;
    mode: "full" | "incremental";
    startTime?: string;
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

    let finalOutput = episodeDetails;
    let episodeUuids: string[] = episodeDetails.episodeUuid
      ? [episodeDetails.episodeUuid]
      : [];
    let currentStatus: IngestionStatus = IngestionStatus.COMPLETED;
    if (episodeBody.type === EpisodeType.DOCUMENT) {
      const currentOutput = ingestionQueue.output as any;
      currentOutput.episodes.push(episodeDetails);
      episodeUuids = currentOutput.episodes.map(
        (episode: any) => episode.episodeUuid,
      );

      finalOutput = {
        ...currentOutput,
      };

      if (currentOutput.episodes.length !== currentOutput.totalChunks) {
        currentStatus = IngestionStatus.PROCESSING;
      }
    }

    await prisma.ingestionQueue.update({
      where: { id: payload.queueId },
      data: {
        output: finalOutput,
        graphIds: episodeUuids,
        status: currentStatus,
      },
    });

    // Deduct credits for episode creation
    if (currentStatus === IngestionStatus.COMPLETED) {
      await deductCredits(
        payload.workspaceId,
        "addEpisode",
        finalOutput.statementsCreated,
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

    // Auto-trigger session compaction if episode has sessionId
    try {
      if (
        episodeBody.sessionId &&
        currentStatus === IngestionStatus.COMPLETED &&
        episodeBody.type !== EpisodeType.DOCUMENT &&
        enqueueSessionCompaction
      ) {
        logger.info(`Checking if session compaction should be triggered`, {
          userId: payload.userId,
          sessionId: episodeBody.sessionId,
          source: episodeBody.source,
        });

        await enqueueSessionCompaction({
          userId: payload.userId,
          sessionId: episodeBody.sessionId,
          source: episodeBody.source,
        });
      }
    } catch (compactionError) {
      // Don't fail the ingestion if compaction fails
      logger.warn(`Failed to trigger session compaction after ingestion:`, {
        error: compactionError,
        userId: payload.userId,
        sessionId: episodeBody.sessionId,
      });
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

    // Check and trigger persona update if threshold met (50+ new episodes)
    try {
      if (
        currentStatus === IngestionStatus.COMPLETED &&
        enqueuePersonaGeneration
      ) {
        await checkAndTriggerPersonaUpdate(
          payload.userId,
          payload.workspaceId,
          enqueuePersonaGeneration,
        );
      }
    } catch (personaTriggerError) {
      // Don't fail the ingestion if persona trigger fails
      logger.warn(`Failed to check persona trigger after ingestion:`, {
        error: personaTriggerError,
        userId: payload.userId,
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
}
