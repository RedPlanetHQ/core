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
