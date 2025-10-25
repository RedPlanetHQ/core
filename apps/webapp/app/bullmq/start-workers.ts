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

export async function startWorkers() {}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logger.log("SIGTERM received, closing workers gracefully...");
  await closeAllWorkers();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.log("SIGINT received, closing workers gracefully...");
  await closeAllWorkers();
  process.exit(0);
});

// Log worker startup
logger.log("Starting BullMQ workers...");
logger.log(`- Ingest worker: ${ingestWorker.name}`);
logger.log(`- Document ingest worker: ${documentIngestWorker.name}`);
logger.log(`- Conversation title worker: ${conversationTitleWorker.name}`);
logger.log(`- Deep search worker: ${deepSearchWorker.name}`);
logger.log(`- Session compaction worker: ${sessionCompactionWorker.name}`);
logger.log("All BullMQ workers started and listening for jobs");
