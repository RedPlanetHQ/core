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
  processLabelAssignment,
  type LabelAssignmentPayload,
} from "~/jobs/labels/label-assignment.logic";
import {
  processTitleGeneration,
  type TitleGenerationPayload,
} from "~/jobs/titles/title-generation.logic";

import {
  enqueueIngestEpisode,
  enqueueLabelAssignment,
  enqueueTitleGeneration,
  enqueueSessionCompaction,
  enqueueBertTopicAnalysis,
  enqueuePersonaGeneration,
} from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";
import {
  type PersonaGenerationPayload,
  processPersonaGeneration,
} from "~/jobs/spaces/persona-generation.logic";
import {
  type GraphResolutionPayload,
  processGraphResolution,
} from "~/jobs/ingest/graph-resolution.logic";
import { enqueueGraphResolution } from "~/lib/queue-adapter.server";

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
      enqueueLabelAssignment,
      enqueueTitleGeneration,
      enqueueSessionCompaction,
      enqueueBertTopicAnalysis,
      enqueuePersonaGeneration,
      enqueueGraphResolution,
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
    return await processTopicAnalysis(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 2, // Process up to 2 analyses in parallel (CPU-intensive)
  },
);

/**
 * Label assignment worker
 * Uses LLM to assign labels to ingested episodes
 */
export const labelAssignmentWorker = new Worker(
  "label-assignment-queue",
  async (job) => {
    const payload = job.data as LabelAssignmentPayload;
    return await processLabelAssignment(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5, // Process up to 5 label assignments in parallel
  },
);

/**
 * Title generation worker
 * Uses LLM to generate titles for ingested episodes
 */
export const titleGenerationWorker = new Worker(
  "title-generation-queue",
  async (job) => {
    const payload = job.data as TitleGenerationPayload;
    return await processTitleGeneration(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 10, // Process up to 10 title generations in parallel
  },
);

/**
 * Persona generation worker
 * Handles CPU-intensive persona generation with HDBSCAN clustering
 */
export const personaGenerationWorker = new Worker(
  "persona-generation-queue",
  async (job) => {
    const payload = job.data as PersonaGenerationPayload;
    return await processPersonaGeneration(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 1, // Process one persona generation at a time (CPU-intensive)
  },
);

/**
 * Graph resolution worker
 * Handles async entity and statement resolution after episode ingestion
 */
export const graphResolutionWorker = new Worker(
  "graph-resolution-queue",
  async (job) => {
    const payload = job.data as GraphResolutionPayload;
    return await processGraphResolution(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 3, // Process up to 3 resolutions in parallel
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
    labelAssignmentWorker.close(),
    titleGenerationWorker.close(),
    personaGenerationWorker.close(),
    graphResolutionWorker.close(),
  ]);
  logger.log("All BullMQ workers closed");
}
