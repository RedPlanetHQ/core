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
} from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";

/**
 * Episode ingestion worker
 * Processes individual episode ingestion jobs with per-user concurrency
 *
 * Note: Per-user concurrency is achieved by using userId as part of the jobId
 * when adding jobs to the queue, ensuring only one job per user runs at a time
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
    concurrency: 5, // Process up to 5 jobs in parallel
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
    return await processTopicAnalysis(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 2, // Process up to 2 analyses in parallel (CPU-intensive)
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
  ]);
  logger.log("All BullMQ workers closed");
}
