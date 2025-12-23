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
import { EpisodeType, type EpisodicNode } from "@core/types";
import { EpisodeVersioningService } from "~/services/episodeVersioning.server";
import { EpisodeDiffer } from "~/services/episodeDiffer.server";
import {
  IngestBodyRequest,
  type IngestEpisodePayload,
} from "./ingest-episode.logic";
import { EpisodeChunker } from "~/services/episodeChunker.server";
import { saveEpisode } from "~/services/graphModels/episode";
import { prisma } from "~/trigger/utils/prisma";
import { type SessionCompactionPayload } from "~/jobs/session/session-compaction.logic";
import { getRecentEpisodes } from "~/services/vectorStorage.server";
import { type EpisodeEmbedding } from "@prisma/client";

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
 * Helper function to fetch previous version episodes
 */
async function getPreviousVersionEpisodes(
  sessionId: string,
  userId: string,
  previousVersion: number,
): Promise<EpisodeEmbedding[]> {
  const allEpisodes = await getRecentEpisodes(userId, 200, sessionId);

  // Filter to get only episodes from previous version
  return allEpisodes.filter((ep) => ep.version === previousVersion);
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
 * 6. Trigger session compaction for conversations (in parallel with ingestion)
 */
export async function processEpisodePreprocessing(
  payload: IngestEpisodePayload,
  // Callback function for enqueueing ingestion jobs (one per chunk)
  enqueueIngestEpisode?: (params: IngestEpisodePayload) => Promise<any>,
  // Callback function for enqueueing session compaction (for conversations)
  enqueueSessionCompaction?: (params: SessionCompactionPayload) => Promise<any>,
): Promise<PreprocessEpisodeResult> {
  try {
    logger.info(`Preprocessing episode for user ${payload.userId}`, {
      type: payload.body.type,
      queueId: payload.queueId,
    });

    const episodeBody = payload.body;
    const type = episodeBody.type || EpisodeType.CONVERSATION;
    const sessionId = episodeBody.sessionId as string;

    const episodeChunker = new EpisodeChunker();
    const needsChunking = episodeChunker.needsChunking(
      episodeBody.episodeBody,
      type,
    );

    let preprocessedChunks: z.infer<typeof IngestBodyRequest>[] = [];
    let preprocessingStrategy = "single_episode";
    let documentVersion: number | undefined;

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

    // Step 2: For documents, handle versioning and diffing
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
      });

      // Store version for Prisma document metadata
      documentVersion = versionInfo.newVersion;
      let contentToProcess = chunked.originalContent;

      // Determine the actual episode type (CONVERSATION for compact conversations, DOCUMENT for regular documents)
      let episodeType = type;
      if (versionInfo.document?.type === "conversation") {
        episodeType = EpisodeType.CONVERSATION;
      }

      // For existing documents, get whole-document diff
      if (!versionInfo.isNewSession && versionInfo.hasContentChanged) {
        logger.info(`Document changed, extracting whole-document diff`, {
          version: versionInfo.newVersion,
          previousVersion: versionInfo.newVersion - 1,
        });

        // Get full previous version content
        const previousVersion = versionInfo.newVersion - 1;
        const episodeDiffer = new EpisodeDiffer();

        // For compact conversation updates, get old content from Document table
        if (versionInfo.document?.type === "conversation") {
          const document = await prisma.document.findUnique({
            where: {
              id: sessionId,
            },
            select: {
              content: true,
            },
          });

          if (document?.content) {
            // Extract diff between old compact summary and new compact summary
            const diffContent = episodeDiffer.getGitStyleDiff(
              document.content,
              chunked.originalContent,
            );

            const diffStats = episodeDiffer.getChangeStats(
              document.content,
              chunked.originalContent,
            );
            logger.info(`Compact conversation git-style diff extracted`, {
              originalLength: chunked.originalContent.length,
              diffLength: diffContent.length,
              tokenSavings:
                (
                  (1 - diffContent.length / chunked.originalContent.length) *
                  100
                ).toFixed(1) + "%",
              diffStats,
            });

            // Use diff as content to process
            contentToProcess = diffContent;
            preprocessingStrategy = "compact_conversation_diff";
          } else {
            logger.warn(
              `Previous compact content not found, using full content`,
            );
            preprocessingStrategy = "full_content";
          }
        } else {
          // For regular documents, get old content from previous version episodes
          const previousVersionEpisodes = await getPreviousVersionEpisodes(
            sessionId,
            payload.userId,
            previousVersion,
          );

          if (previousVersionEpisodes.length > 0) {
            // Reconstruct full previous document
            const sortedPreviousChunks = previousVersionEpisodes.sort(
              (a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0),
            );
            const oldContent = sortedPreviousChunks
              .map((ep) => ep.originalContent || ep.content)
              .join("");

            // Extract whole-document diff in git-style format
            const diffContent = episodeDiffer.getGitStyleDiff(
              oldContent,
              chunked.originalContent,
            );

            const diffStats = episodeDiffer.getChangeStats(
              oldContent,
              chunked.originalContent,
            );
            logger.info(`Whole-document git-style diff extracted`, {
              originalLength: chunked.originalContent.length,
              diffLength: diffContent.length,
              tokenSavings:
                (
                  (1 - diffContent.length / chunked.originalContent.length) *
                  100
                ).toFixed(1) + "%",
              diffStats,
            });

            // Use diff as content to process
            contentToProcess = diffContent;
            preprocessingStrategy = "whole_document_diff";
          } else {
            logger.warn(`Previous version not found, using full content`);
            preprocessingStrategy = "full_content";
          }
        }
      } else {
        preprocessingStrategy = versionInfo.isNewSession
          ? "new_document"
          : "no_changes";
      }

      // Chunk the content (either full content for new docs, or diff for updates)
      const episodeChunker = new EpisodeChunker();
      const needsChunking = episodeChunker.needsChunking(
        contentToProcess,
        type,
      );

      let finalChunks;
      if (needsChunking) {
        // Chunk the diff/content
        logger.info(
          `Chunking ${preprocessingStrategy === "whole_document_diff" ? "diff" : "content"}`,
          {
            contentLength: contentToProcess.length,
          },
        );

        finalChunks = await episodeChunker.chunkEpisode(
          contentToProcess,
          type,
          sessionId,
          episodeBody.title || "Untitled",
          episodeBody.metadata,
        );
      } else {
        // Single chunk
        finalChunks = {
          chunks: [
            {
              content: contentToProcess,
              chunkIndex: 0,
              startPosition: 0,
              endPosition: contentToProcess.length,
              contentHash: crypto
                .createHash("sha256")
                .update(contentToProcess)
                .digest("hex")
                .substring(0, 16),
            },
          ],
          totalChunks: 1,
          originalContent: chunked.originalContent, // Keep full content for reference
          contentHash: chunked.contentHash,
          chunkHashes: chunked.chunkHashes,
          sessionId,
          type,
          title: episodeBody.title || "Untitled",
        };
      }

      // Convert to preprocessed chunks
      for (const chunk of finalChunks.chunks) {
        const isFirstChunk = chunk.chunkIndex === 0;
        preprocessedChunks.push({
          episodeBody: chunk.content, // Diff content for LLM
          originalEpisodeBody: chunked.originalContent, // Full content for future comparisons
          referenceTime: episodeBody.referenceTime,
          metadata: episodeBody.metadata || {},
          source: episodeBody.source,
          labelIds: episodeBody.labelIds,
          sessionId,
          type: episodeType, // Use episodeType (CONVERSATION for compact conversations, DOCUMENT for regular documents)
          title: episodeBody.title,
          chunkIndex: chunk.chunkIndex,
          version: versionInfo.newVersion,
          totalChunks: finalChunks.totalChunks,
          contentHash: chunked.contentHash,
          previousVersionSessionId:
            versionInfo.previousVersionSessionId || undefined,
          // chunkHashes only on first chunk
          ...(isFirstChunk && { chunkHashes: chunked.chunkHashes }),
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

    // Save episodes to Neo4j BEFORE enqueueing ingestion
    // This ensures episodes exist in graph before compaction runs (race condition fix)
    const episodeUuids = new Map<number, string>(); // Map chunkIndex to UUID
    if (preprocessedChunks.length > 0) {
      logger.info(`Saving ${preprocessedChunks.length} episodes to Neo4j`, {
        sessionId,
      });

      const now = new Date();
      for (const chunk of preprocessedChunks) {
        const episodeUuid = crypto.randomUUID();
        const episode: EpisodicNode = {
          uuid: episodeUuid,
          content: chunk.episodeBody, // Diff for LLM (will be updated with normalized content)
          originalContent: chunk.originalEpisodeBody || chunk.episodeBody, // Full content for future comparisons
          contentEmbedding: [], // Will be updated during ingestion
          source: chunk.source,
          metadata: chunk.metadata || {},
          createdAt: now,
          validAt: new Date(chunk.referenceTime),
          labelIds: chunk.labelIds || [],
          userId: payload.userId,
          sessionId: chunk.sessionId!,
          queueId: payload.queueId,
          type: chunk.type,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          version: chunk.version,
          contentHash: chunk.contentHash,
          previousVersionSessionId: chunk.previousVersionSessionId,
          chunkHashes: chunk.chunkHashes,
        };

        await saveEpisode(episode);

        // Store UUID for this chunk
        if (chunk.chunkIndex !== undefined) {
          episodeUuids.set(chunk.chunkIndex, episodeUuid);
        }
      }

      logger.info(
        `Successfully saved ${preprocessedChunks.length} episodes to Neo4j`,
        {
          sessionId,
        },
      );
    }

    // Enqueue ingestion jobs for each chunk, including the episode UUID
    if (enqueueIngestEpisode && preprocessedChunks.length > 0) {
      logger.info(`Enqueueing ${preprocessedChunks.length} ingestion jobs`, {
        sessionId,
      });

      for (const chunk of preprocessedChunks) {
        // Add episode UUID to chunk
        const chunkWithUuid = {
          ...chunk,
          episodeUuid: episodeUuids.get(chunk.chunkIndex!),
        };

        await enqueueIngestEpisode({
          body: chunkWithUuid,
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          queueId: payload.queueId,
        });
      }
    }

    // Trigger session compaction in parallel for conversations
    if (
      sessionId &&
      type === EpisodeType.CONVERSATION &&
      enqueueSessionCompaction
    ) {
      // Check if this is a compact document update (type='conversation' in Document table)
      const document = await prisma.document.findUnique({
        where: { id: sessionId },
        select: { type: true },
      });

      // Only trigger compaction if document type is 'conversation' or document doesn't exist yet
      // Skip if type is 'document' (shouldn't happen for CONVERSATION type episodes)
      if (!document || document.type === "conversation") {
        logger.info(`Enqueueing session compaction for conversation`, {
          sessionId,
          userId: payload.userId,
          isNewConversation: !document,
        });

        try {
          await enqueueSessionCompaction({
            userId: payload.userId,
            sessionId: sessionId,
            source: episodeBody.source,
            workspaceId: payload.workspaceId,
          });
        } catch (compactionError) {
          // Don't fail preprocessing if compaction enqueueing fails
          logger.warn(`Failed to enqueue session compaction`, {
            sessionId,
            error:
              compactionError instanceof Error
                ? compactionError.message
                : String(compactionError),
          });
        }
      } else {
        logger.info(`Skipping compaction for non-conversation document`, {
          sessionId,
          documentType: document.type,
        });
      }
    } else if (sessionId && type === EpisodeType.DOCUMENT) {
      // Create/update Prisma document record for document type
      logger.info(`Creating/updating document record`, {
        sessionId,
        userId: payload.userId,
      });

      const document = await prisma.document.upsert({
        where: { id: sessionId },
        create: {
          id: sessionId,
          title: episodeBody.title || "Untitled Document",
          content: chunked.originalContent,
          labelIds: episodeBody.labelIds || [],
          source: episodeBody.source,
          type: "document",
          metadata: {
            chunkCount: chunked.totalChunks,
            contentHash: chunked.contentHash,
            version: documentVersion || 1,
            preprocessedAt: new Date().toISOString(),
          },
          editedBy: payload.userId,
          workspaceId: payload.workspaceId,
        },
        update: {
          title: episodeBody.title || "Untitled Document",
          content: chunked.originalContent,
          updatedAt: new Date(),
          metadata: {
            chunkCount: chunked.totalChunks,
            contentHash: chunked.contentHash,
            version: documentVersion || 1,
            preprocessedAt: new Date().toISOString(),
          },
        },
      });

      logger.info(
        `Document record ${document.id} ${chunked.totalChunks > 0 ? "updated" : "created"}`,
        {
          sessionId,
          chunks: chunked.totalChunks,
          version: documentVersion || 1,
        },
      );
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
