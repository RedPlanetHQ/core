/**
 * BullMQ Queues
 *
 * All queue definitions for the BullMQ implementation
 */

import { Queue } from "bullmq";
import { getRedisConnection } from "../connection";

/**
 * Episode preprocessing queue
 * Handles chunking, versioning, and differential analysis before ingestion
 */
export const preprocessQueue = new Queue("preprocess-queue", {
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
 * Episode ingestion queue
 * Handles individual episode ingestion (receives pre-chunked episodes from preprocessing)
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
 * Label assignment queue
 * Uses LLM to assign appropriate labels to ingested episodes
 */
export const labelAssignmentQueue = new Queue("label-assignment-queue", {
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
 * Title generation queue
 * Uses LLM to generate titles for ingested episodes
 */
export const titleGenerationQueue = new Queue("title-generation-queue", {
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
 * Persona generation queue
 * Handles CPU-intensive persona generation with HDBSCAN clustering
 */
export const personaGenerationQueue = new Queue("persona-generation-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 2, // Only 2 attempts for expensive operations
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
 * Graph resolution queue
 * Handles async entity and statement resolution after episode ingestion
 */
export const graphResolutionQueue = new Queue("graph-resolution-queue", {
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
 * Integration run queue
 * Handles integration execution (SETUP, SYNC, PROCESS, IDENTIFY events)
 */
export const integrationRunQueue = new Queue("integration-run-queue", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours for debugging
    },
  },
});
