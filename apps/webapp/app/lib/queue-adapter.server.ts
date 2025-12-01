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
import type { z } from "zod";
import type { IngestBodyRequest, IngestEpisodePayload } from "~/jobs/ingest/ingest-episode.logic";
import type { CreateConversationTitlePayload } from "~/jobs/conversation/create-title.logic";
import type { SessionCompactionPayload } from "~/jobs/session/session-compaction.logic";
import type { LabelAssignmentPayload } from "~/jobs/labels/label-assignment.logic";
import type { TitleGenerationPayload } from "~/jobs/titles/title-generation.logic";
import type { GraphResolutionPayload } from "~/jobs/ingest/graph-resolution.logic";

type QueueProvider = "trigger" | "bullmq";

/**
 * Enqueue episode preprocessing job
 */
export async function enqueuePreprocessEpisode(payload: IngestEpisodePayload): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { preprocessTask } = await import("~/trigger/ingest/preprocess-episode");
    const handler = await preprocessTask.trigger(payload, {
      queue: "preprocessing-queue",
      concurrencyKey: payload.userId,
      tags: [payload.userId, payload.queueId],
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { preprocessQueue } = await import("~/bullmq/queues");
    const job = await preprocessQueue.add("preprocess-episode", payload, {
      jobId: payload.queueId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue episode ingestion job
 */
export async function enqueueIngestEpisode(payload: IngestEpisodePayload): Promise<{ id?: string; token?: string }> {
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
    const { createConversationTitle } = await import(
      "~/trigger/conversation/create-conversation-title"
    );
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
    const { triggerSessionCompaction } = await import(
      "~/trigger/session/session-compaction"
    );
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
 * Enqueue BERT topic analysis job
 * Always uses BullMQ regardless of QUEUE_PROVIDER setting
 */
export async function enqueueBertTopicAnalysis(payload: {
  userId: string;
  workspaceId: string;
  minTopicSize?: number;
  nrTopics?: number;
}): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { bertTopicAnalysisTask } = await import("~/trigger/bert/bert");
    const handler = await bertTopicAnalysisTask.trigger(payload, {
      concurrencyKey: payload.userId,
      tags: [payload.userId, "bert-analysis"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { bertTopicQueue } = await import("~/bullmq/queues");
    const job = await bertTopicQueue.add("topic-analysis", payload, {
      jobId: `bert-${payload.userId}-${Date.now()}`,
      attempts: 2, // Only 2 attempts for expensive operations
      backoff: { type: "exponential", delay: 5000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue persona generation job
 */
export async function enqueuePersonaGeneration(payload: {
  userId: string;
  workspaceId: string;
}): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { personaGenerationTask } = await import(
      "~/trigger/spaces/persona-generation"
    );
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
    const { labelAssignmentTask } = await import(
      "~/trigger/labels/label-assignment"
    );
    const handler = await labelAssignmentTask.trigger(payload, {
      tags: [payload.userId, "label-assignment"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { labelAssignmentQueue } = await import("~/bullmq/queues");
    const job = await labelAssignmentQueue.add("label-assignment", payload, {
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
    const { titleGenerationTask } = await import(
      "~/trigger/titles/title-generation"
    );
    const handler = await titleGenerationTask.trigger(payload, {
      tags: [payload.userId, "title-generation"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { titleGenerationQueue } = await import("~/bullmq/queues");
    const job = await titleGenerationQueue.add("title-generation", payload, {
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
    const { graphResolutionTask } = await import(
      "~/trigger/ingest/graph-resolution"
    );
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

export const isTriggerDeployment = () => {
  return env.QUEUE_PROVIDER === "trigger";
};

/**
 * Enqueue conversation import job
 *
 * Auto-detects storage strategy:
 * - Trigger.dev + S3 configured: Upload to S3, trigger Trigger.dev
 * - Otherwise: Save to temp directory, queue BullMQ
 */
export async function enqueueImportConversations(payload: {
  userId: string;
  workspaceId: string;
  provider: "claude" | "openai";
  dryRun?: boolean;
  storageSource: { type: 'local'; filePath: string } | { type: 's3'; key: string };
}): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;
  const { isS3Configured } = await import("~/lib/storage.server");

  // Use Trigger.dev only if both QUEUE_PROVIDER=trigger AND S3 is configured
  const shouldUseTrigger = provider === "trigger" && isS3Configured();

  if (shouldUseTrigger) {
    const { importConversationsTask } = await import("~/trigger/imports/import-conversations");
    const handler = await importConversationsTask.trigger(payload, {
      concurrencyKey: payload.userId,
      tags: [payload.userId, "import-conversations"],
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { importConversationsQueue } = await import("~/bullmq/queues");
    const job = await importConversationsQueue.add("import-conversations", payload, {
      jobId: `import-${payload.userId}-${Date.now()}`,
      attempts: 2, // Expensive operation, only retry once
      backoff: { type: "exponential", delay: 5000 },
    });
    return { id: job.id };
  }
}
