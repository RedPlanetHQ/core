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
import { processEpisodePreprocessing } from "~/jobs/ingest/preprocess-episode.logic";
import {
  processConversationTitleCreation,
  type CreateConversationTitlePayload,
} from "~/jobs/conversation/create-title.logic";
import {
  processSessionCompaction,
  type SessionCompactionPayload,
} from "~/jobs/session/session-compaction.logic";
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
  enqueuePersonaGeneration,
  enqueueGraphResolution,
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
import { addToQueue } from "~/lib/ingest.server";
import {
  type IntegrationRunPayload,
  processIntegrationRun,
} from "~/jobs/integrations/integration-run.logic";
import {
  type ReminderJobData,
  type FollowUpJobData,
  processReminderJob,
  processFollowUpJob,
} from "~/jobs/reminder/reminder.logic";
import {
  createActivities,
  createIntegrationAccount,
  saveIntegrationAccountState,
  saveMCPConfig,
} from "~/trigger/utils/message-utils";
import { extractMessagesFromOutput } from "~/trigger/utils/cli-message-handler";
import {
  scheduleNextOccurrence,
  deactivateReminder,
} from "~/services/reminder.server";
import {
  reminderQueue,
  followUpQueue,
  backgroundTaskQueue,
} from "~/bullmq/queues";
import {
  type BackgroundTaskPayload,
  processBackgroundTask,
} from "~/jobs/background-task/background-task.logic";
import { env } from "~/env.server";

/**
 * Episode preprocessing worker
 * Handles chunking, versioning, and differential analysis before ingestion
 */
export const preprocessWorker = new Worker(
  "preprocess-queue",
  async (job) => {
    const payload = job.data as IngestEpisodePayload;

    const result = await processEpisodePreprocessing(
      payload,
      // Callback to enqueue individual chunk ingestion jobs
      enqueueIngestEpisode,
      // Callback to enqueue session compaction for conversations
      enqueueSessionCompaction,
    );
    if (!result?.success) {
      throw new Error(result?.error || "Episode preprocessing failed");
    }
    return result;
  },
  {
    connection: getRedisConnection(),
    concurrency: env.BULLMQ_CONCURRENCY_PREPROCESS, // Process preprocessing jobs in parallel
  },
);

/**
 * Episode ingestion worker
 * Processes individual episode ingestion jobs (receives pre-chunked episodes from preprocessing)
 *
 * Note: BullMQ uses global concurrency limit (3 jobs max).
 * Trigger.dev uses per-user concurrency via concurrencyKey.
 * For most open-source deployments, global concurrency is sufficient.
 */
export const ingestWorker = new Worker(
  "ingest-queue",
  async (job) => {
    const payload = job.data as IngestEpisodePayload;

    const result = await processEpisodeIngestion(
      payload,
      // Callbacks to enqueue follow-up jobs
      enqueueLabelAssignment,
      enqueueTitleGeneration,
      enqueuePersonaGeneration,
      enqueueGraphResolution,
    );
    if (!result?.success) {
      throw new Error(result?.error || "Episode ingestion failed");
    }
    return result;
  },
  {
    connection: getRedisConnection(),
    concurrency: env.BULLMQ_CONCURRENCY_INGEST, // Global limit for ingestion jobs
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
    concurrency: env.BULLMQ_CONCURRENCY_CONVERSATION_TITLE, // Process title creations in parallel
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
    concurrency: env.BULLMQ_CONCURRENCY_SESSION_COMPACTION, // Process compactions in parallel
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
    concurrency: env.BULLMQ_CONCURRENCY_LABEL_ASSIGNMENT, // Process label assignments in parallel
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
    concurrency: env.BULLMQ_CONCURRENCY_TITLE_GENERATION, // Process title generations in parallel
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
    return await processPersonaGeneration(payload, addToQueue);
  },
  {
    connection: getRedisConnection(),
    concurrency: env.BULLMQ_CONCURRENCY_PERSONA_GENERATION, // Persona is CPU-intensive
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
    concurrency: env.BULLMQ_CONCURRENCY_GRAPH_RESOLUTION, // Graph resolution concurrency
  },
);

/**
 * Integration run worker
 * Handles integration execution (SETUP, SYNC, PROCESS, IDENTIFY events)
 */
export const integrationRunWorker = new Worker(
  "integration-run-queue",
  async (job) => {
    const payload = job.data as IntegrationRunPayload;

    // Call common logic with BullMQ-specific callbacks
    return await processIntegrationRun(payload, {
      createActivities,
      saveState: saveIntegrationAccountState,
      createAccount: createIntegrationAccount,
      saveMCPConfig,
      triggerWebhook: undefined,
      extractMessages: extractMessagesFromOutput,
    });
  },
  {
    connection: getRedisConnection(),
    concurrency: env.BULLMQ_CONCURRENCY_INTEGRATION_RUN, // Process integrations in parallel
  },
);

/**
 * Reminder worker
 * Processes scheduled reminders
 */
export const reminderWorker = new Worker(
  "reminder-queue",
  async (job) => {
    const payload = job.data as ReminderJobData;

    return await processReminderJob(
      payload,
      scheduleNextOccurrence,
      deactivateReminder,
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: env.BULLMQ_CONCURRENCY_REMINDER, // Process reminders in parallel
  },
);

/**
 * Follow-up worker
 * Processes follow-up reminders
 */
export const followUpWorker = new Worker(
  "followup-queue",
  async (job) => {
    const payload = job.data as FollowUpJobData;

    return await processFollowUpJob(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: env.BULLMQ_CONCURRENCY_FOLLOW_UP, // Process follow-ups in parallel
  },
);

/**
 * Background task worker
 * Processes long-running background tasks with user notification
 */
export const backgroundTaskWorker = new Worker(
  "background-task-queue",
  async (job) => {
    const payload = job.data as BackgroundTaskPayload;

    return await processBackgroundTask(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5, // Process up to 5 background tasks in parallel
  },
);

/**
 * Graceful shutdown handler
 */
export async function closeAllWorkers(): Promise<void> {
  await Promise.all([
    preprocessWorker.close(),
    ingestWorker.close(),
    conversationTitleWorker.close(),
    sessionCompactionWorker.close(),
    labelAssignmentWorker.close(),
    titleGenerationWorker.close(),
    personaGenerationWorker.close(),
    graphResolutionWorker.close(),
    integrationRunWorker.close(),
    reminderWorker.close(),
    followUpWorker.close(),
    backgroundTaskWorker.close(),
    reminderQueue.close(),
    followUpQueue.close(),
    backgroundTaskQueue.close(),
  ]);
  logger.log("All BullMQ workers closed");
}
