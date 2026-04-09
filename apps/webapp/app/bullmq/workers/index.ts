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
import { getBurstSafeBullmqConcurrency } from "~/services/llm-provider.server";
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
  taskQueue,
  scheduledTaskQueue,
  scratchpadScanQueue,
} from "~/bullmq/queues";
import {
  type TaskPayload,
  processTask,
} from "~/jobs/task/task.logic";
import {
  type ScratchpadScanPayload,
  processScratchpadScan,
} from "~/jobs/scratchpad/scratchpad-scan.logic";
import {
  type ScheduledTaskPayload,
  processScheduledTask,
} from "~/jobs/task/scheduled-task.logic";
import {
  type ActivityCasePayload,
  processActivityCase,
} from "~/jobs/integrations/activity-case.logic";
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
      (compactionPayload, delayMs) =>
        enqueueSessionCompaction(compactionPayload, delayMs),
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_INGEST",
      env.BULLMQ_CONCURRENCY_INGEST,
    ), // Keep proxy/self-hosted chat from being dogpiled by background ingestion unless explicitly overridden
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_CONVERSATION_TITLE",
      env.BULLMQ_CONCURRENCY_CONVERSATION_TITLE,
    ), // Strict providers benefit from serial title generation unless explicitly overridden
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_SESSION_COMPACTION",
      env.BULLMQ_CONCURRENCY_SESSION_COMPACTION,
    ), // Compaction is background polish; keep it from competing with chat unless explicitly overridden
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_LABEL_ASSIGNMENT",
      env.BULLMQ_CONCURRENCY_LABEL_ASSIGNMENT,
    ), // Labels are non-critical background work for proxy mode unless explicitly overridden
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_TITLE_GENERATION",
      env.BULLMQ_CONCURRENCY_TITLE_GENERATION,
    ), // Keep follow-up title generation from stampeding strict providers unless explicitly overridden
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_PERSONA_GENERATION",
      env.BULLMQ_CONCURRENCY_PERSONA_GENERATION,
    ), // Serialize expensive background LLM work for burst-sensitive setups unless explicitly overridden
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
    concurrency: getBurstSafeBullmqConcurrency(
      "BULLMQ_CONCURRENCY_GRAPH_RESOLUTION",
      env.BULLMQ_CONCURRENCY_GRAPH_RESOLUTION,
    ), // Proxy mode needs stricter background pacing unless explicitly overridden
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
 * Activity CASE worker
 * Sends new integration activities through the CASE pipeline
 */
export const activityCaseWorker = new Worker(
  "activity-case-queue",
  async (job) => {
    const payload = job.data as ActivityCasePayload;
    return await processActivityCase(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

/**
 * Scheduled task worker
 * Processes scheduled/recurring tasks (unified with reminders)
 */
export const scheduledTaskWorker = new Worker(
  "scheduled-task-queue",
  async (job) => {
    const payload = job.data as ScheduledTaskPayload;
    return await processScheduledTask(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 10,
  },
);

/**
 * Task worker
 * Processes long-running tasks
 */
export const taskWorker = new Worker(
  "task-queue",
  async (job) => {
    const payload = job.data as TaskPayload;
    return await processTask(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

/**
 * Scratchpad scan worker
 * Processes mention and proactive scratchpad scan jobs
 */
export const scratchpadScanWorker = new Worker(
  "scratchpad-scan-queue",
  async (job) => {
    const payload = job.data as ScratchpadScanPayload;
    return await processScratchpadScan(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
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
    activityCaseWorker.close(),
    scheduledTaskWorker.close(),
    taskWorker.close(),
    reminderQueue.close(),
    followUpQueue.close(),
    scheduledTaskQueue.close(),
    taskQueue.close(),
    scratchpadScanWorker.close(),
    scratchpadScanQueue.close(),
  ]);
  logger.log("All BullMQ workers closed");
}
