/**
 * BullMQ Queues
 *
 * All queue definitions for the BullMQ implementation
 */

import { Queue } from "bullmq";
import { getRedisConnection } from "../connection";

/**
 * Episode ingestion queue
 * Handles individual episode ingestion (including document chunks)
 */
export const ingestQueue = new Queue("ingest-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

/**
 * Document ingestion queue
 * Handles document-level ingestion with differential processing
 */
export const documentIngestQueue = new Queue("document-ingest-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

/**
 * Conversation title creation queue
 */
export const conversationTitleQueue = new Queue("conversation-title-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

/**
 * Session compaction queue
 */
export const sessionCompactionQueue = new Queue("session-compaction-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

/**
 * BERT topic analysis queue
 * Handles CPU-intensive topic modeling on user episodes
 */
export const bertTopicQueue = new Queue("bert-topic-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 2, // Only 2 attempts due to long runtime
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 7200, // Keep completed jobs for 2 hours
      count: 100,
    },
    removeOnFail: {
      age: 172800, // Keep failed jobs for 48 hours (for debugging)
    },
  },
});

/**
 * Space assignment queue
 * Handles assigning episodes to spaces based on semantic matching
 */
export const spaceAssignmentQueue = new Queue("space-assignment-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

/**
 * Space summary queue
 * Handles generating summaries for spaces
 */
export const spaceSummaryQueue = new Queue("space-summary-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});
