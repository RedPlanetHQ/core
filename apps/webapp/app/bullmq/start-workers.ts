/**
 * BullMQ Worker Startup Script
 *
 * This script starts all BullMQ workers for processing background jobs.
 * Run this as a separate process alongside your main application.
 *
 * Usage:
 *   tsx apps/webapp/app/bullmq/start-workers.ts
 */

import { logger } from "~/services/logger.service";
import {
  ingestWorker,
  documentIngestWorker,
  conversationTitleWorker,
  deepSearchWorker,
  sessionCompactionWorker,
  closeAllWorkers,
} from "./workers";
import {
  ingestQueue,
  documentIngestQueue,
  conversationTitleQueue,
  deepSearchQueue,
  sessionCompactionQueue,
} from "./queues";
import {
  setupWorkerLogging,
  startPeriodicMetricsLogging,
} from "./utils/worker-logger";

let metricsInterval: NodeJS.Timeout | null = null;

/**
 * Initialize and start all BullMQ workers with comprehensive logging
 */
export async function initWorkers(): Promise<void> {
  // Setup comprehensive logging for all workers
  setupWorkerLogging(ingestWorker, ingestQueue, "ingest-episode");
  setupWorkerLogging(
    documentIngestWorker,
    documentIngestQueue,
    "ingest-document",
  );
  setupWorkerLogging(
    conversationTitleWorker,
    conversationTitleQueue,
    "conversation-title",
  );
  setupWorkerLogging(deepSearchWorker, deepSearchQueue, "deep-search");
  setupWorkerLogging(
    sessionCompactionWorker,
    sessionCompactionQueue,
    "session-compaction",
  );

  // Start periodic metrics logging (every 60 seconds)
  metricsInterval = startPeriodicMetricsLogging(
    [
      { worker: ingestWorker, queue: ingestQueue, name: "ingest-episode" },
      {
        worker: documentIngestWorker,
        queue: documentIngestQueue,
        name: "ingest-document",
      },
      {
        worker: conversationTitleWorker,
        queue: conversationTitleQueue,
        name: "conversation-title",
      },
      { worker: deepSearchWorker, queue: deepSearchQueue, name: "deep-search" },
      {
        worker: sessionCompactionWorker,
        queue: sessionCompactionQueue,
        name: "session-compaction",
      },
    ],
    60000, // Log metrics every 60 seconds
  );

  // Log worker startup
  logger.log("\n🚀 Starting BullMQ workers...");
  logger.log("─".repeat(80));
  logger.log(`✓ Ingest worker: ${ingestWorker.name} (concurrency: 5)`);
  logger.log(
    `✓ Document ingest worker: ${documentIngestWorker.name} (concurrency: 3)`,
  );
  logger.log(
    `✓ Conversation title worker: ${conversationTitleWorker.name} (concurrency: 10)`,
  );
  logger.log(`✓ Deep search worker: ${deepSearchWorker.name} (concurrency: 5)`);
  logger.log(
    `✓ Session compaction worker: ${sessionCompactionWorker.name} (concurrency: 3)`,
  );
  logger.log("─".repeat(80));
  logger.log("✅ All BullMQ workers started and listening for jobs");
  logger.log("📊 Metrics will be logged every 60 seconds\n");
}

/**
 * Shutdown all workers gracefully
 */
export async function shutdownWorkers(): Promise<void> {
  logger.log("Shutdown signal received, closing workers gracefully...");
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }
  await closeAllWorkers();
}

// If running as standalone script, initialize workers
if (import.meta.url === `file://${process.argv[1]}`) {
  initWorkers();

  // Handle graceful shutdown
  const shutdown = async () => {
    await shutdownWorkers();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
