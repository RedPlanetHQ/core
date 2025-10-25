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
  processDeepSearch,
  type ProcessDeepSearchPayload,
} from "~/jobs/deep-search/deep-search.logic";
import {
  processSessionCompaction,
  type SessionCompactionPayload,
} from "~/jobs/session/session-compaction.logic";
import {
  enqueueIngestEpisode,
  enqueueSpaceAssignment,
  enqueueSessionCompaction,
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
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: 5, // Process up to 5 jobs in parallel
  },
);

ingestWorker.on("completed", (job) => {
  logger.log(`Job ${job.id} completed`);
});

ingestWorker.on("failed", (job, error) => {
  logger.error(`Job ${job?.id} failed: ${error}`);
});

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

documentIngestWorker.on("completed", (job) => {
  logger.log(`Document job ${job.id} completed`);
});

documentIngestWorker.on("failed", (job, error) => {
  logger.error(`Document job ${job?.id} failed: ${error}`);
});

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

conversationTitleWorker.on("completed", (job) => {
  logger.log(`Conversation title job ${job.id} completed`);
});

conversationTitleWorker.on("failed", (job, error) => {
  logger.error(`Conversation title job ${job?.id} failed: ${error}`);
});

/**
 * Deep search worker (non-streaming version for BullMQ)
 */
export const deepSearchWorker = new Worker(
  "deep-search-queue",
  async (job) => {
    const payload = job.data as ProcessDeepSearchPayload;
    return await processDeepSearch(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5, // Process up to 5 searches in parallel
  },
);

deepSearchWorker.on("completed", (job) => {
  logger.log(`Deep search job ${job.id} completed`);
});

deepSearchWorker.on("failed", (job, error) => {
  logger.error(`Deep search job ${job?.id} failed: ${error}`);
});

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

sessionCompactionWorker.on("completed", (job) => {
  logger.log(`Session compaction job ${job.id} completed`);
});

sessionCompactionWorker.on("failed", (job, error) => {
  logger.error(`Session compaction job ${job?.id} failed: ${error}`);
});

/**
 * Graceful shutdown handler
 */
export async function closeAllWorkers(): Promise<void> {
  await Promise.all([
    ingestWorker.close(),
    documentIngestWorker.close(),
    conversationTitleWorker.close(),
    deepSearchWorker.close(),
    sessionCompactionWorker.close(),
  ]);
  logger.log("All BullMQ workers closed");
}
