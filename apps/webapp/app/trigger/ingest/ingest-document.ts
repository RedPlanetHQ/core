import { queue, task } from "@trigger.dev/sdk";
import { type z } from "zod";
import crypto from "crypto";

import { IngestionStatus } from "@core/database";
import { EpisodeTypeEnum } from "@core/types";
import { logger } from "~/services/logger.service";
import { saveDocument } from "~/services/graphModels/document";
import { type IngestBodyRequest } from "~/lib/ingest.server";
import { DocumentVersioningService } from "~/services/documentVersioning.server";
import { DocumentDifferentialService } from "~/services/documentDiffer.server";
import { KnowledgeGraphService } from "~/services/knowledgeGraph.server";
import { prisma } from "../utils/prisma";
import { ingestTask } from "./ingest";

const documentIngestionQueue = queue({
  name: "document-ingestion-queue",
  concurrencyLimit: 1,
});

// Register the Document Ingestion Trigger.dev task
export const ingestDocumentTask = task({
  id: "ingest-document",
  queue: documentIngestionQueue,
  machine: "medium-2x",
  run: async (payload: {
    body: z.infer<typeof IngestBodyRequest>;
    userId: string;
    workspaceId: string;
    queueId: string;
  }) => {
    const startTime = Date.now();

    try {
      logger.log(`Processing document for user ${payload.userId}`, {
        contentLength: payload.body.episodeBody.length,
      });

      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          status: IngestionStatus.PROCESSING,
        },
      });

      const documentBody = payload.body;

      // Step 1: Initialize services and prepare document version
      const versioningService = new DocumentVersioningService();
      const differentialService = new DocumentDifferentialService();
      const knowledgeGraphService = new KnowledgeGraphService();

      const {
        documentNode: document,
        versionInfo,
        chunkedDocument,
      } = await versioningService.prepareDocumentVersion(
        documentBody.sessionId!,
        payload.userId,
        documentBody.metadata?.documentTitle?.toString() || "Untitled Document",
        documentBody.episodeBody,
        documentBody.source,
        documentBody.metadata || {},
      );

      logger.log(`Document version analysis:`, {
        version: versionInfo.newVersion,
        isNewDocument: versionInfo.isNewDocument,
        hasContentChanged: versionInfo.hasContentChanged,
        changePercentage: versionInfo.chunkLevelChanges.changePercentage,
        changedChunks: versionInfo.chunkLevelChanges.changedChunkIndices.length,
        totalChunks: versionInfo.chunkLevelChanges.totalChunks,
      });

      // Step 2: Determine processing strategy
      const differentialDecision =
        await differentialService.analyzeDifferentialNeed(
          documentBody.episodeBody,
          versionInfo.existingDocument,
          chunkedDocument,
        );

      logger.log(`Differential analysis:`, {
        shouldUseDifferential: differentialDecision.shouldUseDifferential,
        strategy: differentialDecision.strategy,
        reason: differentialDecision.reason,
        documentSizeTokens: differentialDecision.documentSizeTokens,
      });

      // Early return for unchanged documents
      if (differentialDecision.strategy === "skip_processing") {
        logger.log("Document content unchanged, skipping processing");
        return {
          success: true,
          documentsProcessed: 1,
          chunksProcessed: 0,
          episodesCreated: 0,
          entitiesExtracted: 0,
        };
      }

      // Step 3: Save the new document version
      await saveDocument(document);

      // Step 3.1: Invalidate statements from previous document version if it exists
      let invalidationResults = null;
      if (versionInfo.existingDocument && versionInfo.hasContentChanged) {
        logger.log(
          `Invalidating statements from previous document version: ${versionInfo.existingDocument.uuid}`,
        );

        invalidationResults =
          await knowledgeGraphService.invalidateStatementsFromPreviousDocumentVersion(
            {
              previousDocumentUuid: versionInfo.existingDocument.uuid,
              newDocumentContent: documentBody.episodeBody,
              userId: payload.userId,
              invalidatedBy: document.uuid,
              semanticSimilarityThreshold: 0.75, // Configurable threshold
            },
          );

        logger.log(`Statement invalidation completed:`, {
          totalAnalyzed: invalidationResults.totalStatementsAnalyzed,
          invalidated: invalidationResults.invalidatedStatements.length,
          preserved: invalidationResults.preservedStatements.length,
        });
      }

      logger.log(
        `Document chunked into ${chunkedDocument.chunks.length} chunks`,
      );

      // Step 4: Process chunks based on differential strategy
      let chunksToProcess = chunkedDocument.chunks;
      let processingMode = "full";

      if (
        differentialDecision.shouldUseDifferential &&
        differentialDecision.strategy === "chunk_level_diff"
      ) {
        // Only process changed chunks
        const chunkComparisons = differentialService.getChunkComparisons(
          versionInfo.existingDocument!,
          chunkedDocument,
        );

        const changedIndices =
          differentialService.getChunksNeedingReprocessing(chunkComparisons);
        chunksToProcess = chunkedDocument.chunks.filter((chunk) =>
          changedIndices.includes(chunk.chunkIndex),
        );
        processingMode = "differential";

        logger.log(
          `Differential processing: ${chunksToProcess.length}/${chunkedDocument.chunks.length} chunks need reprocessing`,
        );
      } else if (differentialDecision.strategy === "full_reingest") {
        // Process all chunks
        processingMode = "full";
        logger.log(
          `Full reingestion: processing all ${chunkedDocument.chunks.length} chunks`,
        );
      }

      // Step 5: Queue chunks for processing
      const episodeHandlers = [];
      for (const chunk of chunksToProcess) {
        const chunkEpisodeData = {
          episodeBody: chunk.content,
          referenceTime: documentBody.referenceTime,
          metadata: {
            ...documentBody.metadata,
            processingMode,
            differentialStrategy: differentialDecision.strategy,
            chunkHash: chunk.contentHash,
            documentTitle:
              documentBody.metadata?.documentTitle?.toString() ||
              "Untitled Document",
            chunkIndex: chunk.chunkIndex,
            documentUuid: document.uuid,
          },
          source: documentBody.source,
          spaceIds: documentBody.spaceIds,
          sessionId: documentBody.sessionId,
          type: EpisodeTypeEnum.DOCUMENT,
        };

        const episodeHandler = await ingestTask.trigger(
          {
            body: chunkEpisodeData,
            userId: payload.userId,
            workspaceId: payload.workspaceId,
            queueId: payload.queueId,
          },
          {
            queue: "ingestion-queue",
            concurrencyKey: payload.userId,
            tags: [payload.userId, payload.queueId, processingMode],
          },
        );

        if (episodeHandler.id) {
          episodeHandlers.push(episodeHandler.id);
          logger.log(
            `Queued chunk ${chunk.chunkIndex + 1} for ${processingMode} processing`,
            {
              handlerId: episodeHandler.id,
              chunkSize: chunk.content.length,
              chunkHash: chunk.contentHash,
            },
          );
        }
      }

      // Calculate cost savings
      const costSavings = differentialService.calculateCostSavings(
        chunkedDocument.chunks.length,
        chunksToProcess.length,
      );

      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          output: {
            documentUuid: document.uuid,
            version: versionInfo.newVersion,
            totalChunks: chunkedDocument.chunks.length,
            chunksProcessed: chunksToProcess.length,
            chunksSkipped: costSavings.chunksSkipped,
            processingMode,
            differentialStrategy: differentialDecision.strategy,
            estimatedSavings: `${costSavings.estimatedSavingsPercentage.toFixed(1)}%`,
            statementInvalidation: invalidationResults
              ? {
                  totalAnalyzed: invalidationResults.totalStatementsAnalyzed,
                  invalidated: invalidationResults.invalidatedStatements.length,
                  preserved: invalidationResults.preservedStatements.length,
                }
              : null,
            episodes: [],
            episodeHandlers,
          },
          status: IngestionStatus.PROCESSING,
        },
      });

      const processingTimeMs = Date.now() - startTime;

      logger.log(
        `Document differential processing completed in ${processingTimeMs}ms`,
        {
          documentUuid: document.uuid,
          version: versionInfo.newVersion,
          processingMode,
          totalChunks: chunkedDocument.chunks.length,
          chunksProcessed: chunksToProcess.length,
          chunksSkipped: costSavings.chunksSkipped,
          estimatedSavings: `${costSavings.estimatedSavingsPercentage.toFixed(1)}%`,
          changePercentage: `${differentialDecision.changePercentage.toFixed(1)}%`,
          statementInvalidation: invalidationResults
            ? {
                totalAnalyzed: invalidationResults.totalStatementsAnalyzed,
                invalidated: invalidationResults.invalidatedStatements.length,
                preserved: invalidationResults.preservedStatements.length,
              }
            : "No previous version",
        },
      );

      return { success: true };
    } catch (err: any) {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          error: err.message,
          status: IngestionStatus.FAILED,
        },
      });

      logger.error(
        `Error processing document for user ${payload.userId}:`,
        err,
      );
      return { success: false, error: err.message };
    }
  },
});
