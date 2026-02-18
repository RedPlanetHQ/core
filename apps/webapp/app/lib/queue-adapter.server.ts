/**
 * Queue Adapter
 *
 * This module provides a unified interface for queueing background jobs,
 * supporting both Trigger.dev and BullMQ backends based on the QUEUE_PROVIDER
 * environment variable.
 *
 * Usage:
 * - Set QUEUE_PROVIDER="trigger" for Trigger.dev (default, good for production scaling)
 * - Set QUEUE_PROVIDER="bullmq" for BullMQ (good for open-source deployments)
 */

import { env } from "~/env.server";
import type { IngestEpisodePayload } from "~/jobs/ingest/ingest-episode.logic";
import type { CreateConversationTitlePayload } from "~/jobs/conversation/create-title.logic";
import type { SessionCompactionPayload } from "~/jobs/session/session-compaction.logic";
import type { LabelAssignmentPayload } from "~/jobs/labels/label-assignment.logic";
import type { TitleGenerationPayload } from "~/jobs/titles/title-generation.logic";
import type { GraphResolutionPayload } from "~/jobs/ingest/graph-resolution.logic";
import type { IntegrationRunPayload } from "~/jobs/integrations/integration-run.logic";
import type {
  ReminderJobData,
  FollowUpJobData,
} from "~/jobs/reminder/reminder.logic";
import { runs } from "@trigger.dev/sdk";

export type QueueProvider = "trigger" | "bullmq";

/**
 * Enqueue episode preprocessing job
 */
export async function enqueuePreprocessEpisode(
  payload: IngestEpisodePayload,
  delay?: boolean,
): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { preprocessTask } =
      await import("~/trigger/ingest/preprocess-episode");
    const handler = await preprocessTask.trigger(payload, {
      queue: "preprocessing-queue",
      concurrencyKey: payload.userId,
      tags: [payload.userId, payload.queueId],
      delay: delay ? "5m" : undefined,
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { preprocessQueue } = await import("~/bullmq/queues");
    const job = await preprocessQueue.add("preprocess-episode", payload, {
      jobId: payload.queueId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      delay: delay ? 5 * 60 * 1000 : undefined, // 5 minutes in milliseconds
    });
    return { id: job.id };
  }
}

/**
 * Enqueue episode ingestion job
 */
export async function enqueueIngestEpisode(
  payload: IngestEpisodePayload,
): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { ingestTask } = await import("~/trigger/ingest/ingest");
    const handler = await ingestTask.trigger(payload, {
      queue: "ingestion-queue",
      concurrencyKey: payload.userId,
      tags: [payload.userId, payload.queueId],
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { ingestQueue } = await import("~/bullmq/queues");
    const job = await ingestQueue.add("ingest-episode", payload, {
      jobId: payload.queueId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue conversation title creation job
 */
export async function enqueueCreateConversationTitle(
  payload: CreateConversationTitlePayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { createConversationTitle } =
      await import("~/trigger/conversation/create-conversation-title");
    const handler = await createConversationTitle.trigger(payload);
    return { id: handler.id };
  } else {
    // BullMQ
    const { conversationTitleQueue } = await import("~/bullmq/queues");
    const job = await conversationTitleQueue.add(
      "create-conversation-title",
      payload,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
    return { id: job.id };
  }
}

/**
 * Enqueue session compaction job
 */
export async function enqueueSessionCompaction(
  payload: SessionCompactionPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { triggerSessionCompaction } =
      await import("~/trigger/session/session-compaction");
    const handler = await triggerSessionCompaction(payload);
    return { id: handler.id };
  } else {
    // BullMQ
    const { sessionCompactionQueue } = await import("~/bullmq/queues");
    const job = await sessionCompactionQueue.add(
      "session-compaction",
      payload,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
    return { id: job.id };
  }
}

/**
 * Enqueue persona generation job
 */
export async function enqueuePersonaGeneration(payload: {
  userId: string;
  workspaceId: string;
  episodeUuid?: string;
}): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { personaGenerationTask } =
      await import("~/trigger/spaces/persona-generation");
    const handler = await personaGenerationTask.trigger(payload, {
      concurrencyKey: payload.userId,
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { personaGenerationQueue } = await import("~/bullmq/queues");
    const job = await personaGenerationQueue.add(
      "persona-generation",
      payload,
      {
        jobId: `persona-${payload.userId}-${Date.now()}`,
        attempts: 2, // Only 2 attempts for expensive operations
        backoff: { type: "exponential", delay: 5000 },
      },
    );
    return { id: job.id };
  }
}

/* Enqueue label assignment job
 */
export async function enqueueLabelAssignment(
  payload: LabelAssignmentPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { labelAssignmentTask } =
      await import("~/trigger/labels/label-assignment");
    const handler = await labelAssignmentTask.trigger(payload, {
      queue: "label-assignment-queue",
      tags: [payload.userId, "label-assignment"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { labelAssignmentQueue } = await import("~/bullmq/queues");
    const job = await labelAssignmentQueue.add("label-assignment", payload, {
      jobId: `label-${payload.queueId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue title generation job
 */
export async function enqueueTitleGeneration(
  payload: TitleGenerationPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { titleGenerationTask } =
      await import("~/trigger/titles/title-generation");
    const handler = await titleGenerationTask.trigger(payload, {
      tags: [payload.userId, "title-generation"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { titleGenerationQueue } = await import("~/bullmq/queues");
    const job = await titleGenerationQueue.add("title-generation", payload, {
      jobId: `title-${payload.queueId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue graph resolution job
 */
export async function enqueueGraphResolution(
  payload: GraphResolutionPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { graphResolutionTask } =
      await import("~/trigger/ingest/graph-resolution");
    const handler = await graphResolutionTask.trigger(payload, {
      concurrencyKey: payload.userId,
      queue: "graph-resolution-queue",
      tags: [payload.userId, payload.queueId as string],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { graphResolutionQueue } = await import("~/bullmq/queues");
    const job = await graphResolutionQueue.add("graph-resolution", payload, {
      jobId: `resolution-${payload.episodeUuid}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue integration run job
 */
export async function enqueueIntegrationRun(
  payload: IntegrationRunPayload,
): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { integrationRun } =
      await import("~/trigger/integrations/integration-run");
    const handler = await integrationRun.trigger(payload, {
      queue: "integration-run-queue",
      concurrencyKey: payload.userId,
      tags: [
        payload.userId || "unknown",
        payload.integrationDefinition.slug,
        payload.event,
      ],
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { integrationRunQueue } = await import("~/bullmq/queues");
    const job = await integrationRunQueue.add("integration-run", payload, {
      // Use integration account ID + event type for deduplication
      jobId: payload.integrationAccount?.id
        ? `integration-${payload.integrationAccount.id}-${payload.event}-${Date.now()}`
        : `integration-${payload.integrationDefinition.id}-${payload.event}-${Date.now()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue reminder job (with delay support for scheduling)
 */
export async function enqueueReminder(
  payload: ReminderJobData,
  nextRunAt: Date,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;
  const delay = Math.max(nextRunAt.getTime() - Date.now(), 0);
  const jobId = `reminder-${payload.reminderId}-${nextRunAt.getTime()}`;

  if (provider === "trigger") {
    const { reminderTask } = await import("~/trigger/reminders/reminder");
    const handler = await reminderTask.trigger(payload, {
      queue: "reminder-queue",
      delay: delay > 0 ? `${Math.ceil(delay / 1000)}s` : undefined,
      concurrencyKey: payload.workspaceId,
      idempotencyKey: jobId,
      tags: [`reminder:${payload.reminderId}`, payload.workspaceId],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { reminderQueue } = await import("~/bullmq/queues");
    const job = await reminderQueue.add(
      `reminder-${payload.reminderId}`,
      payload,
      {
        delay,
        jobId,
      },
    );
    return { id: job.id };
  }
}

/**
 * Remove scheduled reminder job
 */
export async function removeScheduledReminder(
  reminderId: string,
): Promise<void> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    // Trigger.dev - find and cancel runs by tag
    try {
      const pendingRuns = await runs.list({
        tag: [`reminder:${reminderId}`],
        status: ["QUEUED", "DELAYED"],
      });

      for await (const run of pendingRuns) {
        await runs.cancel(run.id);
      }
    } catch (error) {
      // Silently fail - job may not exist
    }
  } else {
    // BullMQ - find and remove jobs matching reminderId
    const { reminderQueue } = await import("~/bullmq/queues");
    const delayed = await reminderQueue.getDelayed();
    const waiting = await reminderQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    for (const job of jobs) {
      if (job.data.reminderId === reminderId) {
        await job.remove();
      }
    }
  }
}

/**
 * Enqueue follow-up job
 */
export async function enqueueFollowUp(
  payload: FollowUpJobData,
  scheduledFor: Date,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;
  const delay = Math.max(scheduledFor.getTime() - Date.now(), 0);
  const jobId = `followup-${payload.parentReminderId}-${scheduledFor.getTime()}`;

  if (provider === "trigger") {
    const { followUpTask } = await import("~/trigger/reminders/reminder");
    const handler = await followUpTask.trigger(payload, {
      queue: "followup-queue",
      delay: delay > 0 ? `${Math.ceil(delay / 1000)}s` : undefined,
      idempotencyKey: jobId,
      concurrencyKey: payload.workspaceId,
      tags: [`followup:${payload.parentReminderId}`, payload.workspaceId],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { followUpQueue } = await import("~/bullmq/queues");
    const job = await followUpQueue.add(
      `followup-${payload.parentReminderId}`,
      payload,
      {
        delay,
        jobId,
      },
    );
    return { id: job.id };
  }
}

/**
 * Cancel follow-ups for a reminder
 */
export async function cancelFollowUpsForReminder(
  reminderId: string,
): Promise<number> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    // Trigger.dev - find and cancel runs by tag
    try {
      const pendingRuns = await runs.list({
        tag: [`followup:${reminderId}`],
        status: ["QUEUED", "DELAYED"],
      });

      let cancelledCount = 0;
      for await (const run of pendingRuns) {
        await runs.cancel(run.id);
        cancelledCount++;
      }
      return cancelledCount;
    } catch (error) {
      return 0;
    }
  } else {
    // BullMQ
    const { followUpQueue } = await import("~/bullmq/queues");
    const delayed = await followUpQueue.getDelayed();
    const waiting = await followUpQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    let cancelledCount = 0;
    for (const job of jobs) {
      if (job.data.parentReminderId === reminderId) {
        await job.remove();
        cancelledCount++;
      }
    }
    return cancelledCount;
  }
}

export const isTriggerDeployment = () => {
  return env.QUEUE_PROVIDER === "trigger";
};
