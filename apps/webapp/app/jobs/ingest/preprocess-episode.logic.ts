/**
 * Episode Preprocessing Logic
 *
 * Handles chunking, versioning, and differential analysis BEFORE episode ingestion.
 * This preprocessing step runs in a separate queue job for better transparency,
 * error handling, and resource allocation.
 */

import { type z } from "zod";
import crypto from "crypto";
import { logger } from "~/services/logger.service";
import { EpisodeType } from "@core/types";
import { EpisodeVersioningService } from "~/services/episodeVersioning.server";
import { DocumentDifferentialService } from "~/services/documentDiffer.server";
import {
  IngestBodyRequest,
  type IngestEpisodePayload,
} from "./ingest-episode.logic";
import { EpisodeChunker } from "~/services/episodeChunker.server";
import { invalidateStatementsFromPreviousVersion } from "~/services/graphModels/episode";
import { prisma } from "~/trigger/utils/prisma";

export { IngestBodyRequest };

export interface PreprocessEpisodeResult {
  success: boolean;
  preprocessedChunks?: z.infer<typeof IngestBodyRequest>[];
  sessionId?: string;
  totalChunks?: number;
  preprocessingStrategy?: string;
  error?: string;
}

/**
 * Core business logic for preprocessing episodes
 * This is shared between Trigger.dev and BullMQ implementations
 *
 * Responsibilities:
 * 1. Determine if chunking is needed
 * 2. Execute chunking if necessary
 * 3. For documents: analyze versions and apply differential processing
 * 4. For conversations: chunk if needed
 * 5. Output array of pre-chunked episode payloads
 */
export async function processEpisodePreprocessing(
  payload: IngestEpisodePayload,
  // Callback function for enqueueing ingestion jobs (one per chunk)
  enqueueIngestEpisode?: (params: IngestEpisodePayload) => Promise<any>,
): Promise<PreprocessEpisodeResult> {
  try {
    logger.info(`Preprocessing episode for user ${payload.userId}`, {
      type: payload.body.type,
      queueId: payload.queueId,
    });

    const episodeBody = payload.body;
    const type = episodeBody.type || EpisodeType.CONVERSATION;
    const sessionId = episodeBody.sessionId || crypto.randomUUID();

    if (!episodeBody.sessionId) {
      await prisma.ingestionQueue.update({
        where: {
          id: payload.queueId,
        },
        data: {
          sessionId,
        },
      });
    }

    const episodeChunker = new EpisodeChunker();
    const needsChunking = episodeChunker.needsChunking(
      episodeBody.episodeBody,
      type,
    );

    let preprocessedChunks: z.infer<typeof IngestBodyRequest>[] = [];
    let preprocessingStrategy = "single_episode";

    // Step 1: Generate chunks with proper metadata (always generate hashes)
    let chunked;
    if (!needsChunking) {
      // Content below threshold - create single chunk with metadata
      logger.info(
        `Content below chunking threshold - preparing single episode`,
        {
          type,
          sessionId,
        },
      );

      // Use chunkEpisode which will internally call createSingleChunk with proper metadata
      chunked = await episodeChunker.chunkEpisode(
        episodeBody.episodeBody,
        type,
        sessionId,
        episodeBody.title || "Untitled",
        episodeBody.metadata,
      );
    } else {
      // Content needs chunking
      logger.info(`Chunking content for preprocessing`, {
        type,
        sessionId,
      });

      chunked = await episodeChunker.chunkEpisode(
        episodeBody.episodeBody,
        type,
        sessionId,
        episodeBody.title || "Untitled",
        episodeBody.metadata,
      );

      logger.info(`Content chunked`, {
        totalChunks: chunked.totalChunks,
        type,
        sessionId,
      });

      preprocessingStrategy = "chunked";
    }

    // Step 2: For documents, ALWAYS run versioning and differential processing
    if (type === EpisodeType.DOCUMENT) {
      const versioningService = new EpisodeVersioningService();
      const versionInfo = await versioningService.analyzeVersionChanges(
        sessionId,
        payload.userId,
        chunked.originalContent,
        chunked.chunkHashes,
        type,
      );

      logger.info(`Version analysis complete`, {
        isNewSession: versionInfo.isNewSession,
        version: versionInfo.newVersion,
        hasContentChanged: versionInfo.hasContentChanged,
        changePercentage:
          versionInfo.chunkLevelChanges.changePercentage.toFixed(1),
      });

      let chunksToProcess = chunked.chunks;

      // Apply differential processing for existing documents with changes
      if (!versionInfo.isNewSession && versionInfo.hasContentChanged) {
        const differentialService = new DocumentDifferentialService();
        const decision = await differentialService.analyzeDifferentialNeed(
          chunked.originalContent,
          versionInfo.existingFirstEpisode,
          chunked,
        );

        preprocessingStrategy = decision.strategy;

        if (decision.strategy === "chunk_level_diff") {
          // Invalidate statements from changed chunks only
          const changedIndices =
            versionInfo.chunkLevelChanges.changedChunkIndices;

          logger.info(
            `Invalidating statements from changed chunks only: ${changedIndices.length} chunks`,
          );

          const previousVersion =
            versionInfo.existingFirstEpisode?.version || 1;

          const invalidationResult =
            await invalidateStatementsFromPreviousVersion({
              sessionId: sessionId, // Same sessionId (documentId) across versions
              userId: payload.userId,
              previousVersion: previousVersion,
              changedChunkIndices: changedIndices,
              invalidatedBy: sessionId,
            });

          logger.info(`Chunk-level statement invalidation completed`, {
            previousVersion,
            changedChunks: changedIndices.length,
            invalidatedStatements: invalidationResult.invalidatedCount,
          });

          chunksToProcess = chunked.chunks.filter((c) =>
            decision.changedChunkIndices.includes(c.chunkIndex),
          );

          logger.info(
            `Differential processing: processing changed chunks only`,
            {
              totalChunks: chunked.totalChunks,
              chunksToProcess: chunksToProcess.length,
              changedIndices: decision.changedChunkIndices,
            },
          );
        } else if (decision.strategy === "skip_processing") {
          logger.info(`No changes detected, skipping processing`);
          chunksToProcess = [];
        } else if (decision.strategy === "full_reingest") {
          logger.info(
            `Full reingest strategy: invalidating all statements from previous version`,
          );

          const previousVersion =
            versionInfo.existingFirstEpisode?.version || 1;
          const invalidationResult =
            await invalidateStatementsFromPreviousVersion({
              sessionId,
              userId: payload.userId,
              previousVersion: previousVersion,
              invalidatedBy: sessionId,
            });

          logger.info(`Full version invalidation completed`, {
            previousVersion,
            invalidatedStatements: invalidationResult.invalidatedCount,
          });
        }
      }

      // Convert chunks to preprocessed format with version metadata
      for (const chunk of chunksToProcess) {
        const isFirstChunk = chunk.chunkIndex === 0;

        preprocessedChunks.push({
          episodeBody: chunk.content,
          referenceTime: episodeBody.referenceTime,
          metadata: episodeBody.metadata || {},
          source: episodeBody.source,
          labelIds: episodeBody.labelIds,
          sessionId,
          type,
          title: episodeBody.title,
          chunkIndex: chunk.chunkIndex,
          version: versionInfo.newVersion,
          totalChunks: chunked.totalChunks,
          contentHash: chunked.contentHash,
          previousVersionSessionId:
            versionInfo.previousVersionSessionId || undefined,
          // chunkHashes only on first chunk
          ...(isFirstChunk &&
            versionInfo && {
              chunkHashes: chunked.chunkHashes,
            }),
        });
      }
    } else {
      // Conversations - process all chunks (no differential)
      for (const chunk of chunked.chunks) {
        preprocessedChunks.push({
          episodeBody: chunk.content,
          referenceTime: episodeBody.referenceTime,
          metadata: episodeBody.metadata || {},
          source: episodeBody.source,
          labelIds: episodeBody.labelIds,
          sessionId,
          type,
          title: episodeBody.title,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunked.totalChunks,
        });
      }
    }

    logger.info(`Preprocessing complete`, {
      sessionId,
      totalChunks: preprocessedChunks.length,
      strategy: preprocessingStrategy,
    });

    // Enqueue ingestion jobs for each chunk
    if (enqueueIngestEpisode && preprocessedChunks.length > 0) {
      logger.info(`Enqueueing ${preprocessedChunks.length} ingestion jobs`, {
        sessionId,
      });

      for (const chunk of preprocessedChunks) {
        await enqueueIngestEpisode({
          body: chunk,
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          queueId: payload.queueId,
        });
      }
    }

    return {
      success: true,
      preprocessedChunks,
      sessionId,
      totalChunks: preprocessedChunks.length,
      preprocessingStrategy,
    };
  } catch (err: any) {
    logger.error(
      `Error preprocessing episode for user ${payload.userId}:`,
      err,
    );
    return {
      success: false,
      error: err.message,
    };
  }
}
