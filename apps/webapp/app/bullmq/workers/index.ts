/**
 * BullMQ Workers
 *
 * All worker definitions for processing background jobs with BullMQ
 */

import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import {
  processEpisodeIngestion,
  type IngestEpisodePayload,
} from "~/jobs/ingest/ingest-episode.logic";
import {
  processDocumentIngestion,
  type IngestDocumentPayload,
} from "~/jobs/ingest/ingest-document.logic";
import {
  processConversationTitleCreation,
  type CreateConversationTitlePayload,
} from "~/jobs/conversation/create-title.logic";
import {
  processSessionCompaction,
  type SessionCompactionPayload,
} from "~/jobs/session/session-compaction.logic";
import {
  processTopicAnalysis,
  type TopicAnalysisPayload,
} from "~/jobs/bert/topic-analysis.logic";

import {
  enqueueIngestEpisode,
  enqueueSpaceAssignment,
  enqueueSessionCompaction,
  enqueueBertTopicAnalysis,
  enqueueSpaceSummary,
} from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";
import {
  processSpaceAssignment,
  type SpaceAssignmentPayload,
} from "~/jobs/spaces/space-assignment.logic";
import {
  processSpaceSummary,
  type SpaceSummaryPayload,
} from "~/jobs/spaces/space-summary.logic";

/**
 * Episode ingestion worker
 * Processes individual episode ingestion jobs with global concurrency
 *
 * Note: BullMQ uses global concurrency limit (5 jobs max).
 * Trigger.dev uses per-user concurrency via concurrencyKey.
 * For most open-source deployments, global concurrency is sufficient.
 */
export const ingestWorker = new Worker(
  "ingest-queue",
  async (job) => {
    const payload = job.data as IngestEpisodePayload;

    return await processEpisodeIngestion(
      payload,
      // Callbacks to enqueue follow-up jobs
      enqueueSpaceAssignment,
      enqueueSessionCompaction,
      enqueueBertTopicAnalysis,
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: 1, // Global limit: process up to 1 jobs in parallel
  },
);

/**
 * Document ingestion worker
 * Handles document-level ingestion with differential processing
 *
 * Note: Per-user concurrency is achieved by using userId as part of the jobId
 * when adding jobs to the queue
 */
export const documentIngestWorker = new Worker(
  "document-ingest-queue",
  async (job) => {
    const payload = job.data as IngestDocumentPayload;
    return await processDocumentIngestion(
      payload,
      // Callback to enqueue episode ingestion for each chunk
      enqueueIngestEpisode,
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: 3, // Process up to 3 documents in parallel
  },
);

/**
 * Conversation title creation worker
 */
export const conversationTitleWorker = new Worker(
  "conversation-title-queue",
  async (job) => {
    const payload = job.data as CreateConversationTitlePayload;
    return await processConversationTitleCreation(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 10, // Process up to 10 title creations in parallel
  },
);

/**
 * Session compaction worker
 */
export const sessionCompactionWorker = new Worker(
  "session-compaction-queue",
  async (job) => {
    const payload = job.data as SessionCompactionPayload;
    return await processSessionCompaction(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 3, // Process up to 3 compactions in parallel
  },
);

/**
 * BERT topic analysis worker
 * Handles CPU-intensive topic modeling
 */
export const bertTopicWorker = new Worker(
  "bert-topic-queue",
  async (job) => {
    const payload = job.data as TopicAnalysisPayload;
    return await processTopicAnalysis(
      payload,
      // Callback to enqueue space summary
      enqueueSpaceSummary,
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: 2, // Process up to 2 analyses in parallel (CPU-intensive)
  },
);

/**
 * Space assignment worker
 * Handles assigning episodes to spaces based on semantic matching
 *
 * Note: Global concurrency of 1 ensures sequential processing.
 * Trigger.dev uses per-user concurrency via concurrencyKey.
 */
export const spaceAssignmentWorker = new Worker(
  "space-assignment-queue",
  async (job) => {
    const payload = job.data as SpaceAssignmentPayload;
    return await processSpaceAssignment(
      payload,
      // Callback to enqueue space summary
      enqueueSpaceSummary,
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: 1, // Global limit: process one job at a time
  },
);

/**
 * Space summary worker
 * Handles generating summaries for spaces
 */
export const spaceSummaryWorker = new Worker(
  "space-summary-queue",
  async (job) => {
    const payload = job.data as SpaceSummaryPayload;
    return await processSpaceSummary(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 1, // Process one space summary at a time
  },
);

/**
 * Graceful shutdown handler
 */
export async function closeAllWorkers(): Promise<void> {
  await Promise.all([
    ingestWorker.close(),
    documentIngestWorker.close(),
    conversationTitleWorker.close(),
    sessionCompactionWorker.close(),
    bertTopicWorker.close(),
    spaceSummaryWorker.close(),
    spaceAssignmentWorker.close(),
  ]);
  logger.log("All BullMQ workers closed");
}
